import { CommandExecutor } from "./stack_detection.ts";

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
    // Get log with change IDs and bookmarks for the full stack
    const result = await this.executor.exec([
      "jj", "log", "--no-graph", "-r", "trunk()..@",
      "--template", 'change_id ++ " " ++ bookmarks ++ "\\n"'
    ]);

    if (result.code !== 0) {
      return [];
    }

    const unbookmarked: UnbookmarkedChange[] = [];
    const lines = result.stdout.split("\n");

    for (const line of lines) {
      // Don't trim yet - we need to check if there's content after the space
      if (!line) continue;
      
      // Skip the root change (all z's)
      if (line.startsWith("zzzzzzzz")) continue;
      
      // The format is: "changeId bookmarks" where bookmarks may be empty
      // If there's only a changeId followed by space(s), there are no bookmarks
      const spaceIndex = line.indexOf(" ");
      if (spaceIndex === -1) continue; // Shouldn't happen with our template
      
      const changeId = line.substring(0, spaceIndex);
      const bookmarksPart = line.substring(spaceIndex + 1).trim();
      
      // If bookmarksPart is empty, there are no bookmarks
      if (!bookmarksPart) {
        // Get commit description for unbookmarked change
        const descResult = await this.executor.exec([
          "jj", "show", "-r", changeId, "--template", "description"
        ]);
        
        if (descResult.code === 0) {
          const description = descResult.stdout.split("\n")[0].trim();
          unbookmarked.push({ changeId, description });
        }
      }
    }

    return unbookmarked;
  }

  generateBookmarkName(commitMessage: string, changeId: string): string {
    // Take first 6 chars of change ID
    const shortId = changeId.substring(0, 6);
    
    // Clean up commit message
    let cleaned = commitMessage
      // Remove conventional commit prefix
      .replace(/^(feat|fix|docs|style|refactor|test|chore|perf|ci|build|revert)(\([^)]+\))?:\s*/i, "")
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
    
    return `auto/${cleaned}-${shortId}`;
  }

  async createAutoBookmark(change: UnbookmarkedChange): Promise<AutoBookmark> {
    const bookmarkName = this.generateBookmarkName(change.description, change.changeId);
    
    // Create the bookmark
    await this.executor.exec([
      "jj", "bookmark", "create", bookmarkName, "-r", change.changeId
    ]);
    
    return {
      name: bookmarkName,
      changeId: change.changeId,
      isTemporary: true
    };
  }

  async findAutoBookmarks(): Promise<string[]> {
    const result = await this.executor.exec([
      "jj", "bookmark", "list"
    ]);
    
    if (result.code !== 0) {
      return [];
    }
    
    const bookmarks: string[] = [];
    const lines = result.stdout.split("\n").filter(line => line.trim());
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("auto/")) {
        // Extract just the bookmark name from the line
        // Format is: "bookmark-name: commit-info..."
        const bookmarkName = trimmed.split(":")[0].trim();
        bookmarks.push(bookmarkName);
      }
    }
    
    return bookmarks;
  }

  async cleanupMergedAutoBookmarks(autoBookmarks: string[]): Promise<CleanupResult> {
    const deleted: string[] = [];
    const kept: string[] = [];
    
    for (const bookmark of autoBookmarks) {
      // Check PR status
      const prResult = await this.executor.exec([
        "gh", "pr", "view", bookmark, "--json", "state"
      ]);
      
      let shouldDelete = false;
      
      if (prResult.code === 0) {
        try {
          const prInfo = JSON.parse(prResult.stdout);
          shouldDelete = prInfo.state === "MERGED" || prInfo.state === "CLOSED";
        } catch {
          // If we can't parse, assume it should be deleted
          shouldDelete = true;
        }
      } else {
        // No PR found - delete orphaned auto bookmark
        shouldDelete = true;
      }
      
      if (shouldDelete) {
        await this.executor.exec([
          "jj", "bookmark", "delete", bookmark
        ]);
        deleted.push(bookmark);
      } else {
        kept.push(bookmark);
      }
    }
    
    return { deleted, kept };
  }

  async cleanupOrphanedAutoBookmarks(
    autoBookmarks: string[],
    currentStackBookmarks: string[]
  ): Promise<CleanupResult> {
    const deleted: string[] = [];
    const kept: string[] = [];
    const stackSet = new Set(currentStackBookmarks);
    
    for (const bookmark of autoBookmarks) {
      if (!stackSet.has(bookmark)) {
        // Orphaned - not in current stack
        await this.executor.exec([
          "jj", "bookmark", "delete", bookmark
        ]);
        deleted.push(bookmark);
      } else {
        kept.push(bookmark);
      }
    }
    
    return { deleted, kept };
  }
}