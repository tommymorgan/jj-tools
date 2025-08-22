import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { reportCreatedBookmarks } from "../src/main.ts";
import type { ExistingPR } from "../src/pr_manager.ts";

describe("Bookmark count reporting", () => {
	it("should report 'Detected PR chain: 6 PRs (3 local bookmarks + 3 dependent PRs)' when 3 local bookmarks have 3 dependent PRs", () => {
		// Capture output
		const originalLog = console.log;
		const capturedOutput: string[] = [];
		console.log = (msg: string) => capturedOutput.push(msg);

		try {
			// Setup: 3 local bookmarks, 3 dependent PRs
			const createdBookmarks = [
				"feat/dependent1",
				"feat/dependent2",
				"feat/dependent3",
			];
			const existingPRs = new Map<string, ExistingPR>([
				[
					"feat/dependent1",
					{
						number: 4,
						headRefName: "feat/dependent1",
						baseRefName: "feat/top",
						isDraft: false,
					},
				],
				[
					"feat/dependent2",
					{
						number: 5,
						headRefName: "feat/dependent2",
						baseRefName: "feat/dependent1",
						isDraft: false,
					},
				],
				[
					"feat/dependent3",
					{
						number: 6,
						headRefName: "feat/dependent3",
						baseRefName: "feat/dependent2",
						isDraft: false,
					},
				],
			]);
			const initialStackSize = 3;

			// Call the function
			reportCreatedBookmarks(createdBookmarks, existingPRs, initialStackSize);

			// Verify the specific output format
			assertEquals(
				capturedOutput[0],
				"Detected PR chain: 6 PRs (3 local bookmarks + 3 dependent PRs)",
			);
		} finally {
			console.log = originalLog;
		}
	});
});
