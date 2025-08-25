import type { CommandExecutor } from "./stack_detection.ts";

export interface UnbookmarkedChange {
	changeId: string;
	description: string;
}

export interface AutoBookmark {
	name: string;
	changeId: string;
	isTemporary: boolean;
}

export interface CleanupResult {
	deleted: string[];
	kept: string[];
}

async function getChangeLog(executor: CommandExecutor): Promise<string | null> {
	// Only get mutable commits in the current stack, not all descendants of trunk
	const result = await executor.exec([
		"jj",
		"log",
		"--no-graph",
		"-r",
		"::@ ~ immutable()",
		"--template",
		'change_id ++ " " ++ bookmarks ++ "\\n"',
	]);

	return result.code === 0 ? result.stdout : null;
}

function parseLogLine(
	line: string,
): { changeId: string; hasBookmarks: boolean } | null {
	const spaceIndex = line.indexOf(" ");
	if (spaceIndex === -1) return null;

	const changeId = line.substring(0, spaceIndex);
	const bookmarksPart = line.substring(spaceIndex + 1).trim();

	return { changeId, hasBookmarks: !!bookmarksPart };
}

async function isEmptyCommit(
	executor: CommandExecutor,
	changeId: string,
): Promise<boolean> {
	const emptyResult = await executor.exec([
		"jj",
		"show",
		"-r",
		changeId,
		"--template",
		"empty",
	]);

	if (emptyResult.code !== 0) {
		return false;
	}

	return emptyResult.stdout.trim() === "true";
}

async function getChangeDescription(
	executor: CommandExecutor,
	changeId: string,
): Promise<UnbookmarkedChange | null> {
	// Skip empty commits
	const isEmpty = await isEmptyCommit(executor, changeId);
	if (isEmpty) {
		return null;
	}

	const descResult = await executor.exec([
		"jj",
		"show",
		"-r",
		changeId,
		"--template",
		"description",
	]);

	if (descResult.code !== 0) {
		return null;
	}

	const description = descResult.stdout.split("\n")[0].trim();
	return { changeId, description };
}

async function hasMergedPR(
	executor: CommandExecutor,
	changeId: string,
): Promise<boolean> {
	// Check if there's a merged PR for this commit
	// We search by commit SHA which should be part of the PR body or title
	const prResult = await executor.exec([
		"gh",
		"pr",
		"list",
		"--state",
		"merged",
		"--search",
		changeId.substring(0, 8), // Use first 8 chars of change ID for search
		"--json",
		"number,state,headRefName",
	]);

	if (prResult.code !== 0) {
		return false;
	}

	try {
		const prs = JSON.parse(prResult.stdout);
		// Check if any merged PR was for an auto-bookmark
		return prs.some(
			(pr: { state: string; headRefName?: string }) =>
				pr.state === "MERGED" && pr.headRefName?.startsWith("auto/jjsp-"),
		);
	} catch {
		return false;
	}
}

async function processLogLine(
	executor: CommandExecutor,
	line: string,
): Promise<UnbookmarkedChange | null> {
	if (!line || line.startsWith("zzzzzzzz")) {
		return null;
	}

	const parsed = parseLogLine(line);
	if (!parsed || parsed.hasBookmarks) {
		return null;
	}

	// Check if this commit previously had a merged PR with an auto-bookmark
	const hadMergedPR = await hasMergedPR(executor, parsed.changeId);
	if (hadMergedPR) {
		return null; // Skip commits that already had merged PRs
	}

	return await getChangeDescription(executor, parsed.changeId);
}

export async function findUnbookmarkedChanges(
	executor: CommandExecutor,
): Promise<UnbookmarkedChange[]> {
	const logOutput = await getChangeLog(executor);
	if (!logOutput) return [];

	const unbookmarked: UnbookmarkedChange[] = [];
	const lines = logOutput.split("\n");

	for (const line of lines) {
		const change = await processLogLine(executor, line);
		if (change) {
			unbookmarked.push(change);
		}
	}

	return unbookmarked;
}

