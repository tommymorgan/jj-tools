#!/usr/bin/env -S deno run --allow-read --allow-run

/**
 * Check if the version in deno.json has been bumped compared to the previous commit.
 * Exits with code 1 if version hasn't been bumped, 0 if it has.
 */

import { compare, parse as parseSemver } from "@std/semver";

async function getVersionFromCommit(revision: string): Promise<string | null> {
	// Use jj file show to get the file content from a specific revision
	const command = new Deno.Command("jj", {
		args: ["file", "show", "-r", revision, "deno.json"],
		stdout: "piped",
		stderr: "piped",
	});

	const { code, stdout } = await command.output();

	if (code !== 0) {
		// File might not exist in that revision
		return null;
	}

	try {
		const content = new TextDecoder().decode(stdout);
		const denoJson = JSON.parse(content);
		return denoJson.version || null;
	} catch (error) {
		console.error(`Error parsing deno.json from ${revision}:`, error);
		return null;
	}
}

async function getCurrentVersion(): Promise<string | null> {
	try {
		const content = await Deno.readTextFile("deno.json");
		const denoJson = JSON.parse(content);
		return denoJson.version || null;
	} catch {
		return null;
	}
}

function exitWithError(message: string, details?: string[]): never {
	console.error(message);
	if (details) {
		for (const detail of details) {
			console.error(detail);
		}
	}
	Deno.exit(1);
}

function parseVersionOrExit(
	version: string,
	label: string,
): ReturnType<typeof parseSemver> {
	try {
		const semver = parseSemver(version);
		if (!semver) {
			throw new Error(`Invalid version: ${version}`);
		}
		return semver;
	} catch (error) {
		exitWithError(
			`❌ ERROR: ${label} version '${version}' is not valid semver`,
			[`   ${error}`],
		);
	}
}

function getBumpType(
	current: ReturnType<typeof parseSemver>,
	previous: ReturnType<typeof parseSemver>,
): string {
	if (!current || !previous) return "";

	if (current.major > previous.major) {
		return "MAJOR version bump (breaking changes)";
	} else if (current.minor > previous.minor) {
		return "MINOR version bump (new features)";
	} else if (current.patch > previous.patch) {
		return "PATCH version bump (bug fixes)";
	}
	return "";
}

function handleVersionIncreased(
	currentVersion: string,
	previousVersion: string,
	currentSemver: ReturnType<typeof parseSemver>,
	previousSemver: ReturnType<typeof parseSemver>,
): void {
	console.log(`✅ Version bumped: ${previousVersion} → ${currentVersion}`);

	const bumpType = getBumpType(currentSemver, previousSemver);
	if (bumpType) {
		console.log(`   Type: ${bumpType}`);
	}

	Deno.exit(0);
}

function handleVersionUnchanged(
	currentVersion: string,
	previousVersion: string,
	isCI: boolean,
): void {
	const details = [
		`   Current version:  ${currentVersion}`,
		`   Previous version: ${previousVersion}`,
		"",
		`   Please bump the version in deno.json before committing.`,
		`   Use semantic versioning:`,
		`     - PATCH bump (x.y.Z) for bug fixes`,
		`     - MINOR bump (x.Y.z) for new features`,
		`     - MAJOR bump (X.y.z) for breaking changes`,
	];

	if (isCI) {
		details.push("");
		details.push(`   This check failed in CI. Push will be rejected.`);
	}

	exitWithError(`❌ FAILURE: Version has not been bumped`, details);
}

function handleVersionDecreased(
	currentVersion: string,
	previousVersion: string,
): void {
	exitWithError(`❌ ERROR: Version has been decreased!`, [
		`   Current version:  ${currentVersion} (lower)`,
		`   Previous version: ${previousVersion} (higher)`,
		"",
		`   Version numbers must always increase, never decrease.`,
		`   If you need to revert changes, bump to a new patch version.`,
	]);
}

async function main() {
	const isCI = Deno.env.get("CI") === "true";

	// Get current version
	const currentVersion = await getCurrentVersion();
	if (!currentVersion) {
		exitWithError("❌ ERROR: Could not read version from deno.json", [
			"   Make sure deno.json exists and has a 'version' field.",
		]);
	}

	// Get previous version
	const previousVersion = await getVersionFromCommit("@-");
	if (!previousVersion) {
		console.log(
			"ℹ️  No previous version found (first versioned commit or new repository)",
		);
		console.log(`   Current version: ${currentVersion}`);
		Deno.exit(0);
	}

	// Parse versions
	const currentSemver = parseVersionOrExit(currentVersion, "Current");
	const previousSemver = parseVersionOrExit(previousVersion, "Previous");

	// Compare and handle results
	const comparison = compare(currentSemver, previousSemver);

	if (comparison > 0) {
		handleVersionIncreased(
			currentVersion,
			previousVersion,
			currentSemver,
			previousSemver,
		);
	} else if (comparison === 0) {
		handleVersionUnchanged(currentVersion, previousVersion, isCI);
	} else {
		handleVersionDecreased(currentVersion, previousVersion);
	}
}

if (import.meta.main) {
	await main();
}
