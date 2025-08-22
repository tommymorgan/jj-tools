import { assertEquals, assertExists, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { type CommandExecutor, detectStack } from "../src/stack_detection.ts";

function createMockResponse(stdout: string, stderr = "", code = 0) {
	return { stdout, stderr, code };
}

function handleLogCommand(cmd: string[], logOutput: string) {
	if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
		return createMockResponse(logOutput);
	}
	return null;
}

function handleShowCommand(cmd: string[], showOutput: string) {
	if (cmd.includes("show")) {
		return createMockResponse(showOutput);
	}
	return null;
}

function handleShowCommandWithMapping(
	cmd: string[],
	bookmarkToMessageMap: Record<string, string>,
) {
	if (!cmd.includes("show")) {
		return null;
	}

	for (const [bookmark, message] of Object.entries(bookmarkToMessageMap)) {
		if (cmd.includes(bookmark)) {
			return createMockResponse(message);
		}
	}

	return null;
}

function getReconcileResponse(cmdStr: string, logOutput: string) {
	if (cmdStr.includes("log") && cmdStr.includes("bookmarks")) {
		return createMockResponse(logOutput);
	}
	if (
		cmdStr.includes("jj bookmark create") ||
		cmdStr.includes("jj git fetch")
	) {
		return createMockResponse("");
	}
	return createMockResponse("", "Unknown command", 1);
}

function createMockExecutor(
	logOutput: string,
	showOutput = "feat: test",
): CommandExecutor {
	return {
		exec: async (cmd: string[]) => {
			return (
				handleLogCommand(cmd, logOutput) ||
				handleShowCommand(cmd, showOutput) ||
				createMockResponse("", "Unknown command", 1)
			);
		},
	};
}

function createMockExecutorWithMapping(
	logOutput: string,
	showMapping: Record<string, string>,
): CommandExecutor {
	return {
		exec: async (cmd: string[]) => {
			return (
				handleLogCommand(cmd, logOutput) ||
				handleShowCommandWithMapping(cmd, showMapping) ||
				createMockResponse("", "Unknown command", 1)
			);
		},
	};
}

