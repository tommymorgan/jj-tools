# jj-stack-prs

A command-line tool for creating GitHub Pull Requests from your Jujutsu (jj) stack of changes. Automatically manages PR dependencies, maintains chain visualizations, and handles the complexity of stacked PRs.

## Features

- 🔗 **Automatic PR Chain Management** - Creates PRs with proper dependencies based on your jj stack
- 📊 **Visual Stack Representation** - Each PR includes a visualization of the entire PR chain
- 🔖 **Auto-Bookmarking** - Automatically creates bookmarks for unbookmarked changes
- 🧹 **Smart Cleanup** - Automatically removes temporary bookmarks when PRs are merged
- 🔄 **Incremental Updates** - Updates existing PRs instead of creating duplicates
- 🎯 **Draft/Ready States** - Bottom PR is ready for review, dependent PRs are drafts
- 🚀 **Fast and Efficient** - Built with Deno for quick execution

## Installation

### Prerequisites

- [Jujutsu (jj)](https://github.com/martinvonz/jj) - Version control system
- [GitHub CLI (gh)](https://cli.github.com/) - Authenticated with your GitHub account
- [Deno](https://deno.land/) - JavaScript/TypeScript runtime (for development)

### Download Binary

Download the latest binary from the [releases page](https://github.com/tommymorgan/jj-tools/releases) and add it to your PATH.

### Build from Source

```bash
# Clone the repository
git clone https://github.com/tommymorgan/jj-tools.git
cd jj-tools

# Install dependencies and compile
deno compile --allow-run --allow-read --allow-write --allow-env \
  --output=jj-stack-prs src/main.ts

# Move to your PATH
sudo mv jj-stack-prs /usr/local/bin/
```

## Usage

### Basic Usage

```bash
# Create PRs for your current stack
jj-stack-prs

# Use a different base branch
jj-stack-prs --base develop

# Auto-create bookmarks for unbookmarked changes
jj-stack-prs --auto-bookmark

# Preview what would be done
jj-stack-prs --dry-run
```

### Workflow Example

1. Create your changes with jj:
```bash
jj new -m "feat: add authentication"
echo "auth code" > auth.js
jj new -m "feat: add user profiles" 
echo "profile code" > profile.js
jj new -m "feat: add settings"
echo "settings code" > settings.js
```

2. Create bookmarks for your changes:
```bash
jj bookmark create feature-auth -r @--
jj bookmark create feature-profile -r @-
jj bookmark create feature-settings -r @
```

3. Create PRs for the entire stack:
```bash
jj-stack-prs
```

This creates:
- PR #1: feature-auth → master (ready for review)
- PR #2: feature-profile → feature-auth (draft)
- PR #3: feature-settings → feature-profile (draft)

### Auto-Bookmarking

If you have unbookmarked changes in your stack:

```bash
jj-stack-prs --auto-bookmark
```

This will:
1. Detect unbookmarked changes
2. Create temporary bookmarks with the prefix `auto/`
3. Create PRs for all changes
4. Clean up auto-bookmarks when PRs are merged

### Command-Line Options

| Option | Description |
|--------|-------------|
| `--base <branch>` | Set the base branch for the bottom of the stack (default: master) |
| `--auto-bookmark` | Automatically create bookmarks for unbookmarked changes |
| `--keep-auto` | Skip automatic cleanup of auto/* bookmarks |
| `--cleanup-all-auto` | Force cleanup of all auto/* bookmarks |
| `--dry-run` | Show what would be done without making changes |
| `-h, --help` | Show help message |

## How It Works

1. **Stack Detection**: Uses `jj log` to detect all bookmarks in your current stack
2. **PR Management**: Uses GitHub CLI to create or update PRs
3. **Chain Visualization**: Adds a visualization of the entire PR chain to each PR description
4. **Auto-Cleanup**: Monitors PR status and cleans up temporary bookmarks when PRs are merged

### PR Chain Visualization

Each PR includes a visualization like this:

```
Stack position: 2 of 3
Base: `feature-auth`
Depends on: #1

---
Full chain of PRs as of 2024-01-15:
• PR #1: feature-auth → master (ready for review)
• **PR #2: feature-profile → feature-auth (draft)**
• PR #3: feature-settings → feature-profile (draft)
```

## Development

### Project Structure

```
jj-tools/
├── src/
│   ├── main.ts              # Entry point
│   ├── stack_detection.ts   # Jujutsu stack detection
│   ├── pr_manager.ts        # GitHub PR management
│   ├── auto_bookmark.ts     # Auto-bookmarking logic
│   ├── pr_description.ts    # PR description generation
│   └── cli.ts              # CLI argument parsing
├── tests/                   # Test files
└── jj-stack-prs.feature    # Gherkin specifications
```

### Running Tests

```bash
# Run all tests
deno test

# Run specific test file
deno test tests/stack_detection_test.ts

# Run with coverage
deno test --coverage
```

### Building

```bash
# Compile the binary
deno compile --allow-run --allow-read --allow-write --allow-env \
  --output=jj-stack-prs src/main.ts
```

## Known Limitations

- Only supports linear stacks (no diamond/merge patterns)
- Requires GitHub CLI authentication
- Auto-bookmarks use the `auto/` prefix (avoid creating manual bookmarks with this prefix)
- Currently only supports GitHub (not GitLab, Bitbucket, etc.)

## Troubleshooting

### "No bookmarks found in current stack!"
- Ensure you have bookmarks created for your changes
- Use `--auto-bookmark` to automatically create bookmarks

### "Broken pipe" error
- This is a display issue that occurs with large output
- The operations complete successfully despite the error

### PRs not updating
- Ensure you're authenticated with GitHub CLI: `gh auth status`
- Check that the remote repository exists and you have push access

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

See [BUGS.md](BUGS.md) for known issues that need fixing.

## License

MIT License - see [LICENSE](LICENSE) file for details

## Credits

Created by [Tommy Morgan](https://github.com/tommymorgan)

Built with:
- [Deno](https://deno.land/) - Runtime and tooling
- [Jujutsu](https://github.com/martinvonz/jj) - Version control system
- [GitHub CLI](https://cli.github.com/) - GitHub interaction

## Related Projects

- [jj](https://github.com/martinvonz/jj) - The Jujutsu version control system
- [gh-stack](https://github.com/timothyandrew/gh-stack) - Similar tool for git
- [git-stack](https://github.com/magus/git-stack) - Another stacked PR tool for git