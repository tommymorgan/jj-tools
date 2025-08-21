import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExistingPR } from "../src/pr_manager.ts";
import { buildPRChainWithAutoCreate } from "../src/pr_manager.ts";
import type { Bookmark, CommandExecutor } from "../src/stack_detection.ts";

describe("Dependent PR bookmark auto-creation", () => {
	it("should create local bookmark when GitHub PR depends on local stack but has no local bookmark", async () => {
		// Arrange: Mock executor that tracks bookmark creation
		const createdBookmarks: string[] = [];
		const mockExecutor: CommandExecutor = {
			exec: async (cmd: string[]) => {
				if (cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "create") {
					createdBookmarks.push(cmd[3]);
					return { stdout: "", stderr: "", code: 0 };
				}
				// Default response for other commands
				return { stdout: "", stderr: "", code: 0 };
			},
		};

		// Local stack has 2 bookmarks
		const localBookmarks: Bookmark[] = [
			{ name: "feat/a", commitMessage: "Feature A" },
			{ name: "feat/b", commitMessage: "Feature B" },
		];

		// GitHub has 3 PRs - the 2 local ones plus a dependent PR
		const existingPRs = new Map<string, ExistingPR>([
			[
				"feat/a",
				{
					number: 1,
					headRefName: "feat/a",
					baseRefName: "main",
					isDraft: false,
				},
			],
			[
				"feat/b",
				{
					number: 2,
					headRefName: "feat/b",
					baseRefName: "feat/a",
					isDraft: false,
				},
			],
			[
				"feat/c",
				{
					number: 3,
					headRefName: "feat/c",
					baseRefName: "feat/b", // Depends on feat/b but not in local stack!
					isDraft: false,
				},
			],
		]);

		// Act: Build PR chain with auto-creation of missing bookmarks
		const { chain, createdBookmarks: autoCreated } =
			await buildPRChainWithAutoCreate(
				localBookmarks,
				existingPRs,
				"main",
				mockExecutor,
			);

		// Assert: Should have created the missing bookmark
		assertEquals(autoCreated.length, 1);
		assertEquals(autoCreated[0], "feat/c");

		// Chain should include all 3 PRs
		assertEquals(chain.length, 3);
		assertEquals(
			chain.map((pr) => pr.bookmark),
			["feat/a", "feat/b", "feat/c"],
		);

		// Verify bookmark was actually created via jj command
		assertEquals(createdBookmarks, ["feat/c"]);
	});

	it("should not create bookmarks when dependent PRs already have local bookmarks", async () => {
		// Arrange: All PRs already have corresponding local bookmarks
		const mockExecutor: CommandExecutor = {
			exec: async () => ({ stdout: "", stderr: "", code: 0 }),
		};

		const localBookmarks: Bookmark[] = [
			{ name: "feat/a", commitMessage: "Feature A" },
			{ name: "feat/b", commitMessage: "Feature B" },
		];

		const existingPRs = new Map<string, ExistingPR>([
			[
				"feat/a",
				{
					number: 1,
					headRefName: "feat/a",
					baseRefName: "main",
					isDraft: false,
				},
			],
			[
				"feat/b",
				{
					number: 2,
					headRefName: "feat/b",
					baseRefName: "feat/a",
					isDraft: false,
				},
			],
		]);

		// Act
		const { chain, createdBookmarks } = await buildPRChainWithAutoCreate(
			localBookmarks,
			existingPRs,
			"main",
			mockExecutor,
		);

		// Assert: No bookmarks should be created since all PRs have local bookmarks
		assertEquals(createdBookmarks.length, 0);
		assertEquals(chain.length, 2);
	});

	it("should create local bookmarks for entire chain of GitHub PRs that depend on local stack", async () => {
		// Arrange: Local stack has 1 bookmark, but GitHub has a chain of 3 PRs
		const createdBookmarks: string[] = [];
		const mockExecutor: CommandExecutor = {
			exec: async (cmd: string[]) => {
				if (cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "create") {
					createdBookmarks.push(cmd[3]);
					return { stdout: "", stderr: "", code: 0 };
				}
				return { stdout: "", stderr: "", code: 0 };
			},
		};

		const localBookmarks: Bookmark[] = [
			{ name: "feat/a", commitMessage: "Feature A" },
		];

		const existingPRs = new Map<string, ExistingPR>([
			[
				"feat/a",
				{
					number: 1,
					headRefName: "feat/a",
					baseRefName: "main",
					isDraft: false,
				},
			],
			[
				"feat/b",
				{
					number: 2,
					headRefName: "feat/b",
					baseRefName: "feat/a", // depends on our local bookmark
					isDraft: false,
				},
			],
			[
				"feat/c",
				{
					number: 3,
					headRefName: "feat/c",
					baseRefName: "feat/b", // depends on feat/b which depends on our local bookmark
					isDraft: false,
				},
			],
		]);

		// Act
		const { chain, createdBookmarks: autoCreated } =
			await buildPRChainWithAutoCreate(
				localBookmarks,
				existingPRs,
				"main",
				mockExecutor,
			);

		// Assert: Should create bookmarks for both missing PRs
		assertEquals(autoCreated.length, 2);
		assertEquals(autoCreated, ["feat/b", "feat/c"]);
		assertEquals(chain.length, 3);
		assertEquals(createdBookmarks, ["feat/b", "feat/c"]);
	});
});