export function generateBookmarkName(
	commitMessage: string,
	changeId: string,
): string {
	// Take first 6 chars of change ID
	const shortId = changeId.substring(0, 6);

	// Clean up commit message
	let cleaned = commitMessage
		// Remove conventional commit prefix
		.replace(
			/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([^)]+\))?:\s*/i,
			"",
		)
		// Replace special characters with spaces
		.replace(/[^a-zA-Z0-9\s]/g, " ")
		// Replace multiple spaces with single space
		.replace(/\s+/g, " ")
		// Convert to lowercase
		.toLowerCase()
		// Trim whitespace
		.trim()
		// Replace spaces with hyphens
		.replace(/\s/g, "-");

	// Truncate to 30 characters
	if (cleaned.length > 30) {
		cleaned = cleaned.substring(0, 30);
	}

	// Include a marker "jjsp" (jj-stack-prs) to identify auto-created bookmarks
	return `auto/jjsp-${cleaned}-${shortId}`;
}

export async function createAutoBookmark(
	executor: CommandExecutor,
	change: UnbookmarkedChange,
): Promise<AutoBookmark> {
	const bookmarkName = generateBookmarkName(
		change.description,
		change.changeId,
	);

	// Create the bookmark
	await executor.exec([
		"jj",
		"bookmark",
		"create",
		bookmarkName,
		"-r",
		change.changeId,
	]);

	return {
		name: bookmarkName,
		changeId: change.changeId,
		isTemporary: true,
	};
}

export async function findAutoBookmarks(
	executor: CommandExecutor,
): Promise<string[]> {
	const result = await executor.exec(["jj", "bookmark", "list"]);

	if (result.code !== 0) {
		return [];
	}

	const bookmarks: string[] = [];
	const lines = result.stdout.split("\n").filter((line) => line.trim());

	for (const line of lines) {
		const trimmed = line.trim();
		// Only find bookmarks created by this tool (with jjsp marker)
		if (trimmed.startsWith("auto/jjsp-")) {
			// Extract just the bookmark name from the line
			// Format is: "bookmark-name: commit-info..."
			const bookmarkName = trimmed.split(":")[0].trim();
			bookmarks.push(bookmarkName);
		}
	}

	return bookmarks;
}

async function getPRState(
	executor: CommandExecutor,
	bookmark: string,
): Promise<string | null> {
	const prResult = await executor.exec([
		"gh",
		"pr",
		"view",
		bookmark,
		"--json",
		"state",
	]);

	if (prResult.code !== 0) {
		return null; // No PR found
	}

	try {
		const prInfo = JSON.parse(prResult.stdout);
		return prInfo.state;
	} catch {
		return null; // Can't parse, treat as no PR
	}
}

async function deleteBookmark(
	executor: CommandExecutor,
	bookmark: string,
): Promise<void> {
	// Delete the local bookmark
	await executor.exec(["jj", "bookmark", "delete", bookmark]);
	// Also forget the remote tracking bookmark to prevent it from appearing as bookmark@origin
	await executor.exec(["jj", "bookmark", "forget", `${bookmark}@origin`]);
}

async function shouldDeleteBookmark(
	executor: CommandExecutor,
	bookmark: string,
): Promise<boolean> {
	const prState = await getPRState(executor, bookmark);
	return prState === null || prState === "MERGED" || prState === "CLOSED";
}

async function processAutoBookmark(
	executor: CommandExecutor,
	bookmark: string,
	dryRun: boolean,
): Promise<boolean> {
	const shouldDelete = await shouldDeleteBookmark(executor, bookmark);
	if (shouldDelete && !dryRun) {
		await deleteBookmark(executor, bookmark);
	}
	return shouldDelete;
}

export async function cleanupMergedAutoBookmarks(
	executor: CommandExecutor,
	autoBookmarks: string[],
	dryRun = false,
): Promise<CleanupResult> {
	const deleted: string[] = [];
	const kept: string[] = [];

	for (const bookmark of autoBookmarks) {
		const wasDeleted = await processAutoBookmark(executor, bookmark, dryRun);
		if (wasDeleted) {
			deleted.push(bookmark);
		} else {
			kept.push(bookmark);
		}
	}

	return { deleted, kept };
}

export async function cleanupOrphanedAutoBookmarks(
	executor: CommandExecutor,
	autoBookmarks: string[],
	currentStackBookmarks: string[],
): Promise<CleanupResult> {
	const deleted: string[] = [];
	const kept: string[] = [];
	const stackSet = new Set(currentStackBookmarks);

	for (const bookmark of autoBookmarks) {
		if (!stackSet.has(bookmark)) {
			// Orphaned - not in current stack
			await deleteBookmark(executor, bookmark);
			deleted.push(bookmark);
		} else {
			kept.push(bookmark);
		}
	}

	return { deleted, kept };
}
