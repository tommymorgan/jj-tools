import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import {
	type AuthValidationResult,
	validateGitHubAuth,
} from "../src/auth_validator.ts";
import type { CommandExecutor } from "../src/stack_detection.ts";

describe("GitHub Authentication Validator", () => {
	describe("validateGitHubAuth", () => {
		it("should return valid result when gh auth status succeeds", async () => {
			const mockExecutor: CommandExecutor = {
				async exec(cmd: string[]) {
					if (cmd[0] === "gh" && cmd[1] === "auth" && cmd[2] === "status") {
						return {
							stdout: "github.com\n  ✓ Logged in to github.com account user",
							stderr: "",
							code: 0,
						};
					}
					throw new Error(`Unexpected command: ${cmd.join(" ")}`);
				},
			};

			const result: AuthValidationResult =
				await validateGitHubAuth(mockExecutor);
			assertEquals(result.isValid, true);
			assertEquals(result.errorMessage, undefined);
		});

		it("should return invalid result when gh auth status fails", async () => {
			const mockExecutor: CommandExecutor = {
				async exec(cmd: string[]) {
					if (cmd[0] === "gh" && cmd[1] === "auth" && cmd[2] === "status") {
						return {
							stdout: "",
							stderr:
								"You are not logged into any GitHub hosts. Run gh auth login to authenticate.",
							code: 1,
						};
					}
					throw new Error(`Unexpected command: ${cmd.join(" ")}`);
				},
			};

			const result: AuthValidationResult =
				await validateGitHubAuth(mockExecutor);
			assertEquals(result.isValid, false);
			assertEquals(
				result.errorMessage,
				"You are not logged into any GitHub hosts. Run gh auth login to authenticate.",
			);
		});

		it("should handle command execution errors gracefully", async () => {
			const mockExecutor: CommandExecutor = {
				async exec(_cmd: string[]) {
					throw new Error("Command not found: gh");
				},
			};

			const result: AuthValidationResult =
				await validateGitHubAuth(mockExecutor);
			assertEquals(result.isValid, false);
			assertEquals(
				result.errorMessage,
				"Failed to check GitHub authentication: Command not found: gh",
			);
		});

		it("should extract clean error message from gh auth status stderr", async () => {
			const mockExecutor: CommandExecutor = {
				async exec(cmd: string[]) {
					if (cmd[0] === "gh" && cmd[1] === "auth" && cmd[2] === "status") {
						return {
							stdout: "",
							stderr:
								"X Error: authentication failed\nX Additional info\nYou need to authenticate first",
							code: 1,
						};
					}
					throw new Error(`Unexpected command: ${cmd.join(" ")}`);
				},
			};

			const result: AuthValidationResult =
				await validateGitHubAuth(mockExecutor);
			assertEquals(result.isValid, false);
			assertEquals(result.errorMessage, "You need to authenticate first");
		});

		it("should handle empty stderr from failed auth check", async () => {
			const mockExecutor: CommandExecutor = {
				async exec(cmd: string[]) {
					if (cmd[0] === "gh" && cmd[1] === "auth" && cmd[2] === "status") {
						return {
							stdout: "",
							stderr: "",
							code: 1,
						};
					}
					throw new Error(`Unexpected command: ${cmd.join(" ")}`);
				},
			};

			const result: AuthValidationResult =
				await validateGitHubAuth(mockExecutor);
			assertEquals(result.isValid, false);
			assertEquals(
				result.errorMessage,
				"GitHub CLI authentication check failed",
			);
		});
	});
});
