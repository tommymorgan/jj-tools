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
					commitMessage: "feat: implement feature 1",
				},
				{
					bookmark: "feature-2",
					base: "feature-1",
					prNumber: 102,
					isDraft: true,
					isReady: false,
					commitMessage: "feat: implement feature 2",
				},
				{
					bookmark: "feature-3",
					base: "feature-2",
					prNumber: 103,
					isDraft: true,
					isReady: false,
					commitMessage: "feat: implement feature 3",
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
			assertStringIncludes(description, "feat: implement feature 1");
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
					commitMessage: "feat: implement feature 1",
				},
				{
					bookmark: "feature-2",
					base: "feature-1",
					prNumber: 102,
					isDraft: true,
					isReady: false,
					commitMessage: "feat: implement feature 2",
				},
				{
					bookmark: "feature-3",
					base: "feature-2",
					prNumber: 103,
					isDraft: true,
					isReady: false,
					commitMessage: "feat: implement feature 3",
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
			assertStringIncludes(description, "feat: implement feature 2");
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
				"2. 👉 **You are here** 👉 **PR #102: feature-2 → feature-1 (draft)**",
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
				"1. 👉 **You are here** 👉 **PR #201: fix-1 → develop (ready for review)**",
			);
			// Other PR should not be bold and not have the marker
			assertStringIncludes(description, "2. PR #202: fix-2 → fix-1");
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
			assertStringIncludes(
				description,
				`PR Stack (review in order) as of ${today}`,
			);
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

	describe("generateDescription with commit message", () => {
		it("should replace PR body with commit message between stack metadata and chain visualization", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "feature-1",
					base: "master",
					prNumber: 101,
					isDraft: false,
					isReady: true,
					commitMessage: "feat: add user authentication\n\nThis adds a new authentication system that supports:\n- Email/password login\n- OAuth integration\n- JWT token generation",
				},
				{
					bookmark: "feature-2",
					base: "feature-1",
					prNumber: 102,
					isDraft: true,
					isReady: false,
					commitMessage: "feat: add profile management",
				},
			];

			const options: PRDescriptionOptions = {
				currentPR: chain[0],
				fullChain: chain,
				position: 1,
				originalBody: "This old content should be replaced", // Even with existing body
			};

			// Act
			const description = generator.generateDescription(options);

			// Assert
			// Should include stack metadata
			assertStringIncludes(description, "Stack position: 1 of 2");
			assertStringIncludes(description, "Base: `master`");
			
			// Should include commit message as body
			assertStringIncludes(description, "feat: add user authentication");
			assertStringIncludes(description, "This adds a new authentication system");
			assertStringIncludes(description, "- Email/password login");
			assertStringIncludes(description, "- OAuth integration");
			assertStringIncludes(description, "- JWT token generation");
			
			// Should include PR chain visualization
			assertStringIncludes(description, "PR Stack (review in order)");
			assertStringIncludes(description, "Created with jj (Jujutsu) stack-prs");
			
			// Should NOT include the old PR body
			assertEquals(description.includes("This old content should be replaced"), false);
		});

		it("should include commit message in complete PR description even without body text", () => {
			// Arrange
			const generator = new PRDescriptionGenerator();
			const chain: PRChainInfo[] = [
				{
					bookmark: "quick-fix",
					base: "main",
					prNumber: 201,
					isDraft: false,
					isReady: true,
					commitMessage: "fix: resolve null pointer exception",
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
			// Should include stack metadata
			assertStringIncludes(description, "Stack position: 1 of 1");
			assertStringIncludes(description, "Base: `main`");
			
			// Should include commit message
			assertStringIncludes(description, "fix: resolve null pointer exception");
			
			// Should include chain visualization
			assertStringIncludes(description, "PR Stack (review in order)");
			assertStringIncludes(description, "Created with jj (Jujutsu) stack-prs");
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
			assertEquals(
				formatted,
				"2. 👉 **You are here** 👉 **PR #102: feature-2 → feature-1 (draft)**",
			);
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
