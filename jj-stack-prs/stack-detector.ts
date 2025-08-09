export type JJExecutor = (
	args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export interface StackInfo {
	bookmarks: string[];
	baseBranch: string;
	isPartialStack?: boolean;
}

export async function detectStack(
	executeJJ: JJExecutor,
	baseBranch = "main",
): Promise<StackInfo> {
	// Get bookmarks in current lineage (ancestors of current position)
	const result = await executeJJ([
		"log",
		"--no-graph",
		"-r",
		`::@ & bookmarks() & descendants(${baseBranch})`,
		"--template",
		'concat(local_bookmarks, "\\n")',
	]);

	const bookmarks = result.stdout
		.split("\n")
		.filter((line) => line.trim())
		.flatMap((line) => line.split(" "))
		.filter((bookmark) => bookmark && bookmark !== baseBranch)
		.reverse();

	if (bookmarks.length === 0) {
		throw new Error("No bookmarks found in current stack");
	}

	// Check if there are any bookmarks that are descendants of current position
	// If there are, we're not at the top of the stack
	const descendantsResult = await executeJJ([
		"log",
		"--no-graph",
		"-r",
		`@:: & bookmarks() & descendants(${baseBranch})`,
		"--template",
		'concat(local_bookmarks, "\\n")',
	]);

	const descendantBookmarks = descendantsResult.stdout
		.split("\n")
		.filter((line) => line.trim())
		.flatMap((line) => line.split(" "))
		.filter((bookmark) => bookmark && bookmark !== baseBranch && !bookmarks.includes(bookmark));

	return {
		bookmarks,
		baseBranch,
		isPartialStack: descendantBookmarks.length > 0,
	};
}
