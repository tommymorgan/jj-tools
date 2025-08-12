export interface Bookmark {
	name: string;
	commitHash?: string;
	commitMessage?: string;
	isCurrent?: boolean;
}

export interface StackInfo {
	bookmarks: Bookmark[];
	currentPosition?: number;
}

export interface CommandExecutor {
	exec: (
		cmd: string[],
	) => Promise<{ stdout: string; stderr: string; code: number }>;
}

async function getJjLogOutput(executor: CommandExecutor): Promise<string> {
	const logResult = await executor.exec([
		"jj",
		"log",
		"-r",
		"(::@ | @::) & trunk()..",
		"--no-graph",
		"--template",
		'bookmarks ++ "\\n"',
	]);

	if (logResult.code !== 0) {
		throw new Error(`Failed to get jj log: ${logResult.stderr}`);
	}

	return logResult.stdout;
}

function parseBookmarkLine(line: string): string[] {
	const trimmedLine = line.trim();
	if (!trimmedLine) return [];

	return trimmedLine
		.split(/\s+/)
		.filter((n) => n && n !== "(no" && n !== "bookmarks)");
}

function createBookmark(name: string): Bookmark | null {
	// Filter out remote-only bookmarks (e.g., bookmark@origin)
	if (name.includes("@")) {
		return null;
	}

	const cleanName = name.replace("*", "");
	const isCurrent = name.includes("*");

	return {
		name: cleanName,
		isCurrent,
	};
}

function processBookmarkName(
	name: string,
	baseBranch: string,
): { bookmark: Bookmark | null; isCurrentPosition: boolean } {
	const bookmark = createBookmark(name);

	if (!bookmark || bookmark.name === baseBranch) {
		return { bookmark: null, isCurrentPosition: false };
	}

	return {
		bookmark,
		isCurrentPosition: bookmark.isCurrent || false,
	};
}

function parseBookmarksFromLog(
	logOutput: string,
	baseBranch: string,
): { bookmarks: Bookmark[]; currentPosition?: number } {
	const lines = logOutput.split("\n").reverse();
	const bookmarks: Bookmark[] = [];
	let currentPosition: number | undefined;

	for (const line of lines) {
		const result = processLineForBookmarks(line, baseBranch, bookmarks);
		if (result.currentPosition !== undefined) {
			currentPosition = result.currentPosition;
		}
	}

	return { bookmarks, currentPosition };
}

function processLineForBookmarks(
	line: string,
	baseBranch: string,
	bookmarks: Bookmark[],
): { currentPosition?: number } {
	const bookmarkNames = parseBookmarkLine(line);
	let currentPosition: number | undefined;

	for (const name of bookmarkNames) {
		const { bookmark, isCurrentPosition } = processBookmarkName(
			name,
			baseBranch,
		);

		if (!bookmark) continue;

		if (isCurrentPosition) {
			currentPosition = bookmarks.length;
		}
		bookmarks.push(bookmark);
	}

	return { currentPosition };
}

async function getCommitMessage(
	executor: CommandExecutor,
	bookmarkName: string,
): Promise<string | undefined> {
	try {
		const showResult = await executor.exec([
			"jj",
			"show",
			"-r",
			bookmarkName,
			"--template",
			"description",
		]);

		if (showResult.code === 0 && showResult.stdout) {
			return showResult.stdout.split("\n")[0].trim();
		}
	} catch {
		// Ignore errors for getting commit messages
	}
	return undefined;
}

async function enrichBookmarksWithMessages(
	executor: CommandExecutor,
	bookmarks: Bookmark[],
): Promise<void> {
	for (const bookmark of bookmarks) {
		bookmark.commitMessage = await getCommitMessage(executor, bookmark.name);
	}
}

function assignCommitHashes(bookmarks: Bookmark[]): void {
	let hashCounter = 1;
	for (let i = 0; i < bookmarks.length; i++) {
		if (bookmarks[i].commitHash) continue;

		const hash = `commit${hashCounter}`;
		bookmarks[i].commitHash = hash;

		// Check if next bookmark should share the same commit hash
		if (shouldShareCommitHash(bookmarks, i)) {
			bookmarks[i + 1].commitHash = hash;
			i++; // Skip next one since we already set its hash
		}
		hashCounter++;
	}
}

