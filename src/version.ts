/**
 * Version utility for jj-stack-prs
 */

export async function getVersion(): Promise<string> {
	// Always read fresh from deno.json
	const denoJsonPath = new URL("../deno.json", import.meta.url);
	const content = await Deno.readTextFile(denoJsonPath);
	const denoJson = JSON.parse(content);

	if (!denoJson.version) {
		throw new Error("No version field found in deno.json");
	}

	return denoJson.version;
}

export async function showVersion(): Promise<string> {
	const version = await getVersion();
	return `jj-stack-prs version ${version}`;
}
