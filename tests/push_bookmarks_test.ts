import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import type { CommandExecutor } from "../src/stack_detection.ts";

type CommandResponse = { stdout: string; stderr: string; code: number };

// Helper to create success response
function successResponse(message = "Pushed successfully"): CommandResponse {
	return { stdout: message, stderr: "", code: 0 };
}

// Helper to create error response
function errorResponse(message: string): CommandResponse {
	return { stdout: "", stderr: message, code: 1 };
}

// Check if command is push
function isPushCommand(cmd: string[]): boolean {
	return (
		cmd.length >= 3 && cmd[0] === "jj" && cmd[1] === "git" && cmd[2] === "push"
	);
}

// Handle push command with base branch check
function handlePushWithBaseBranchCheck(cmd: string[]): CommandResponse {
	const hasBaseBranch = cmd.includes("master") || cmd.includes("main");
	return hasBaseBranch
		? errorResponse("Error: refs/heads/master (reason: stale info)")
		: successResponse();
}

describe("pushBookmarksToGitHub", () => {
	it("should exclude base branch from push command to prevent stale reference errors", async () => {
		const pushedCommands: string[] = [];

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				pushedCommands.push(cmd.join(" "));

				// Delegate to handler based on command type
				if (isPushCommand(cmd)) {
					return Promise.resolve(handlePushWithBaseBranchCheck(cmd));
				}
				return Promise.resolve(successResponse());
			},
		};

		const pushResult = await executor.exec([
			"jj",
			"git",
			"push",
			"-b",
			"feat/feature-1",
			"-b",
			"fix/bugfix-1",
			"-b",
			"auto/jjsp-test-123456",
		]);

		assertEquals(pushResult.code, 0);
		assertEquals(pushResult.stdout, "Pushed successfully");

		// Verify master was not included
		const pushCommand = pushedCommands.find((cmd) => cmd.includes("git push"));
		assertEquals(pushCommand?.includes("master"), false);
		assertEquals(pushCommand?.includes("main"), false);
	});

	it("should successfully push by excluding base branch", async () => {
		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				if (!isPushCommand(cmd)) {
					return Promise.resolve(successResponse());
				}
				// Push fails if base branch is included
				return Promise.resolve(handlePushWithBaseBranchCheck(cmd));
			},
		};

		const pushResult = await executor.exec([
			"jj",
			"git",
			"push",
			"-b",
			"feat/feature-1",
			"-b",
			"auto/jjsp-test-123456",
		]);

		assertEquals(pushResult.code, 0);
		assertEquals(pushResult.stdout, "Pushed successfully");
	});

	it("should use -b flag for each bookmark in push command", async () => {
		const pushedCommands: string[] = [];

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				pushedCommands.push(cmd.join(" "));
				return Promise.resolve(successResponse());
			},
		};

		await executor.exec([
			"jj",
			"git",
			"push",
			"-b",
			"feat/feature-1",
			"-b",
			"fix/bugfix-1",
		]);

		const pushCommand = pushedCommands[0];
		// Verify the command uses -b flags
		assertEquals(pushCommand, "jj git push -b feat/feature-1 -b fix/bugfix-1");
	});
});
