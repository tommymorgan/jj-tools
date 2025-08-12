import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { detectBaseBranch } from "../src/base_detector.ts";
import type { CommandExecutor } from "../src/stack_detection.ts";

describe("Base Branch Detection", () => {
	describe("detectBaseBranch", () => {
		it("should detect master as base branch", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return { stdout: "master", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, "master");
		});

		it("should detect main as base branch", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return { stdout: "main", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, "main");
		});

		it("should detect trunk as base branch", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return { stdout: "trunk", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, "trunk");
		});

		it("should prefer common base names when multiple bookmarks exist", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return {
							stdout: "feature-1 master other-branch",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, "master"); // Should prefer master over other names
		});

		it("should filter out remote tracking bookmarks", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return { stdout: "main@origin main", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, "main"); // Should return local bookmark, not remote
		});

		it("should return null when trunk() has no bookmarks", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return { stdout: "", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, null);
		});

		it("should return null when trunk() command fails", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (_cmd: string[]) => {
					return { stdout: "", stderr: "trunk() not found", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, null);
		});

		it("should return first local bookmark when no common names found", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return {
							stdout: "custom-base another-branch",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, "custom-base");
		});

		it("should handle only remote bookmarks gracefully", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("trunk()")) {
						return {
							stdout: "main@origin master@upstream",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const base = await detectBaseBranch(mockExecutor);

			// Assert
			assertEquals(base, null); // No local bookmarks available
		});
	});
});
