/**
 * GitHub authentication validation utilities
 * Provides early validation of GitHub CLI authentication to prevent wasted processing
 */

import { safeError, safeLog } from "./safe_output.ts";
import type { CommandExecutor } from "./stack_detection.ts";

/**
 * Result of authentication validation
 */
export interface AuthValidationResult {
	/** Whether authentication is valid */
	isValid: boolean;
	/** Error message if authentication failed */
	errorMessage?: string;
}

/**
 * Validates GitHub CLI authentication
 * Runs `gh auth status` to check if the user is properly authenticated
 *
 * @param executor - Command executor to run the auth check
 * @returns Promise resolving to validation result
 */
export async function validateGitHubAuth(
	executor: CommandExecutor,
): Promise<AuthValidationResult> {
	try {
		const result = await executor.exec(["gh", "auth", "status"]);

		if (result.code === 0) {
			return { isValid: true };
		}

		// If `gh auth status` fails, extract meaningful error message
		const errorMessage = extractAuthErrorMessage(result.stderr);
		return {
			isValid: false,
			errorMessage,
		};
	} catch (error) {
		// Handle case where `gh` command is not found or other execution errors
		return {
			isValid: false,
			errorMessage: `Failed to check GitHub authentication: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

/**
 * Validates GitHub authentication and exits with error if invalid
 * This is a convenience function that combines validation and error handling
 *
 * @param executor - Command executor to run the auth check
 * @param isDryRun - Whether this is a dry run (affects error message)
 */
export async function validateGitHubAuthOrExit(
	executor: CommandExecutor,
	isDryRun = false,
): Promise<void> {
	safeLog("🔑 Validating GitHub authentication...");

	const authResult = await validateGitHubAuth(executor);

	if (authResult.isValid) {
		return; // Authentication is valid, continue
	}

	// Authentication failed - show clear error and exit
	safeError("❌ GitHub authentication failed!");
	safeError("");

	if (authResult.errorMessage) {
		safeError(`Error: ${authResult.errorMessage}`);
		safeError("");
	}

	safeError("To authenticate with GitHub:");
	safeError("  gh auth login");
	safeError("");
	safeError("Or set a personal access token:");
	safeError("  export GH_TOKEN=your_token_here");
	safeError("");
	safeError("For more help:");
	safeError("  gh auth --help");

	if (isDryRun) {
		safeError("");
		safeError("(This was a dry run - no changes would have been made)");
	}

	Deno.exit(1);
}

/**
 * Extracts a meaningful error message from `gh auth status` stderr output
 *
 * @param stderr - The stderr output from `gh auth status`
 * @returns Cleaned error message
 */
function extractAuthErrorMessage(stderr: string): string {
	if (!stderr.trim()) {
		return "GitHub CLI authentication check failed";
	}

	const lines = stderr.split("\n").filter((line) => line.trim());
	const meaningfulLine = findMeaningfulErrorLine(lines);

	return meaningfulLine || lines[0] || "GitHub CLI authentication check failed";
}

/**
 * Finds the first meaningful error line from stderr lines
 *
 * @param lines - Non-empty lines from stderr
 * @returns First meaningful error line or undefined
 */
function findMeaningfulErrorLine(lines: string[]): string | undefined {
	for (const line of lines) {
		const cleanLine = line.trim();

		// Skip empty lines or lines that are just formatting
		if (!cleanLine || cleanLine.startsWith("X ")) {
			continue;
		}

		// Return the first meaningful error line
		return cleanLine;
	}

	return undefined;
}
