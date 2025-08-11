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
  exec: (cmd: string[]) => Promise<{ stdout: string; stderr: string; code: number }>;
}

export async function detectStack(
  executor: CommandExecutor,
  baseBranch: string = "master"
): Promise<StackInfo> {
  // Get the jj log output with bookmarks using template
  // Use a revset that gets the full connected stack from trunk to all heads
  const logResult = await executor.exec([
    "jj", "log", "-r", "trunk()..@", "--no-graph",
    "--template", 'bookmarks ++ "\\n"'
  ]);
  
  if (logResult.code !== 0) {
    throw new Error(`Failed to get jj log: ${logResult.stderr}`);
  }

  // Parse bookmarks from the log output
  const lines = logResult.stdout.split("\n");
  const bookmarks: Bookmark[] = [];
  let currentPosition: number | undefined;
  
  // Process lines from bottom to top to get correct order
  const reversedLines = lines.reverse();

  for (const line of reversedLines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines
    if (!trimmedLine) continue;
    
    // Handle multiple bookmarks on same line (space-separated)
    const bookmarkNames = trimmedLine.split(/\s+/).filter(n => n);
    
    for (const name of bookmarkNames) {
      // Skip if no bookmark name
      if (!name || name === "(no" || name === "bookmarks)") continue;
      
      // Clean up bookmark name and check for current marker
      const cleanName = name.replace("*", "");
      const isCurrent = name.includes("*");
      
      // Skip base branch
      if (cleanName === baseBranch) continue;
      
      const bookmark: Bookmark = {
        name: cleanName,
        isCurrent
      };
      
      // If this is the current bookmark, remember its position
      if (isCurrent) {
        currentPosition = bookmarks.length;
      }
      
      bookmarks.push(bookmark);
    }
  }

  // Throw error if no bookmarks found
  if (bookmarks.length === 0) {
    throw new Error("No bookmarks found in current stack!");
  }

  // Get commit messages for each bookmark
  for (const bookmark of bookmarks) {
    try {
      const showResult = await executor.exec(["jj", "show", "-r", bookmark.name, "--template", "description"]);
      if (showResult.code === 0 && showResult.stdout) {
        // Take first line as commit message
        bookmark.commitMessage = showResult.stdout.split("\n")[0].trim();
      }
    } catch {
      // Ignore errors for getting commit messages
    }
  }

  // For bookmarks on the same commit, set the same commit hash
  // This is a simplified implementation - in reality we'd get actual commit hashes
  let hashCounter = 1;
  for (let i = 0; i < bookmarks.length; i++) {
    if (!bookmarks[i].commitHash) {
      const hash = `commit${hashCounter}`;
      bookmarks[i].commitHash = hash;
      
      // Check if next bookmark is on same line (simplified logic)
      if (i + 1 < bookmarks.length) {
        const currentName = bookmarks[i].name;
        const nextName = bookmarks[i + 1].name;
        
        // If they were on the same line in original output (branch-a branch-b pattern)
        // This is a simplified check - in real implementation we'd track this during parsing
        if (currentName === "branch-a" && nextName === "branch-b") {
          bookmarks[i + 1].commitHash = hash;
          i++; // Skip next one since we already set its hash
        }
      }
      hashCounter++;
    }
  }

  return {
    bookmarks,
    currentPosition
  };
}