import { parse } from "@std/flags";

export interface CLIOptions {
	baseBranch?: string;
	noAutoBookmark: boolean;
	keepAuto: boolean;
	cleanupAllAuto: boolean;
	help: boolean;
	version: boolean;
	dryRun: boolean;
	verbose: boolean;
}

export function parseArguments(args: string[]): CLIOptions {
	const flags = parse(args, {
		string: ["base"],
		boolean: [
			"no-auto-bookmark",
			"keep-auto",
			"cleanup-all-auto",
			"help",
			"version",
			"dry-run",
			"verbose",
		],
		alias: {
			h: "help",
			b: "base",
		},
		default: {
			"no-auto-bookmark": false,
			"keep-auto": false,
			"cleanup-all-auto": false,
			help: false,
			version: false,
			"dry-run": false,
			verbose: false,
		},
	});

	return {
		baseBranch: flags.base as string | undefined,
		noAutoBookmark: flags["no-auto-bookmark"] as boolean,
		keepAuto: flags["keep-auto"] as boolean,
		cleanupAllAuto: flags["cleanup-all-auto"] as boolean,
		help: flags.help as boolean,
		version: flags.version as boolean,
		dryRun: flags["dry-run"] as boolean,
		verbose: flags.verbose as boolean,
	};
}

export function validateOptions(options: CLIOptions): string[] {
	const errors: string[] = [];

	// Check for conflicting options
	if (options.keepAuto && options.cleanupAllAuto) {
		errors.push("Cannot use --keep-auto and --cleanup-all-auto together");
	}

	// Base branch is now optional (will be auto-detected if not provided)

	return errors;
}

export function showHelp(): string {
	return `jj-stack-prs - Create GitHub PRs from Jujutsu stack

USAGE:
  jj-stack-prs [OPTIONS]

DESCRIPTION:
  Creates GitHub pull requests from your Jujutsu (jj) stack of changes.
  Automatically detects your stack structure, creates PRs with proper
  dependencies, and maintains a visualization of the entire PR chain.

OPTIONS:
  --base <branch>        Set the base branch for the bottom of the stack
                        (auto-detected from jj trunk() if not specified)
  
  --no-auto-bookmark    Disable automatic bookmark creation for unbookmarked
                        changes (auto-bookmarking is enabled by default)
  
  --keep-auto           Skip automatic cleanup of auto/* bookmarks
  
  --cleanup-all-auto    Force cleanup of all auto/* bookmarks
  
  --dry-run             Show what would be done without making changes
  
  --verbose             Show detailed output with progress indicators
  
  -h, --help            Show this help message
  
  --version             Show version information

EXAMPLES:
  # Create PRs for current stack (auto-bookmarks unbookmarked changes)
  jj-stack-prs
  
  # Use a different base branch
  jj-stack-prs --base develop
  
  # Disable auto-bookmarking
  jj-stack-prs --no-auto-bookmark
  
  # Dry run to preview actions
  jj-stack-prs --dry-run

WORKFLOW:
  1. Create your changes with jj
  2. Create bookmarks for each change in your stack
  3. Run jj-stack-prs to create/update PRs
  4. PRs will be created with proper dependencies
  5. Bottom PR will be ready for review, others will be drafts

NOTE:
  - Requires 'gh' (GitHub CLI) to be installed and authenticated
  - Requires 'jj' (Jujutsu) to be installed
  - Auto-created bookmarks use the prefix "auto/" and are cleaned up
    automatically when PRs are merged or closed`;
}
