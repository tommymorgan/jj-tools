#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { parseArguments, validateOptions, showHelp } from "./cli.ts";
import { detectStack, CommandExecutor } from "./stack_detection.ts";
import { PullRequestManager } from "./pr_manager.ts";
import { AutoBookmarkManager } from "./auto_bookmark.ts";
import { PRDescriptionGenerator, PRChainInfo } from "./pr_description.ts";

// Real command executor that runs system commands
class SystemCommandExecutor implements CommandExecutor {
  async exec(cmd: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    const command = new Deno.Command(cmd[0], {
      args: cmd.slice(1),
      stdout: "piped",
      stderr: "piped"
    });
    
    const { code, stdout, stderr } = await command.output();
    
    return {
      stdout: new TextDecoder().decode(stdout),
      stderr: new TextDecoder().decode(stderr),
      code
    };
  }
}

async function main() {
  // Parse CLI arguments
  const options = parseArguments(Deno.args);
  
  // Show help if requested
  if (options.help) {
    console.log(showHelp());
    Deno.exit(0);
  }
  
  // Validate options
  const errors = validateOptions(options);
  if (errors.length > 0) {
    console.error("❌ Invalid options:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    Deno.exit(1);
  }
  
  const executor = new SystemCommandExecutor();
  const prManager = new PullRequestManager(executor);
  const autoBookmarkManager = new AutoBookmarkManager(executor);
  const descriptionGenerator = new PRDescriptionGenerator();
  
  try {
    // Step 1: Clean up auto bookmarks if not skipped
    if (!options.keepAuto) {
      console.log("🧹 Cleaning up auto-bookmarks...");
      const autoBookmarks = await autoBookmarkManager.findAutoBookmarks();
      
      if (options.cleanupAllAuto) {
        // Force cleanup all auto bookmarks
        for (const bookmark of autoBookmarks) {
          if (!options.dryRun) {
            await executor.exec(["jj", "bookmark", "delete", bookmark]);
          }
          console.log(`  - Deleted: ${bookmark}`);
        }
      } else if (autoBookmarks.length > 0) {
        // Normal cleanup - check for merged/closed PRs
        const cleanupResult = await autoBookmarkManager.cleanupMergedAutoBookmarks(autoBookmarks);
        for (const deleted of cleanupResult.deleted) {
          console.log(`  - ${deleted}: PR merged/closed ✓ deleted`);
        }
      }
    }
    
    // Step 2: Handle unbookmarked changes if auto-bookmark is enabled
    if (options.autoBookmark) {
      console.log("🔍 Checking for unbookmarked changes...");
      const unbookmarked = await autoBookmarkManager.findUnbookmarkedChanges();
      
      if (unbookmarked.length > 0) {
        console.log(`⚠️  Found ${unbookmarked.length} unbookmarked change(s)`);
        
        for (const change of unbookmarked) {
          console.log(`  - ${change.changeId}: ${change.description}`);
          
          if (!options.dryRun) {
            const autoBookmark = await autoBookmarkManager.createAutoBookmark(change);
            console.log(`  🔖 Created auto-bookmark: ${autoBookmark.name}`);
          } else {
            const bookmarkName = autoBookmarkManager.generateBookmarkName(
              change.description,
              change.changeId
            );
            console.log(`  🔖 Would create: ${bookmarkName}`);
          }
        }
      }
    }
    
    // Step 3: Detect stack
    console.log("🔍 Detecting stack...");
    const stack = await detectStack(executor, options.baseBranch);
    
    // Check if we have bookmarks
    if (stack.bookmarks.length === 0) {
      if (!options.autoBookmark) {
        console.error("❌ No bookmarks found in current stack!");
        console.error("\nCreate bookmarks for your changes. Examples:");
        console.error("  jj bookmark create <name> -r @   # for current change");
        console.error("  jj bookmark create <name> -r @-  # for previous change");
        console.error("  jj bookmark create <name> -r @-- # for change before that");
        console.error("\nOr use --auto-bookmark to automatically create bookmarks");
        Deno.exit(1);
      } else if (options.dryRun) {
        console.log("\n✨ Dry run complete. Would have created auto-bookmarks and PRs.");
        Deno.exit(0);
      } else {
        console.error("❌ No bookmarks found after auto-bookmark creation!");
        Deno.exit(1);
      }
    }
    
    console.log(`📚 Found stack with ${stack.bookmarks.length} bookmark(s)`);
    
    // Step 4: Push bookmarks to GitHub
    console.log("🚀 Pushing bookmarks to GitHub...");
    if (!options.dryRun) {
      const pushResult = await executor.exec(["jj", "git", "push", "--all"]);
      if (pushResult.code !== 0) {
        console.error("❌ Failed to push bookmarks:", pushResult.stderr);
        Deno.exit(1);
      }
    } else {
      console.log("  (dry-run: would push all bookmarks)");
    }
    
    // Step 5: Find existing PRs
    console.log("🔗 Building PR chain...");
    const existingPRs = await prManager.findExistingPRs(stack.bookmarks);
    
    // Step 6: Build PR chain
    const prChain = await prManager.buildPRChain(
      stack.bookmarks,
      existingPRs,
      options.baseBranch
    );
    
    // Step 7: Create or update PRs
    const createdPRs: PRChainInfo[] = [];
    let prCount = 0;
    
    for (let i = 0; i < prChain.length; i++) {
      const pr = prChain[i];
      prCount++;
      
      const isBottom = i === 0;
      const isDraft = !isBottom; // Only bottom PR is ready for review
      
      if (pr.existingPR) {
        // Update existing PR
        console.log(`[${prCount}/${prChain.length}] 🔄 Updating PR #${pr.existingPR.number}: ${pr.bookmark} → ${pr.base}`);
        
        if (!options.dryRun) {
          // Check if base needs updating
          if (pr.existingPR.baseRefName !== pr.base) {
            await prManager.updatePR({
              prNumber: pr.existingPR.number,
              base: pr.base
            });
            console.log(`  📝 Updated base: ${pr.existingPR.baseRefName} → ${pr.base}`);
          }
          
          createdPRs.push({
            bookmark: pr.bookmark,
            base: pr.base,
            prNumber: pr.existingPR.number,
            isDraft: pr.existingPR.isDraft,
            isReady: !pr.existingPR.isDraft
          });
        }
        
        console.log(`  ✅ Updated PR #${pr.existingPR.number}`);
      } else {
        // Create new PR
        console.log(`[${prCount}/${prChain.length}] 🆕 Creating PR: ${pr.bookmark} → ${pr.base}`);
        
        if (!options.dryRun) {
          const prNumber = await prManager.createPR({
            title: pr.title,
            body: `Initial PR for ${pr.bookmark}`,
            head: pr.bookmark,
            base: pr.base,
            draft: isDraft
          });
          
          createdPRs.push({
            bookmark: pr.bookmark,
            base: pr.base,
            prNumber,
            isDraft,
            isReady: !isDraft
          });
          
          const status = isDraft ? "draft" : "ready for review";
          console.log(`  ✅ Created PR #${prNumber} (${status})`);
        } else {
          console.log(`  (dry-run: would create ${isDraft ? "draft" : "ready"} PR)`);
        }
      }
    }
    
    // Step 8: Update PR descriptions with chain visualization
    if (!options.dryRun && createdPRs.length > 0) {
      console.log("📝 Updating PR descriptions...");
      
      for (let i = 0; i < createdPRs.length; i++) {
        const pr = createdPRs[i];
        
        if (pr.prNumber) {
          // Get current PR body
          const viewResult = await executor.exec([
            "gh", "pr", "view", pr.prNumber.toString(), "--json", "body"
          ]);
          
          let originalBody = "";
          if (viewResult.code === 0) {
            try {
              const prData = JSON.parse(viewResult.stdout);
              originalBody = descriptionGenerator.extractOriginalBody(prData.body || "");
            } catch {
              // Ignore parse errors
            }
          }
          
          // Generate new description
          const description = descriptionGenerator.generateDescription({
            currentPR: pr,
            fullChain: createdPRs,
            position: i + 1,
            originalBody
          });
          
          // Update PR description
          await prManager.updatePR({
            prNumber: pr.prNumber,
            body: description
          });
        }
      }
    }
    
    // Step 9: Show summary
    console.log("\n✨ Stack PRs created with full chain visualization!");
    
    if (!options.dryRun) {
      const createdCount = createdPRs.filter(pr => !existingPRs.has(pr.bookmark)).length;
      const updatedCount = createdPRs.filter(pr => existingPRs.has(pr.bookmark)).length;
      const readyCount = createdPRs.filter(pr => pr.isReady).length;
      const draftCount = createdPRs.filter(pr => pr.isDraft).length;
      
      console.log("\n📊 Summary:");
      if (createdCount > 0) console.log(`  • Created: ${createdCount} new PR(s)`);
      if (updatedCount > 0) console.log(`  • Updated: ${updatedCount} existing PR(s)`);
      console.log(`  • Ready for review: ${readyCount}`);
      console.log(`  • Drafts: ${draftCount}`);
      
      console.log("\nView your stack:");
      console.log("  gh pr list --author @me --state open");
      console.log("\nView in browser:");
      console.log("  gh pr list --author @me --state open --web");
    }
    
  } catch (error) {
    console.error("❌ Error:", error instanceof Error ? error.message : String(error));
    if (options.dryRun) {
      console.error("(This was a dry run - no changes were made)");
    }
    Deno.exit(1);
  }
}

// Run main function
if (import.meta.main) {
  await main();
}