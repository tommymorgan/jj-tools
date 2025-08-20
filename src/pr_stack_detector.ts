import type { CommandExecutor } from "./stack_detection.ts";

export interface StackPR {
	number: number;
	headRefName: string;
	baseRefName: string;
	title: string;
}

export interface PRStackInfo {
	prs: StackPR[];
	missingLocalBookmarks: string[];
	existingLocalBookmarks: string[];
}

async function fetchUserPRs(executor: CommandExecutor): Promise<StackPR[]> {
	const prsResult = await executor.exec([
		"gh",
		"pr",
		"list",
		"--author",
		"@me",
		"--json",
		"number,headRefName,baseRefName,title",
		"--limit",
		"50",
	]);

	if (prsResult.code !== 0) {
		throw new Error(`Failed to fetch PRs: ${prsResult.stderr}`);
	}

	return JSON.parse(prsResult.stdout);
}

async function getAncestorBookmarks(
	executor: CommandExecutor,
): Promise<Set<string>> {
	const ancestorResult = await executor.exec([
		"jj",
		"log",
		"--no-graph",
		"-r",
		`::@`,
		"-T",
		'bookmarks ++ "\n"',
	]);

	const bookmarkLines = ancestorResult.stdout
		.split("\n")
		.filter((line) => line.trim());

	const ancestorBookmarks = new Set<string>();
	bookmarkLines.forEach((line) => {
		line.split(/[@\s]+/).forEach((part) => {
			if (part && part !== "origin") {
				ancestorBookmarks.add(part);
			}
		});
	});

	return ancestorBookmarks;
}

function findCurrentStack(
	prStacks: StackPR[][],
	ancestorBookmarks: Set<string>,
): StackPR[] {
	for (const stack of prStacks) {
		const inThisStack = stack.some((pr) =>
			ancestorBookmarks.has(pr.headRefName),
		);
		if (inThisStack) {
			return stack;
		}
	}
	return [];
}

function selectLargestStack(prStacks: StackPR[][]): StackPR[] {
	if (prStacks.length === 0) return [];

	const largest = prStacks.reduce((largest, current) =>
		current.length > largest.length ? current : largest,
	);

	console.log(`\n📍 Found a PR stack but you're not currently in it.`);
	console.log(
		`   The stack contains ${largest.length} PRs starting from ${largest[0]?.headRefName}`,
	);
	console.log(
		`   You may need to navigate to the stack with: jj new ${largest[largest.length - 1]?.headRefName}@origin\n`,
	);

	return largest;
}

async function getLocalBookmarks(
	executor: CommandExecutor,
): Promise<Set<string>> {
	const bookmarkListResult = await executor.exec(["jj", "bookmark", "list"]);

	const bookmarks = bookmarkListResult.stdout
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => {
			const match = line.match(/^([^:@\s]+):/);
			return match ? match[1] : null;
		})
		.filter((b): b is string => b !== null);

	return new Set(bookmarks);
}

function categorizeBookmarks(
	sortedPRs: StackPR[],
	localBookmarks: Set<string>,
): { missing: string[]; existing: string[] } {
	const missingLocalBookmarks: string[] = [];
	const existingLocalBookmarks: string[] = [];

	for (const pr of sortedPRs) {
		if (localBookmarks.has(pr.headRefName)) {
			existingLocalBookmarks.push(pr.headRefName);
		} else {
			missingLocalBookmarks.push(pr.headRefName);
		}
	}

	return {
		missing: missingLocalBookmarks,
		existing: existingLocalBookmarks,
	};
}

export async function detectPRStack(
	executor: CommandExecutor,
	baseBranch: string = "master",
): Promise<PRStackInfo> {
	// Step 1: Get all PRs for the current user
	const allPRs = await fetchUserPRs(executor);

	// Step 2: Find connected PR stacks
	const prStacks = findPRStacks(allPRs, baseBranch);

	// Step 3: Check if we're in any of these stacks
	const ancestorBookmarks = await getAncestorBookmarks(executor);

	// Find the stack we're currently in (if any)
	let currentStack = findCurrentStack(prStacks, ancestorBookmarks);

	// If we're not in any stack but there are stacks, use the largest
	if (currentStack.length === 0 && prStacks.length > 0) {
		currentStack = selectLargestStack(prStacks);
	}

	// Step 4: Check which bookmarks exist locally
	const localBookmarks = await getLocalBookmarks(executor);
	const { missing, existing } = categorizeBookmarks(
		currentStack,
		localBookmarks,
	);

	return {
		prs: currentStack,
		missingLocalBookmarks: missing,
		existingLocalBookmarks: existing,
	};
}

