import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { checkStackLinearity } from "../src/linearity_checker.ts";
import type { CommandExecutor } from "../src/stack_detection.ts";

describe("Stack Linearity Checker", () => {
	describe("checkStackLinearity", () => {
		it("should detect linear stacks as valid", async () => {
			// Arrange - simulate a linear stack
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					// No merge commits - all have 1 parent
					if (cmdStr.includes("parents.len()")) {
						return { stdout: "", stderr: "", code: 0 };
					}
					// Linear chain - each has at most 1 child
					return {
						stdout: "abc123 1\ndef456 1\nghi789 0\n",
						stderr: "",
						code: 0,
					};
				},
			};

			// Act
			const result = await checkStackLinearity(mockExecutor);

			// Assert
			assertEquals(result.isLinear, true);
			assertEquals(result.problematicCommits.length, 0);
			assertEquals(result.message, "Stack is linear");
		});

		it("should detect merge commits as non-linear", async () => {
			// Arrange - simulate a stack with a merge commit
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					// Has a merge commit with 2 parents
					if (cmdStr.includes("parents.len()")) {
						return {
							stdout: "merge123 MERGE 2\n",
							stderr: "",
							code: 0,
						};
					}
					// Don't check children if we already found merges
					return { stdout: "", stderr: "", code: 0 };
				},
			};

			// Act
			const result = await checkStackLinearity(mockExecutor);

			// Assert
			assertEquals(result.isLinear, false);
			assertEquals(result.problematicCommits.length, 1);
			assertEquals(result.problematicCommits[0], "merge123 (2 parents)");
			assertEquals(
				result.message,
				"Non-linear stack detected! Found 1 merge commit(s)",
			);
		});

		it("should detect multiple merge commits", async () => {
			// Arrange - simulate a stack with multiple merge commits
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					if (cmdStr.includes("parents.len()")) {
						// Has multiple merge commits
						return {
							stdout: "merge1 MERGE 2\nmerge2 MERGE 3\n",
							stderr: "",
							code: 0,
						};
					}
					return { stdout: "", stderr: "", code: 0 };
				},
			};

			// Act
			const result = await checkStackLinearity(mockExecutor);

			// Assert
			assertEquals(result.isLinear, false);
			assertEquals(result.problematicCommits.length, 2);
			assertEquals(result.problematicCommits[0], "merge1 (2 parents)");
			assertEquals(result.problematicCommits[1], "merge2 (3 parents)");
			assertEquals(
				result.message,
				"Non-linear stack detected! Found 2 merge commit(s)",
			);
		});

		it("should detect divergent branches as non-linear", async () => {
			// Arrange - simulate a commit with multiple children (divergent)
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					// No merge commits
					if (cmdStr.includes("parents.len()")) {
						return { stdout: "", stderr: "", code: 0 };
					}
					// Has a commit with 2 children (divergent branches)
					return {
						stdout: "base123 2\nleft456 0\nright789 0\n",
						stderr: "",
						code: 0,
					};
				},
			};

			// Act
			const result = await checkStackLinearity(mockExecutor);

			// Assert
			assertEquals(result.isLinear, false);
			assertEquals(result.problematicCommits.length, 1);
			assertEquals(result.problematicCommits[0], "base123 (2 children)");
			assertEquals(
				result.message,
				"Non-linear stack detected! Found 1 divergent commit(s)",
			);
		});

		it("should handle command execution failures gracefully", async () => {
			// Arrange - simulate command failure
			const mockExecutor: CommandExecutor = {
				exec: async (_cmd: string[]) => {
					return {
						stdout: "",
						stderr: "jj command failed",
						code: 1,
					};
				},
			};

			// Act
			const result = await checkStackLinearity(mockExecutor);

			// Assert
			assertEquals(result.isLinear, false);
			assertEquals(result.problematicCommits.length, 0);
			assertEquals(
				result.message,
				"Failed to check stack linearity: jj command failed",
			);
		});

		it("should handle empty stack as linear", async () => {
			// Arrange - simulate empty stack
			const mockExecutor: CommandExecutor = {
				exec: async (_cmd: string[]) => {
					return { stdout: "", stderr: "", code: 0 };
				},
			};

			// Act
			const result = await checkStackLinearity(mockExecutor);

			// Assert
			assertEquals(result.isLinear, true);
			assertEquals(result.problematicCommits.length, 0);
			assertEquals(result.message, "Stack is linear");
		});

		it("should detect diamond patterns correctly", async () => {
			// Arrange - simulate a diamond pattern:
			// base -> left & right (divergent) -> merge (merge commit)
			const mockExecutor: CommandExecutor = {
				exec: async (cmd: string[]) => {
					const cmdStr = cmd.join(" ");
					// Merge point has 2 parents
					if (cmdStr.includes("parents.len()")) {
						return {
							stdout: "mergepoint MERGE 2\n",
							stderr: "",
							code: 0,
						};
					}
					// Base has 2 children
					return {
						stdout: "base123 2\nleft456 1\nright789 1\nmergepoint 0\n",
						stderr: "",
						code: 0,
					};
				},
			};

			// Act
			const result = await checkStackLinearity(mockExecutor);

			// Assert
			assertEquals(result.isLinear, false);
			// Should detect the merge commit first, not check for divergence
			assertEquals(result.problematicCommits.length, 1);
			assertEquals(result.problematicCommits[0], "mergepoint (2 parents)");
		});
	});
});
