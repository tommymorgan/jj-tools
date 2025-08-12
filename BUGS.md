# jj-stack-prs Bug Report
**Date**: 2025-08-12  
**Tester**: Claude  
**Version**: Latest compiled binary from src/main.ts

## Executive Summary
This document contains bugs and issues discovered during exploratory testing of the jj-stack-prs tool. Testing covered edge cases, error conditions, and various stack configurations. A total of 6 bugs were identified, ranging from minor UI issues to significant functional problems.

## Testing Environment
- Repository: Multiple test repositories created during testing
- Platform: Linux
- Dependencies: jj (Jujutsu), gh (GitHub CLI), Deno runtime
- Testing approach: Exploratory testing with focus on edge cases

## Bugs Found

### 🐛 BUG-001: Broken Pipe Error on Large Output
**Status**: 🔴 Open  
**Severity**: Medium  
**Category**: Output/Display  
**Steps to Reproduce**:
1. Create a stack with 5+ bookmarks
2. Run `jj-stack-prs` or `jj-stack-prs --dry-run`
3. Observe output after PR creation/update messages

**Expected Behavior**:
Full output should be displayed without errors

**Actual Behavior**:
"Broken pipe (os error 32)" error appears, truncating output

**Error Output**:
```
[5/5] 🆕 Creating PR: auto/unbookmarked-change-uosynu → auto/add-settings-xvrxqs
❌ Error: Broken pipe (os error 32)
```

**Impact**:
- Output is truncated but operations complete successfully
- Confusing error message that suggests failure when operations succeeded
- Appears when piping through `head` or when terminal buffer is exceeded

**Suggested Fix**:
- Handle SIGPIPE gracefully
- Catch broken pipe errors and continue silently
- Consider paginating long output

---



### 🐛 BUG-004: Diamond/Merge Patterns Incorrectly Linearized
**Status**: 🔴 Open  
**Severity**: High  
**Category**: Logic/Stack Detection  
**Steps to Reproduce**:
1. Create a diamond pattern:
   - Base commit
   - Two parallel branches from base
   - Merge commit joining the branches
2. Run `jj-stack-prs`
3. Observe the PR chain structure

**Expected Behavior**:
Tool should either:
- Reject diamond patterns with clear error
- Handle parallel branches correctly
- Create separate PR chains for each branch

**Actual Behavior**:
Diamond is incorrectly linearized into a single chain, creating wrong PR dependencies

**Test Output**:
```
[1/4] 🆕 Creating PR: base → master
[2/4] 🆕 Creating PR: left → base
[3/4] 🆕 Creating PR: right → left     # WRONG: should be right → base
[4/4] 🆕 Creating PR: merge-point → right  # WRONG: needs both parents
```

**Impact**:
- Creates incorrect PR dependencies
- PRs cannot be merged in correct order
- Breaks for any non-linear history

**Suggested Fix**:
- Detect non-linear patterns and error out
- Support only linear stacks explicitly
- Add validation for stack linearity
- Document this limitation clearly

---

### 🐛 BUG-005: Deleted Bookmarks Still Appear in Stack Detection
**Status**: 🔴 Open  
**Severity**: Medium  
**Category**: State Management  
**Steps to Reproduce**:
1. Create PRs with auto-bookmarks
2. Close the PRs on GitHub
3. Run `jj-stack-prs` which deletes the bookmarks
4. Run `jj-stack-prs` again immediately
5. Observe that deleted bookmarks still appear with "@origin" suffix

**Expected Behavior**:
Deleted bookmarks should not appear in stack detection

**Actual Behavior**:
Deleted bookmarks appear with "@origin" suffix and tool attempts to create PRs for them

**Test Output**:
```
🧹 Cleaning up auto-bookmarks...
  - auto/add-authentication-qvmssl: PR merged/closed ✓ deleted
🔍 Detecting stack...
📚 Found stack with 5 bookmark(s)
[1/5] 🆕 Creating PR: auto/add-authentication-qvmssl@origin → master
```

