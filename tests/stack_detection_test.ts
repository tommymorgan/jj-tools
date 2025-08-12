import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { Bookmark, detectStack, StackInfo } from "../src/stack_detection.ts";

describe("Stack Detection", () => {
	describe("detectStack", () => {
		it("should detect a simple linear stack with bookmarks", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
						return {
							stdout: `feature-3\nfeature-2\nfeature-1`,
							stderr: "",
							code: 0,
						};
					}
					if (cmd.includes("show")) {
						return { stdout: "feat: test", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const stack = await detectStack(mockExecutor);

			// Assert
			assertExists(stack);
			assertEquals(stack.bookmarks.length, 3);
			assertEquals(stack.bookmarks[0].name, "feature-1");
			assertEquals(stack.bookmarks[1].name, "feature-2");
			assertEquals(stack.bookmarks[2].name, "feature-3");
		});

		it("should filter out empty lines and base branch", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
						return {
							stdout: `feature-2\n\nfeature-1\nmaster\n`,
							stderr: "",
							code: 0,
						};
					}
					if (cmd.includes("show")) {
						return { stdout: "feat: test", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const stack = await detectStack(mockExecutor, "master");

			// Assert
			assertEquals(stack.bookmarks.length, 2);
			assertEquals(stack.bookmarks[0].name, "feature-1");
			assertEquals(stack.bookmarks[1].name, "feature-2");
		});

		it("should handle bookmarks with asterisk marking current position", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
						return {
							stdout: `feature-3\nfeature-2*\nfeature-1`,
							stderr: "",
							code: 0,
						};
					}
					if (cmd.includes("show")) {
						return { stdout: "feat: test", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const stack = await detectStack(mockExecutor);

			// Assert
			assertEquals(stack.bookmarks.length, 3);
			assertEquals(stack.bookmarks[1].name, "feature-2");
			assertEquals(stack.bookmarks[1].isCurrent, true);
			assertEquals(stack.bookmarks[0].isCurrent, false);
			assertEquals(stack.bookmarks[2].isCurrent, false);
		});

		it("should error when no bookmarks found in stack", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
						return {
							stdout: `\n\n`,
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act & Assert
			await assertRejects(
				async () => await detectStack(mockExecutor),
				Error,
				"No bookmarks found in current stack!",
			);
		});

		it("should extract commit messages for each bookmark", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
						return {
							stdout: `feature-2\nfeature-1`,
							stderr: "",
							code: 0,
						};
					}
					if (cmd.includes("show") && cmd.includes("feature-1")) {
						return {
							stdout:
								"feat: add user authentication\n\nDetailed description here",
							stderr: "",
							code: 0,
						};
					}
					if (cmd.includes("show") && cmd.includes("feature-2")) {
						return {
							stdout: "feat: add user profile\n\nMore details",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const stack = await detectStack(mockExecutor);

			// Assert
			assertEquals(
				stack.bookmarks[0].commitMessage,
				"feat: add user authentication",
			);
			assertEquals(stack.bookmarks[1].commitMessage, "feat: add user profile");
		});

		it("should detect stack from any position (not just top)", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
						return {
							stdout: `top-1\nmiddle-1*\nbottom-1`,
							stderr: "",
							code: 0,
						};
					}
					if (cmd.includes("show")) {
						return { stdout: "feat: test", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const stack = await detectStack(mockExecutor);

			// Assert
			assertEquals(stack.bookmarks.length, 3);
			assertEquals(stack.bookmarks[0].name, "bottom-1");
			assertEquals(stack.bookmarks[1].name, "middle-1");
			assertEquals(stack.bookmarks[2].name, "top-1");
			assertEquals(stack.currentPosition, 1); // middle-1 is at index 1
		});

		it("should handle multiple bookmarks on same commit", async () => {
			// Arrange
			const mockExecutor = {
				exec: async (cmd: string[]) => {
					if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
						return {
							stdout: `branch-c\nbranch-a branch-b\n`,
							stderr: "",
							code: 0,
						};
					}
					if (cmd.includes("show")) {
						return { stdout: "feat: test", stderr: "", code: 0 };
					}
					return { stdout: "", stderr: "Unknown command", code: 1 };
				},
			};

			// Act
			const stack = await detectStack(mockExecutor);

			// Assert
			assertEquals(stack.bookmarks.length, 3);
			assertEquals(stack.bookmarks[0].name, "branch-a");
			assertEquals(stack.bookmarks[1].name, "branch-b");
			assertEquals(stack.bookmarks[2].name, "branch-c");
			// branch-a and branch-b should have the same commit hash
			assertEquals(
				stack.bookmarks[0].commitHash,
				stack.bookmarks[1].commitHash,
			);
		});
	});
});
