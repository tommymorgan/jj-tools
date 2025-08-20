import type { CommandExecutor } from "./stack_detection.ts";

export interface StackPR {
	number: number;
	headRefName: string;
	baseRefName: string;
	title: string;
}

export interface PRStackInfo {
	prs: StackPR[];
	missingLocalBookmarks: string[];
	existingLocalBookmarks: string[];
}

export async function detectPRStack(
	executor: CommandExecutor,
	baseBranch: string = "master",
): Promise<PRStackInfo> {
	// Step 1: Get all PRs for the current user
	const prsResult = await executor.exec([
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

	if (prsResult.code !== 0) {
		throw new Error(`Failed to fetch PRs: ${prsResult.stderr}`);
	}

	const allPRs: StackPR[] = JSON.parse(prsResult.stdout);

	// Step 2: Find connected PR stacks
	const prStacks = findPRStacks(allPRs, baseBranch);

	// Step 3: Check if we're in any of these stacks
	const ancestorResult = await executor.exec([
		"jj",
		"log",
		"--no-graph",
		"-r",
		`::@`,
		"-T",
		'bookmarks ++ "\n"',
	]);

	// Parse bookmarks in current ancestry
	const bookmarkLines = ancestorResult.stdout
		.split("\n")
		.filter((line) => line.trim());
	const ancestorBookmarks = new Set<string>();

	for (const line of bookmarkLines) {
		// Split by common separators and patterns
		const parts = line.split(/[@\s]+/);
		for (const part of parts) {
			if (part && part !== "origin") {
				ancestorBookmarks.add(part);
			}
		}
	}

	// Find the stack we're currently in (if any)
	let currentStack: StackPR[] = [];
	for (const stack of prStacks) {
		// Check if any PR in this stack is in our ancestry
		const inThisStack = stack.some((pr) =>
			ancestorBookmarks.has(pr.headRefName),
		);
		if (inThisStack) {
			currentStack = stack;
			break;
		}
	}

	// If we're not in any stack but there are stacks, we might need to navigate
	if (currentStack.length === 0 && prStacks.length > 0) {
		// Use the largest stack as the most likely one the user wants
		currentStack = prStacks.reduce((largest, current) =>
			current.length > largest.length ? current : largest,
		);

		console.log(`\n📍 Found a PR stack but you're not currently in it.`);
		console.log(
			`   The stack contains ${currentStack.length} PRs starting from ${currentStack[0]?.headRefName}`,
		);
		console.log(
			`   You may need to navigate to the stack with: jj new ${currentStack[currentStack.length - 1]?.headRefName}@origin\n`,
		);
	}

	// Step 4: Sort PRs to form a chain (bottom to top)
	const sortedPRs = currentStack;

	// Step 5: Check which bookmarks exist locally
	const bookmarkListResult = await executor.exec(["jj", "bookmark", "list"]);

	const localBookmarks = new Set(
		bookmarkListResult.stdout
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => {
				// Extract bookmark name from lines like "bookmark: commit-hash description"
				const match = line.match(/^([^:@\s]+):/);
				return match ? match[1] : null;
			})
			.filter(Boolean),
	);

	const missingLocalBookmarks: string[] = [];
	const existingLocalBookmarks: string[] = [];

	for (const pr of sortedPRs) {
		if (localBookmarks.has(pr.headRefName)) {
			existingLocalBookmarks.push(pr.headRefName);
		} else {
			missingLocalBookmarks.push(pr.headRefName);
		}
	}

	return {
		prs: sortedPRs,
		missingLocalBookmarks,
		existingLocalBookmarks,
	};
}

function findPRStacks(allPRs: StackPR[], baseBranch: string): StackPR[][] {
	const stacks: StackPR[][] = [];
	const processed = new Set<string>();

	// Build a map for quick lookups
	const prsByBase = new Map<string, StackPR[]>();

	for (const pr of allPRs) {
		if (!prsByBase.has(pr.baseRefName)) {
			prsByBase.set(pr.baseRefName, []);
		}
		prsByBase.get(pr.baseRefName)?.push(pr);
	}

	// Find all stacks starting from PRs that base on master/main
	const rootPRs = allPRs.filter(
		(pr) => pr.baseRefName === baseBranch || pr.baseRefName === "main",
	);

	for (const rootPR of rootPRs) {
		if (processed.has(rootPR.headRefName)) continue;

		// Build the stack starting from this root
		const stack: StackPR[] = [];
		let current: StackPR | undefined = rootPR;

		while (current && !processed.has(current.headRefName)) {
			stack.push(current);
			processed.add(current.headRefName);

			// Find PR that bases on current
			const children: StackPR[] = prsByBase.get(current.headRefName) || [];
			current = children.find((pr: StackPR) => !processed.has(pr.headRefName));
		}

		if (stack.length > 0) {
			stacks.push(stack);
		}
	}

	// Add any remaining unconnected PRs as single-PR stacks
	for (const pr of allPRs) {
		if (!processed.has(pr.headRefName)) {
			stacks.push([pr]);
			processed.add(pr.headRefName);
		}
	}

	return stacks;
}

export async function reconcilePRBookmarks(
	executor: CommandExecutor,
	missingBookmarks: string[],
	dryRun: boolean = false,
): Promise<{ success: boolean; createdBookmarks: string[]; error?: string }> {
	const createdBookmarks: string[] = [];

	// First, fetch from remote to ensure we have latest
	if (!dryRun) {
		const fetchResult = await executor.exec(["jj", "git", "fetch"]);
		if (fetchResult.code !== 0) {
			return {
				success: false,
				createdBookmarks: [],
				error: `Failed to fetch from remote: ${fetchResult.stderr}`,
			};
		}
	}

	// Create local bookmarks for each missing one
	for (const bookmarkName of missingBookmarks) {
		const remoteRef = `${bookmarkName}@origin`;

		if (dryRun) {
			console.log(`  🔖 Would create: ${bookmarkName} tracking ${remoteRef}`);
			createdBookmarks.push(bookmarkName);
		} else {
			const createResult = await executor.exec([
				"jj",
				"bookmark",
				"create",
				bookmarkName,
				"-r",
				remoteRef,
			]);

			if (createResult.code === 0) {
				console.log(`  ✅ Created: ${bookmarkName} tracking ${remoteRef}`);
				createdBookmarks.push(bookmarkName);
			} else if (!createResult.stderr.includes("already exists")) {
				console.error(
					`  ❌ Failed to create ${bookmarkName}: ${createResult.stderr}`,
				);
			}
		}
	}

	return {
		success: true,
		createdBookmarks,
	};
}