describe("Stack Detection", () => {
	describe("detectStack", () => {
		it("should detect a simple linear stack with bookmarks", async () => {
			// Arrange
			const logOutput = `feature-3\nfeature-2\nfeature-1`;
			const mockExecutor = createMockExecutor(logOutput);

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
			const logOutput = `feature-2\n\nfeature-1\nmaster\n`;
			const mockExecutor = createMockExecutor(logOutput);

			// Act
			const stack = await detectStack(mockExecutor, "master");

			// Assert
			assertEquals(stack.bookmarks.length, 2);
			assertEquals(stack.bookmarks[0].name, "feature-1");
			assertEquals(stack.bookmarks[1].name, "feature-2");
		});

		it("should handle bookmarks with asterisk marking current position", async () => {
			// Arrange
			const logOutput = `feature-3\nfeature-2*\nfeature-1`;
			const mockExecutor = createMockExecutor(logOutput);

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
			const logOutput = `\n\n`;
			const mockExecutor = createMockExecutor(logOutput);

			// Act & Assert
			await assertRejects(
				async () => await detectStack(mockExecutor),
				Error,
				"No bookmarks found in current stack!",
			);
		});

		it("should extract commit messages for each bookmark", async () => {
			// Arrange
			const logOutput = `feature-2\nfeature-1`;
			const showMapping = {
				"feature-1":
					"feat: add user authentication\n\nDetailed description here",
				"feature-2": "feat: add user profile\n\nMore details",
			};

			const mockExecutor = createMockExecutorWithMapping(
				logOutput,
				showMapping,
			);

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
			const logOutput = `top-1\nmiddle-1*\nbottom-1`;
			const mockExecutor = createMockExecutor(logOutput);

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
			const logOutput = `branch-c\nbranch-a branch-b\n`;
			const mockExecutor = createMockExecutor(logOutput);

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

		it("should include commits with @origin bookmarks as candidates for local bookmark creation", async () => {
			// Arrange - simulating bookmarks that exist on remote but not locally
			const logOutput = `feature-3\nauto/jjsp-feature-2-abc123@origin\nfeature-1`;
			const mockExecutor = createMockExecutor(logOutput);

			// Act
			const stack = await detectStack(mockExecutor);

			// Assert - should include the commit so a local bookmark can be created
			assertEquals(stack.bookmarks.length, 3);
			assertEquals(stack.bookmarks[0].name, "feature-1");
			assertEquals(stack.bookmarks[1].name, "auto/jjsp-feature-2-abc123");
			assertEquals(stack.bookmarks[2].name, "feature-3");
			// The @origin suffix should be stripped but the bookmark included
			const bookmarkNames = stack.bookmarks.map((b) => b.name);
			assertEquals(
				bookmarkNames.includes("auto/jjsp-feature-2-abc123@origin"),
				false,
			);
			assertEquals(bookmarkNames.includes("auto/jjsp-feature-2-abc123"), true);
		});

		it("should include @origin bookmarks but filter out other remote tracking bookmarks", async () => {
			// Arrange - multiple remote tracking bookmarks
			const logOutput = `local-feature\nremote-1@origin\nremote-2@upstream\nlocal-fix`;
			const mockExecutor = createMockExecutor(logOutput);

			// Act
			const stack = await detectStack(mockExecutor);

			// Assert - should include @origin (for local bookmark creation) but not @upstream
			assertEquals(stack.bookmarks.length, 3);
			assertEquals(stack.bookmarks[0].name, "local-fix");
			assertEquals(stack.bookmarks[1].name, "remote-1");
			assertEquals(stack.bookmarks[2].name, "local-feature");
			// @origin should be stripped, @upstream should be filtered out entirely
			const bookmarkNames = stack.bookmarks.map((b) => b.name);
			assertEquals(
				bookmarkNames.some((n) => n.includes("@")),
				false,
			);
		});
	});

	describe("remote bookmark detection", () => {
		it("should detect when stack contains only remote bookmarks and provide them for reconciliation", async () => {
			// Arrange - simulating a stack where bookmarks exist on remote but not locally
			// This happens when you switch computers and haven't created local tracking bookmarks
			const logOutput = `feat/pr-risk-schemas@origin
auto/jjsp-update-dependencies-across-eng-sukvuq@origin
auto/jjsp-add-pr-file-count-distribution-nmvlyp@origin
feat/cm-pr-approval-time@origin
feat/github-lib@origin
docs/cm-remove-fix-on-fix@origin`;

			const mockExecutor = createMockExecutor(logOutput);

			// Act
			const { detectStackWithRemotes } = await import(
				"../src/stack_detection.ts"
			);
			const result = await detectStackWithRemotes(mockExecutor);

			// Assert - The new function should detect remote-only bookmarks
			assertEquals(result.hasRemoteOnlyBookmarks, true);
			assertEquals(result.remoteBookmarks.length, 6);
			assertEquals(result.localBookmarks.length, 0);

			// Remote bookmarks should be in the correct order (bottom to top)
			assertEquals(result.remoteBookmarks[0].name, "docs/cm-remove-fix-on-fix");
			assertEquals(result.remoteBookmarks[0].remote, "origin");
			assertEquals(result.remoteBookmarks[1].name, "feat/github-lib");
			assertEquals(result.remoteBookmarks[2].name, "feat/cm-pr-approval-time");
			assertEquals(
				result.remoteBookmarks[3].name,
				"auto/jjsp-add-pr-file-count-distribution-nmvlyp",
			);
			assertEquals(
				result.remoteBookmarks[4].name,
				"auto/jjsp-update-dependencies-across-eng-sukvuq",
			);
			assertEquals(result.remoteBookmarks[5].name, "feat/pr-risk-schemas");
		});

		it("should create local bookmarks tracking remote ones when reconciliation is requested", async () => {
			// Arrange - Stack with only remote bookmarks
			const logOutput = `feat/feature-c@origin
feat/feature-b@origin
feat/feature-a@origin`;

			const executedCommands: string[][] = [];

			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					executedCommands.push(cmd);
					return getReconcileResponse(cmd.join(" "), logOutput);
				},
			};

			// Act
			const { reconcileRemoteBookmarks } = await import(
				"../src/stack_detection.ts"
			);
			const result = await reconcileRemoteBookmarks(mockExecutor);

			// Assert
			assertEquals(result.success, true);
			assertEquals(result.createdBookmarks.length, 3);
			assertEquals(result.createdBookmarks[0], "feat/feature-a");
			assertEquals(result.createdBookmarks[1], "feat/feature-b");
			assertEquals(result.createdBookmarks[2], "feat/feature-c");

			// Verify the correct jj commands were executed
			const bookmarkCreateCommands = executedCommands.filter(
				(cmd) =>
					cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "create",
			);
			assertEquals(bookmarkCreateCommands.length, 3);

			// Check that bookmarks were created with correct names tracking remote
			assertEquals(bookmarkCreateCommands[0].includes("feat/feature-a"), true);
			assertEquals(
				bookmarkCreateCommands[0].includes("feat/feature-a@origin"),
				true,
			);
			assertEquals(bookmarkCreateCommands[1].includes("feat/feature-b"), true);
			assertEquals(bookmarkCreateCommands[2].includes("feat/feature-c"), true);
		});
	});

	describe("hasConflicts", () => {
		it("should detect when there are no conflicts in the stack", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					if (
						cmdStr.includes("jj log") &&
						cmdStr.includes("builtin_log_oneline")
					) {
						return createMockResponse(
							`
wqnwkozp tommy@example.com 2025-08-13 10:00:00 bookmark-a 12345678
vxyzabcd tommy@example.com 2025-08-13 09:00:00 bookmark-b 87654321
`.trim(),
						);
					}
					throw new Error(`Unexpected command: ${cmdStr}`);
				},
			};

			// Act
			const { hasConflicts } = await import("../src/stack_detection.ts");
			const result = await hasConflicts(mockExecutor, "master");

			// Assert
			assertEquals(result.hasConflicts, false);
			assertEquals(result.conflictedCommits.length, 0);
		});

		it("should detect when there are conflicts in the stack", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					if (
						cmdStr.includes("jj log") &&
						cmdStr.includes("builtin_log_oneline")
					) {
						return createMockResponse(
							`
wqnwkozp tommy@example.com 2025-08-13 10:00:00 bookmark-a 12345678
vwptqkon tommy@example.com 2025-08-13 09:00:00 feat/pr-risk-schemas 2ddc0365 conflict
`.trim(),
						);
					}
					throw new Error(`Unexpected command: ${cmdStr}`);
				},
			};

			// Act
			const { hasConflicts } = await import("../src/stack_detection.ts");
			const result = await hasConflicts(mockExecutor, "master");

			// Assert
			assertEquals(result.hasConflicts, true);
			assertEquals(result.conflictedCommits.length, 1);
			assertEquals(result.conflictedCommits[0].changeId, "vwptqkon");
			assertEquals(
				result.conflictedCommits[0].bookmark,
				"feat/pr-risk-schemas",
			);
			assertEquals(result.conflictedCommits[0].description, "conflict");
		});

		it("should detect multiple conflicts in the stack", async () => {
			// Arrange
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					if (
						cmdStr.includes("jj log") &&
						cmdStr.includes("builtin_log_oneline")
					) {
						return createMockResponse(
							`
wqnwkozp tommy@example.com 2025-08-13 10:00:00 bookmark-a 12345678
vwptqkon tommy@example.com 2025-08-13 09:00:00 feat/pr-risk-schemas 2ddc0365 conflict
abcdefgh tommy@example.com 2025-08-13 08:00:00 another-bookmark 11111111 (conflict) some description
`.trim(),
						);
					}
					throw new Error(`Unexpected command: ${cmdStr}`);
				},
			};

			// Act
			const { hasConflicts } = await import("../src/stack_detection.ts");
			const result = await hasConflicts(mockExecutor, "master");

			// Assert
			assertEquals(result.hasConflicts, true);
			assertEquals(result.conflictedCommits.length, 2);
			assertEquals(result.conflictedCommits[0].changeId, "vwptqkon");
			assertEquals(
				result.conflictedCommits[0].bookmark,
				"feat/pr-risk-schemas",
			);
			assertEquals(result.conflictedCommits[0].description, "conflict");
			assertEquals(result.conflictedCommits[1].changeId, "abcdefgh");
			assertEquals(result.conflictedCommits[1].bookmark, "another-bookmark");
			assertEquals(
				result.conflictedCommits[1].description,
				"(conflict) some description",
			);
		});
	});
});
