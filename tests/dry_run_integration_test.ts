import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { cleanupMergedAutoBookmarks } from "../src/auto_bookmark.ts";
import { buildPRChainWithAutoCreate } from "../src/pr_manager.ts";
import { type CommandExecutor, detectStack } from "../src/stack_detection.ts";

type CommandResponse = { stdout: string; stderr: string; code: number };

describe("Dry-run Integration", () => {
	it("should not create PRs for bookmarks marked for deletion in dry-run when bookmark has dependents", async () => {
		// This test verifies the complete flow:
		// 1. An auto-bookmark exists with a merged PR
		// 2. There are other PRs that depend on this bookmark
		// 3. In dry-run mode, it's marked for deletion
		// 4. The PR chain builder should NOT include it

		const executedCommands: string[][] = [];

		// Extract handler functions to reduce complexity
		const handleBookmarkList = (cmd: string[]): CommandResponse | null => {
			if (cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "list") {
				return {
					stdout:
						"base-bookmark: abc123def base commit\nauto/jjsp-merged-bookmark: def456ghi merged commit\ndependent-bookmark: ghi789jkl dependent commit",
					stderr: "",
					code: 0,
				};
			}
			return null;
		};

		const getPRViewResponse = (bookmarkName: string): CommandResponse => {
			const responses: Record<string, CommandResponse> = {
				"auto/jjsp-merged-bookmark": {
					stdout: JSON.stringify({ state: "MERGED" }),
					stderr: "",
					code: 0,
				},
			};

			return (
				responses[bookmarkName] || {
					stdout: "",
					stderr: "no pull request found",
					code: 1,
				}
			);
		};

		const handlePRView = (cmd: string[]): CommandResponse | null => {
			const isGhPrView = cmd.join(" ").startsWith("gh pr view");
			if (!isGhPrView) return null;
			return getPRViewResponse(cmd[3]);
		};

		const handlePRList = (cmd: string[]): CommandResponse | null => {
			if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "list") {
				return {
					stdout: JSON.stringify([
						{
							number: 100,
							headRefName: "base-bookmark",
							baseRefName: "main",
							state: "OPEN",
						},
						{
							number: 101,
							headRefName: "auto/jjsp-merged-bookmark",
							baseRefName: "base-bookmark",
							state: "MERGED",
						},
						{
							number: 102,
							headRefName: "dependent-bookmark",
							baseRefName: "auto/jjsp-merged-bookmark",
							state: "OPEN",
						},
					]),
					stderr: "",
					code: 0,
				};
			}
			return null;
		};

		const handleJJLog = (cmd: string[]): CommandResponse | null => {
			if (cmd[0] === "jj" && cmd[1] === "log") {
				return {
					stdout:
						"dependent-bookmark\nauto/jjsp-merged-bookmark\nbase-bookmark\n",
					stderr: "",
					code: 0,
				};
			}
			return null;
		};

		const getJJShowResponse = (cmdString: string): CommandResponse | null => {
			const messages: Record<string, string> = {
				"base-bookmark": "feat: base feature",
				"auto/jjsp-merged-bookmark": "fix: merged fix",
				"dependent-bookmark": "feat: dependent feature",
			};

			const matchedBookmark = Object.keys(messages).find((bookmark) =>
				cmdString.includes(bookmark),
			);
			if (!matchedBookmark) return null;

			return { stdout: messages[matchedBookmark], stderr: "", code: 0 };
		};

		const handleJJShow = (cmd: string[]): CommandResponse | null => {
			const cmdString = cmd.join(" ");
			if (!cmdString.startsWith("jj show")) return null;
			return getJJShowResponse(cmdString);
		};

		const handleBookmarkCreate = (cmd: string[]): CommandResponse | null => {
			if (cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "create") {
				return { stdout: "", stderr: "", code: 0 };
			}
			return null;
		};

		const mockExecutor: CommandExecutor = {
			exec: async (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);

				return (
					handleBookmarkList(cmd) ||
					handlePRView(cmd) ||
					handlePRList(cmd) ||
					handleJJLog(cmd) ||
					handleJJShow(cmd) ||
					handleBookmarkCreate(cmd) || { stdout: "", stderr: "", code: 0 }
				);
			},
		};

		// Step 1: Cleanup in dry-run mode should mark the auto-bookmark for deletion
		const autoBookmarks = ["auto/jjsp-merged-bookmark"];
		const cleanupResult = await cleanupMergedAutoBookmarks(
			mockExecutor,
			autoBookmarks,
			true, // dry-run
		);

		// Verify it was marked for deletion but not actually deleted
		assertEquals(cleanupResult.deleted.length, 1);
		assertEquals(cleanupResult.deleted[0], "auto/jjsp-merged-bookmark");

		// Step 2: Detect the stack (should still include all bookmarks since nothing was actually deleted)
		const stack = await detectStack(mockExecutor, "main");

		// The stack will still contain all bookmarks including the one marked for deletion
		assertEquals(stack.bookmarks.length, 3);
		assertEquals(
			stack.bookmarks.some((b) => b.name === "auto/jjsp-merged-bookmark"),
			true,
		);

		// Step 3: Build PR chain - should handle the deleted bookmark properly
		// Find existing PRs - important: dependent-bookmark depends on auto/jjsp-merged-bookmark
		const existingPRs = new Map();
		existingPRs.set("base-bookmark", {
			number: 100,
			state: "OPEN",
			baseRefName: "main",
		});
		existingPRs.set("auto/jjsp-merged-bookmark", {
			number: 101,
			state: "MERGED",
			baseRefName: "base-bookmark",
		});
		existingPRs.set("dependent-bookmark", {
			number: 102,
			state: "OPEN",
			baseRefName: "auto/jjsp-merged-bookmark", // This PR depends on the deleted bookmark!
		});

		// Build PR chain with the deleted bookmarks list
		const { chain: prChain } = await buildPRChainWithAutoCreate(
			stack.bookmarks,
			existingPRs,
			"main",
			mockExecutor,
			cleanupResult.deleted, // Pass the bookmarks marked for deletion
		);

		// Should NOT create/update a PR for the bookmark marked for deletion
		const deletedBookmarkPRs = prChain.filter(
			(pr) => pr.bookmark === "auto/jjsp-merged-bookmark",
		);
		assertEquals(
			deletedBookmarkPRs.length,
			0,
			"Should not create/update PR for bookmark marked for deletion",
		);

		// The dependent PR should now have base-bookmark as its new base (not the deleted bookmark)
		const dependentPR = prChain.find(
			(pr) => pr.bookmark === "dependent-bookmark",
		);
		assertEquals(
			dependentPR?.base,
			"base-bookmark",
			"Dependent PR should be rebased to skip the deleted bookmark",
		);
	});
});
