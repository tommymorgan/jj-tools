import { assertEquals, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
	type PRChainInfo,
	PRDescriptionGenerator,
	type PRDescriptionOptions,
} from "../src/pr_description.ts";

describe("PR Description Generator", () => {
	describe("generateDescription", () => {
		it("should generate description with stack position for bottom PR", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "feature-1",
					base: "master",
					prNumber: 101,
					isDraft: false,
					isReady: true,
				},
				{
					bookmark: "feature-2",
					base: "feature-1",
					prNumber: 102,
					isDraft: true,
					isReady: false,
				},
				{
					bookmark: "feature-3",
					base: "feature-2",
					prNumber: 103,
					isDraft: true,
					isReady: false,
				},
			];

			const options: PRDescriptionOptions = {
				currentPR: chain[0],
				fullChain: chain,
				position: 1,
				originalBody: "Original PR description",
			};

			// Act
			const description = generator.generateDescription(options);

			// Assert
			assertStringIncludes(description, "Stack position: 1 of 3");
			assertStringIncludes(description, "Base: `master`");
			assertStringIncludes(description, "Original PR description");
			// Bottom PR should not have "Depends on"
			assertEquals(description.includes("Depends on:"), false);
		});

		it("should generate description with dependencies for middle PR", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "feature-1",
					base: "master",
					prNumber: 101,
					isDraft: false,
					isReady: true,
				},
				{
					bookmark: "feature-2",
					base: "feature-1",
					prNumber: 102,
					isDraft: true,
					isReady: false,
				},
				{
					bookmark: "feature-3",
					base: "feature-2",
					prNumber: 103,
					isDraft: true,
					isReady: false,
				},
			];

			const options: PRDescriptionOptions = {
				currentPR: chain[1],
				fullChain: chain,
				position: 2,
				originalBody: "Feature 2 description",
			};

			// Act
			const description = generator.generateDescription(options);

			// Assert
			assertStringIncludes(description, "Stack position: 2 of 3");
			assertStringIncludes(description, "Base: `feature-1`");
			assertStringIncludes(description, "Depends on: #101");
			assertStringIncludes(description, "Feature 2 description");
		});

		it("should include full chain visualization", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "feature-1",
					base: "master",
					prNumber: 101,
					isDraft: false,
					isReady: true,
				},
				{
					bookmark: "feature-2",
					base: "feature-1",
					prNumber: 102,
					isDraft: true,
					isReady: false,
				},
				{
					bookmark: "feature-3",
					base: "feature-2",
					prNumber: 103,
					isDraft: true,
					isReady: false,
				},
			];

			const options: PRDescriptionOptions = {
				currentPR: chain[1],
				fullChain: chain,
				position: 2,
				originalBody: "",
			};

			// Act
			const description = generator.generateDescription(options);

			// Assert
			assertStringIncludes(description, "PR Stack (review in order) as of");
			assertStringIncludes(
				description,
				"1. PR #101: feature-1 → master (ready for review)",
			);
			assertStringIncludes(
				description,
				"2. **PR #102: feature-2 → feature-1 (draft)** ← You are here",
			);
			assertStringIncludes(
				description,
				"3. PR #103: feature-3 → feature-2 (draft)",
			);
			assertStringIncludes(description, "Created with jj (Jujutsu) stack-prs");
		});

		it("should highlight current PR in chain visualization", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "fix-1",
					base: "develop",
					prNumber: 201,
					isDraft: false,
					isReady: true,
				},
				{
					bookmark: "fix-2",
					base: "fix-1",
					prNumber: 202,
					isDraft: false,
					isReady: true,
				},
			];

			const options: PRDescriptionOptions = {
				currentPR: chain[0],
				fullChain: chain,
				position: 1,
				originalBody: "",
			};

			// Act
			const description = generator.generateDescription(options);

			// Assert
			// Current PR should be bold with "You are here" marker
			assertStringIncludes(
				description,
				"1. **PR #201: fix-1 → develop (ready for review)** ← You are here",
			);
			// Other PR should not be bold and not have the marker
			assertStringIncludes(description, "2. PR #202: fix-2 → fix-1");
		});

		it("should preserve original body content", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "feature-1",
					base: "master",
					prNumber: 101,
					isDraft: false,
					isReady: true,
				},
			];

			const originalBody = `## Summary
This PR implements user authentication.

## Changes
- Added login endpoint
- Added JWT token generation

## Testing
Run \`npm test\``;

			const options: PRDescriptionOptions = {
				currentPR: chain[0],
				fullChain: chain,
				position: 1,
				originalBody,
			};

			// Act
			const description = generator.generateDescription(options);

			// Assert
			assertStringIncludes(description, "## Summary");
			assertStringIncludes(
				description,
				"This PR implements user authentication.",
			);
			assertStringIncludes(description, "- Added login endpoint");
			assertStringIncludes(description, "- Added JWT token generation");
			assertStringIncludes(description, "Run `npm test`");
		});

		it("should format date correctly in chain header", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "feature-1",
					base: "master",
					prNumber: 101,
					isDraft: false,
					isReady: true,
				},
			];

			const options: PRDescriptionOptions = {
				currentPR: chain[0],
				fullChain: chain,
				position: 1,
				originalBody: "",
			};

			// Act
			const description = generator.generateDescription(options);
			const today = new Date().toISOString().split("T")[0];

			// Assert
			assertStringIncludes(description, `PR Stack (review in order) as of ${today}`);
		});
	});

	describe("extractOriginalBody", () => {
		it("should extract body without chain metadata", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const fullDescription = `Stack position: 2 of 3
Base: \`feature-1\`
Depends on: #101

## Original Content
This is the original PR description.

---
Full chain of PRs as of 2024-01-01:
• PR #101: feature-1 → master (ready for review)
• **PR #102: feature-2 → feature-1 (draft)**
• PR #103: feature-3 → feature-2 (draft)

Created with jj (Jujutsu) stack-prs`;

			// Act
			const originalBody = generator.extractOriginalBody(fullDescription);

			// Assert
			assertEquals(
				originalBody.trim(),
				"## Original Content\nThis is the original PR description.",
			);
		});

		it("should return full body if no metadata found", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const simpleDescription =
				"This is a simple PR description without metadata.";

			// Act
			const originalBody = generator.extractOriginalBody(simpleDescription);

			// Assert
			assertEquals(originalBody, simpleDescription);
		});

		it("should handle empty descriptions", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();

			// Act
			const originalBody = generator.extractOriginalBody("");

			// Assert
			assertEquals(originalBody, "");
		});
	});

	describe("formatPRStatus", () => {
		it("should format ready PR status correctly", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();

			// Act & Assert
			assertEquals(generator.formatPRStatus(false, true), "ready for review");
			assertEquals(generator.formatPRStatus(false, false), "ready for review");
		});

		it("should format draft PR status correctly", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();

			// Act & Assert
			assertEquals(generator.formatPRStatus(true, false), "draft");
			assertEquals(generator.formatPRStatus(true, true), "draft");
		});
	});

	describe("formatChainItem", () => {
		it("should format chain item with PR number", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const item: PRChainInfo = {
				bookmark: "feature-1",
				base: "master",
				prNumber: 101,
				isDraft: false,
				isReady: true,
			};

			// Act
			const formatted = generator.formatChainItem(item, false, 1);

			// Assert
			assertEquals(
				formatted,
				"1. PR #101: feature-1 → master (ready for review)",
			);
		});

		it("should bold current PR in chain", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const item: PRChainInfo = {
				bookmark: "feature-2",
				base: "feature-1",
				prNumber: 102,
				isDraft: true,
				isReady: false,
			};

			// Act
			const formatted = generator.formatChainItem(item, true, 2);

			// Assert
			assertEquals(formatted, "2. **PR #102: feature-2 → feature-1 (draft)** ← You are here");
		});

		it("should handle PR without number", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const item: PRChainInfo = {
				bookmark: "feature-3",
				base: "feature-2",
				isDraft: true,
				isReady: false,
			};

			// Act
			const formatted = generator.formatChainItem(item, false, 3);

			// Assert
			assertEquals(formatted, "3. feature-3 → feature-2 (draft)");
		});
	});
});
