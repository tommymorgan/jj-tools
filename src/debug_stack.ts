#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import {
	type CommandExecutor,
	detectStackWithRemotes,
} from "./stack_detection.ts";

const realExecutor: CommandExecutor = {
	exec: async (cmd: string[]) => {
		const process = new Deno.Command(cmd[0], {
			args: cmd.slice(1),
			stdout: "piped",
			stderr: "piped",
		});
		const result = await process.output();
		const decoder = new TextDecoder();
		return {
			stdout: decoder.decode(result.stdout),
			stderr: decoder.decode(result.stderr),
			code: result.code,
		};
	},
};

async function getMyPRs(): Promise<
	{ number: number; headRefName: string; baseRefName: string; title: string }[]
> {
	console.log("📋 Fetching your PRs...");
	const result = await realExecutor.exec([
		"gh",
		"pr",
		"list",
		"--author",
		"@me",
		"--json",
		"number,headRefName,baseRefName,title",
		"--limit",
		"50",
	]);

	if (result.code !== 0) {
		console.error("❌ Failed to fetch PRs:", result.stderr);
		return [];
	}

	try {
		return JSON.parse(result.stdout);
	} catch (e) {
		console.error("❌ Failed to parse PR data:", e);
		return [];
	}
}

async function checkBookmarkStatus(bookmarkName: string): Promise<{
	hasLocal: boolean;
	hasRemote: boolean;
	remotes: string[];
}> {
	// Check if local bookmark exists
	const localResult = await realExecutor.exec(["jj", "bookmark", "list"]);

	const hasLocal =
		localResult.stdout.includes(`${bookmarkName}:`) ||
		localResult.stdout.includes(`${bookmarkName} `);

	// Check for remote bookmarks
	const remoteResult = await realExecutor.exec([
		"jj",
		"bookmark",
		"list",
		"-a",
	]);

	const remotes: string[] = [];
	const lines = remoteResult.stdout.split("\n");
	for (const line of lines) {
		// Match patterns like "bookmark@origin:" or "bookmark@upstream:"
		const remotePattern = new RegExp(`${bookmarkName}@(\\w+):`);
		const match = line.match(remotePattern);
		if (match) {
			remotes.push(match[1]);
		}
	}

	return {
		hasLocal,
		hasRemote: remotes.length > 0,
		remotes,
	};
}

