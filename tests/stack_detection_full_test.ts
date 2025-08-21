import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { type CommandExecutor, detectStack } from "../src/stack_detection.ts";

function createMockResponse(stdout: string, stderr = "", code = 0) {
	return { stdout, stderr, code };
}

function createMockExecutor(
	logOutput: string,
	showOutput = "feat: test",
): CommandExecutor {
	return {
		exec: async (cmd: string[]) => {
			const isLogCommand =
				cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"));
			const isShowCommand = cmd.includes("show");

			if (isLogCommand) {
				return createMockResponse(logOutput);
			}
			if (isShowCommand) {
				return createMockResponse(showOutput);
			}
			return createMockResponse("", "Unknown command", 1);
		},
	};
}

describe("Stack Detection - Full Stack", () => {
	it("should detect all bookmarks in the stack, not just ancestors of current position", async () => {
		// Arrange - simulating being in the middle of a stack
		const logOutput = `auto/add-settings-xvrxqs
auto/add-middleware-layer-pqyzym
auto/add-user-profile-szqzyp`;

		const mockExecutor = createMockExecutor(logOutput);

		// Act
		const stack = await detectStack(mockExecutor);

		// Assert - should get all 3 bookmarks in the stack
		assertEquals(stack.bookmarks.length, 3);
		assertEquals(stack.bookmarks[0].name, "auto/add-user-profile-szqzyp");
		assertEquals(stack.bookmarks[1].name, "auto/add-middleware-layer-pqyzym");
		assertEquals(stack.bookmarks[2].name, "auto/add-settings-xvrxqs");
	});

	it("should detect full stack even when positioned at the top", async () => {
		// Arrange - at top of stack
		const logOutput = `feature-top
feature-middle  
feature-bottom`;

		const mockExecutor = createMockExecutor(logOutput);

		// Act
		const stack = await detectStack(mockExecutor);

		// Assert - should still get all bookmarks
		assertEquals(stack.bookmarks.length, 3);
		assertEquals(stack.bookmarks[0].name, "feature-bottom");
		assertEquals(stack.bookmarks[1].name, "feature-middle");
		assertEquals(stack.bookmarks[2].name, "feature-top");
	});
});
