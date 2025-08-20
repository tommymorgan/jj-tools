import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { CommandExecutor } from "../src/stack_detection.ts";

// Test helper to match commands to responses
function matchTestCommand(cmdStr: string, logOutput: string) {
	if (cmdStr.includes("log") && cmdStr.includes("bookmarks")) {
		return { stdout: logOutput, stderr: "", code: 0 };
	}
	if (
		cmdStr.includes("jj git fetch") ||
		cmdStr.includes("jj bookmark create")
	) {
		return { stdout: "", stderr: "", code: 0 };
	}
	return { stdout: "", stderr: "Unknown command", code: 1 };
}

// Test helper for creating mock command executors
function createMockExecutor(executedCommands: string[][], logOutput: string) {
	return {
		exec: async (cmd: string[]) => {
			executedCommands.push(cmd);
			return matchTestCommand(cmd.join(" "), logOutput);
		},
	} as CommandExecutor;
}

describe("Main Integration - Remote Bookmark Reconciliation", () => {
	it("should detect remote-only bookmarks and prompt for reconciliation", async () => {
		// Arrange - simulate a stack with only remote bookmarks
		const executedCommands: string[][] = [];
		const mockExecutor = createMockExecutor(
			executedCommands,
			`feat/feature-c@origin
feat/feature-b@origin
feat/feature-a@origin`,
		);

		// We'll check if the correct message was logged by examining executed commands
		// In a real scenario, safeLog would output to console

		// Act
		const { handleRemoteOnlyBookmarks } = await import("../src/main.ts");
		const result = await handleRemoteOnlyBookmarks(
			mockExecutor,
			"master",
			false,
		);

		// Assert
		assertEquals(result.success, true);
		assertEquals(result.reconciledBookmarks.length, 3);
		assertEquals(result.reconciledBookmarks[0], "feat/feature-a");
		assertEquals(result.reconciledBookmarks[1], "feat/feature-b");
		assertEquals(result.reconciledBookmarks[2], "feat/feature-c");

		// Verify the correct jj commands were executed
		const bookmarkCreateCommands = executedCommands.filter(
			(cmd) => cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "create",
		);
		assertEquals(bookmarkCreateCommands.length, 3);
	});

	it("should skip reconciliation in dry-run mode", async () => {
		// Arrange
		const executedCommands: string[][] = [];
		const mockExecutor = createMockExecutor(
			executedCommands,
			`feat/feature-a@origin`,
		);

		// Act
		const { handleRemoteOnlyBookmarks } = await import("../src/main.ts");
		const result = await handleRemoteOnlyBookmarks(
			mockExecutor,
			"master",
			true,
		);

		// Assert
		assertEquals(result.success, true);

		// In dry-run mode, no bookmark create commands should be executed
		const createCommands = executedCommands.filter(
			(cmd) => cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "create",
		);
		assertEquals(createCommands.length, 0);
	});
});