function buildPRsByBase(allPRs: StackPR[]): Map<string, StackPR[]> {
	const prsByBase = new Map<string, StackPR[]>();
	for (const pr of allPRs) {
		if (!prsByBase.has(pr.baseRefName)) {
			prsByBase.set(pr.baseRefName, []);
		}
		prsByBase.get(pr.baseRefName)?.push(pr);
	}
	return prsByBase;
}

function buildStackFromRoot(
	rootPR: StackPR,
	prsByBase: Map<string, StackPR[]>,
	processed: Set<string>,
): StackPR[] {
	const stack: StackPR[] = [];
	let current: StackPR | undefined = rootPR;

	while (current && !processed.has(current.headRefName)) {
		stack.push(current);
		processed.add(current.headRefName);
		const children: StackPR[] = prsByBase.get(current.headRefName) || [];
		current = children.find((pr: StackPR) => !processed.has(pr.headRefName));
	}

	return stack;
}

function addUnconnectedPRs(
	allPRs: StackPR[],
	processed: Set<string>,
	stacks: StackPR[][],
): void {
	for (const pr of allPRs) {
		if (!processed.has(pr.headRefName)) {
			stacks.push([pr]);
			processed.add(pr.headRefName);
		}
	}
}

function findPRStacks(allPRs: StackPR[], baseBranch: string): StackPR[][] {
	const stacks: StackPR[][] = [];
	const processed = new Set<string>();
	const prsByBase = buildPRsByBase(allPRs);

	// Find all stacks starting from PRs that base on master/main
	const rootPRs = allPRs.filter(
		(pr) => pr.baseRefName === baseBranch || pr.baseRefName === "main",
	);

	for (const rootPR of rootPRs) {
		if (processed.has(rootPR.headRefName)) continue;
		const stack = buildStackFromRoot(rootPR, prsByBase, processed);
		if (stack.length > 0) {
			stacks.push(stack);
		}
	}

	// Add any remaining unconnected PRs as single-PR stacks
	addUnconnectedPRs(allPRs, processed, stacks);
	return stacks;
}

async function fetchFromRemote(
	executor: CommandExecutor,
	dryRun: boolean,
): Promise<{ success: boolean; error?: string }> {
	if (dryRun) {
		return { success: true };
	}

	const fetchResult = await executor.exec(["jj", "git", "fetch"]);
	if (fetchResult.code !== 0) {
		return {
			success: false,
			error: `Failed to fetch from remote: ${fetchResult.stderr}`,
		};
	}
	return { success: true };
}

async function createBookmark(
	executor: CommandExecutor,
	bookmarkName: string,
	dryRun: boolean,
): Promise<boolean> {
	const remoteRef = `${bookmarkName}@origin`;

	if (dryRun) {
		console.log(`  🔖 Would create: ${bookmarkName} tracking ${remoteRef}`);
		return true;
	}

	const createResult = await executor.exec([
		"jj",
		"bookmark",
		"create",
		bookmarkName,
		"-r",
		remoteRef,
	]);

	if (createResult.code === 0) {
		console.log(`  ✅ Created: ${bookmarkName} tracking ${remoteRef}`);
		return true;
	}

	if (!createResult.stderr.includes("already exists")) {
		console.error(
			`  ❌ Failed to create ${bookmarkName}: ${createResult.stderr}`,
		);
	}
	return false;
}

export async function reconcilePRBookmarks(
	executor: CommandExecutor,
	missingBookmarks: string[],
	dryRun: boolean = false,
): Promise<{ success: boolean; createdBookmarks: string[]; error?: string }> {
	// First, fetch from remote to ensure we have latest
	const fetchResult = await fetchFromRemote(executor, dryRun);
	if (!fetchResult.success) {
		return {
			success: false,
			createdBookmarks: [],
			error: fetchResult.error,
		};
	}

	// Create local bookmarks for each missing one
	const createdBookmarks: string[] = [];
	for (const bookmarkName of missingBookmarks) {
		const created = await createBookmark(executor, bookmarkName, dryRun);
		if (created) {
			createdBookmarks.push(bookmarkName);
		}
	}

	return {
		success: true,
		createdBookmarks,
	};
}
