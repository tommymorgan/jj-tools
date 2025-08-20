import { z } from "npm:zod@3";

// Schema for jj log output line format: "changeId bookmarks description"
export const JJLogLineSchema = z.object({
	changeId: z.string().min(12),
	bookmarks: z.array(z.string()).default([]),
	description: z.string().default(""),
});

export type JJLogLine = z.infer<typeof JJLogLineSchema>;

// Schema for jj show output
export const JJShowOutputSchema = z.object({
	changeId: z.string(),
	description: z.string(),
	author: z.string().optional(),
	date: z.string().optional(),
});

export type JJShowOutput = z.infer<typeof JJShowOutputSchema>;

export class JJTestDataGenerator {
	/**
	 * Generate jj log output in the format: "changeId bookmark1 bookmark2 ..."
	 */
	static generateLogOutput(lines: JJLogLine[]): string {
		return lines
			.map((line) => {
				const bookmarksPart = line.bookmarks.join(" ");
				// Don't trim - the format needs the space after changeId even if no bookmarks
				return `${line.changeId} ${bookmarksPart}`;
			})
			.join("\n");
	}

	/**
	 * Generate jj log output with template for descriptions
	 */
	static generateLogWithDescriptions(lines: JJLogLine[]): string {
		return lines
			.map((line) => {
				const bookmarksPart = line.bookmarks.join(" ");
				return `${line.changeId} ${bookmarksPart} ${line.description}`.trim();
			})
			.join("\n");
	}

	/**
	 * Generate a typical working stack scenario
	 */
	static generateWorkingStack(options: {
		numCommits: number;
		hasBookmarks?: boolean;
		baseBranch?: string;
	}): JJLogLine[] {
		const { numCommits, hasBookmarks = false, baseBranch = "master" } = options;
		const stack: JJLogLine[] = [];

		// Add working commits
		for (let i = 0; i < numCommits; i++) {
			stack.push({
				changeId: this.generateChangeId(),
				bookmarks: hasBookmarks ? [`feature-${i}`] : [],
				description: `feat: working on feature part ${i}`,
			});
		}

		// Add base branch
		stack.push({
			changeId: this.generateChangeId(),
			bookmarks: [baseBranch],
			description: `chore: release v1.0.0`,
		});

		return stack;
	}

	/**
	 * Generate a problematic scenario with many merged commits
	 */
	static generateProblematicHistory(options: {
		numWorkingCommits: number;
		numMergedCommits: number;
		baseBranch?: string;
	}): JJLogLine[] {
		const {
			numWorkingCommits,
			numMergedCommits,
			baseBranch = "master",
		} = options;
		const history: JJLogLine[] = [];

		// Add current working commits (unbookmarked)
		for (let i = 0; i < numWorkingCommits; i++) {
			history.push({
				changeId: this.generateChangeId(),
				bookmarks: [],
				description: i === 0 ? "" : `feat: my actual work ${i}`,
			});
		}

		// Add merged commits (these should NOT get auto-bookmarks)
		for (let i = 0; i < numMergedCommits; i++) {
			const prNumber = 14000 + i;
			history.push({
				changeId: this.generateChangeId(),
				bookmarks: [],
				description: `feat: already merged feature (#${prNumber})`,
			});
		}

		// Add base branch
		history.push({
			changeId: this.generateChangeId(),
			bookmarks: [baseBranch],
			description: `chore: release v1.89.0`,
		});

		return history;
	}

	/**
	 * Generate commits with remote bookmarks (for PR stack scenario)
	 */
	static generateRemoteBookmarkStack(
		prStack: {
			branch: string;
			description: string;
			prNumber: number;
		}[],
	): JJLogLine[] {
		return prStack.map((pr) => ({
			changeId: this.generateChangeId(),
			bookmarks: [`${pr.branch}@origin`],
			description: pr.description,
		}));
	}

	/**
	 * Generate a realistic change ID (32 chars of lowercase letters)
	 */
	static generateChangeId(): string {
		const chars = "klmnopqrstuvwxyz";
		let id = "";
		for (let i = 0; i < 32; i++) {
			id += chars[Math.floor(Math.random() * chars.length)];
		}
		return id;
	}

