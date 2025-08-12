import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
	AutoBookmarkManager,
	type UnbookmarkedChange,
} from "../src/auto_bookmark.ts";
import type { CommandExecutor } from "../src/stack_detection.ts";

// Helper function to create mock responses
function createMockResponse(stdout: string, stderr = "", code = 0) {
	return { stdout, stderr, code };
}

// Helper function to handle jj log commands
function handleLogCommand(cmd: string[], logOutput: string) {
	if (cmd.includes("log") && cmd.some((c) => c.includes("change_id"))) {
		return createMockResponse(logOutput);
	}
	return null;
}

// Helper function to handle jj show commands with change ID mapping
function handleShowCommand(
	cmd: string[],
	changeIdToMessageMap: Record<string, string>,
) {
	if (!cmd.includes("show")) {
		return null;
	}

	for (const [changeId, message] of Object.entries(changeIdToMessageMap)) {
		if (cmd.includes(changeId)) {
			return createMockResponse(message);
		}
	}

	return null;
}

// Helper function to handle jj bookmark list commands
function handleBookmarkListCommand(cmd: string[], bookmarkOutput: string) {
	if (cmd.includes("bookmark") && cmd.includes("list")) {
		return createMockResponse(bookmarkOutput);
	}
	return null;
}

// Helper function to handle jj pr view commands with state mapping
function handlePrViewCommand(
	cmd: string[],
	bookmarkToStateMap: Record<string, string>,
) {
	if (!cmd.includes("pr") || !cmd.includes("view")) {
		return null;
	}

	for (const [bookmark, state] of Object.entries(bookmarkToStateMap)) {
		if (cmd.includes(bookmark)) {
			return createMockResponse(JSON.stringify({ state }));
		}
	}

	// Default: no PR found
	return createMockResponse("", "no pull requests found", 1);
}

// Helper function to handle jj bookmark delete commands
function handleBookmarkDeleteCommand(
	cmd: string[],
	deletedBookmarks: string[],
) {
	if (cmd.includes("bookmark") && cmd.includes("delete")) {
		const bookmarkName = cmd[cmd.indexOf("delete") + 1];
		deletedBookmarks.push(bookmarkName);
		return createMockResponse("");
	}
	return null;
}

// Helper function to create mock executor for findUnbookmarkedChanges tests
function createFindUnbookmarkedMockExecutor(
	logOutput: string,
	showMap: Record<string, string>,
): CommandExecutor {
	return {
		exec: async (cmd: string[]) => {
			return (
				handleLogCommand(cmd, logOutput) ||
				handleShowCommand(cmd, showMap) ||
				createMockResponse("", "Unknown command", 1)
			);
		},
	};
}

// Helper function to create mock executor for cleanup tests
function createCleanupMockExecutor(
	prStateMap: Record<string, string>,
	deletedBookmarks: string[],
): CommandExecutor {
	return {
		exec: async (cmd: string[]) => {
			return (
				handlePrViewCommand(cmd, prStateMap) ||
				handleBookmarkDeleteCommand(cmd, deletedBookmarks) ||
				createMockResponse("", "Unknown command", 1)
			);
		},
	};
}

