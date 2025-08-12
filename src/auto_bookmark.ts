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

export class AutoBookmarkManager {
	constructor(private executor: CommandExecutor) {}

	async findUnbookmarkedChanges(): Promise<UnbookmarkedChange[]> {
		const logOutput = await this.getChangeLog();
		if (!logOutput) return [];

		const unbookmarked: UnbookmarkedChange[] = [];
		const lines = logOutput.split("\n");

		for (const line of lines) {
			const change = await this.processLogLine(line);
			if (change) {
				unbookmarked.push(change);
			}
		}

		return unbookmarked;
	}

	private async getChangeLog(): Promise<string | null> {
		const result = await this.executor.exec([
			"jj",
			"log",
			"--no-graph",
			"-r",
			"(::@ | @::) & trunk()..",
			"--template",
			'change_id ++ " " ++ bookmarks ++ "\\n"',
		]);

		return result.code === 0 ? result.stdout : null;
	}

	private async processLogLine(
		line: string,
	): Promise<UnbookmarkedChange | null> {
		if (!line || line.startsWith("zzzzzzzz")) {
			return null;
		}

		const parsed = this.parseLogLine(line);
		if (!parsed || parsed.hasBookmarks) {
			return null;
		}

		return await this.getChangeDescription(parsed.changeId);
	}

	private parseLogLine(
		line: string,
	): { changeId: string; hasBookmarks: boolean } | null {
		const spaceIndex = line.indexOf(" ");
		if (spaceIndex === -1) return null;

		const changeId = line.substring(0, spaceIndex);
		const bookmarksPart = line.substring(spaceIndex + 1).trim();

		return { changeId, hasBookmarks: !!bookmarksPart };
	}

	private async getChangeDescription(
		changeId: string,
	): Promise<UnbookmarkedChange | null> {
		const descResult = await this.executor.exec([
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

	generateBookmarkName(commitMessage: string, changeId: string): string {
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

	async createAutoBookmark(change: UnbookmarkedChange): Promise<AutoBookmark> {
		const bookmarkName = this.generateBookmarkName(
			change.description,
			change.changeId,
		);

		// Create the bookmark
		await this.executor.exec([
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

	async findAutoBookmarks(): Promise<string[]> {
		const result = await this.executor.exec(["jj", "bookmark", "list"]);

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

	async cleanupMergedAutoBookmarks(
		autoBookmarks: string[],
	): Promise<CleanupResult> {
		const deleted: string[] = [];
		const kept: string[] = [];

		for (const bookmark of autoBookmarks) {
			const shouldDelete = await this.shouldDeleteBookmark(bookmark);

			if (shouldDelete) {
				await this.deleteBookmark(bookmark);
				deleted.push(bookmark);
			} else {
				kept.push(bookmark);
			}
		}

		return { deleted, kept };
	}

	private async shouldDeleteBookmark(bookmark: string): Promise<boolean> {
		const prState = await this.getPRState(bookmark);
		return prState === null || prState === "MERGED" || prState === "CLOSED";
	}

	private async getPRState(bookmark: string): Promise<string | null> {
		const prResult = await this.executor.exec([
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

	private async deleteBookmark(bookmark: string): Promise<void> {
		// Delete the local bookmark
		await this.executor.exec(["jj", "bookmark", "delete", bookmark]);
		// Also forget the remote tracking bookmark to prevent it from appearing as bookmark@origin
		await this.executor.exec([
			"jj",
			"bookmark",
			"forget",
			`${bookmark}@origin`,
		]);
	}

	async cleanupOrphanedAutoBookmarks(
		autoBookmarks: string[],
		currentStackBookmarks: string[],
	): Promise<CleanupResult> {
		const deleted: string[] = [];
		const kept: string[] = [];
		const stackSet = new Set(currentStackBookmarks);

		for (const bookmark of autoBookmarks) {
			if (!stackSet.has(bookmark)) {
				// Orphaned - not in current stack
				await this.deleteBookmark(bookmark);
				deleted.push(bookmark);
			} else {
				kept.push(bookmark);
			}
		}

		return { deleted, kept };
	}
}
