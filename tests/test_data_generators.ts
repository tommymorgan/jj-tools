import { faker } from "npm:@faker-js/faker@9";
import { z } from "npm:zod@4";
import type { CLIOptions } from "../src/cli.ts";
import type { Bookmark, StackInfo } from "../src/stack_detection.ts";

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

/**
 * Generate jj log output in the format: "changeId bookmark1 bookmark2 ..."
 */
export function generateLogOutput(lines: JJLogLine[]): string {
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
export function generateLogWithDescriptions(lines: JJLogLine[]): string {
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
export function generateWorkingStack(options: {
	numCommits: number;
	hasBookmarks?: boolean;
	baseBranch?: string;
}): JJLogLine[] {
	const { numCommits, hasBookmarks = false, baseBranch = "master" } = options;
	const stack: JJLogLine[] = [];

	// Add working commits
	for (let i = 0; i < numCommits; i++) {
		stack.push({
			changeId: generateChangeId(),
			bookmarks: hasBookmarks ? [`feature-${i}`] : [],
			description: `feat: working on feature part ${i}`,
		});
	}

	// Add base branch
	stack.push({
		changeId: generateChangeId(),
		bookmarks: [baseBranch],
		description: `chore: release v1.0.0`,
	});

	return stack;
}

/**
 * Generate a problematic scenario with many merged commits
 */
export function generateProblematicHistory(options: {
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
			changeId: generateChangeId(),
			bookmarks: [],
			description: i === 0 ? "" : `feat: my actual work ${i}`,
		});
	}

	// Add merged commits (these should NOT get auto-bookmarks)
	for (let i = 0; i < numMergedCommits; i++) {
		const prNumber = 14000 + i;
		history.push({
			changeId: generateChangeId(),
			bookmarks: [],
			description: `feat: already merged feature (#${prNumber})`,
		});
	}

	// Add base branch
	history.push({
		changeId: generateChangeId(),
		bookmarks: [baseBranch],
		description: `chore: release v1.89.0`,
	});

	return history;
}

/**
 * Generate commits with remote bookmarks (for PR stack scenario)
 */
export function generateRemoteBookmarkStack(
	prStack: {
		branch: string;
		description: string;
		prNumber: number;
	}[],
): JJLogLine[] {
	return prStack.map((pr) => ({
		changeId: generateChangeId(),
		bookmarks: [`${pr.branch}@origin`],
		description: pr.description,
	}));
}

export function generateChangeId(): string {
	return faker.string.alpha({
		length: 32,
		casing: "lower",
		exclude: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"],
	});
}

/**
 * Helper to check if a line is immutable
 */