describe("Auto Bookmark Manager", () => {
	describe("findUnbookmarkedChanges", () => {
		it("should detect unbookmarked changes when no bookmarks present", async () => {
			// Arrange - simulating actual jj output format
			const logOutput = `xvrxqsnrzpnkpwxsvtwskyrzrxvvryox 
szqzyprqmrlwvkrpmvppxsutusrvpprl 
qvmssloumqwzpwuuzvntslprwpnxmuwp `;
			const showMap = {
				xvrxqsnrzpnkpwxsvtwskyrzrxvvryox: "feat: add settings",
				szqzyprqmrlwvkrpmvppxsutusrvpprl: "feat: add user profile",
				qvmssloumqwzpwuuzvntslprwpnxmuwp: "feat: add authentication",
			};

			const mockExecutor = createFindUnbookmarkedMockExecutor(
				logOutput,
				showMap,
			);

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const unbookmarked = await manager.findUnbookmarkedChanges();

			// Assert
			assertEquals(unbookmarked.length, 3);
			assertEquals(
				unbookmarked[0].changeId,
				"xvrxqsnrzpnkpwxsvtwskyrzrxvvryox",
			);
			assertEquals(unbookmarked[0].description, "feat: add settings");
			assertEquals(
				unbookmarked[1].changeId,
				"szqzyprqmrlwvkrpmvppxsutusrvpprl",
			);
			assertEquals(unbookmarked[1].description, "feat: add user profile");
			assertEquals(
				unbookmarked[2].changeId,
				"qvmssloumqwzpwuuzvntslprwpnxmuwp",
			);
			assertEquals(unbookmarked[2].description, "feat: add authentication");
		});

		it("should skip changes that have bookmarks", async () => {
			// Arrange
			const logOutput = `xvrxqsnrzpnkpwxsvtwskyrzrxvvryox feature-settings
szqzyprqmrlwvkrpmvppxsutusrvpprl 
qvmssloumqwzpwuuzvntslprwpnxmuwp feature-auth`;
			const showMap = {
				szqzyprqmrlwvkrpmvppxsutusrvpprl: "feat: add user profile",
			};

			const mockExecutor = createFindUnbookmarkedMockExecutor(
				logOutput,
				showMap,
			);

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const unbookmarked = await manager.findUnbookmarkedChanges();

			// Assert - only the middle one without bookmark
			assertEquals(unbookmarked.length, 1);
			assertEquals(
				unbookmarked[0].changeId,
				"szqzyprqmrlwvkrpmvppxsutusrvpprl",
			);
			assertEquals(unbookmarked[0].description, "feat: add user profile");
		});

		it("should skip the root change (all z's)", async () => {
			// Arrange
			const logOutput = `abc123 
zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz `;
			const showMap = {
				abc123: "feat: some feature",
			};

			const mockExecutor = createFindUnbookmarkedMockExecutor(
				logOutput,
				showMap,
			);

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const unbookmarked = await manager.findUnbookmarkedChanges();

			// Assert
			assertEquals(unbookmarked.length, 1);
			assertEquals(unbookmarked[0].changeId, "abc123");
		});

		it("should return empty array when all changes have bookmarks", async () => {
			// Arrange
			const logOutput = `abc123 feature-1
def456 feature-2`;

			const mockExecutor = createFindUnbookmarkedMockExecutor(logOutput, {});

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const unbookmarked = await manager.findUnbookmarkedChanges();

			// Assert
			assertEquals(unbookmarked.length, 0);
		});
	});

	describe("generateBookmarkName", () => {
		it("should generate valid bookmark name from commit message", () => {
			// Arrange
			const manager = new AutoBookmarkManager({
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			});

			// Act & Assert
			assertEquals(
				manager.generateBookmarkName("feat: add user authentication", "abc123"),
				"auto/jjsp-add-user-authentication-abc123",
			);

			assertEquals(
				manager.generateBookmarkName(
					"fix(auth): resolve login bug #123",
					"def456",
				),
				"auto/jjsp-resolve-login-bug-123-def456",
			);

			assertEquals(
				manager.generateBookmarkName("chore: update dependencies", "ghi789"),
				"auto/jjsp-update-dependencies-ghi789",
			);
		});

		it("should truncate long commit messages", () => {
			// Arrange
			const manager = new AutoBookmarkManager({
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			});

			const longMessage =
				"feat: this is a very long commit message that should be truncated to fit within reasonable limits";

			// Act
			const bookmarkName = manager.generateBookmarkName(longMessage, "abc123");

			// Assert
			assertEquals(bookmarkName.startsWith("auto/"), true);
			assertEquals(bookmarkName.endsWith("-abc123"), true);
			// Check that the middle part (including "jjsp-" prefix) is truncated to reasonable length
			const middlePart = bookmarkName
				.replace("auto/", "")
				.replace("-abc123", "");
			// The middle part now includes "jjsp-" (5 chars) + up to 30 chars of message
		assertEquals(middlePart.length <= 35, true);
		});

		it("should handle special characters in commit messages", () => {
			// Arrange
			const manager = new AutoBookmarkManager({
				exec: async () => ({ stdout: "", stderr: "", code: 0 }),
			});

			// Act & Assert
			assertEquals(
				manager.generateBookmarkName("feat: add user@email support!", "abc123"),
				"auto/jjsp-add-user-email-support-abc123",
			);

			assertEquals(
				manager.generateBookmarkName(
					"fix: resolve (bug) in [module]",
					"def456",
				),
				"auto/jjsp-resolve-bug-in-module-def456",
			);
		});
	});

	describe("createAutoBookmark", () => {
		it("should create bookmark for unbookmarked change", async () => {
			// Arrange
			let capturedCommand: string[] = [];
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					capturedCommand = cmd;
					return { stdout: "", stderr: "", code: 0 };
				},
			};

			const manager = new AutoBookmarkManager(mockExecutor);
			const change: UnbookmarkedChange = {
				changeId: "abc123",
				description: "feat: add authentication",
			};

			// Act
			const bookmark = await manager.createAutoBookmark(change);

			// Assert
			assertEquals(bookmark.name, "auto/jjsp-add-authentication-abc123");
			assertEquals(bookmark.changeId, "abc123");
			assertEquals(bookmark.isTemporary, true);
			assertEquals(capturedCommand.includes("bookmark"), true);
			assertEquals(capturedCommand.includes("create"), true);
			assertEquals(
				capturedCommand.includes("auto/jjsp-add-authentication-abc123"),
				true,
			);
			assertEquals(capturedCommand.includes("-r"), true);
			assertEquals(capturedCommand.includes("abc123"), true);
		});
	});

	describe("findAutoBookmarks", () => {
		it("should not find manual bookmarks with auto/ prefix (BUG-003 fix)", async () => {
			// This test verifies that manual bookmarks with auto/ prefix are protected
			// Arrange
			const bookmarkOutput = `
                auto/manual-bookmark
                auto/user-created-bookmark
                auto/jjsp-tool-created-abc123
                auto/another-manual
              `;

			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					return (
						handleBookmarkListCommand(cmd, bookmarkOutput) ||
						createMockResponse("", "Unknown command", 1)
					);
				},
			};

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const autoBookmarks = await manager.findAutoBookmarks();

			// Assert - should ONLY find the jjsp- prefixed bookmark
			assertEquals(autoBookmarks.length, 1);
			assertEquals(autoBookmarks[0], "auto/jjsp-tool-created-abc123");
			// Manual bookmarks should NOT be found
			assertEquals(autoBookmarks.includes("auto/manual-bookmark"), false);
			assertEquals(autoBookmarks.includes("auto/user-created-bookmark"), false);
			assertEquals(autoBookmarks.includes("auto/another-manual"), false);
		});

		it("should list only auto/jjsp-* bookmarks created by tool", async () => {
			// Arrange
			const bookmarkOutput = `
                auto/jjsp-feature-abc123
                feature-1
                auto/manual-bookmark
                auto/jjsp-fix-bug-def456
                master
                auto/jjsp-update-deps-ghi789
                auto/user-created
              `;

			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					return (
						handleBookmarkListCommand(cmd, bookmarkOutput) ||
						createMockResponse("", "Unknown command", 1)
					);
				},
			};

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const autoBookmarks = await manager.findAutoBookmarks();

			// Assert - should only find jjsp- prefixed bookmarks
			assertEquals(autoBookmarks.length, 3);
			assertEquals(autoBookmarks[0], "auto/jjsp-feature-abc123");
			assertEquals(autoBookmarks[1], "auto/jjsp-fix-bug-def456");
			assertEquals(autoBookmarks[2], "auto/jjsp-update-deps-ghi789");
		});

		it("should return empty array when no auto bookmarks exist", async () => {
			// Arrange
			const bookmarkOutput = `
                feature-1
                feature-2
                master
              `;

			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					return (
						handleBookmarkListCommand(cmd, bookmarkOutput) ||
						createMockResponse("", "Unknown command", 1)
					);
				},
			};

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const autoBookmarks = await manager.findAutoBookmarks();

			// Assert
			assertEquals(autoBookmarks.length, 0);
		});

		it("should extract bookmark names from jj bookmark list output with commit info", async () => {
			// Arrange - simulating real jj bookmark list output
			const bookmarkOutput = `auto/jjsp-add-settings-xvrxqs: xvrxqsnr da0c8c10 feat: add settings
auto/manual-bookmark: abcdefgh 12345678 manual change
auto/jjsp-add-middleware-layer-pqyzym: pqyzymlo 10e7c205 feat: add middleware layer
master: mzmwrosu 606382ed Initial commit
auto/jjsp-add-user-profile-szqzyp: szqzyprq bd5c84f0 feat: add user profile`;

			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					return (
						handleBookmarkListCommand(cmd, bookmarkOutput) ||
						createMockResponse("", "Unknown command", 1)
					);
				},
			};

			const manager = new AutoBookmarkManager(mockExecutor);

			// Act
			const bookmarks = await manager.findAutoBookmarks();

			// Assert - should only find jjsp- prefixed bookmarks
			assertEquals(bookmarks.length, 3);
			assertEquals(bookmarks[0], "auto/jjsp-add-settings-xvrxqs");
			assertEquals(bookmarks[1], "auto/jjsp-add-middleware-layer-pqyzym");
			assertEquals(bookmarks[2], "auto/jjsp-add-user-profile-szqzyp");
			// Should not include the commit info
			assertEquals(
				bookmarks.some((b) => b.includes("xvrxqsnr")),
				false,
			);
			assertEquals(
				bookmarks.some((b) => b.includes("feat:")),
				false,
			);
		});
	});

	describe("cleanupMergedAutoBookmarks", () => {
		it("should delete auto bookmarks for merged PRs", async () => {
			// Arrange
			const deletedBookmarks: string[] = [];
			const prStateMap = {
				"auto/jjsp-feature-abc123": "MERGED",
				"auto/jjsp-fix-bug-def456": "CLOSED",
				"auto/jjsp-update-deps-ghi789": "OPEN",
			};

			const mockExecutor = createCleanupMockExecutor(
				prStateMap,
				deletedBookmarks,
			);

			const manager = new AutoBookmarkManager(mockExecutor);
			const autoBookmarks = [
				"auto/jjsp-feature-abc123",
				"auto/jjsp-fix-bug-def456",
				"auto/jjsp-update-deps-ghi789",
			];

			// Act
			const result = await manager.cleanupMergedAutoBookmarks(autoBookmarks);

			// Assert
			assertEquals(result.deleted.length, 2);
			assertEquals(result.deleted.includes("auto/jjsp-feature-abc123"), true);
			assertEquals(result.deleted.includes("auto/jjsp-fix-bug-def456"), true);
			assertEquals(result.kept.length, 1);
			assertEquals(result.kept.includes("auto/jjsp-update-deps-ghi789"), true);
			assertEquals(deletedBookmarks.length, 2);
		});

		it("should handle bookmarks without PRs", async () => {
			// Arrange
			const deletedBookmarks: string[] = [];
			// Empty prStateMap means no PRs found
			const mockExecutor = createCleanupMockExecutor({}, deletedBookmarks);

			const manager = new AutoBookmarkManager(mockExecutor);
			const autoBookmarks = ["auto/jjsp-orphaned-abc123"];

			// Act
			const result = await manager.cleanupMergedAutoBookmarks(autoBookmarks);

			// Assert
			assertEquals(result.deleted.length, 1);
			assertEquals(result.deleted[0], "auto/jjsp-orphaned-abc123");
			assertEquals(result.kept.length, 0);
			assertEquals(deletedBookmarks[0], "auto/jjsp-orphaned-abc123");
		});
	});

	describe("cleanupOrphanedAutoBookmarks", () => {
		it("should delete auto bookmarks not in current stack", async () => {
			// Arrange
			const deletedBookmarks: string[] = [];
			// Only needs bookmark delete functionality
			const mockExecutor = createCleanupMockExecutor({}, deletedBookmarks);

			const manager = new AutoBookmarkManager(mockExecutor);
			const autoBookmarks = [
				"auto/jjsp-in-stack-abc123",
				"auto/jjsp-orphaned-def456",
				"auto/jjsp-also-orphaned-ghi789",
			];
			const currentStackBookmarks = [
				"feature-1",
				"auto/jjsp-in-stack-abc123",
				"feature-2",
			];

			// Act
			const result = await manager.cleanupOrphanedAutoBookmarks(
				autoBookmarks,
				currentStackBookmarks,
			);

			// Assert
			assertEquals(result.deleted.length, 2);
			assertEquals(result.deleted.includes("auto/jjsp-orphaned-def456"), true);
			assertEquals(result.deleted.includes("auto/jjsp-also-orphaned-ghi789"), true);
			assertEquals(result.kept.length, 1);
			assertEquals(result.kept[0], "auto/jjsp-in-stack-abc123");
			assertEquals(deletedBookmarks.length, 2);
		});
	});
});
