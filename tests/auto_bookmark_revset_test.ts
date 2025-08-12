import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { AutoBookmarkManager } from "../src/auto_bookmark.ts";
import type { CommandExecutor } from "../src/stack_detection.ts";

// Helper function to create mock responses
function createMockResponse(stdout: string, stderr = "", code = 0) {
	return { stdout, stderr, code };
}

// Helper function to handle jj log commands with revset validation
function handleLogCommand(
	cmd: string[],
	expectedRevset: string,
	logOutput: string,
) {
	if (cmd.includes("log") && cmd.some((c) => c.includes("change_id"))) {
		const revsetIndex = cmd.indexOf("-r") + 1;
		const revset = cmd[revsetIndex];
		assertEquals(revset, expectedRevset, `Should use ${expectedRevset} revset`);
		return createMockResponse(logOutput);
	}
	return null;
}

// Helper function to handle jj show commands
function handleShowCommand(
	cmd: string[],
	changeIdToMessageMap: Record<string, string>,
) {
	if (!cmd.includes("show")) {
		return null;
	}

	// Check for wildcard default response first
	if (changeIdToMessageMap["*"]) {
		return createMockResponse(changeIdToMessageMap["*"]);
	}

	// Check for specific change IDs
	for (const [changeId, message] of Object.entries(changeIdToMessageMap)) {
		if (cmd.includes(changeId)) {
			return createMockResponse(message);
		}
	}

	return null;
}

// Helper function to create mock executor for revset tests
function createRevsetMockExecutor(
	logOutput: string,
	showMap: Record<string, string> = {},
): CommandExecutor {
	return {
		exec: async (cmd: string[]) => {
			const logResponse = handleLogCommand(
				cmd,
				"(::@ | @::) & trunk()..",
				logOutput,
			);
			if (logResponse) return logResponse;

			const showResponse = handleShowCommand(cmd, showMap);
			if (showResponse) return showResponse;

			return createMockResponse("", "Unknown command", 1);
		},
	};
}

describe("Auto Bookmark Manager - Revset Logic", () => {
	describe("findUnbookmarkedChanges with proper revset", () => {
		it("should get changes from trunk to current position", async () => {
			// Arrange - simulating a stack from trunk to current position
			const logOutput = `xvrxqsnrzpnkpwxsvtwskyrzrxvvryox 
szqzyprqmrlwvkrpmvppxsutusrvpprl `;
			const showMap = {
				xvrxqsnrzpnkpwxsvtwskyrzrxvvryox: "feat: add settings",
				szqzyprqmrlwvkrpmvppxsutusrvpprl: "feat: add user profile",
			};

			const mockExecutor = createRevsetMockExecutor(logOutput, showMap);

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const unbookmarked = await manager.findUnbookmarkedChanges();

			// Assert - should only get stack changes, not initial commit
			assertEquals(unbookmarked.length, 2);
			assertEquals(
				unbookmarked[0].changeId,
				"xvrxqsnrzpnkpwxsvtwskyrzrxvvryox",
			);
			assertEquals(
				unbookmarked[1].changeId,
				"szqzyprqmrlwvkrpmvppxsutusrvpprl",
			);
		});

		it("should handle full stack including all connected changes", async () => {
			// Arrange - simulating a full stack
			const logOutput = `change10 
change9 
change8 
change7 
change6 `;
			const showMap = { "*": "feat: some feature" }; // Default response for any show command

			const mockExecutor = createRevsetMockExecutor(logOutput, showMap);

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const unbookmarked = await manager.findUnbookmarkedChanges();

			// Assert
			assertEquals(unbookmarked.length, 5);
		});

		it("should get all changes from trunk to current position", async () => {
			// Arrange
			const logOutput = `current 
parent 
grandparent `;
			const showMap = { "*": "feat: test" }; // Default response for any show command

			const mockExecutor = createRevsetMockExecutor(logOutput, showMap);

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const unbookmarked = await manager.findUnbookmarkedChanges();

			// Assert - should get exactly the stack changes
			assertEquals(unbookmarked.length, 3);
			assertEquals(unbookmarked[0].changeId, "current");
			assertEquals(unbookmarked[1].changeId, "parent");
			assertEquals(unbookmarked[2].changeId, "grandparent");
		});
	});
});
