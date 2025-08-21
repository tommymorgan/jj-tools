#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

/**
 * Build script that updates version.ts with the current version from deno.json
 * before compiling the binary
 */

const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
const version = denoJson.version || "unknown";

const versionFilePath = "src/version.ts";
let versionFileContent = await Deno.readTextFile(versionFilePath);

versionFileContent = versionFileContent.replace(
	/const VERSION = "[^"]*";/,
	`const VERSION = "${version}";`,
);

await Deno.writeTextFile(versionFilePath, versionFileContent);

console.log(`✓ Set version to ${version}`);

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
