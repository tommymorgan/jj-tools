/**
 * Version utility for jj-stack-prs
 */

// This constant is replaced by scripts/build.ts during compilation
const VERSION = "0.1.19";

export function getVersion(): string {
	return VERSION;
}

export function showVersion(): string {
	const version = getVersion();
	return `jj-stack-prs version ${version}`;
}
