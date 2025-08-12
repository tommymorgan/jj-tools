/**
 * Safe output utilities that handle broken pipe errors gracefully
 * This prevents the tool from crashing when output is piped to commands like `head`
 * or when the terminal buffer is exceeded.
 */

/**
 * Safely write to stdout, ignoring broken pipe errors
 */
export function safeLog(...args: unknown[]): void {
	try {
		console.log(...args);
	} catch (error) {
		// Ignore broken pipe errors (EPIPE)
		if (!isBrokenPipeError(error)) {
			// Re-throw non-broken-pipe errors
			throw error;
		}
		// Silently ignore broken pipe errors
	}
}

/**
 * Safely write to stderr, ignoring broken pipe errors
 */
export function safeError(...args: unknown[]): void {
	try {
		console.error(...args);
	} catch (error) {
		// Ignore broken pipe errors (EPIPE)
		if (!isBrokenPipeError(error)) {
			// Re-throw non-broken-pipe errors
			throw error;
		}
		// Silently ignore broken pipe errors
	}
}

/**
 * Check if an error is a broken pipe error
 */
function isBrokenPipeError(error: unknown): boolean {
	if (error instanceof Error) {
		// Check for broken pipe error patterns
		return (
			error.message.includes("Broken pipe") ||
			error.message.includes("EPIPE") ||
			error.message.includes("os error 32")
		);
	}
	return false;
}

/**
 * Install global handlers for broken pipe errors
 * This prevents the process from crashing on SIGPIPE
 */
export function installBrokenPipeHandlers(): void {
	// Handle uncaught exceptions that might be broken pipe errors
	globalThis.addEventListener("error", (event) => {
		if (isBrokenPipeError(event.error)) {
			event.preventDefault();
			// Exit gracefully without error
			Deno.exit(0);
		}
	});

	// Handle unhandled promise rejections that might be broken pipe errors
	globalThis.addEventListener("unhandledrejection", (event) => {
		if (isBrokenPipeError(event.reason)) {
			event.preventDefault();
			// Exit gracefully without error
			Deno.exit(0);
		}
	});
}