import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { 
  AutoBookmarkManager
} from "../src/auto_bookmark.ts";
import { CommandExecutor } from "../src/stack_detection.ts";

describe("Auto Bookmark Manager - Revset Logic", () => {
  describe("findUnbookmarkedChanges with proper revset", () => {
    it("should get changes from trunk to current position", async () => {
      // Arrange - simulating a stack from trunk to current position
      const mockExecutor: CommandExecutor = {
        exec: async (cmd: string[]) => {
          if (cmd.includes("log") && cmd.some(c => c.includes("change_id"))) {
            // Check that we're using the right revset
            const revsetIndex = cmd.indexOf("-r") + 1;
            const revset = cmd[revsetIndex];
            
            // Should use trunk()..@ to get the full connected stack
            assertEquals(revset, "trunk()..@", "Should use trunk()..@ revset");
            
            // Return only the stack changes (not initial commit)
            return {
              stdout: `xvrxqsnrzpnkpwxsvtwskyrzrxvvryox 
szqzyprqmrlwvkrpmvppxsutusrvpprl `,
              stderr: "",
              code: 0
            };
          }
          if (cmd.includes("show") && cmd.includes("xvrxqsnrzpnkpwxsvtwskyrzrxvvryox")) {
            return {
              stdout: "feat: add settings",
              stderr: "",
              code: 0
            };
          }
          if (cmd.includes("show") && cmd.includes("szqzyprqmrlwvkrpmvppxsutusrvpprl")) {
            return {
              stdout: "feat: add user profile",
              stderr: "",
              code: 0
            };
          }
          return { stdout: "", stderr: "Unknown command", code: 1 };
        }
      };

      const manager = new AutoBookmarkManager(mockExecutor);

      // Act
      const unbookmarked = await manager.findUnbookmarkedChanges();

      // Assert - should only get stack changes, not initial commit
      assertEquals(unbookmarked.length, 2);
      assertEquals(unbookmarked[0].changeId, "xvrxqsnrzpnkpwxsvtwskyrzrxvvryox");
      assertEquals(unbookmarked[1].changeId, "szqzyprqmrlwvkrpmvppxsutusrvpprl");
    });

    it("should handle full stack including all connected changes", async () => {
      // Arrange - simulating a full stack
      const mockExecutor: CommandExecutor = {
        exec: async (cmd: string[]) => {
          if (cmd.includes("log") && cmd.some(c => c.includes("change_id"))) {
            const revsetIndex = cmd.indexOf("-r") + 1;
            const revset = cmd[revsetIndex];
            
            // Verify we're using trunk()..@
            assertEquals(revset, "trunk()..@", "Should use trunk()..@ revset");
            
            // Return all changes in the connected stack
            return {
              stdout: `change10 
change9 
change8 
change7 
change6 `,
              stderr: "",
              code: 0
            };
          }
          if (cmd.includes("show")) {
            return {
              stdout: "feat: some feature",
              stderr: "",
              code: 0
            };
          }
          return { stdout: "", stderr: "Unknown command", code: 1 };
        }
      };

      const manager = new AutoBookmarkManager(mockExecutor);

      // Act
      const unbookmarked = await manager.findUnbookmarkedChanges();

      // Assert
      assertEquals(unbookmarked.length, 5);
    });

    it("should get all changes from trunk to current position", async () => {
      // Arrange
      const mockExecutor: CommandExecutor = {
        exec: async (cmd: string[]) => {
          if (cmd.includes("log") && cmd.some(c => c.includes("change_id"))) {
            const revsetIndex = cmd.indexOf("-r") + 1;
            const revset = cmd[revsetIndex];
            
            // Should use trunk()..@
            assertEquals(revset, "trunk()..@", "Should use trunk()..@ revset");
            
            // Return only changes in the stack window
            return {
              stdout: `current 
parent 
grandparent `,
              stderr: "",
              code: 0
            };
          }
          if (cmd.includes("show")) {
            return {
              stdout: "feat: test",
              stderr: "",
              code: 0
            };
          }
          return { stdout: "", stderr: "Unknown command", code: 1 };
        }
      };

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