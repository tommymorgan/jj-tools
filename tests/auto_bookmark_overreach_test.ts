import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { findUnbookmarkedChanges } from "../src/auto_bookmark.ts";
import {
	createMockExecutor,
	generateProblematicHistory,
	generateWorkingStack,
	REAL_WORLD_SCENARIOS,
} from "./test_data_generators.ts";

describe("Auto-bookmark scope limitation", () => {
	describe("should NOT create bookmarks for already-merged commits", () => {
		it("should exclude already-merged commits when finding unbookmarked changes", async () => {
			// This reproduces the exact user scenario: 384 unbookmarked changes detected
			// when there should only be the current working copy
			const history = REAL_WORLD_SCENARIOS.massiveMergedHistory();
			const showDescriptions = new Map(
				history.map((h) => [h.changeId, h.description]),
			);

			const mockExecutor = createMockExecutor({
				logOutput: history,
				showDescriptions,
				trunk: "master",
			});

			// Using functional API
			const unbookmarked = await findUnbookmarkedChanges(mockExecutor);

			// Fixed: Should only detect the working copy, not the 384 merged commits
			// The working copy has no bookmarks and an empty description
			const expectedCount = 1; // Just the working copy

			assertEquals(
				unbookmarked.length,
				expectedCount,
				`Should find only ${expectedCount} unbookmarked change (working copy), not ${unbookmarked.length}`,
			);
		});
	});

	describe("should only create bookmarks for mutable working stack", () => {
		it("should exclude immutable commits when detecting unbookmarked changes", async () => {
			// Generate a history with both mutable and immutable commits
			const mutableCommits = generateWorkingStack({
				numCommits: 2,
				hasBookmarks: false,
			});

			const immutableCommits = generateProblematicHistory({
				numWorkingCommits: 0,
				numMergedCommits: 5,
			}).slice(0, 5); // Just the merged commits

			const allCommits = [...mutableCommits, ...immutableCommits];
			const immutableIds = immutableCommits.map((c) => c.changeId);

			const mockExecutor = createMockExecutor({
				logOutput: allCommits,
				trunk: "master",
				immutableCommits: immutableIds,
			});

			// Using functional API
			const unbookmarked = await findUnbookmarkedChanges(mockExecutor);

			// Should only find the 2 mutable commits, not the 5 immutable ones
			assertEquals(
				unbookmarked.length,
				2,
				`Should only find 2 mutable commits, not ${unbookmarked.length}`,
			);

			// Verify none of the results are immutable commits
			const hasImmutableCommit = unbookmarked.some((c) =>
				immutableIds.includes(c.changeId),
			);
			assertEquals(
				hasImmutableCommit,
				false,
				"Should not include immutable commits",
			);
		});
	});
});
