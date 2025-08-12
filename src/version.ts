/**
 * Version utility for jj-stack-prs
 */

// This will be set at compile time from deno.json
const VERSION = "0.1.0";

export async function getVersion(): Promise<string> {
	return VERSION;
}

export async function showVersion(): Promise<string> {
	const version = await getVersion();
	return `jj-stack-prs version ${version}`;
}
