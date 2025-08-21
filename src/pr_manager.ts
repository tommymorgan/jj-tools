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
): Promise<Map<string, ExistingPR>> {
	// Query GitHub for ALL existing PRs by the user
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

	// Include ALL PRs, not just those matching local bookmarks
	// This is needed to detect full PR chains even when only part
	// of the chain is in the local working directory
	for (const pr of prs) {
		prMap.set(pr.headRefName, pr);
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
	// First, build the complete chain including dependent PRs
	const completeChain = buildCompleteChain(bookmarks, existingPRs, baseBranch);

	const chain: PRInfo[] = [];
	for (let i = 0; i < completeChain.length; i++) {
		const bookmarkName = completeChain[i];
		const isBottom = i === 0;
		const base = isBottom ? baseBranch : completeChain[i - 1];

		// Find the bookmark info if available
		const bookmark = bookmarks.find((b) => b.name === bookmarkName);

		chain.push({
			bookmark: bookmarkName,
			base,
			title: bookmark?.commitMessage || `Changes from ${bookmarkName}`,
			isBottom,
			existingPR: existingPRs.get(bookmarkName),
		});
	}

	return chain;
}

async function createMissingBookmarks(
	missingBookmarks: string[],
	executor: CommandExecutor,
): Promise<string[]> {
	const createdBookmarks: string[] = [];
	for (const bookmarkName of missingBookmarks) {
		// Try to create the bookmark tracking the remote
		const createResult = await executor.exec([
			"jj",
			"bookmark",
			"create",
			bookmarkName,
			"-r",
			`${bookmarkName}@origin`,
		]);

		if (createResult.code === 0) {
			createdBookmarks.push(bookmarkName);
		}
	}
	return createdBookmarks;
}

function buildChainFromCompleteList(
	completeChain: string[],
	bookmarks: Bookmark[],
	existingPRs: Map<string, ExistingPR>,
	baseBranch: string,
): PRInfo[] {
	const chain: PRInfo[] = [];
	for (let i = 0; i < completeChain.length; i++) {
		const bookmarkName = completeChain[i];
		const isBottom = i === 0;
		const base = isBottom ? baseBranch : completeChain[i - 1];

		// Find the bookmark info if available
		const bookmark = bookmarks.find((b) => b.name === bookmarkName);

		chain.push({
			bookmark: bookmarkName,
			base,
			title: bookmark?.commitMessage || `Changes from ${bookmarkName}`,
			isBottom,
			existingPR: existingPRs.get(bookmarkName),
		});
	}
	return chain;
}

export async function buildPRChainWithAutoCreate(
	bookmarks: Bookmark[],
	existingPRs: Map<string, ExistingPR>,
	baseBranch: string,
	executor: CommandExecutor,
): Promise<{ chain: PRInfo[]; createdBookmarks: string[] }> {
	// First, build the complete chain including dependent PRs
	const completeChain = buildCompleteChain(bookmarks, existingPRs, baseBranch);

	// Find which bookmarks are missing locally
	const localBookmarkNames = new Set(bookmarks.map((b) => b.name));
	const missingBookmarks = completeChain.filter(
		(name) => !localBookmarkNames.has(name),
	);

	// Create missing bookmarks
	const createdBookmarks = await createMissingBookmarks(
		missingBookmarks,
		executor,
	);

	// Build the PR chain
	const chain = buildChainFromCompleteList(
		completeChain,
		bookmarks,
		existingPRs,
		baseBranch,
	);

	return { chain, createdBookmarks };
}

function buildCompleteChain(
	bookmarks: Bookmark[],
	existingPRs: Map<string, ExistingPR>,
	baseBranch: string,
): string[] {
	// Start with bookmarks in the local stack
	const bookmarkNames = bookmarks.map((b) => b.name);
	const completeChain = new Set<string>(bookmarkNames);

	// Also need to include dependencies (things our bookmarks depend on)
	addDependencyPRs(completeChain, existingPRs, baseBranch);

	// Find all PRs that depend on any bookmark in our chain
	addDependentPRs(completeChain, existingPRs);

	// Sort the chain by dependencies (topological sort)
	return sortChainByDependencies(
		Array.from(completeChain),
		existingPRs,
		baseBranch,
	);
}

function addDependentPRs(
	chain: Set<string>,
	existingPRs: Map<string, ExistingPR>,
): void {
	let foundNew = true;
	while (foundNew) {
		foundNew = addOneDependentPR(chain, existingPRs);
	}
}

function addOneDependentPR(
	chain: Set<string>,
	existingPRs: Map<string, ExistingPR>,
): boolean {
	for (const [prName, pr] of existingPRs) {
		if (chain.has(pr.baseRefName) && !chain.has(prName)) {
			chain.add(prName);
			return true;
		}
	}
	return false;
}

function addDependencyPRs(
	chain: Set<string>,
	existingPRs: Map<string, ExistingPR>,
	baseBranch: string,
): void {
	let foundNew = true;
	while (foundNew) {
		foundNew = addOneDependencyPR(chain, existingPRs, baseBranch);
	}
}

function addOneDependencyPR(
	chain: Set<string>,
	existingPRs: Map<string, ExistingPR>,
	baseBranch: string,
): boolean {
	for (const bookmarkName of chain) {
		const pr = existingPRs.get(bookmarkName);
		if (pr && pr.baseRefName !== baseBranch && !chain.has(pr.baseRefName)) {
			chain.add(pr.baseRefName);
			return true;
		}
	}
	return false;
}

function sortChainByDependencies(
	bookmarkNames: string[],
	existingPRs: Map<string, ExistingPR>,
	baseBranch: string,
): string[] {
	const sorted: string[] = [];
	const visited = new Set<string>();

	function visit(name: string): void {
		if (visited.has(name)) return;
		visited.add(name);

		// Visit dependencies first
		const pr = existingPRs.get(name);
		if (
			pr &&
			pr.baseRefName !== baseBranch &&
			bookmarkNames.includes(pr.baseRefName)
		) {
			visit(pr.baseRefName);
		}

		sorted.push(name);
	}

	for (const name of bookmarkNames) {
		visit(name);
	}

	return sorted;
}
