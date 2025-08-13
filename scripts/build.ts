#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Build script that updates version.ts with the current version from deno.json
 * before compiling the binary
 */

// Read version from deno.json
const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const version = denoJson.version || "unknown";

// Read version.ts
const versionFilePath = "src/version.ts";
let versionFileContent = await Deno.readTextFile(versionFilePath);

// Update the VERSION constant
versionFileContent = versionFileContent.replace(
	/const VERSION = "[^"]*";/,
	`const VERSION = "${version}";`,
);

// Write back the updated content
await Deno.writeTextFile(versionFilePath, versionFileContent);

console.log(`✓ Set version to ${version}`);

// Run the compile command
const cmd = new Deno.Command("deno", {
	args: [
		"compile",
		"--allow-run",
		"--allow-read",
		"--allow-write",
		"--allow-env",
		"--output",
		"jj-stack-prs",
		"src/main.ts",
	],
	stdout: "inherit",
	stderr: "inherit",
});

const { code } = await cmd.output();

if (code === 0) {
	console.log("✓ Compilation successful");
} else {
	console.error("✗ Compilation failed");
	Deno.exit(code);
}
