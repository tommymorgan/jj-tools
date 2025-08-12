# TODO List for jj-stack-prs

## Immediate Tasks

- [ ] Add --version flag to CLI

## Code Improvements

- [ ] Explore simplification opportunities based on jj's internal bookmark management
  - Investigate if we can rely more on jj's automatic bookmark movement instead of manual tracking
  - Consider leveraging jj's built-in remote tracking features for push operations
  - Review if `git.auto-local-bookmark` config could reduce complexity
  - Document which features must remain (auto-bookmark creation, PR chain management, cleanup)

## Release Management

- [ ] Exclude the binary from source control
- [ ] Use GitHub Releases to distribute compiled binaries
- [ ] Use GitHub Actions to build and release binaries automatically

---

*Last Updated: 2025-08-12*