function isImmutableLine(
	line: JJLogLine,
	immutableCommits: string[],
	trunk: string,
): boolean {
	return (
		immutableCommits.includes(line.changeId) ||
		line.bookmarks.some((b) => b === trunk) ||
		!!line.description.match(/\(#\d+\)/)
	);
}

/**
 * Helper to filter lines for mutable commits
 */
function filterMutableLines(
	logOutput: JJLogLine[],
	immutableCommits: string[],
	trunk: string,
): JJLogLine[] {
	return logOutput.filter(
		(line) => !isImmutableLine(line, immutableCommits, trunk),
	);
}

/**
 * Helper to handle jj log commands
 */
function handleJJLog(
	cmd: string[],
	logOutput: JJLogLine[],
	immutableCommits: string[],
	trunk: string,
) {
	const revsetIndex = cmd.indexOf("-r");
	if (revsetIndex === -1) {
		return { stdout: "", stderr: "", code: 0 };
	}
	const revset = cmd[revsetIndex + 1];

	// Old buggy query - would return everything
	if (revset.includes("(::@ | @::) & trunk()..")) {
		return {
			stdout: generateLogOutput(logOutput),
			stderr: "",
			code: 0,
		};
	}

	// Return immutable commits
	if (revset === "immutable()") {
		const immutableLines = logOutput.filter(
			(line) =>
				immutableCommits.includes(line.changeId) ||
				line.bookmarks.some((b) => b === trunk),
		);
		return {
			stdout: generateLogOutput(immutableLines),
			stderr: "",
			code: 0,
		};
	}

	// NEW FIXED query - only mutable commits in current stack
	if (revset === "::@ ~ immutable()") {
		const mutableLines = filterMutableLines(logOutput, immutableCommits, trunk);
		return {
			stdout: generateLogOutput(mutableLines),
			stderr: "",
			code: 0,
		};
	}

	// Default - return all
	return {
		stdout: generateLogOutput(logOutput),
		stderr: "",
		code: 0,
	};
}

/**
 * Helper to handle jj show commands
 */
function handleJJShow(
	cmd: string[],
	logOutput: JJLogLine[],
	showDescriptions: Map<string, string>,
) {
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

/**
 * Create a mock CommandExecutor for testing
 */
export function createMockExecutor(scenarios: {
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

	const handleConfig = (cmd: string[]) => {
		if (cmd[2] === "list" && cmd[3] === "revset-aliases.trunk") {
			return {
				stdout: `revset-aliases.trunk = "${trunk}"`,
				stderr: "",
				code: 0,
			};
		}
		return null;
	};

	const handleJJCommand = (cmd: string[]) => {
		switch (cmd[1]) {
			case "config":
				return handleConfig(cmd) || { stdout: "", stderr: "", code: 0 };
			case "log":
				return handleJJLog(cmd, logOutput, immutableCommits, trunk);
			case "show":
				return handleJJShow(cmd, logOutput, showDescriptions);
			default:
				return { stdout: "", stderr: "", code: 0 };
		}
	};

	const handleCommand = (cmd: string[]) => {
		if (cmd[0] !== "jj") {
			return Promise.resolve({ stdout: "", stderr: "", code: 0 });
		}

		return Promise.resolve(handleJJCommand(cmd));
	};

	return {
		exec: handleCommand,
	};
}

/**
 * Generate CLIOptions for testing with dynamic values
 */
export function generateCLIOptions(options?: {
	overrides?: Partial<CLIOptions>;
}): CLIOptions {
	const defaults: CLIOptions = {
		baseBranch: faker.helpers.maybe(() =>
			faker.helpers.arrayElement([
				"main",
				"master",
				"trunk",
				"develop",
				"production",
			]),
		),
		noAutoBookmark: faker.datatype.boolean(),
		keepAuto: false,
		cleanupAllAuto: false,
		dryRun: faker.datatype.boolean({ probability: 0.2 }),
		verbose: faker.datatype.boolean({ probability: 0.3 }),
		version: false,
		help: false,
	};

	return { ...defaults, ...options?.overrides };
}

/**
 * Generate a Bookmark with dynamic test data
 */
export function generateBookmark(options?: {
	overrides?: Partial<Bookmark>;
}): Bookmark {
	const commitTypes = ["feat", "fix", "chore", "docs", "test", "refactor"];
	const branchPrefixes = [
		"feat/",
		"fix/",
		"chore/",
		"docs/",
		"test/",
		"auto/jjsp-",
	];

	const defaults: Bookmark = {
		name:
			faker.helpers.arrayElement(branchPrefixes) +
			faker.git
				.branch()
				.replace(/[^a-z0-9-]/gi, "-")
				.toLowerCase(),
		commitHash: faker.git.commitSha().substring(0, 8),
		commitMessage: `${faker.helpers.arrayElement(commitTypes)}: ${faker.hacker.phrase().toLowerCase()}`,
		isCurrent: faker.datatype.boolean({ probability: 0.1 }),
	};

	return { ...defaults, ...options?.overrides };
}

// Helper to add base branch if needed
function addBaseBranchIfNeeded(
	bookmarks: Bookmark[],
	options?: {
		includeBaseBranch?: boolean;
		baseBranchName?: string;
	},
): void {
	const shouldInclude =
		options?.includeBaseBranch ?? faker.datatype.boolean({ probability: 0.3 });

	if (!shouldInclude) return;

	const baseName =
		options?.baseBranchName ??
		faker.helpers.arrayElement(["main", "master", "trunk"]);
	bookmarks.push(
		generateBookmark({
			overrides: {
				name: baseName,
				commitMessage: `chore: ${faker.lorem.words(3)}`,
				isCurrent: false,
			},
		}),
	);
}

/**
 * Generate a StackInfo with dynamic test data
 */
export function generateStackInfo(options?: {
	bookmarkCount?: number;
	includeBaseBranch?: boolean;
	baseBranchName?: string;
	overrides?: Partial<StackInfo>;
}): StackInfo {
	const bookmarkCount =
		options?.bookmarkCount ?? faker.number.int({ min: 1, max: 6 });
	const bookmarks: Bookmark[] = [];

	// Generate feature bookmarks
	for (let i = 0; i < bookmarkCount; i++) {
		bookmarks.push(generateBookmark());
	}

	// Optionally include base branch
	addBaseBranchIfNeeded(bookmarks, options);

	// Set one random bookmark as current
	const currentIndex = faker.number.int({ min: 0, max: bookmarks.length - 1 });
	if (bookmarks.length > 0) {
		bookmarks[currentIndex].isCurrent = true;
	}

	const defaults: StackInfo = {
		bookmarks,
		currentPosition: currentIndex,
	};

	return { ...defaults, ...options?.overrides };
}

/**
 * Real-world test data based on user's actual scenario
 */
export const REAL_WORLD_SCENARIOS = {
	// Scenario with many unbookmarked commits
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
				changeId: generateChangeId(),
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
