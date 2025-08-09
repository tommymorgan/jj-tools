import { assertEquals, assertRejects } from "jsr:@std/assert";
import { describe, it } from "jsr:@std/testing/bdd";
import { detectStack } from "./stack-detector.ts";

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

describe("Stack Detection - Integration Tests", () => {
	it("Should identify all bookmarks between base branch and current position ordered from base to tip", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Create a linear stack of commits with bookmarks
			await executeJJ(["new", "-m", "Test commit A"]);
			await executeJJ(["bookmark", "create", "feature-a"]);
			await executeJJ(["new", "-m", "Test commit B"]);
			await executeJJ(["bookmark", "create", "feature-b"]);
			await executeJJ(["new", "-m", "Test commit C"]);
			await executeJJ(["bookmark", "create", "feature-c"]);

			// Act: Detect the stack
			const stack = await detectStack(executeJJ, "main");

			// Assert: Bookmarks should be ordered from base to tip
			assertEquals(stack.bookmarks, ["feature-a", "feature-b", "feature-c"]);
			assertEquals(stack.baseBranch, "main");
		});
	});

	it("Should handle divergent branches by including only the current lineage", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Create a divergent history
			await executeJJ(["new", "-m", "Test commit A"]);
			await executeJJ(["bookmark", "create", "feature-a"]);

			// Create divergent branch
			await executeJJ(["new", "-m", "Test commit X"]);
			await executeJJ(["bookmark", "create", "feature-x"]);

			// Go back and create another branch
			await executeJJ(["edit", "feature-a"]);
			await executeJJ(["new", "-m", "Test commit B"]);
			await executeJJ(["bookmark", "create", "feature-b"]);

			// Act: Detect the stack from feature-b
			const stack = await detectStack(executeJJ, "main");

			// Assert: Should only include current lineage (feature-a, feature-b), not feature-x
			assertEquals(stack.bookmarks, ["feature-a", "feature-b"]);
			assertEquals(stack.baseBranch, "main");
		});
	});

	it("Should exclude the base branch from the stack", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Create commits on top of main
			await executeJJ(["new", "main", "-m", "Test commit A"]);
			await executeJJ(["bookmark", "create", "feature-a"]);
			await executeJJ(["new", "-m", "Test commit B"]);
			await executeJJ(["bookmark", "create", "feature-b"]);

			// Act: Detect the stack
			const stack = await detectStack(executeJJ, "main");

			// Assert: main should not be in the bookmarks list
			assertEquals(stack.bookmarks.includes("main"), false);
			assertEquals(stack.baseBranch, "main");
		});
	});

	it("Should handle multiple bookmarks on the same commit", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Create a commit with multiple bookmarks
			await executeJJ(["new", "-m", "Test commit A"]);
			await executeJJ(["bookmark", "create", "feature-a"]);
			await executeJJ(["bookmark", "create", "feature-a-alias"]);
			await executeJJ(["new", "-m", "Test commit B"]);
			await executeJJ(["bookmark", "create", "feature-b"]);

			// Act: Detect the stack
			const stack = await detectStack(executeJJ, "main");

			// Assert: Both bookmarks on the same commit should be included
			assertEquals(stack.bookmarks.includes("feature-a"), true);
			assertEquals(stack.bookmarks.includes("feature-a-alias"), true);
			assertEquals(stack.bookmarks.includes("feature-b"), true);
		});
	});

	it("Should provide meaningful error when no bookmarks exist in the stack", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Create commits without bookmarks
			await executeJJ(["new", "-m", "Test commit without bookmark"]);

			// Act & Assert: Should throw an error
			await assertRejects(
				async () => await detectStack(executeJJ, "main"),
				Error,
				"No bookmarks found in current stack",
			);
		});
	});

	it("Should warn when not at top of stack without --partial flag", async () => {
		await withTempRepo(async (executeJJ) => {
			// Arrange: Create a stack and position ourselves in the middle
			await executeJJ(["new", "-m", "Test commit A"]);
			await executeJJ(["bookmark", "create", "feature-a"]);
			await executeJJ(["new", "-m", "Test commit B"]);
			await executeJJ(["bookmark", "create", "feature-b"]);
			await executeJJ(["new", "-m", "Test commit C"]);
			await executeJJ(["bookmark", "create", "feature-c"]);
			
			// Move to the middle of the stack
			await executeJJ(["edit", "feature-b"]);
			
			// Act: Detect stack should include a warning flag
			const stack = await detectStack(executeJJ, "main");
			
			// Assert: Stack should be detected but indicate we're not at the top
			assertEquals(stack.bookmarks, ["feature-a", "feature-b"]);
			assertEquals(stack.isPartialStack, true);
		});
	});
});
