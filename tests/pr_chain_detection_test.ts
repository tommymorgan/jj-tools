import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { ExistingPR } from "../src/pr_manager.ts";
import { buildPRChain } from "../src/pr_manager.ts";
import type { Bookmark } from "../src/stack_detection.ts";

describe("PR Chain Detection - Full Chain from Any Position", () => {
	const fullPRChain: ExistingPR[] = [
		{
			number: 14048,
			headRefName: "docs/cm-remove-fix-on-fix",
			baseRefName: "master",
			isDraft: true,
		},
		{
			number: 14054,
			headRefName: "feat/github-lib",
			baseRefName: "docs/cm-remove-fix-on-fix",
			isDraft: true,
		},
		{
			number: 14077,
			headRefName: "feat/cm-pr-approval-time",
			baseRefName: "feat/github-lib",
			isDraft: true,
		},
		{
			number: 14078,
			headRefName: "feat/pr-risk-schemas",
			baseRefName: "feat/cm-pr-approval-time",
			isDraft: true,
		},
	];

	// Convert to Map for the function
	const prMap = new Map<string, ExistingPR>();
	for (const pr of fullPRChain) {
		prMap.set(pr.headRefName, pr);
	}

	it("should detect full chain when positioned at BOTTOM of stack", () => {
		// When at the bottom bookmark, should detect all dependent PRs
		const stackBookmarks: Bookmark[] = [{ name: "docs/cm-remove-fix-on-fix" }];
		const chain = buildPRChain(stackBookmarks, prMap, "master");

		// EXPECTED: Should include entire chain that depends on this bookmark
		assertEquals(chain.length, 4);
		assertEquals(chain[0].bookmark, "docs/cm-remove-fix-on-fix");
		assertEquals(chain[1].bookmark, "feat/github-lib");
		assertEquals(chain[2].bookmark, "feat/cm-pr-approval-time");
		assertEquals(chain[3].bookmark, "feat/pr-risk-schemas");
	});

	it("should detect full chain when positioned in MIDDLE of stack", () => {
		// When at a middle bookmark, should detect all dependent PRs
		const stackBookmarks: Bookmark[] = [{ name: "feat/github-lib" }];
		const chain = buildPRChain(stackBookmarks, prMap, "master");

		// EXPECTED: Should include:
		// 1. The bookmark we're at and its dependencies (docs/cm-remove-fix-on-fix)
		// 2. PRs that depend on our bookmark (feat/cm-pr-approval-time, feat/pr-risk-schemas)
		assertEquals(chain.length, 4);
		assertEquals(chain[0].bookmark, "docs/cm-remove-fix-on-fix");
		assertEquals(chain[1].bookmark, "feat/github-lib");
		assertEquals(chain[2].bookmark, "feat/cm-pr-approval-time");
		assertEquals(chain[3].bookmark, "feat/pr-risk-schemas");
	});

	it("should detect full chain when positioned at TOP of stack", () => {
		// When at the top, we need to detect the full chain to avoid breaking it
		const stackBookmarks: Bookmark[] = [{ name: "feat/pr-risk-schemas" }];
		const chain = buildPRChain(stackBookmarks, prMap, "master");

		// EXPECTED: Should detect the full chain including dependencies
		assertEquals(chain.length, 4);
		assertEquals(chain[0].bookmark, "docs/cm-remove-fix-on-fix");
		assertEquals(chain[1].bookmark, "feat/github-lib");
		assertEquals(chain[2].bookmark, "feat/cm-pr-approval-time");
		assertEquals(chain[3].bookmark, "feat/pr-risk-schemas");
	});

	it("should detect chain even with multiple bookmarks in working directory", () => {
		// Real scenario: User has multiple bookmarks in their working directory
		// but they're only part of a larger PR chain
		const stackBookmarks: Bookmark[] = [
			{ name: "docs/cm-remove-fix-on-fix" },
			{ name: "feat/github-lib" },
		];
		const chain = buildPRChain(stackBookmarks, prMap, "master");

		// EXPECTED: Should include dependent PRs too
		assertEquals(chain.length, 4);
		assertEquals(chain[0].bookmark, "docs/cm-remove-fix-on-fix");
		assertEquals(chain[1].bookmark, "feat/github-lib");
		assertEquals(chain[2].bookmark, "feat/cm-pr-approval-time");
		assertEquals(chain[3].bookmark, "feat/pr-risk-schemas");
	});
});

describe("PR Chain Detection - Prevent Duplicate/Broken Stacks", () => {
	it("should never create a PR that breaks an existing chain", () => {
		// The critical bug: Creating a PR that points to master
		// when it should point to another PR in the chain

		const existingPRs: ExistingPR[] = [
			{
				number: 14048,
				headRefName: "docs/cm-remove-fix-on-fix",
				baseRefName: "master",
				isDraft: true,
			},
			{
				number: 14054,
				headRefName: "feat/github-lib",
				baseRefName: "docs/cm-remove-fix-on-fix", // Chain dependency!
				isDraft: true,
			},
		];

		const prMap2 = new Map<string, ExistingPR>();
		for (const pr of existingPRs) {
			prMap2.set(pr.headRefName, pr);
		}

		// When updating just feat/github-lib
		const chain = buildPRChain([{ name: "feat/github-lib" }], prMap2, "master");

		// EXPECTED: Should maintain the chain relationship
		assertEquals(chain.length, 2);
		assertEquals(chain[0].bookmark, "docs/cm-remove-fix-on-fix");
		assertEquals(chain[0].base, "master");
		assertEquals(chain[1].bookmark, "feat/github-lib");
		assertEquals(chain[1].base, "docs/cm-remove-fix-on-fix");
	});

	it("should detect dependents when updating partial stack", () => {
		// If a bookmark has dependents, we need to include them to avoid breaking the chain

		const existingPRs: ExistingPR[] = [
			{
				number: 14048,
				headRefName: "bottom-pr",
				baseRefName: "master",
				isDraft: true,
			},
			{
				number: 14054,
				headRefName: "top-pr",
				baseRefName: "bottom-pr",
				isDraft: true,
			},
		];

		const prMap3 = new Map<string, ExistingPR>();
		for (const pr of existingPRs) {
			prMap3.set(pr.headRefName, pr);
		}

		// Trying to update just bottom-pr when top-pr depends on it
		const chain = buildPRChain([{ name: "bottom-pr" }], prMap3, "master");

		// Expected: Should detect the dependent and include it
		assertEquals(chain.length, 2);
		assertEquals(chain[0].bookmark, "bottom-pr");
		assertEquals(chain[0].base, "master");
		assertEquals(chain[1].bookmark, "top-pr");
		assertEquals(chain[1].base, "bottom-pr");
	});
});
