#!/usr/bin/env -S deno run --allow-read --allow-run --allow-env

/**
 * Validates that version has been bumped appropriately in deno.json
 * Enforces semantic versioning and ensures version changes on every commit to main
 */

import { parse as parseFlags } from "@std/flags";
import { parse as parseSemver, compare, type SemVer } from "@std/semver";

function detectChangeLevel(curr: SemVer, prev: SemVer): string {
	if (curr.major > prev.major) return "major";
	if (curr.minor > prev.minor) return "minor";
	if (curr.patch > prev.patch) return "patch";
	return "prerelease";
}

function getVersionChangeType(current: string, previous: string): string {
	const curr = parseSemver(current);
	const prev = parseSemver(previous);

	const comparison = compare(curr, prev);
	if (comparison === 0) return "unchanged";
	if (comparison < 0) return "backwards";

	return detectChangeLevel(curr, prev);
}

async function getGitDefaultBranch(): Promise<string> {
	const cmd = new Deno.Command("git", {
		args: ["symbolic-ref", "refs/remotes/origin/HEAD"],
		stdout: "piped",
		stderr: "piped",
	});

	const { stdout } = await cmd.output();
	const output = new TextDecoder().decode(stdout).trim();
	// Extract branch name from refs/remotes/origin/main
	return output.split("/").pop() || "main";
}

async function getPreviousVersion(): Promise<string | null> {
	try {
		// Get the default branch name
		const defaultBranch = await getGitDefaultBranch();

		// Get version from origin/main's deno.json
		const cmd = new Deno.Command("git", {
			args: ["show", `origin/${defaultBranch}:deno.json`],
			stdout: "piped",
			stderr: "piped",
		});

		const { stdout, success } = await cmd.output();
		if (!success) return null;

		const denoJson = JSON.parse(new TextDecoder().decode(stdout));
		return denoJson.version || null;
	} catch {
		return null;
	}
}

async function getCurrentVersion(): Promise<string | null> {
	try {
		const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
		return denoJson.version || null;
	} catch {
		return null;
	}
}

function showHelp(): void {
	console.log(`Usage: check-version.ts [OPTIONS]

Options:
  --ci      Run in CI mode (fails if version not bumped)
  --help    Show this help message

Validates that version in deno.json follows semver and has been bumped.`);
}

function validateCurrentVersion(versionStr: string | null): string {
	if (!versionStr) {
		console.error("❌ No version found in deno.json");
		Deno.exit(1);
	}

	try {
		parseSemver(versionStr);
	} catch {
		console.error(`❌ Invalid version format: ${versionStr}`);
		console.error("   Version must follow semantic versioning (e.g., 1.2.3)");
		Deno.exit(1);
	}

	return versionStr;
}

function handleVersionChange(
	change: string,
	currentVersionStr: string,
	previousVersionStr: string,
): void {
	const changeMessages = {
		unchanged: () => {
			console.error(
				`❌ Version has not been bumped from ${previousVersionStr}`,
			);
			console.error("   Every change to main must include a version bump");
			console.error("   Use: patch (x.x.N) for fixes and minor changes");
			console.error("        minor (x.N.x) for new features");
			console.error("        major (N.x.x) for breaking changes");
			Deno.exit(1);
		},
		backwards: () => {
			console.error(
				`❌ Version went backwards: ${currentVersionStr} < ${previousVersionStr}`,
			);
			Deno.exit(1);
		},
		major: () =>
			console.log(
				`✓ Major version bump: ${previousVersionStr} → ${currentVersionStr}`,
			),
		minor: () =>
			console.log(
				`✓ Minor version bump: ${previousVersionStr} → ${currentVersionStr}`,
			),
		patch: () =>
			console.log(
				`✓ Patch version bump: ${previousVersionStr} → ${currentVersionStr}`,
			),
	};

	const handler = changeMessages[change as keyof typeof changeMessages];
	if (handler) handler();
}

async function checkCIVersion(currentVersionStr: string): Promise<void> {
	const previousVersionStr = await getPreviousVersion();
	if (!previousVersionStr) {
		console.log("✓ No previous version found (first release)");
		return;
	}

	try {
		const change = getVersionChangeType(currentVersionStr, previousVersionStr);
		handleVersionChange(change, currentVersionStr, previousVersionStr);
	} catch {
		console.error(
			`❌ Previous version has invalid format: ${previousVersionStr}`,
		);
		Deno.exit(1);
	}
}

async function main() {
	const flags = parseFlags(Deno.args, {
		boolean: ["help", "ci"],
		alias: { h: "help" },
	});

	if (flags.help) {
		showHelp();
		Deno.exit(0);
	}

	const currentVersionStr = await getCurrentVersion();
	validateCurrentVersion(currentVersionStr);
	console.log(`✓ Current version: ${currentVersionStr}`);

	if (flags.ci && currentVersionStr) {
		await checkCIVersion(currentVersionStr);
	}

	console.log("✅ Version check passed");
}

if (import.meta.main) {
	main();
}
