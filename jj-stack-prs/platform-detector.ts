export type JJExecutor = (
	args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export type Platform = 
	| { type: "github"; owner: string; repo: string }
	| { type: "forgejo"; host: string; owner: string; repo: string };

export async function detectPlatform(executeJJ: JJExecutor): Promise<Platform> {
	// Get the remote URL
	const result = await executeJJ(["git", "remote", "get-url", "origin"]);
	const remoteUrl = result.stdout.trim();
	
	if (!remoteUrl) {
		throw new Error("No git remote found");
	}

	// Parse the remote URL
	// Handle both HTTPS and SSH URLs
	// HTTPS: https://github.com/user/repo.git
	// SSH: git@github.com:user/repo.git
	
	let host: string;
	let pathParts: string[];
	
	if (remoteUrl.startsWith("https://") || remoteUrl.startsWith("http://")) {
		// HTTPS URL
		const url = new URL(remoteUrl);
		host = url.hostname;
		pathParts = url.pathname.slice(1).replace(/\.git$/, "").split("/");
	} else if (remoteUrl.includes("@") && remoteUrl.includes(":")) {
		// SSH URL
		const [hostPart, pathPart] = remoteUrl.split(":");
		host = hostPart.split("@")[1];
		pathParts = pathPart.replace(/\.git$/, "").split("/");
	} else {
		throw new Error(`Unsupported remote URL format: ${remoteUrl}`);
	}

	const owner = pathParts[0];
	const repo = pathParts[1];

	if (!owner || !repo) {
		throw new Error(`Could not parse owner/repo from remote URL: ${remoteUrl}`);
	}

	// Detect platform based on host
	if (host === "github.com") {
		return { type: "github", owner, repo };
	} else {
		// Assume everything else is Forgejo/Gitea
		return { type: "forgejo", host, owner, repo };
	}
}