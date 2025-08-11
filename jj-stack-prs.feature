Feature: jj-stack-prs - Create GitHub PRs from Jujutsu stack
  As a developer using Jujutsu version control
  I want to create GitHub PRs from my stack of changes
  So that I can maintain proper PR dependencies and visualizations

  Background:
    Given I have a Jujutsu repository with GitHub remote
    And I am authenticated with GitHub CLI
    And the default base branch is "master"

  Scenario: Successfully create PRs from a simple stack
    Given I have a stack with 3 bookmarks:
      | bookmark_name | commit_message               | position |
      | feature-1     | feat: add user authentication | bottom   |
      | feature-2     | feat: add user profile        | middle   |
      | feature-3     | feat: add user settings       | top      |
    When I run "jj-stack-prs"
    Then 3 PRs should be created on GitHub
    And the bottom PR "feature-1" should be ready for review
    And the middle PR "feature-2" should be in draft state
    And the top PR "feature-3" should be in draft state
    And each PR should have the correct base branch:
      | pr_branch | base_branch |
      | feature-1 | master      |
      | feature-2 | feature-1   |
      | feature-3 | feature-2   |
    And each PR description should contain the full chain visualization

  Scenario: Create PRs with custom base branch
    Given I have a stack with 2 bookmarks:
      | bookmark_name | commit_message          |
      | fix-1        | fix: resolve bug in API |
      | fix-2        | fix: improve error msg  |
    When I run "jj-stack-prs --base develop"
    Then 2 PRs should be created with "develop" as the initial base
    And the PR chain should be:
      | pr_branch | base_branch |
      | fix-1     | develop     |
      | fix-2     | fix-1       |

  Scenario: Handle existing PRs in the stack
    Given I have a stack with 2 bookmarks:
      | bookmark_name | commit_message     |
      | update-1     | chore: update deps |
      | update-2     | chore: fix tests   |
    And PR #123 already exists for "update-1"
    When I run "jj-stack-prs"
    Then the existing PR #123 should be found and updated
    And a new PR should be created for "update-2"
    And both PRs should have updated descriptions with the full chain

  Scenario: Error when no bookmarks found in stack
    Given I have changes without any bookmarks
    When I run "jj-stack-prs"
    Then the command should exit with code 1
    And the error message should say "No bookmarks found in current stack!"
    And helpful instructions should be displayed:
      """
      Create bookmarks for your changes. Examples:
        jj bookmark create <name> -r @   # for current change
        jj bookmark create <name> -r @-  # for previous change
        jj bookmark create <name> -r @-- # for change before that
      """

  Scenario: Push all bookmarks before creating PRs
    Given I have a stack with 2 bookmarks that haven't been pushed
      | bookmark_name | commit_message        |
      | new-1        | feat: add new feature |
      | new-2        | test: add tests       |
    When I run "jj-stack-prs"
    Then "jj git push --all" should be executed first
    And then PRs should be created for both bookmarks

  Scenario: Handle multiple bookmarks on the same commit
    Given I have multiple bookmarks pointing to the same commit:
      | bookmark_name | commit_hash |
      | branch-a     | abc123      |
      | branch-b     | abc123      |
      | branch-c     | def456      |
    When I run "jj-stack-prs"
    Then each bookmark should get its own PR
    And the stack should be properly ordered

  Scenario: Update PR descriptions with chain visualization
    Given I have a stack with 3 bookmarks and PRs are created
    When the PR descriptions are updated
    Then each PR description should contain:
      | section                    | content                                |
      | Stack position            | "Stack position: X of Y"               |
      | Base branch               | "Base: `branch_name`"                  |
      | Dependencies              | "Depends on: `branch_name`" (if not bottom) |
      | Full chain header         | "Full chain of PRs as of YYYY-MM-DD"   |
      | Chain visualization       | Bulleted list with arrows              |
      | Current PR highlighting   | Bold formatting for current PR         |
      | Footer                    | "Created with jj (Jujutsu) stack-prs"  |

  Scenario: Handle PR creation failures gracefully
    Given I have a stack with 2 bookmarks
    And GitHub API returns an error for the second PR creation
    When I run "jj-stack-prs"
    Then the first PR should be created successfully
    And a warning should be shown for the failed PR
    And the chain visualization should still include the failed branch

  Scenario: Detect stack from middle position
    Given I am currently positioned in the middle of a stack
    And there are bookmarks both above and below my position:
      | bookmark_name | relative_position |
      | bottom-1     | ancestor          |
      | middle-1     | current (@)       |
      | top-1        | descendant        |
    When I run "jj-stack-prs"
    Then the full stack should be detected (not just from current position)
    And all 3 PRs should be created in the correct order

  Scenario: Filter out base branch from bookmarks
    Given I have a stack that includes the base branch "master"
    And bookmarks include:
      | bookmark_name |
      | master       |
      | feature-1    |
      | feature-2    |
    When I run "jj-stack-prs"
    Then "master" should be excluded from the PR creation
    And only "feature-1" and "feature-2" should have PRs created

  Scenario: Handle bookmarks with asterisk marking
    Given jj log shows bookmarks with current position marked:
      | bookmark_display |
      | feature-1*      |
      | feature-2       |
    When I run "jj-stack-prs"
    Then the asterisk should be removed during processing
    And PRs should be created for "feature-1" and "feature-2"

  Scenario: Display progress information
    Given I have a stack with 4 bookmarks
    When I run "jj-stack-prs"
    Then I should see progress messages:
      | stage                | message_pattern                        |
      | Detection           | "🔍 Detecting stack..."                |
      | Stack found         | "📚 Found stack with 4 bookmarks"      |
      | Pushing             | "🚀 Pushing bookmarks to GitHub..."    |
      | Chain building      | "🔗 Building PR chain..."              |
      | PR creation         | "[X/4] Creating PR: branch → base"     |
      | PR success          | "✅ Created PR #XXX (ready/draft)"     |
      | Description update  | "📝 Updating PR descriptions..."       |
      | Completion          | "✨ Stack PRs created with full chain" |

  Scenario: Provide helpful next steps
    Given I have successfully created PRs from my stack
    When the command completes
    Then I should see suggested commands:
      """
      View your stack:
        gh pr list --author @me --state open
      
      View in browser:
        gh pr list --author @me --state open --web
      """

  Scenario: Handle empty bookmark lines
    Given jj log returns output with empty lines:
      """
      feature-1
      
      feature-2
      
      """
    When I run "jj-stack-prs"
    Then empty lines should be filtered out
    And only valid bookmarks should be processed

  Scenario: Preserve commit messages as PR titles
    Given I have bookmarks with specific commit messages:
      | bookmark_name | first_line_of_description          |
      | impl-1       | feat(auth): implement JWT tokens    |
      | impl-2       | test(auth): add integration tests   |
      | impl-3       | docs(auth): update API documentation |
    When I run "jj-stack-prs"
    Then each PR should use the first line of the commit description as its title
    And the PR titles should be:
      | pr_number | title                                |
      | 1         | feat(auth): implement JWT tokens    |
      | 2         | test(auth): add integration tests   |
      | 3         | docs(auth): update API documentation |

  Scenario: Handle special characters in branch names
    Given I have bookmarks with special characters:
      | bookmark_name          |
      | feature/user-auth     |
      | bugfix/issue-123      |
      | hotfix/security-patch |
    When I run "jj-stack-prs"
    Then all branch names should be handled correctly
    And PRs should be created without escaping issues

  Scenario: Update existing PR without duplicating
    Given PR #456 already exists for bookmark "feature-x"
    When I run "jj-stack-prs" multiple times
    Then the existing PR #456 should be updated, not duplicated
    And the PR description should reflect the latest chain state

  # TODO: Complete implementation for the following scenarios

  Scenario: Avoid creating duplicate PRs when base branch changes
    Given PR #100 exists for "feature-a" with base "master"
    And I add a new change "feature-b" between "master" and "feature-a"
    When I run "jj-stack-prs"
    Then PR #100 should be updated with new base "feature-b"
    And no duplicate PR should be created for "feature-a"
    And the command should detect existing PRs by:
      | detection_method | value                                    |
      | head_branch     | Match by bookmark/branch name            |
      | pr_state        | Consider open and draft PRs              |
      | author          | Current user (@me)                       |
    And when updating PR #100:
      | update_action   | description                              |
      | base_change     | Use gh pr edit #100 --base feature-b    |
      | description     | Update with new chain visualization     |
      | draft_status    | Keep as draft since base changed        |
    And the output should show:
      """
      🔄 PR #100 exists for feature-a (base was: master)
      📝 Updating PR #100 base: master → feature-b
      ✅ Updated PR #100 (kept as draft due to base change)
      """

  Scenario: Auto-create bookmarks for unbookmarked changes
    Given I have a stack with changes:
      | change_id | has_bookmark | description                    |
      | abc123    | yes         | feat: add authentication       |
      | def456    | no          | feat: add user profiles        |
      | ghi789    | yes         | feat: add user settings        |
    When I run "jj-stack-prs --auto-bookmark"
    Then a temporary bookmark should be created for change "def456"
    And the auto-generated bookmark name should be based on the commit message
    And all 3 changes should have PRs created
    And the auto-generated bookmark naming convention should be:
      | component       | format                                      | example                    |
      | prefix          | "auto/"                                     | auto/                      |
      | feature_name    | slugified first 30 chars of commit message | add-user-profiles          |
      | uniquifier      | first 6 chars of change_id                 | def456                     |
      | full_name       | prefix + feature_name + "-" + uniquifier   | auto/add-user-profiles-def456 |
    And the cleanup strategy for temporary bookmarks should be:
      | cleanup_trigger | action                                           |
      | PR merged       | Delete auto/* bookmark after successful merge   |
      | PR closed       | Prompt user to delete or keep bookmark          |
      | Manual cleanup  | jj-stack-prs --cleanup-auto-bookmarks          |
      | Age-based       | Warn about auto/* bookmarks older than 30 days |
    And the output should show:
      """
      🔍 Detecting stack...
      ⚠️  Found unbookmarked change: def456 (feat: add user profiles)
      🔖 Creating auto-bookmark: auto/add-user-profiles-def456
      📚 Found stack with 3 changes (1 auto-bookmarked)
      """

  Scenario: Handle stack structure changes without duplicating PRs
    Given I have an existing PR stack:
      | pr_number | bookmark  | base      |
      | 101       | feature-1 | master    |
      | 102       | feature-2 | feature-1 |
      | 103       | feature-3 | feature-2 |
    And I reorder the stack to:
      | bookmark  | new_base  |
      | feature-2 | master    |
      | feature-1 | feature-2 |
      | feature-3 | feature-1 |
    When I run "jj-stack-prs"
    Then existing PRs should be updated with new bases
    And no duplicate PRs should be created
    And the detection strategy for existing PRs should be:
      | step | action                                                              |
      | 1    | Run "gh pr list --author @me --state open --json number,headRefName,baseRefName" |
      | 2    | Build a map of bookmark_name → pr_number                          |
      | 3    | Check each bookmark in stack against the map                      |
      | 4    | Mark PRs as "needs_update" if base changed                       |
    And PR number references in descriptions should be handled by:
      | reference_type    | update_strategy                                         |
      | Direct PR links   | Update #101 → #101 (keep same, GitHub auto-links)     |
      | Base PR mention   | Update "Depends on #102" based on new chain order      |
      | Chain viz bullets | Regenerate entire chain with current PR numbers        |
      | Status indicators | Update (ready/draft) based on current PR states        |
    And the update process should be:
      | pr_number | action                                              |
      | 101       | gh pr edit 101 --base feature-2                   |
      | 102       | gh pr edit 102 --base master                      |
      | 103       | No base change needed (still feature-1)           |
    And all PR descriptions should be regenerated with:
      """
      Full chain of PRs as of [current date]:
      • PR #102: feature-2 → master (draft)
      • PR #101: feature-1 → feature-2 (draft)
      • PR #103: feature-3 → feature-1 (draft)
      """

  Scenario: Auto-delete temporary bookmarks when no longer needed
    Given I created PRs with temporary bookmarks:
      | bookmark_name         | pr_number | is_temporary |
      | feature-auth         | 201       | no           |
      | auto/user-prof-abc123| 202       | yes          |
      | auto/settings-def456 | 203       | yes          |
    When I run "jj-stack-prs" after PRs have been merged
    Then temporary bookmarks should be automatically deleted
    And permanent bookmarks should be retained
    And auto-deletion should occur when:
      | trigger_condition   | action                                                       |
      | PR merged          | Auto-delete bookmark when detected as merged                |
      | PR closed          | Auto-delete bookmark when PR closed without merging         |
      | Bookmark orphaned  | Auto-delete when bookmark no longer in active stack         |
      | Stack rebuilt      | Auto-delete unused auto/* bookmarks from previous runs      |
    And the auto-deletion process should:
      | step | action                                                          |
      | 1    | Check all auto/* bookmarks at start of jj-stack-prs          |
      | 2    | Query PR status: gh pr view <branch> --json state            |
      | 3    | Delete if PR state is MERGED or CLOSED                       |
      | 4    | Delete orphaned auto/* not in current stack                  |
      | 5    | Report deletions in output                                   |
    And safety measures should include:
      | safety_type        | description                                          |
      | prefix_check      | Only auto-delete bookmarks with "auto/" prefix      |
      | state_verification| Verify PR state before deletion                     |
      | no_prompts        | Auto-deletion happens silently (it's expected)     |
      | preserve_manual   | Never auto-delete user-created bookmarks            |
    And the output should show:
      """
      🔍 Detecting stack...
      🧹 Cleaning up auto-bookmarks...
        - auto/user-prof-abc123: PR #202 merged ✓ deleted
        - auto/settings-def456: PR #203 merged ✓ deleted
      📚 Found stack with 1 bookmark
      """
    And manual cleanup should still be available via:
      | command                           | purpose                                |
      | jj-stack-prs --cleanup-all-auto | Force cleanup of all auto/* bookmarks |
      | jj-stack-prs --keep-auto        | Skip auto-cleanup for this run        |

  Scenario: Differentiate between creating and updating PRs in output
    Given I have a stack with:
      | bookmark  | has_existing_pr | pr_number |
      | feature-1 | yes            | 301       |
      | feature-2 | no             | -         |
      | feature-3 | yes            | 303       |
    When I run "jj-stack-prs"
    Then the output should show:
      | action    | message_pattern                           |
      | update    | "[1/3] Updating PR #301: feature-1 → master"    |
      | create    | "[2/3] Creating PR: feature-2 → feature-1"      |
      | update    | "[3/3] Updating PR #303: feature-3 → feature-2" |
    And success messages should differentiate:
      | action    | message_pattern                    |
      | update    | "✅ Updated PR #301"              |
      | create    | "✅ Created PR #302 (draft)"      |
      | update    | "✅ Updated PR #303"              |
    And the detection of existing PRs should happen by:
      | step | action                                                                |
      | 1    | Query all open PRs: gh pr list --author @me --state open --json number,headRefName,baseRefName,isDraft |
      | 2    | Build map: bookmark_name → {pr_number, base, isDraft}               |
      | 3    | For each bookmark in stack, check if exists in map                  |
      | 4    | Set action="update" if found, action="create" if not found          |
    And different icons/prefixes should be used:
      | action         | icon | verb      | color_code  | example                               |
      | create_ready   | 🆕   | Creating  | green       | "🆕 Creating PR: feature-1 → master" |
      | create_draft   | 📝   | Creating  | yellow      | "📝 Creating draft PR: feature-2 → feature-1" |
      | update_ready   | 🔄   | Updating  | blue        | "🔄 Updating PR #301: feature-1 → master" |
      | update_draft   | 📝   | Updating  | yellow      | "📝 Updating draft PR #303: feature-3 → feature-2" |
      | update_base    | 🔀   | Rebasing  | orange      | "🔀 Updating PR #301 base: master → develop" |
      | skip_unchanged | ⏭️    | Skipping  | gray        | "⏭️  PR #301 unchanged, skipping" |
      | error          | ❌   | Failed    | red         | "❌ Failed to create PR: feature-2" |
    And the summary at the end should show:
      """
      ✨ Stack PRs processed:
        • Created: 1 new PR
        • Updated: 2 existing PRs  
        • Ready for review: 1 (bottom of stack)
        • Drafts: 2 (waiting on dependencies)
      
      View your stack:
        gh pr list --author @me --state open
      """