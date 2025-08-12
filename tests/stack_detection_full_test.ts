import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { type CommandExecutor, detectStack } from "../src/stack_detection.ts";

describe("Stack Detection - Full Stack", () => {
	it("should detect all bookmarks in the stack, not just ancestors of current position", async () => {
		// Arrange - simulating being in the middle of a stack
		const mockExecutor: CommandExecutor = {
			exec: async (cmd: string[]) => {
				if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
					// Should get all bookmarks in the connected stack
					return {
						stdout: `auto/add-settings-xvrxqs
auto/add-middleware-layer-pqyzym
auto/add-user-profile-szqzyp`,
						stderr: "",
						code: 0,
					};
				}
				if (cmd.includes("show")) {
					return {
						stdout: "feat: test",
						stderr: "",
						code: 0,
					};
				}
				return { stdout: "", stderr: "Unknown command", code: 1 };
			},
		};

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
		const mockExecutor: CommandExecutor = {
			exec: async (cmd: string[]) => {
				if (cmd.includes("log") && cmd.some((c) => c.includes("bookmarks"))) {
					// The revset should capture the entire connected stack
					return {
						stdout: `feature-top
feature-middle  
feature-bottom`,
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
		assertEquals(stack.bookmarks.length, 3);
		assertEquals(stack.bookmarks[0].name, "feature-bottom");
		assertEquals(stack.bookmarks[1].name, "feature-middle");
		assertEquals(stack.bookmarks[2].name, "feature-top");
	});
});
