# TODO List for jj-stack-prs

## High Priority Bugs 🔴

### Fix Trunk Filtering (BUG-002)
- [ ] Add "trunk" to the list of filtered base branches in stack_detection.ts
- [ ] Consider making the filtered branch list configurable via CLI flag or config file
- [ ] Add common base branch names: master, main, trunk, develop
- [ ] Write tests for base branch filtering

### Fix Diamond Pattern Handling (BUG-004)
- [ ] Add validation to detect non-linear stack patterns
- [ ] Return clear error message when diamond/merge patterns are detected
- [ ] Document that only linear stacks are supported
- [ ] Add test cases for non-linear pattern detection

### Protect Manual auto/* Bookmarks (BUG-003)
- [ ] Track which bookmarks were auto-created (consider using a `.jj-stack-prs` metadata file)
- [ ] Only delete bookmarks that were created by the tool
- [ ] Alternative: Use a different prefix like `_auto/` or `.auto/`
- [ ] Add warning when manual bookmarks with auto/ prefix are detected

## Medium Priority Bugs 🟡

### Handle Broken Pipe Errors (BUG-001)
- [ ] Catch SIGPIPE and handle gracefully
- [ ] Suppress broken pipe error messages
- [ ] Consider implementing output pagination for large stacks
- [ ] Test with stacks of 20+ PRs

### Fix Deleted Bookmark Detection (BUG-005)
- [ ] Filter out bookmarks marked as deleted (with @origin suffix)
- [ ] Run `jj bookmark forget` after deletion
- [ ] Add proper state management for deleted bookmarks
- [ ] Test cleanup workflow thoroughly

## Low Priority Bugs 🟢

### Add GitHub Authentication Validation (BUG-006)
- [ ] Run `gh auth status` at startup
- [ ] Fail early with clear error message if not authenticated
- [ ] Check repository access before processing
- [ ] Add --skip-auth-check flag for offline testing

## Feature Enhancements 🚀

### Configuration System
- [ ] Add support for `.jj-stack-prs.yml` configuration file
- [ ] Allow configuring default base branch
- [ ] Allow configuring auto-bookmark prefix
- [ ] Support per-repository configuration

### Better Error Handling
- [ ] Add --verbose flag for detailed debug output
- [ ] Improve error messages with suggested fixes
- [ ] Add recovery suggestions for common failures
- [ ] Implement proper error codes for scripting

### PR Template Support
- [ ] Support custom PR templates
- [ ] Allow template configuration per repository
- [ ] Support template variables for stack position, dependencies, etc.
- [ ] Add --template flag to specify template file

### Progress Indicators
- [ ] Add progress bars for long operations
- [ ] Show ETA for large stack processing
- [ ] Add spinner for network operations
- [ ] Support --quiet flag to suppress progress output

### Advanced Features
- [ ] Support for updating PR titles from commit messages
- [ ] Batch operations for large stacks
- [ ] Support for GitLab and Bitbucket (not just GitHub)
- [ ] Add `jj-stack-prs status` command to show current stack state
- [ ] Add `jj-stack-prs merge` command to help merge PRs in order

## Testing Improvements 🧪

### Expand Test Coverage
- [ ] Add integration tests with real jj repositories
- [ ] Test with 50+ PR stacks
- [ ] Add tests for network failure scenarios
- [ ] Test GitHub API rate limiting handling
- [ ] Add performance benchmarks

### Test Infrastructure
- [ ] Set up GitHub Actions for CI/CD
- [ ] Add code coverage reporting
- [ ] Create test fixtures for common scenarios
- [ ] Add mutation testing to verify test quality

## Documentation 📚

### User Documentation
- [ ] Create video tutorial showing workflow
- [ ] Add more examples to README
- [ ] Create troubleshooting guide
- [ ] Document best practices for stacked PRs

### Developer Documentation
- [ ] Add architecture documentation
- [ ] Document the codebase structure
- [ ] Add contribution guidelines
- [ ] Create developer setup guide

## Performance Optimizations ⚡

- [ ] Cache PR information to reduce API calls
- [ ] Parallelize PR creation/updates
- [ ] Optimize stack detection for large repositories
- [ ] Add --batch-size flag for controlling concurrent operations

## Release Management 📦

- [ ] Set up automated releases with GitHub Actions
- [ ] Create binary distributions for major platforms (Linux, macOS, Windows)
- [ ] Add version command: `jj-stack-prs --version`
- [ ] Create changelog automation
- [ ] Set up semantic versioning

## Code Quality 🎨

- [ ] Add pre-commit hooks for formatting and linting
- [ ] Set up Deno fmt and Deno lint in CI
- [ ] Add type checking to CI pipeline
- [ ] Consider migrating to stricter TypeScript settings

## Community 👥

- [ ] Create issue templates for bugs and features
- [ ] Set up discussions for Q&A
- [ ] Add code of conduct
- [ ] Create security policy
- [ ] Add GitHub Sponsors configuration

## Future Ideas 💡

- [ ] Integration with other tools (gh-stack, git-stack)
- [ ] Support for partial stack updates
- [ ] Smart conflict resolution assistance
- [ ] Integration with CI/CD status checks
- [ ] Slack/Discord notifications for PR updates
- [ ] Web UI for visualizing stack state
- [ ] Support for multiple stacks in same repository
- [ ] Auto-rebase functionality when base PRs are merged

---

## Priority Matrix

### Do First (High Impact, Low Effort)
1. Fix trunk filtering
2. Add authentication validation
3. Improve error messages

### Do Next (High Impact, High Effort)
1. Fix diamond pattern handling
2. Protect manual bookmarks
3. Add configuration system

### Do Later (Low Impact, Low Effort)
1. Add version command
2. Fix broken pipe errors
3. Add progress indicators

### Maybe (Low Impact, High Effort)
1. Support other platforms (GitLab, Bitbucket)
2. Web UI
3. Slack/Discord integration

---

*Last Updated: 2025-08-12*
*Generated from exploratory testing session and bug report analysis*