**Impact**:
- Confusing behavior after cleanup
- Attempts to create PRs for deleted bookmarks
- May fail when pushing deleted bookmarks

**Suggested Fix**:
- Filter out bookmarks marked as deleted
- Run `jj bookmark forget` after deletion
- Check bookmark status before including in stack

---

### 🐛 BUG-006: No Validation for GitHub Authentication
**Status**: 🔴 Open  
**Severity**: Low  
**Category**: Error Handling  
**Steps to Reproduce**:
1. Set invalid GitHub token: `export GH_TOKEN=invalid`
2. Run `jj-stack-prs`
3. Observe that tool continues without validating auth

**Expected Behavior**:
Tool should validate GitHub authentication early and fail with clear error

**Actual Behavior**:
Tool continues processing and may fail later with unclear errors

**Impact**:
- Wasted processing before auth failure
- Unclear error messages
- May partially complete operations before failing

**Suggested Fix**:
- Add early validation: `gh auth status`
- Check GitHub connectivity before processing
- Provide clear error message about authentication

---

## Additional Observations

### Positive Findings
1. ✅ Handles empty repositories gracefully
2. ✅ Properly truncates long commit messages in auto-bookmarks (30 char limit)
3. ✅ Handles special characters in bookmark names (/, ., -)
4. ✅ Works with deep stacks (tested up to 10 levels)
5. ✅ Handles empty commits without issues
6. ✅ Help text is comprehensive and clear
7. ✅ Dry-run mode works correctly (except for cleanup operations)

### Areas for Improvement
1. 📝 Add progress indicators for long operations
2. 📝 Consider adding --verbose flag for debugging
3. 📝 Add configuration file support for default settings
4. 📝 Improve error messages with suggested fixes
5. 📝 Add --force flag to bypass certain safety checks
6. 📝 Consider adding PR template support

### Edge Cases Handled Well
- Single bookmark stacks
- Empty commits
- Very long commit messages
- Special characters in bookmark names (except spaces, which jj prevents)
- Missing GitHub repo (fails gracefully)

## Testing Coverage

### Tested Scenarios
- ✅ Empty repository
- ✅ Single change
- ✅ Linear stacks (2-10 changes)
- ✅ Special characters in bookmarks
- ✅ Auto-bookmark creation
- ✅ Cleanup functionality
- ✅ Deep stacks (10+ levels)
- ✅ Empty commits
- ✅ Long commit messages
- ✅ Diamond/merge patterns
- ✅ Invalid authentication
- ✅ Dry-run mode
- ✅ Help output

### Not Tested (Future Testing Recommended)
- ⏳ Concurrent execution (multiple users)
- ⏳ Very large stacks (50+ PRs)
- ⏳ Network failures during PR creation
- ⏳ GitHub API rate limiting
- ⏳ PR creation with large diffs
- ⏳ Integration with CI/CD systems
- ⏳ Different git remote configurations
- ⏳ Bookmarks with unicode characters
- ⏳ Stacks with conflicts

## Recommendations

### High Priority Fixes
1. Fix diamond pattern handling (BUG-004)

### Medium Priority Fixes
1. Handle broken pipe errors (BUG-001)
2. Fix deleted bookmark detection (BUG-005)

### Low Priority Fixes
1. Add auth validation (BUG-006)

### Feature Enhancements
1. Make base branch filtering configurable
2. Add verbose/debug mode
3. Support for PR templates
4. Better progress indicators
5. Configuration file support

## Conclusion

The jj-stack-prs tool works well for its primary use case of creating GitHub PRs from linear Jujutsu stacks. The main issues discovered relate to edge cases and non-linear stack patterns. The tool would benefit from:

1. Better input validation and error handling
2. Clearer documentation of limitations (linear stacks only)
3. More robust bookmark management
4. Configurable behavior for base branches and filters

Overall, the tool is functional and useful, but needs refinement for production use, particularly around data safety (not deleting manual bookmarks) and handling of edge cases.