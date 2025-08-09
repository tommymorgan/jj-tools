import { assertEquals } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { detectPlatform, type Platform } from "./platform-detector.ts";

// Real executor that runs jj commands in a specific directory
const executeJJIn = (dir: string) => async (args: string[]) => {
	const command = new Deno.Command("jj", {
		args,
		cwd: dir,
	});
	const output = await command.output();
	return {
		stdout: new TextDecoder().decode(output.stdout),
		stderr: new TextDecoder().decode(output.stderr),
	};
};

async function withTempRepo(
	fn: (
		executeJJ: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
	) => Promise<void>,
) {
	// Create temp directory
	const tempDir = await Deno.makeTempDir({ prefix: "jj-test-" });
	const executeJJ = executeJJIn(tempDir);

	try {
		// Initialize jj repo
		await executeJJ(["git", "init", "--colocate"]);
		await executeJJ(["describe", "-m", "Initial commit"]);
		await executeJJ(["bookmark", "create", "main"]);

		// Run the test
		await fn(executeJJ);
	} finally {
		// Clean up temp directory
		await Deno.remove(tempDir, { recursive: true });
	}
}

describe("Platform Detection - Integration Tests", () => {
	it("Should detect GitHub from remote URL", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Add a GitHub remote
			await executeJJ(["git", "remote", "add", "origin", "https://github.com/user/repo.git"]);

			// Act: Detect platform
			const platform = await detectPlatform(executeJJ);

			// Assert: Should detect GitHub
			assertEquals(platform.type, "github");
			assertEquals(platform.owner, "user");
			assertEquals(platform.repo, "repo");
		});
	});

	it("Should detect GitHub from SSH URL", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Add a GitHub SSH remote
			await executeJJ(["git", "remote", "add", "origin", "git@github.com:user/repo.git"]);

			// Act: Detect platform
			const platform = await detectPlatform(executeJJ);

			// Assert: Should detect GitHub
			assertEquals(platform.type, "github");
			assertEquals(platform.owner, "user");
			assertEquals(platform.repo, "repo");
		});
	});

	it("Should detect Forgejo from remote URL", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Add a Forgejo remote (using codeberg as example)
			await executeJJ(["git", "remote", "add", "origin", "https://codeberg.org/user/repo.git"]);

			// Act: Detect platform
			const platform = await detectPlatform(executeJJ);

			// Assert: Should detect Forgejo
			assertEquals(platform.type, "forgejo");
			assertEquals(platform.host, "codeberg.org");
			assertEquals(platform.owner, "user");
			assertEquals(platform.repo, "repo");
		});
	});

	it("Should detect self-hosted Forgejo from remote URL", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Add a self-hosted Forgejo remote
			await executeJJ(["git", "remote", "add", "origin", "https://git.example.com/user/repo.git"]);

			// Act: Detect platform
			const platform = await detectPlatform(executeJJ);

			// Assert: Should detect Forgejo (assuming non-github.com is Forgejo/Gitea)
			assertEquals(platform.type, "forgejo");
			assertEquals(platform.host, "git.example.com");
			assertEquals(platform.owner, "user");
			assertEquals(platform.repo, "repo");
		});
	});

	it("Should provide meaningful error when no remote exists", async () => {
		await withTempRepo(async (executeJJ) => {
			// Act & Assert: Should throw an error
			try {
				await detectPlatform(executeJJ);
				throw new Error("Expected error but got none");
			} catch (error) {
				assertEquals((error as Error).message, "No git remote found");
			}
		});
	});
});