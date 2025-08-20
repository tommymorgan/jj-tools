import type { Bookmark, CommandExecutor } from "./stack_detection.ts";

export interface ExistingPR {
	number: number;
	headRefName: string;
	baseRefName: string;
	isDraft: boolean;
}

export interface PRInfo {
	bookmark: string;
	base: string;
	title: string;
	isBottom: boolean;
	existingPR?: ExistingPR;
}

export interface CreatePROptions {
	title: string;
	body: string;
	head: string;
	base: string;
	draft: boolean;
}

export interface UpdatePROptions {
	prNumber: number;
	base?: string;
	body?: string;
	draft?: boolean;
}

export async function findExistingPRs(
	executor: CommandExecutor,
	bookmarks: Bookmark[],
): Promise<Map<string, ExistingPR>> {
	// Query GitHub for existing PRs
	const result = await executor.exec([
		"gh",
		"pr",
		"list",
		"--author",
		"@me",
		"--state",
		"open",
		"--json",
		"number,headRefName,baseRefName,isDraft",
	]);

	if (result.code !== 0) {
		return new Map();
	}

	const prs: ExistingPR[] = JSON.parse(result.stdout || "[]");
	const prMap = new Map<string, ExistingPR>();

	// Match PRs to bookmarks
	for (const pr of prs) {
		const bookmark = bookmarks.find((b) => b.name === pr.headRefName);
		if (bookmark) {
			prMap.set(bookmark.name, pr);
		}
	}

	return prMap;
}

export function extractPRNumber(output: string): number | null {
	// Try to extract from GitHub URL
	const urlMatch = output.match(/\/pull\/(\d+)/);
	if (urlMatch) {
		return parseInt(urlMatch[1], 10);
	}

	// Try to extract from "PR #123" format
	const prMatch = output.match(/#(\d+)/);
	if (prMatch) {
		return parseInt(prMatch[1], 10);
	}

	return null;
}

export async function createPR(
	executor: CommandExecutor,
	options: CreatePROptions,
): Promise<number> {
	const args = [
		"gh",
		"pr",
		"create",
		"--title",
		options.title,
		"--body",
		options.body,
		"--base",
		options.base,
		"--head",
		options.head,
	];

	if (options.draft) {
		args.push("--draft");
	}

	const result = await executor.exec(args);

	if (result.code !== 0) {
		throw new Error(`Failed to create PR: ${result.stderr}`);
	}

	// Extract PR number from output
	const prNumber = extractPRNumber(result.stdout);
	if (!prNumber) {
		throw new Error("Could not extract PR number from output");
	}

	return prNumber;
}

export async function updatePR(
	executor: CommandExecutor,
	options: UpdatePROptions,
): Promise<void> {
	// Update base if specified
	if (options.base !== undefined) {
		await executor.exec([
			"gh",
			"pr",
			"edit",
			options.prNumber.toString(),
			"--base",
			options.base,
		]);
	}

	// Update body if specified
	if (options.body !== undefined) {
		await executor.exec([
			"gh",
			"pr",
			"edit",
			options.prNumber.toString(),
			"--body",
			options.body,
		]);
	}

	// Update draft status if specified
	if (options.draft !== undefined) {
		const draftFlag = options.draft ? "--draft" : "--ready";
		await executor.exec([
			"gh",
			"pr",
			"ready",
			options.prNumber.toString(),
			draftFlag,
		]);
	}
}

export function buildPRChain(
	bookmarks: Bookmark[],
	existingPRs: Map<string, ExistingPR>,
	baseBranch: string,
): PRInfo[] {
	const chain: PRInfo[] = [];

	for (let i = 0; i < bookmarks.length; i++) {
		const bookmark = bookmarks[i];
		const isBottom = i === 0;
		const base = isBottom ? baseBranch : bookmarks[i - 1].name;

		chain.push({
			bookmark: bookmark.name,
			base,
			title: bookmark.commitMessage || `Changes from ${bookmark.name}`,
			isBottom,
			existingPR: existingPRs.get(bookmark.name),
		});
	}

	return chain;
}
