import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { cleanupMergedAutoBookmarks } from "../src/auto_bookmark.ts";
import { buildPRChainWithAutoCreate } from "../src/pr_manager.ts";
import { type CommandExecutor, detectStack } from "../src/stack_detection.ts";

type CommandResponse = { stdout: string; stderr: string; code: number };

describe("Deleted bookmark as dependency", () => {
	it("should not include deleted bookmarks even when local PRs depend on them", async () => {
		// This test models the real scenario where:
		// - auto/jjsp-address-pr-feedback is marked for deletion (PR merged)
		// - auto/jjsp-add-pr-file-count IS in the local stack
		// - auto/jjsp-add-pr-file-count's PR has auto/jjsp-address-pr-feedback as its base

		const executedCommands: string[][] = [];

		// Define mock responses
		const mockResponses = {
			bookmarkList: {
				stdout:
					"feat/cm-pr-approval-time: abc123 approval time feature\n" +
					"auto/jjsp-address-pr-feedback: def456 merged auto bookmark\n" +
					"auto/jjsp-add-pr-file-count: ghi789 file count feature",
				stderr: "",
				code: 0,
			},
			jjLog: {
				stdout:
					"auto/jjsp-add-pr-file-count\n" +
					"auto/jjsp-address-pr-feedback\n" +
					"feat/cm-pr-approval-time\n",
				stderr: "",
				code: 0,
			},
			prList: {
				stdout: JSON.stringify([
					{
						number: 14077,
						headRefName: "feat/cm-pr-approval-time",
						baseRefName: "master",
						state: "OPEN",
					},
					{
						number: 14100,
						headRefName: "auto/jjsp-address-pr-feedback",
						baseRefName: "feat/cm-pr-approval-time",
						state: "MERGED",
					},
					{
						number: 14102,
						headRefName: "auto/jjsp-add-pr-file-count",
						baseRefName: "auto/jjsp-address-pr-feedback",
						state: "OPEN",
					},
				]),
				stderr: "",
				code: 0,
			},
			prViews: {
				"auto/jjsp-address-pr-feedback": {
					stdout: JSON.stringify({ state: "MERGED" }),
					stderr: "",
					code: 0,
				},
				"auto/jjsp-add-pr-file-count": {
					stdout: JSON.stringify({ state: "OPEN" }),
					stderr: "",
					code: 0,
				},
			} as Record<string, CommandResponse>,
		};

		const handleBookmarkList = (cmd: string[]): CommandResponse | null => {
			if (cmd[0] === "jj" && cmd[1] === "bookmark" && cmd[2] === "list") {
				return mockResponses.bookmarkList;
			}
			return null;
		};

		const handleJJLog = (cmd: string[]): CommandResponse | null => {
			if (cmd[0] === "jj" && cmd[1] === "log") {
				return mockResponses.jjLog;
			}
			return null;
		};

		const handlePRList = (cmd: string[]): CommandResponse | null => {
			if (cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "list") {
				return mockResponses.prList;
			}
			return null;
		};

		const findPRViewResponse = (bookmark: string): CommandResponse => {
			const response = mockResponses.prViews[bookmark];
			if (response) return response;
			return { stdout: "", stderr: "no pull request found", code: 1 };
		};

		const handlePRView = (cmd: string[]): CommandResponse | null => {
			if (!cmd.join(" ").includes("gh pr view")) return null;

			const bookmark = Object.keys(mockResponses.prViews).find((b) =>
				cmd.includes(b),
			);
			return findPRViewResponse(bookmark || "");
		};

		// Use predicates to avoid complexity
		type ResponsePredicate = {
			predicate: (cmdStr: string) => boolean;
			response: CommandResponse;
		};

		const jjShowPredicates: ResponsePredicate[] = [
			{
				predicate: (s) => s.includes("feat/cm-pr-approval-time"),
				response: { stdout: "feat: approval time", stderr: "", code: 0 },
			},
			{
				predicate: (s) => s.includes("auto/jjsp-address-pr-feedback"),
				response: { stdout: "fix: address feedback", stderr: "", code: 0 },
			},
			{
				predicate: (s) => s.includes("auto/jjsp-add-pr-file-count"),
				response: { stdout: "feat: file count", stderr: "", code: 0 },
			},
		];

		const findJJShowResponse = (cmdStr: string): CommandResponse | null => {
			const match = jjShowPredicates.find((p) => p.predicate(cmdStr));
			return match?.response || null;
		};

		const handleJJShow = (cmd: string[]): CommandResponse | null => {
			const cmdStr = cmd.join(" ");
			if (!cmdStr.startsWith("jj show")) return null;
			return findJJShowResponse(cmdStr);
		};

		const mockExecutor: CommandExecutor = {
			exec: async (cmd: string[]): Promise<CommandResponse> => {
				executedCommands.push(cmd);
				return (
					handleBookmarkList(cmd) ||
					handleJJLog(cmd) ||
					handlePRList(cmd) ||
					handlePRView(cmd) ||
					handleJJShow(cmd) || { stdout: "", stderr: "", code: 0 }
				);
			},
		};

		// Step 1: Cleanup marks auto/jjsp-address-pr-feedback for deletion
		const autoBookmarks = [
			"auto/jjsp-address-pr-feedback",
			"auto/jjsp-add-pr-file-count",
		];
		const cleanupResult = await cleanupMergedAutoBookmarks(
			mockExecutor,
			autoBookmarks,
			true, // dry-run
		);

		assertEquals(
			cleanupResult.deleted.length,
			1,
			"Should delete 1 merged bookmark",
		);
		assertEquals(cleanupResult.deleted[0], "auto/jjsp-address-pr-feedback");

		// Step 2: Detect the stack
		const stack = await detectStack(mockExecutor, "master");

		// Step 3: Find existing PRs
		const prListResult = await mockExecutor.exec([
			"gh",
			"pr",
			"list",
			"--author",
			"@me",
			"--state",
			"open",
			"--json",
			"number,headRefName,baseRefName,isDraft",
		]);
		const existingPRs = new Map();
		const prs = JSON.parse(prListResult.stdout);
		for (const pr of prs) {
			existingPRs.set(pr.headRefName, pr);
		}

		// Step 4: Build PR chain with deleted bookmarks
		const { chain } = await buildPRChainWithAutoCreate(
			stack.bookmarks,
			existingPRs,
			"master",
			mockExecutor,
			cleanupResult.deleted,
		);

		// The deleted bookmark should NOT appear in the chain
		const deletedInChain = chain.filter(
			(pr) => pr.bookmark === "auto/jjsp-address-pr-feedback",
		);
		assertEquals(
			deletedInChain.length,
			0,
			"Deleted bookmark should not appear in PR chain",
		);

		// The dependent PR should be rebased to the deleted bookmark's parent
		const dependentPR = chain.find(
			(pr) => pr.bookmark === "auto/jjsp-add-pr-file-count",
		);
		assertEquals(
			dependentPR?.base,
			"feat/cm-pr-approval-time",
			"Dependent PR should be rebased to parent of deleted bookmark",
		);
	});
});
