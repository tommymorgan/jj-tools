import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.208.0/testing/bdd.ts";
import { pushBookmarksToGitHub } from "../src/main.ts";
import type { CommandExecutor } from "../src/stack_detection.ts";
import {
	generateBookmark,
	generateCLIOptions,
	generateStackInfo,
} from "./test_data_generators.ts";

type CommandResponse = { stdout: string; stderr: string; code: number };

describe("pushBookmarksToGitHub function", () => {
	it("should exclude base branch when pushing bookmarks", async () => {
		const executedCommands: string[][] = [];
		const baseBranch = "trunk"; // Non-standard base branch name

		// Helper function to check if command matches a prefix
		function findMatchingResponse(cmdString: string): CommandResponse | null {
			const responses = [
				{
					prefix: "jj bookmark",
					response: { stdout: "", stderr: "", code: 0 },
				},
				{
					prefix: "jj git push",
					response: { stdout: "Pushed successfully", stderr: "", code: 0 },
				},
			];

			const match = responses.find((r) => cmdString.startsWith(r.prefix));
			return match ? match.response : null;
		}

		// Helper function to get command response
		function getCommandResponse(cmdString: string): CommandResponse {
			const response = findMatchingResponse(cmdString);
			return response || { stdout: "", stderr: "Unknown command", code: 1 };
		}

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);
				const cmdString = cmd.join(" ");
				return Promise.resolve(getCommandResponse(cmdString));
			},
		};

		const options = generateCLIOptions({
			overrides: {
				baseBranch,
				dryRun: false,
			},
		});

		const stack = generateStackInfo({
			bookmarkCount: 2,
			includeBaseBranch: true,
			baseBranchName: baseBranch,
		});

		await pushBookmarksToGitHub(options, executor, stack);

		// Find the push command
		const pushCommand = executedCommands.find(
			(cmd) => cmd[0] === "jj" && cmd[1] === "git" && cmd[2] === "push",
		);

		// Verify push command was executed
		assertEquals(pushCommand !== undefined, true);

		// Verify base branch (trunk) was NOT included in push
		assertEquals(pushCommand?.includes(baseBranch), false);

		// Verify other bookmarks WERE included (at least the feature bookmarks)
		const nonBaseBookmarks = stack.bookmarks.filter(
			(b) => b.name !== baseBranch,
		);
		for (const bookmark of nonBaseBookmarks) {
			assertEquals(pushCommand?.includes(bookmark.name), true);
		}

		// Verify correct -b flag usage
		const bFlagCount = pushCommand?.filter((item) => item === "-b").length ?? 0;
		assertEquals(bFlagCount, nonBaseBookmarks.length);
	});

	it("should handle different base branch names dynamically", async () => {
		const executedCommands: string[][] = [];

		// Generate a random base branch name
		const baseBranches = [
			"main",
			"master",
			"trunk",
			"develop",
			"production",
			"release",
		];
		const baseBranch =
			baseBranches[Math.floor(Math.random() * baseBranches.length)];

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);
				return Promise.resolve({ stdout: "", stderr: "", code: 0 });
			},
		};

		const options = generateCLIOptions({
			overrides: {
				baseBranch,
				dryRun: false,
			},
		});

		const stack = generateStackInfo({
			bookmarkCount: 3,
			includeBaseBranch: true,
			baseBranchName: baseBranch,
		});

		await pushBookmarksToGitHub(options, executor, stack);

		const pushCommand = executedCommands.find(
			(cmd) => cmd[0] === "jj" && cmd[1] === "git" && cmd[2] === "push",
		);

		// Verify the dynamically chosen base branch was excluded
		assertEquals(pushCommand?.includes(baseBranch), false);

		// Verify all non-base bookmarks were included
		const nonBaseBookmarks = stack.bookmarks.filter(
			(b) => b.name !== baseBranch,
		);
		for (const bookmark of nonBaseBookmarks) {
			assertEquals(pushCommand?.includes(bookmark.name), true);
		}
	});

	it("should push all bookmarks when base branch is not in the stack", async () => {
		const executedCommands: string[][] = [];

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);
				return Promise.resolve({ stdout: "", stderr: "", code: 0 });
			},
		};

		const options = generateCLIOptions({
			overrides: {
				baseBranch: "main",
				dryRun: false,
			},
		});

		// Generate stack without base branch
		const stack = generateStackInfo({
			bookmarkCount: 3,
			includeBaseBranch: false,
		});

		await pushBookmarksToGitHub(options, executor, stack);

		const pushCommand = executedCommands.find(
			(cmd) => cmd[0] === "jj" && cmd[1] === "git" && cmd[2] === "push",
		);

		// All bookmarks should be included since base branch is not in stack
		for (const bookmark of stack.bookmarks) {
			assertEquals(pushCommand?.includes(bookmark.name), true);
		}

		// Should have -b flags for all bookmarks
		const bFlagCount = pushCommand?.filter((item) => item === "-b").length ?? 0;
		assertEquals(bFlagCount, stack.bookmarks.length);
	});

	it("should respect dry-run mode and not execute push", async () => {
		const executedCommands: string[][] = [];

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);
				return Promise.resolve({ stdout: "", stderr: "", code: 0 });
			},
		};

		const options = generateCLIOptions({
			overrides: {
				dryRun: true,
			},
		});

		const stack = generateStackInfo({
			bookmarkCount: 2,
		});

		await pushBookmarksToGitHub(options, executor, stack);

		// No push command should be executed in dry-run mode
		const pushCommand = executedCommands.find(
			(cmd) => cmd[0] === "jj" && cmd[1] === "git" && cmd[2] === "push",
		);

		assertEquals(pushCommand, undefined);
	});

	it("should track all bookmarks before pushing", async () => {
		const executedCommands: string[][] = [];

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);
				return Promise.resolve({ stdout: "", stderr: "", code: 0 });
			},
		};

		const options = generateCLIOptions({
			overrides: {
				dryRun: false,
			},
		});

		// Create specific bookmarks to ensure predictable behavior
		const stack = generateStackInfo({
			overrides: {
				bookmarks: [
					generateBookmark({
						overrides: { name: "feat/user-auth", commitHash: "abc123" },
					}),
					generateBookmark({
						overrides: { name: "fix/bug-123", commitHash: "def456" },
					}),
				],
				currentPosition: 0,
			},
		});

		await pushBookmarksToGitHub(options, executor, stack);

		// Verify tracking commands were executed before push
		const trackCommands = executedCommands.filter(
			(cmd) => cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "track",
		);

		const pushCommandIndex = executedCommands.findIndex(
			(cmd) => cmd[0] === "jj" && cmd[1] === "git" && cmd[2] === "push",
		);

		// Should have tracking commands for ALL bookmarks (even if not all are pushed)
		assertEquals(trackCommands.length, stack.bookmarks.length);

		// Verify tracking happened (track command uses bookmark@origin format)
		for (let i = 0; i < stack.bookmarks.length; i++) {
			const bookmark = stack.bookmarks[i];
			const trackCmd = trackCommands[i];
			assertEquals(trackCmd?.includes(`${bookmark.name}@origin`), true);
		}

		// All tracking should happen before push
		const trackIndices = executedCommands.reduce((indices, cmd, index) => {
			if (cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "track") {
				indices.push(index);
			}
			return indices;
		}, [] as number[]);

		assertEquals(
			trackIndices.every((idx) => idx < pushCommandIndex),
			true,
		);
	});

	it("should handle stacks with auto-generated bookmarks", async () => {
		const executedCommands: string[][] = [];

		const executor: CommandExecutor = {
			exec: (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);
				return Promise.resolve({ stdout: "", stderr: "", code: 0 });
			},
		};

		const options = generateCLIOptions({
			overrides: {
				baseBranch: "master",
				dryRun: false,
			},
		});

		// Create stack with mix of regular and auto bookmarks
		const stack = generateStackInfo({
			overrides: {
				bookmarks: [
					generateBookmark({ overrides: { name: "feat/user-auth" } }),
					generateBookmark({
						overrides: { name: "auto/jjsp-fix-login-abc123" },
					}),
					generateBookmark({
						overrides: { name: "master", commitMessage: "chore: base" },
					}),
					generateBookmark({ overrides: { name: "fix/session-timeout" } }),
				],
				currentPosition: 1,
			},
		});

		await pushBookmarksToGitHub(options, executor, stack);

		const pushCommand = executedCommands.find(
			(cmd) => cmd[0] === "jj" && cmd[1] === "git" && cmd[2] === "push",
		);

		// Should push auto bookmarks but not base branch
		assertEquals(pushCommand?.includes("feat/user-auth"), true);
		assertEquals(pushCommand?.includes("auto/jjsp-fix-login-abc123"), true);
		assertEquals(pushCommand?.includes("fix/session-timeout"), true);
		assertEquals(pushCommand?.includes("master"), false);
	});
});