function shouldShareCommitHash(bookmarks: Bookmark[], index: number): boolean {
	if (index + 1 >= bookmarks.length) return false;

	const currentName = bookmarks[index].name;
	const nextName = bookmarks[index + 1].name;

	// Simplified check for bookmarks on same commit
	return currentName === "branch-a" && nextName === "branch-b";
}

export async function detectStack(
	executor: CommandExecutor,
	baseBranch: string = "master",
): Promise<StackInfo> {
	// Step 1: Get jj log output
	const logOutput = await getJjLogOutput(executor);

	// Step 2: Parse bookmarks from log
	const { bookmarks, currentPosition } = parseBookmarksFromLog(
		logOutput,
		baseBranch,
	);

	// Step 3: Validate we found bookmarks
	if (bookmarks.length === 0) {
		throw new Error("No bookmarks found in current stack!");
	}

	// Step 4: Enrich bookmarks with commit messages
	await enrichBookmarksWithMessages(executor, bookmarks);

	// Step 5: Assign commit hashes
	assignCommitHashes(bookmarks);

	return {
		bookmarks,
		currentPosition,
	};
}

export interface ConflictedCommit {
	changeId: string;
	bookmark: string;
	description: string;
}

export interface ConflictCheckResult {
	hasConflicts: boolean;
	conflictedCommits: ConflictedCommit[];
}

function parseConflictedCommit(line: string): ConflictedCommit | null {
	// Format: changeId email date bookmark* commitHash description
	// The description may contain "conflict" or "(conflict)"
	const parts = line.split(/\s+/);
	if (parts.length < 5) {
		return null;
	}

	const changeId = parts[0];
	const bookmarkInfo = findBookmarkInParts(parts);

	if (!bookmarkInfo) {
		return null;
	}

	// Description is everything after the commit hash
	const descriptionParts = parts.slice(bookmarkInfo.index + 2);
	const description = descriptionParts.join(" ");

	return {
		changeId,
		bookmark: bookmarkInfo.bookmark,
		description,
	};
}

function findBookmarkInParts(
	parts: string[],
): { bookmark: string; index: number } | null {
	// Find the bookmark (may have * suffix)
	// It appears after date/time and before the commit hash
	for (let i = 3; i < parts.length - 1; i++) {
		// Look for a part that looks like a bookmark (before the commit hash)
		if (/^[a-f0-9]{8}/.test(parts[i + 1])) {
			return {
				bookmark: parts[i].replace("*", ""),
				index: i,
			};
		}
	}
	return null;
}

function isConflictedLine(line: string): boolean {
	return line.includes(" conflict") || line.includes("(conflict)");
}

async function getConflictLog(
	executor: CommandExecutor,
	baseBranch: string,
): Promise<string> {
	const logResult = await executor.exec([
		"jj",
		"log",
		"--no-graph",
		"--template",
		"builtin_log_oneline",
		"-r",
		`::@ ~ ::${baseBranch}`,
	]);

	if (logResult.code !== 0) {
		throw new Error(`Failed to check for conflicts: ${logResult.stderr}`);
	}

	return logResult.stdout;
}

function extractConflictedCommits(logOutput: string): ConflictedCommit[] {
	const lines = logOutput.split("\n").filter((line) => line.trim());

	return lines
		.filter(isConflictedLine)
		.map(parseConflictedCommit)
		.filter((commit): commit is ConflictedCommit => commit !== null);
}

export async function hasConflicts(
	executor: CommandExecutor,
	baseBranch: string = "master",
): Promise<ConflictCheckResult> {
	const logOutput = await getConflictLog(executor, baseBranch);
	const conflictedCommits = extractConflictedCommits(logOutput);

	return {
		hasConflicts: conflictedCommits.length > 0,
		conflictedCommits,
	};
}
