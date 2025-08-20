#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { parse as parseVersion } from "@std/semver";

interface CommandResult {
	stdout: string;
	stderr: string;
	code: number;
}

async function exec(cmd: string[]): Promise<CommandResult> {
	const command = new Deno.Command(cmd[0], {
		args: cmd.slice(1),
		stdout: "piped",
		stderr: "piped",
	});

	const { code, stdout, stderr } = await command.output();

	return {
		stdout: new TextDecoder().decode(stdout),
		stderr: new TextDecoder().decode(stderr),
		code,
	};
}

async function getCurrentVersion(): Promise<string> {
	const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
	return denoJson.version;
}

async function getPreviousMainVersion(): Promise<string | null> {
	// First try to get version from main@origin
	console.log("📖 Checking previous main version...");
	
	let result = await exec(["jj", "cat", "-r", "main@origin", "deno.json"]);
	
	if (result.code !== 0) {
		// If main@origin doesn't exist, try the parent commit
		console.log("  No main@origin found, checking parent commit...");
		result = await exec(["jj", "cat", "-r", "@-", "deno.json"]);
		
		if (result.code !== 0) {
			// This might be the first commit
			console.log("  No previous version found (first release?)");
			return null;
		}
	}

	try {
		const previousDenoJson = JSON.parse(result.stdout);
		return previousDenoJson.version;
	} catch (e) {
		console.error("  Failed to parse previous deno.json:", e);
		return null;
	}
}

async function bumpPatchVersion(currentVersion: string): Promise<string> {
	const parsed = parseVersion(currentVersion);
	return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

async function updateVersion(newVersion: string): Promise<void> {
	const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
	denoJson.version = newVersion;
	await Deno.writeTextFile(
		"deno.json",
		JSON.stringify(denoJson, null, "\t") + "\n",
	);
}

async function hasUncommittedChanges(): Promise<boolean> {
	const result = await exec(["jj", "status"]);
	return result.stdout.includes("Working copy changes:");
}

async function amendCommit(): Promise<void> {
	console.log("📝 Amending commit with version bump...");
	const result = await exec(["jj", "amend"]);
	if (result.code !== 0) {
		throw new Error(`Failed to amend commit: ${result.stderr}`);
	}
}

async function isOnMainBookmark(): Promise<boolean> {
	const result = await exec(["jj", "log", "-r", "@", "--no-graph", "-T", "bookmarks"]);
	return result.stdout.includes("main");
}

async function moveMainBookmark(): Promise<void> {
	console.log("🔖 Moving main bookmark to current commit...");
	const result = await exec(["jj", "bookmark", "set", "main", "-r", "@"]);
	if (result.code !== 0) {
		throw new Error(`Failed to move main bookmark: ${result.stderr}`);
	}
}

async function pushToGitHub(): Promise<void> {
	console.log("🚀 Pushing to GitHub...");
	const result = await exec(["jj", "git", "push"]);
	if (result.code !== 0) {
		throw new Error(`Failed to push: ${result.stderr}`);
	}
	console.log(result.stdout);
}

async function main() {
	try {
		// Get current and previous versions
		const currentVersion = await getCurrentVersion();
		console.log(`📦 Current version: ${currentVersion}`);

		const previousVersion = await getPreviousMainVersion();
		
		if (previousVersion) {
			console.log(`📦 Previous main version: ${previousVersion}`);
			
			// Check if version needs bumping
			if (currentVersion === previousVersion) {
				const newVersion = await bumpPatchVersion(currentVersion);
				console.log(`⬆️  Bumping version: ${currentVersion} → ${newVersion}`);
				
				await updateVersion(newVersion);
				
				// Amend the commit if there are changes
				if (await hasUncommittedChanges()) {
					await amendCommit();
				}
			} else {
				const currentParsed = parseVersion(currentVersion);
				const previousParsed = parseVersion(previousVersion);
				
				if (currentParsed.compare(previousParsed) > 0) {
					console.log("✅ Version already bumped");
				} else {
					throw new Error(
						`Current version (${currentVersion}) is not greater than previous version (${previousVersion})`,
					);
				}
			}
		} else {
			console.log("✅ No previous version to compare (first release)");
		}

		// Ensure we're on main bookmark
		if (!await isOnMainBookmark()) {
			await moveMainBookmark();
		}

		// Push to GitHub
		await pushToGitHub();
		
		console.log("✨ Successfully pushed to GitHub!");
	} catch (error) {
		console.error("❌ Error:", error);
		Deno.exit(1);
	}
}

if (import.meta.main) {
	await main();
}