	/**
	 * Create a mock CommandExecutor for testing
	 */
	static createMockExecutor(scenarios: {
		logOutput?: JJLogLine[];
		showDescriptions?: Map<string, string>;
		trunk?: string;
		immutableCommits?: string[];
	}) {
		const {
			logOutput = [],
			showDescriptions = new Map(),
			trunk = "master",
			immutableCommits = [],
		} = scenarios;

		return {
			exec: async (cmd: string[]) => {
				// Handle jj config for trunk
				if (
					cmd[0] === "jj" &&
					cmd[1] === "config" &&
					cmd[2] === "list" &&
					cmd[3] === "revset-aliases.trunk"
				) {
					return {
						stdout: `revset-aliases.trunk = "${trunk}"`,
						stderr: "",
						code: 0,
					};
				}

				// Handle jj log with various revsets
				if (cmd[0] === "jj" && cmd[1] === "log") {
					const revsetIndex = cmd.indexOf("-r");
					if (revsetIndex === -1) {
						// No -r flag, return empty
						return { stdout: "", stderr: "", code: 0 };
					}
					const revset = cmd[revsetIndex + 1];
					const templateIndex = cmd.indexOf("--template");
					const template = templateIndex !== -1 ? cmd[templateIndex + 1] : "";

					// Check what query is being made
					if (revset.includes("(::@ | @::) & trunk()..")) {
						// Old buggy query - would return everything
						return {
							stdout: this.generateLogOutput(logOutput),
							stderr: "",
							code: 0,
						};
					}

					if (revset === "immutable()") {
						// Return immutable commits
						const immutableLines = logOutput.filter(
							(line) =>
								immutableCommits.includes(line.changeId) ||
								line.bookmarks.some((b) => b === trunk),
						);
						return {
							stdout: this.generateLogOutput(immutableLines),
							stderr: "",
							code: 0,
						};
					}

					if (revset === "::@ ~ immutable()") {
						// NEW FIXED query - only mutable commits in current stack
						// Filter out: immutable commits, trunk, and merged commits with PR numbers
						const mutableLines = logOutput.filter((line) => {
							// Exclude if it's marked as immutable
							if (immutableCommits.includes(line.changeId)) return false;
							// Exclude if it's the trunk branch
							if (line.bookmarks.some((b) => b === trunk)) return false;
							// Exclude if it has a PR number (merged commit)
							if (line.description.match(/\(#\d+\)/)) return false;
							// Include everything else (actual working commits)
							return true;
						});
						return {
							stdout: this.generateLogOutput(mutableLines),
							stderr: "",
							code: 0,
						};
					}

					// Default - return all
					return {
						stdout: this.generateLogOutput(logOutput),
						stderr: "",
						code: 0,
					};
				}

				// Handle jj show for descriptions
				if (cmd[0] === "jj" && cmd[1] === "show") {
					const changeId = cmd[3];
					const description =
						showDescriptions.get(changeId) ||
						logOutput.find((l) => l.changeId === changeId)?.description ||
						"";
					return {
						stdout: description,
						stderr: "",
						code: 0,
					};
				}

				return { stdout: "", stderr: "", code: 0 };
			},
		};
	}
}

/**
 * Real-world test data based on user's actual scenario
 */
export const REAL_WORLD_SCENARIOS = {
	// The 384 unbookmarked commits scenario from the user
	massiveMergedHistory: () => {
		const history: JJLogLine[] = [];

		// Working copy
		history.push({
			changeId: "kulqvzrpzxwykrlpknltrkvuszmyqrtr",
			bookmarks: [],
			description: "",
		});

		// A few actual merged commits with PR numbers
		const mergedCommits = [
			{
				id: "srxtpwymqtrswwpqoszrnnmnuyuvvkzz",
				desc: "feat: add dependency review workflow for PRs (#14111)",
			},
			{
				id: "vtooqxztovsrnpxnmmtlwrwqwvqnooxq",
				desc: "test: updated global setup for jwt failures (#14113)",
			},
			{
				id: "uxomryvtxxymmytuvvwswxxrvkmrrzps",
				desc: "feat: [API-477] Adding debug logging and viewer for NGA maps. (#14046)",
			},
			{
				id: "tolurrqrklloolukotmknzuuxnnxqrko",
				desc: "test: added script for debugging intermittent failures. (#14108)",
			},
		];

		for (const commit of mergedCommits) {
			history.push({
				changeId: commit.id,
				bookmarks: [],
				description: commit.desc,
			});
		}

		// Add ~379 more merged commits
		for (let i = 0; i < 379; i++) {
			history.push({
				changeId: JJTestDataGenerator.generateChangeId(),
				bookmarks: [],
				description: `chore: some merged work (#${13000 + i})`,
			});
		}

		// Master branch
		history.push({
			changeId: "poonoxvurtotrvqwkvvwklpukuxwtnls",
			bookmarks: ["master", "master@origin"],
			description: "chore: release v1.89.0",
		});

		return history;
	},

	// A clean working stack with only 2-3 commits
	cleanWorkingStack: () => {
		return [
			{
				changeId: "kulqvzrpzxwykrlpknltrkvuszmyqrtr",
				bookmarks: [],
				description: "",
			},
			{
				changeId: "myworkcommitxxxxxxxxxxxxxxxxx001",
				bookmarks: [],
				description: "feat: implement new feature",
			},
			{
				changeId: "myworkcommitxxxxxxxxxxxxxxxxx002",
				bookmarks: [],
				description: "test: add tests for feature",
			},
		];
	},
};
