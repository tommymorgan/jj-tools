# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development
```bash
# Run the tool
deno run --allow-run --allow-read --allow-write --allow-env src/main.ts

# Run tests
deno test --allow-run --allow-read --allow-write --allow-env

# Run specific test file
deno test --allow-run --allow-read --allow-write --allow-env tests/stack_detection_test.ts

# Watch mode for tests
deno test --allow-run --allow-read --allow-write --allow-env --watch

# Compile binary
deno compile --allow-run --allow-read --allow-write --allow-env --output jj-stack-prs src/main.ts
```

### Linting and Type Checking
Currently, this project does not have Biome configured for linting. The TODO.md file indicates Biome should be installed for code formatting and linting.

## Architecture

This is a TypeScript/Deno CLI tool that creates GitHub PRs from Jujutsu (jj) version control stacks. The architecture follows a modular design with clear separation of concerns:

### Core Modules

1. **main.ts** - Entry point that orchestrates the entire workflow:
   - Handles CLI argument parsing
   - Manages the execution flow (cleanup → auto-bookmark → detect stack → push → create/update PRs)
   - Coordinates between all other modules

2. **stack_detection.ts** - Detects and analyzes the jj stack:
   - Uses `jj log` to find bookmarks in the current stack
   - Builds the dependency chain between bookmarks
   - Filters out base branches (master/main)

3. **pr_manager.ts** - Manages GitHub PR operations:
   - Creates new PRs using GitHub CLI (`gh`)
   - Updates existing PRs
   - Finds existing PRs for bookmarks
   - Builds PR chains with proper dependencies

4. **auto_bookmark.ts** - Handles automatic bookmark creation:
   - Detects unbookmarked changes in the stack
   - Creates auto-prefixed bookmarks (`auto/*`)
   - Cleans up auto-bookmarks when PRs are merged/closed
   - Manages bookmark lifecycle

5. **pr_description.ts** - Generates PR descriptions:
   - Creates chain visualizations showing the entire PR stack
   - Maintains original PR body content
   - Updates descriptions with current stack position

6. **cli.ts** - CLI argument parsing and validation:
   - Handles command-line flags (--base, --auto-bookmark, --dry-run, etc.)
   - Provides help text
   - Validates option combinations

### Key Design Patterns

- **CommandExecutor Interface**: Abstracts command execution for testing (allows mocking of system commands)
- **Dry-Run Support**: All destructive operations check the dry-run flag
- **Chain Visualization**: Each PR includes a visual representation of the entire stack
- **Auto-Cleanup**: Temporary bookmarks are automatically removed when PRs merge

### Testing Structure

Tests are organized by module in the `tests/` directory. The project uses Deno's built-in testing framework with BDD-style tests. Test files follow the pattern `*_test.ts` and use mock implementations of the CommandExecutor interface for isolation.

### Known Issues (from BUGS.md)

- **BUG-002**: "trunk" bookmark is not filtered (should be treated like "master")
- **BUG-004**: Diamond/merge patterns are incorrectly linearized (only linear stacks are properly supported)
- **BUG-003**: Manual bookmarks with `auto/` prefix are deleted during cleanup

## Important Notes

- The tool only supports linear stacks - diamond/merge patterns will be incorrectly handled
- Requires GitHub CLI (`gh`) to be authenticated
- Auto-bookmarks use the `auto/` prefix - avoid creating manual bookmarks with this prefix
- The tool pushes all bookmarks to GitHub before creating PRs