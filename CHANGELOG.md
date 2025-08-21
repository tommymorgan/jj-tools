# Changelog

## [Unreleased]
<!-- Test edit for push verification -->

### Fixed
- **Critical: Prevent duplicate/broken PR stacks** - Fixed a bug where updating a PR in the middle or bottom of a stack would break the chain and create duplicate stacks. The tool now correctly detects the complete PR chain even when only part of the stack is in the local working directory. This ensures that PRs maintain their chain relationships and are never duplicated across multiple stacks.
  - `findExistingPRs` now fetches ALL open PRs by the user, not just those matching local bookmarks
  - `buildPRChain` detects and includes dependent PRs (PRs that depend on bookmarks in the local stack)
  - `buildPRChain` detects and includes dependency PRs (PRs that the local bookmarks depend on)
  - Added comprehensive test coverage for PR chain detection from any position in the stack