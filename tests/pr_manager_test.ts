import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
	buildPRChain,
	type CreatePROptions,
	createPR,
	type ExistingPR,
	extractPRNumber,
	findExistingPRs,
	type UpdatePROptions,
	updatePR,
} from "../src/pr_manager.ts";
import type { Bookmark } from "../src/stack_detection.ts";

describe("Pull Request Manager", () => {
	describe("findExistingPRs", () => {
		it("should find existing PRs for bookmarks", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("pr") && cmd.includes("list")) {
						return {
							stdout: JSON.stringify([
								{
									number: 101,
									headRefName: "feature-1",
									baseRefName: "master",
									isDraft: false,
								},
								{
									number: 102,
									headRefName: "feature-2",
									baseRefName: "feature-1",
									isDraft: true,
								},
							]),
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Using functional API
			const bookmarks: Bookmark[] = [
				{ name: "feature-1" },
				{ name: "feature-2" },
				{ name: "feature-3" },
			];

			// Act
			const existingPRs = await findExistingPRs(mockExecutor, bookmarks);

			// Assert
			assertEquals(existingPRs.size, 2);
			assertEquals(existingPRs.get("feature-1")?.number, 101);
			assertEquals(existingPRs.get("feature-1")?.isDraft, false);
			assertEquals(existingPRs.get("feature-2")?.number, 102);
			assertEquals(existingPRs.get("feature-2")?.isDraft, true);
			assertEquals(existingPRs.has("feature-3"), false);
		});

		it("should handle empty PR list", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("pr") && cmd.includes("list")) {
						return { stdout: "[]", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Using functional API
			const bookmarks: Bookmark[] = [{ name: "feature-1" }];

			// Act
			const existingPRs = await findExistingPRs(mockExecutor, bookmarks);

			// Assert
			assertEquals(existingPRs.size, 0);
		});
	});

	describe("createPR", () => {
		it("should create a new PR with correct parameters", async () => {
			// Arrange
			let capturedCommand: string[] = [];
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					capturedCommand = cmd;
					if (cmd.includes("pr") && cmd.includes("create")) {
						return {
							stdout: "https://github.com/owner/repo/pull/123",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Using functional API
			const options: CreatePROptions = {
				title: "feat: add new feature",
				body: "Test PR body",
				head: "feature-1",
				base: "master",
				draft: false,
			};

			// Act
			const prNumber = await createPR(mockExecutor, options);

			// Assert
			assertEquals(prNumber, 123);
			assertEquals(capturedCommand.includes("--title"), true);
			assertEquals(capturedCommand.includes("feat: add new feature"), true);
			assertEquals(capturedCommand.includes("--base"), true);
			assertEquals(capturedCommand.includes("master"), true);
			assertEquals(capturedCommand.includes("--head"), true);
			assertEquals(capturedCommand.includes("feature-1"), true);
		});

		it("should create a draft PR when specified", async () => {
			// Arrange
			let capturedCommand: string[] = [];
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					capturedCommand = cmd;
					if (cmd.includes("pr") && cmd.includes("create")) {
						return {
							stdout: "https://github.com/owner/repo/pull/124",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Using functional API
			const options: CreatePROptions = {
				title: "test: add tests",
				body: "Draft PR",
				head: "feature-2",
				base: "feature-1",
				draft: true,
			};

			// Act
			const prNumber = await createPR(mockExecutor, options);

			// Assert
			assertEquals(prNumber, 124);
			assertEquals(capturedCommand.includes("--draft"), true);
		});
	});

	describe("updatePR", () => {
		it("should update PR base when needed", async () => {
			// Arrange
			const capturedCommands: string[][] = [];
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					capturedCommands.push(cmd);
					return { stdout: "", stderr: "", code: 0 };
				},
			};

			// Using functional API
			const options: UpdatePROptions = {
				prNumber: 101,
				base: "develop",
				body: "Updated description",
			};

			// Act
			await updatePR(mockExecutor, options);

			// Assert
			const baseCommand = capturedCommands.find(
				(cmd) => cmd.includes("edit") && cmd.includes("--base"),
			);
			assertExists(baseCommand);
			assertEquals(baseCommand?.includes("develop"), true);
			assertEquals(baseCommand?.includes("101"), true);
		});

		it("should update PR description", async () => {
			// Arrange
			const capturedCommands: string[][] = [];
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					capturedCommands.push(cmd);
					return { stdout: "", stderr: "", code: 0 };
				},
			};

			// Using functional API
			const options: UpdatePROptions = {
				prNumber: 102,
				body: "New PR description with chain visualization",
			};

			// Act
			await updatePR(mockExecutor, options);

			// Assert
			const bodyCommand = capturedCommands.find(
				(cmd) => cmd.includes("edit") && cmd.includes("--body"),
			);
			assertExists(bodyCommand);
			assertEquals(bodyCommand?.includes("102"), true);
		});
	});

	describe("buildPRChain", () => {
		it("should build correct PR chain for stack", async () => {
			// Arrange
			const _mockExecutor = {
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			};

			// Using functional API
			const bookmarks: Bookmark[] = [
				{ name: "feature-1", commitMessage: "feat: add auth" },
				{ name: "feature-2", commitMessage: "feat: add profile" },
				{ name: "feature-3", commitMessage: "feat: add settings" },
			];

			const existingPRs = new Map<string, ExistingPR>([
				[
					"feature-1",
					{
						number: 101,
						headRefName: "feature-1",
						baseRefName: "master",
						isDraft: false,
					},
				],
			]);

			// Act
			const chain = await buildPRChain(bookmarks, existingPRs, "master");

			// Assert
			assertEquals(chain.length, 3);

			// First PR (bottom of stack)
			assertEquals(chain[0].bookmark, "feature-1");
			assertEquals(chain[0].base, "master");
			assertEquals(chain[0].isBottom, true);
			assertEquals(chain[0].existingPR?.number, 101);
			assertEquals(chain[0].title, "feat: add auth");

			// Second PR
			assertEquals(chain[1].bookmark, "feature-2");
			assertEquals(chain[1].base, "feature-1");
			assertEquals(chain[1].isBottom, false);
			assertEquals(chain[1].existingPR, undefined);
			assertEquals(chain[1].title, "feat: add profile");

			// Third PR (top of stack)
			assertEquals(chain[2].bookmark, "feature-3");
			assertEquals(chain[2].base, "feature-2");
			assertEquals(chain[2].isBottom, false);
			assertEquals(chain[2].existingPR, undefined);
			assertEquals(chain[2].title, "feat: add settings");
		});

		it("should handle custom base branch", async () => {
			// Arrange
			const _mockExecutor = {
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			};

			// Using functional API
			const bookmarks: Bookmark[] = [{ name: "fix-1" }, { name: "fix-2" }];

			// Act
			const chain = await buildPRChain(bookmarks, new Map(), "develop");

			// Assert
			assertEquals(chain[0].base, "develop");
			assertEquals(chain[1].base, "fix-1");
		});
	});

	describe("extractPRNumber", () => {
		it("should extract PR number from GitHub URL", () => {
			// Act & Assert
			assertEquals(
				extractPRNumber("https://github.com/owner/repo/pull/456"),
				456,
			);
			assertEquals(extractPRNumber("https://github.com/owner/repo/pull/1"), 1);
			assertEquals(extractPRNumber("Created PR #789"), 789);
		});

		it("should return null for invalid PR references", () => {
			// Act & Assert
			assertEquals(extractPRNumber("No PR here"), null);
			assertEquals(extractPRNumber(""), null);
		});
	});
});
