#!/bin/bash

# Fix auto_bookmark_test.ts
sed -i 's/AutoBookmarkManager,/findUnbookmarkedChanges,\n\tgenerateBookmarkName,\n\tcreateAutoBookmark,\n\tfindAutoBookmarks,\n\tcleanupMergedAutoBookmarks,\n\tcleanupOrphanedAutoBookmarks,/' tests/auto_bookmark_test.ts

# Replace new AutoBookmarkManager(mockExecutor) patterns
sed -i 's/const manager = new AutoBookmarkManager(mockExecutor);/\/\/ Using functional API instead of class/' tests/auto_bookmark_test.ts
sed -i 's/const manager = new AutoBookmarkManager({/const mockExecutor = {/' tests/auto_bookmark_test.ts

# Replace manager.findUnbookmarkedChanges() with findUnbookmarkedChanges(mockExecutor)
sed -i 's/manager\.findUnbookmarkedChanges()/findUnbookmarkedChanges(mockExecutor)/g' tests/auto_bookmark_test.ts

# Replace manager.generateBookmarkName with generateBookmarkName
sed -i 's/manager\.generateBookmarkName(/generateBookmarkName(/g' tests/auto_bookmark_test.ts

# Replace manager.createAutoBookmark with createAutoBookmark(mockExecutor,
sed -i 's/manager\.createAutoBookmark(/createAutoBookmark(mockExecutor, /g' tests/auto_bookmark_test.ts

# Replace manager.findAutoBookmarks with findAutoBookmarks(mockExecutor)
sed -i 's/manager\.findAutoBookmarks()/findAutoBookmarks(mockExecutor)/g' tests/auto_bookmark_test.ts

# Replace manager.cleanupMergedAutoBookmarks with cleanupMergedAutoBookmarks(mockExecutor,
sed -i 's/manager\.cleanupMergedAutoBookmarks(/cleanupMergedAutoBookmarks(mockExecutor, /g' tests/auto_bookmark_test.ts

# Replace manager.cleanupOrphanedAutoBookmarks with cleanupOrphanedAutoBookmarks(mockExecutor,
sed -i 's/manager\.cleanupOrphanedAutoBookmarks(/cleanupOrphanedAutoBookmarks(mockExecutor, /g' tests/auto_bookmark_test.ts

# Fix auto_bookmark_overreach_test.ts
sed -i 's/import { AutoBookmarkManager }/import { findUnbookmarkedChanges }/' tests/auto_bookmark_overreach_test.ts
sed -i 's/const manager = new AutoBookmarkManager(mockExecutor);/\/\/ Using functional API/' tests/auto_bookmark_overreach_test.ts
sed -i 's/manager\.findUnbookmarkedChanges()/findUnbookmarkedChanges(mockExecutor)/g' tests/auto_bookmark_overreach_test.ts

# Fix auto_bookmark_revset_test.ts
sed -i 's/import { AutoBookmarkManager }/import { findUnbookmarkedChanges }/' tests/auto_bookmark_revset_test.ts
sed -i 's/const manager = new AutoBookmarkManager(mockExecutor);/\/\/ Using functional API/' tests/auto_bookmark_revset_test.ts
sed -i 's/manager\.findUnbookmarkedChanges()/findUnbookmarkedChanges(mockExecutor)/g' tests/auto_bookmark_revset_test.ts

# Fix pr_description_test.ts
sed -i 's/PRDescriptionGenerator,/generateDescription,\n\textractOriginalBody,\n\tformatPRStatus,\n\tformatChainItem,/' tests/pr_description_test.ts
sed -i 's/const generator = new PRDescriptionGenerator();/\/\/ Using functional API/' tests/pr_description_test.ts
sed -i 's/generator\.generateDescription(/generateDescription(/g' tests/pr_description_test.ts
sed -i 's/generator\.extractOriginalBody(/extractOriginalBody(/g' tests/pr_description_test.ts
sed -i 's/generator\.formatPRStatus(/formatPRStatus(/g' tests/pr_description_test.ts
sed -i 's/generator\.formatChainItem(/formatChainItem(/g' tests/pr_description_test.ts

# Fix pr_manager_test.ts
sed -i 's/PullRequestManager,/findExistingPRs,\n\tcreatePN,\n\tupdatePR,\n\tbuildPRChain,\n\textractPRNumber,/' tests/pr_manager_test.ts
sed -i 's/const manager = new PullRequestManager(mockExecutor);/\/\/ Using functional API/' tests/pr_manager_test.ts
sed -i 's/manager\.findExistingPRs(/findExistingPRs(mockExecutor, /g' tests/pr_manager_test.ts
sed -i 's/manager\.createPR(/createPR(mockExecutor, /g' tests/pr_manager_test.ts
sed -i 's/manager\.updatePR(/updatePR(mockExecutor, /g' tests/pr_manager_test.ts
sed -i 's/manager\.buildPRChain(/buildPRChain(/g' tests/pr_manager_test.ts
sed -i 's/manager\.extractPRNumber(/extractPRNumber(/g' tests/pr_manager_test.ts

echo "Refactoring complete!"