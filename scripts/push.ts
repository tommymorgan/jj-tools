#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env

import { parse as parseVersion, compare } from "@std/semver";

const VERBOSE = Deno.args.includes("--verbose") || Deno.args.includes("-v");

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
	if (VERBOSE) console.log("Checking previous main version...");
	
	let result = await exec(["jj", "file", "show", "-r", "main@origin", "deno.json"]);
	
	if (result.code !== 0) {
		// If main@origin doesn't exist, try the parent commit
		if (VERBOSE) console.log("  No main@origin found, checking parent commit...");
		result = await exec(["jj", "file", "show", "-r", "@-", "deno.json"]);
		
		if (result.code !== 0) {
			// This might be the first commit
			if (VERBOSE) console.log("  No previous version found (first release?)");
			return null;
		}
	}

	try {
		const previousDenoJson = JSON.parse(result.stdout);
		return previousDenoJson.version;
	} catch (e) {
		if (VERBOSE) console.error("  Failed to parse previous deno.json:", e);
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
	if (VERBOSE) console.log("Amending commit with version bump...");
	const result = await exec(["jj", "squash"]);
	if (result.code !== 0) {
		throw new Error(`Failed to amend commit: ${result.stderr}`);
	}
}

async function isOnMainBookmark(): Promise<boolean> {
	const result = await exec(["jj", "log", "-r", "@", "--no-graph", "-T", "bookmarks"]);
	return result.stdout.includes("main");
}

async function moveMainBookmark(): Promise<void> {
	if (VERBOSE) console.log("Moving main bookmark to current commit...");
	const result = await exec(["jj", "bookmark", "set", "main", "-r", "@"]);
	if (result.code !== 0) {
		throw new Error(`Failed to move main bookmark: ${result.stderr}`);
	}
}

async function hasDescription(): Promise<boolean> {
	const result = await exec(["jj", "log", "-r", "@", "--no-graph", "-T", "description"]);
	return result.stdout.trim() !== "" && !result.stdout.includes("(no description set)");
}

async function isEmptyCommit(): Promise<boolean> {
	const result = await exec(["jj", "log", "-r", "@", "--no-graph", "-T", "empty"]);
	return result.stdout.trim() === "true";
}

async function pushToGitHub(): Promise<void> {
	if (VERBOSE) console.log("Pushing to GitHub...");
	const result = await exec(["jj", "git", "push"]);
	if (result.code !== 0) {
		throw new Error(`Failed to push: ${result.stderr}`);
	}
	if (VERBOSE) console.log(result.stdout);
}

async function main() {
	try {
		// Check if current commit is pushable
		const hasDesc = await hasDescription();
		const isEmpty = await isEmptyCommit();
		
		if (!hasDesc) {
			console.error("❌ Current commit has no description. Please describe your changes:");
			console.error("   jj describe -m \"your commit message\"");
			Deno.exit(1);
		}
		
		if (isEmpty && hasDesc) {
			console.log("⚠️  Warning: Pushing an empty commit");
		}
		
		const currentVersion = await getCurrentVersion();
		console.log(`📦 Current version: ${currentVersion}`);

		const previousVersion = await getPreviousMainVersion();
		
		if (previousVersion) {
			console.log(`📦 Previous main version: ${previousVersion}`);
			
			if (currentVersion === previousVersion) {
				const newVersion = await bumpPatchVersion(currentVersion);
				console.log(`⬆️  Bumping version: ${currentVersion} → ${newVersion}`);
				
				await updateVersion(newVersion);
				
				// Only amend if we're already on main (otherwise we'd try to squash into an immutable commit)
				if (await isOnMainBookmark()) {
					await amendCommit();
				} else {
					if (VERBOSE) console.log("Not amending - not on main bookmark");
				}
			} else {
				const currentParsed = parseVersion(currentVersion);
				const previousParsed = parseVersion(previousVersion);
				
				if (compare(currentParsed, previousParsed) > 0) {
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

		if (!await isOnMainBookmark()) {
			await moveMainBookmark();
		}

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