async function debugStack() {
	console.log("🔍 Debug Stack Detection Tool\n");

	// Step 1: Get user's PRs
	const prs = await getMyPRs();
	console.log(`\n📊 Found ${prs.length} PRs\n`);

	if (prs.length > 0) {
		console.log("Your PRs:");
		for (const pr of prs.slice(0, 10)) {
			// Show first 10
			console.log(`  #${pr.number}: ${pr.headRefName} → ${pr.baseRefName}`);
			console.log(`    Title: ${pr.title}`);

			// Check bookmark status
			const status = await checkBookmarkStatus(pr.headRefName);
			console.log(
				`    Local bookmark: ${status.hasLocal ? "✅ YES" : "❌ NO"}`,
			);
			if (status.hasRemote) {
				console.log(
					`    Remote bookmarks: ${status.remotes.map((r) => `${pr.headRefName}@${r}`).join(", ")}`,
				);
			}
			console.log();
		}
	}

	// Step 2: Detect current stack
	console.log("\n🔍 Detecting current stack...\n");

	// Get current position
	const posResult = await realExecutor.exec([
		"jj",
		"log",
		"--no-graph",
		"-r",
		"@",
		"-T",
		'change_id.shortest(7) ++ " " ++ bookmarks',
	]);
	console.log("Current position:", posResult.stdout.trim());

	// Try stack detection with remotes
	try {
		const stackInfo = await detectStackWithRemotes(realExecutor);

		console.log("\n📚 Stack Detection Results:");
		console.log(`  Local bookmarks found: ${stackInfo.localBookmarks.length}`);
		console.log(
			`  Remote bookmarks found: ${stackInfo.remoteBookmarks.length}`,
		);
		console.log(
			`  Has remote-only bookmarks: ${stackInfo.hasRemoteOnlyBookmarks}`,
		);

		if (stackInfo.localBookmarks.length > 0) {
			console.log("\n  Local bookmarks in stack:");
			for (const bookmark of stackInfo.localBookmarks) {
				console.log(
					`    - ${bookmark.name}${bookmark.isCurrent ? " (current)" : ""}`,
				);
			}
		}

		if (stackInfo.remoteBookmarks.length > 0) {
			console.log("\n  Remote bookmarks in stack:");
			for (const remote of stackInfo.remoteBookmarks) {
				console.log(`    - ${remote.name}@${remote.remote}`);
			}
		}

		// Step 3: Check which PR bookmarks are in the current stack
		console.log("\n🔗 Checking PR bookmarks in current stack:");

		// Get all bookmarks in the current stack (including ancestors)
		const ancestorResult = await realExecutor.exec([
			"jj",
			"log",
			"--no-graph",
			"-r",
			"::@",
			"-T",
			"bookmarks",
			"--no-elided-nodes",
		]);

		const ancestorBookmarks = ancestorResult.stdout
			.split("\n")
			.filter((line) => line.trim())
			.flatMap((line) => line.split(/\s+/))
			.filter((b) => b && !b.includes("(") && !b.includes(")"));

		console.log("\n  All bookmarks in ancestors:", ancestorBookmarks.length);

		// Check which PRs are in the stack
		const prsInStack = prs.filter((pr) => {
			const inAncestors = ancestorBookmarks.some(
				(b) => b === pr.headRefName || b === `${pr.headRefName}@origin`,
			);
			return inAncestors;
		});

		console.log(
			`\n  PRs that are in current stack ancestry: ${prsInStack.length}`,
		);
		if (prsInStack.length > 0) {
			for (const pr of prsInStack) {
				const status = await checkBookmarkStatus(pr.headRefName);
				console.log(
					`    #${pr.number}: ${pr.headRefName} (Local: ${status.hasLocal ? "✅" : "❌"})`,
				);
			}
		}

		// Try to identify the actual linear stack (excluding master)
		console.log("\n🎯 Detecting linear stack (excluding base branch):");
		const linearResult = await realExecutor.exec([
			"jj",
			"log",
			"--no-graph",
			"-r",
			"::@ ~ ::master",
			"-T",
			"bookmarks",
			"--no-elided-nodes",
		]);

		const linearBookmarks = linearResult.stdout
			.split("\n")
			.filter((line) => line.trim())
			.flatMap((line) => line.split(/\s+/))
			.filter((b) => b && !b.includes("(") && !b.includes(")"));

		console.log("  Bookmarks in linear stack:", linearBookmarks.length);
		if (linearBookmarks.length > 0 && linearBookmarks.length <= 20) {
			for (const bookmark of linearBookmarks) {
				console.log(`    - ${bookmark}`);
			}
		}

		// Step 4: Reconstruct PR stack from remote bookmarks
		console.log("\n🔗 Reconstructing PR stack from remote bookmarks:");

		// Find PRs that match remote bookmarks in the stack
		const remoteBookmarksInStack = stackInfo.remoteBookmarks.map((r) => r.name);
		const stackPRs = prs.filter((pr) =>
			remoteBookmarksInStack.includes(pr.headRefName),
		);

		if (stackPRs.length > 0) {
			console.log(
				`  Found ${stackPRs.length} PRs matching remote bookmarks in stack:`,
			);

			// Find the bottom PR (one that points to master or main)
			const bottomPRs = stackPRs.filter(
				(pr) => pr.baseRefName === "master" || pr.baseRefName === "main",
			);

			if (bottomPRs.length > 0) {
				console.log("\n  PR Stack Chain (bottom to top):");
				let current = bottomPRs[0];
				let level = 1;
				const visited = new Set<string>();

				while (current && !visited.has(current.headRefName)) {
					visited.add(current.headRefName);
					console.log(
						`    ${level}. #${current.number}: ${current.headRefName} → ${current.baseRefName}`,
					);
					console.log(`       ${current.title}`);

					// Find next PR in chain
					const next = stackPRs.find(
						(pr) => pr.baseRefName === current.headRefName,
					);
					if (!next) break;
					current = next;
					level++;
				}
			}
		} else {
			console.log("  No PRs found matching the remote bookmarks in the stack");
		}
	} catch (error) {
		console.error("\n❌ Error during stack detection:", error);
	}
}

// Run the debug tool
if (import.meta.main) {
	await debugStack();
}
