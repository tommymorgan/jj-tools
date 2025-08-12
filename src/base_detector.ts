import type { CommandExecutor } from "./stack_detection.ts";

/**
 * Auto-detects the base branch by finding what jj considers trunk()
 * This will typically be main, master, trunk, or whatever the repository uses
 */
export async function detectBaseBranch(
	executor: CommandExecutor,
): Promise<string | null> {
	const bookmarks = await getTrunkBookmarks(executor);
	if (!bookmarks) return null;

	const localBookmarks = filterLocalBookmarks(bookmarks);
	if (localBookmarks.length === 0) return null;

	return selectBestBaseBranch(localBookmarks);
}

async function getTrunkBookmarks(
	executor: CommandExecutor,
): Promise<string | null> {
	const result = await executor.exec([
		"jj",
		"log",
		"--no-graph",
		"-r",
		"trunk()",
		"--template",
		"bookmarks",
		"--limit",
		"1",
	]);

	if (result.code !== 0) return null;
	
	const bookmarks = result.stdout.trim();
	return bookmarks || null;
}

function filterLocalBookmarks(bookmarks: string): string[] {
	const bookmarkList = bookmarks.split(/\s+/).filter((b) => b.length > 0);
	return bookmarkList.filter((b) => !b.includes("@"));
}

function selectBestBaseBranch(localBookmarks: string[]): string {
	const commonBases = ["main", "master", "trunk", "develop", "development"];
	
	for (const base of commonBases) {
		if (localBookmarks.includes(base)) {
			return base;
		}
	}
	
	return localBookmarks[0];
}