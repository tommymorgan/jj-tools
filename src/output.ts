// Output functions that respect verbose mode
let VERBOSE_MODE = false;

export function setVerboseMode(verbose: boolean): void {
	VERBOSE_MODE = verbose;
}

export function output(message: string): void {
	console.log(message);
}

export function error(message: string): void {
	console.error(message);
}

export function verbose(message: string): void {
	if (VERBOSE_MODE) {
		console.log(message);
	}
}

export function progress(
	current: number,
	total: number,
	action: string,
	details: string,
): void {
	if (VERBOSE_MODE) {
		output(`[${current}/${total}] ${action}: ${details}`);
	} else {
		// In non-verbose mode, show condensed progress
		output(`${action} ${details}`);
	}
}

function verboseSummary(
	created: number,
	updated: number,
	ready: number,
	draft: number,
): void {
	output("\nSummary:");
	if (created > 0) output(`  • Created: ${created} new PR(s)`);
	if (updated > 0) output(`  • Updated: ${updated} existing PR(s)`);
	output(`  • Ready for review: ${ready}`);
	output(`  • Drafts: ${draft}`);

	output("\nView your stack:");
	output("  gh pr list --author @me --state open");
	output("\nView in browser:");
	output("  gh pr list --author @me --state open --web");
}

export function summary(
	created: number,
	updated: number,
	ready: number,
	draft: number,
): void {
	if (VERBOSE_MODE) {
		verboseSummary(created, updated, ready, draft);
	} else {
		output(
			`\nCreated: ${created}, Updated: ${updated}, Ready: ${ready}, Draft: ${draft}`,
		);
	}
}
