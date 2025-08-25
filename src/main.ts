#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { validateGitHubAuthOrExit } from "./auth_validator.ts";
import {
	cleanupMergedAutoBookmarks,
	createAutoBookmark,
	findAutoBookmarks,
	findUnbookmarkedChanges,
	generateBookmarkName,
} from "./auto_bookmark.ts";
import { detectBaseBranch } from "./base_detector.ts";
import {
	type CLIOptions,
	parseArguments,
	showHelp,
	validateOptions,
} from "./cli.ts";
import { checkStackLinearity } from "./linearity_checker.ts";
import {
	error,
	output,
	progress,
	setVerboseMode,
	summary,
	verbose,
} from "./output.ts";
import {
	extractOriginalBody,
	generateDescription,
	type PRChainInfo,
} from "./pr_description.ts";
import {
	buildPRChainWithAutoCreate,
	createPR,
	type ExistingPR,
	findExistingPRs,
	type PRInfo,
	updatePR,
} from "./pr_manager.ts";
import {
	detectPRStack,
	type PRStackInfo,
	reconcilePRBookmarks,
} from "./pr_stack_detector.ts";
import { installBrokenPipeHandlers, safeLog } from "./safe_output.ts";
import {
	type Bookmark,
	type CommandExecutor,
	detectStack,
	detectStackWithRemotes,
	hasConflicts,
	reconcileRemoteBookmarks,
	type StackInfo,
} from "./stack_detection.ts";
import { showVersion } from "./version.ts";

export function createSystemCommandExecutor(): CommandExecutor {
	return {
		async exec(
			cmd: string[],
		): Promise<{ stdout: string; stderr: string; code: number }> {
			const command = new Deno.Command(cmd[0], {
				args: cmd.slice(1),
				stdout: "piped",
				stderr: "piped",
			});

			const { code, stdout, stderr } = await command.output();

			return {
				stdout: new TextDecoder().decode(stdout),
				stderr: new TextDecoder().decode(stderr),
				code,
			};
		},
	};
}

function handleHelpAndVersion(options: CLIOptions): void {
	if (options.help) {
		safeLog(showHelp());
		Deno.exit(0);
	}
	if (options.version) {
		safeLog(showVersion());
		Deno.exit(0);
	}
}

function handleValidationErrors(errors: string[]): void {
	if (errors.length > 0) {
		error("Error: Invalid options");
		for (const err of errors) {
			error(`  ${err}`);
		}
		Deno.exit(1);
	}
}

async function cleanupAutoBookmarks(
	options: CLIOptions,
	executor: CommandExecutor,
): Promise<string[]> {
	if (options.keepAuto) return [];

	verbose("Cleaning up auto-bookmarks...");
	const autoBookmarks = await findAutoBookmarks(executor);

	if (options.cleanupAllAuto) {
		await forceCleanupAllAutoBookmarks(autoBookmarks, options, executor);
		return options.dryRun ? autoBookmarks : [];
	} else if (autoBookmarks.length > 0) {
		return await cleanupMergedAutoBookmarksWrapper(
			autoBookmarks,
			executor,
			options.dryRun,
		);
	}
	return [];
}

async function forceCleanupAllAutoBookmarks(
	autoBookmarks: string[],
	options: CLIOptions,
	executor: CommandExecutor,
): Promise<void> {
	for (const bookmark of autoBookmarks) {
		if (!options.dryRun) {
			await executor.exec(["jj", "bookmark", "delete", bookmark]);
		}
		verbose(`  Deleted: ${bookmark}`);
	}
}

async function cleanupMergedAutoBookmarksWrapper(
	autoBookmarks: string[],
	executor: CommandExecutor,
	dryRun = false,
): Promise<string[]> {
	const cleanupResult = await cleanupMergedAutoBookmarks(
		executor,
		autoBookmarks,
		dryRun,
	);
	for (const deleted of cleanupResult.deleted) {
		if (dryRun) {
			verbose(`  ${deleted}: PR merged/closed, would delete`);
		} else {
			verbose(`  ${deleted}: PR merged/closed, deleted`);
		}
	}
	return cleanupResult.deleted;
}

async function handleUnbookmarkedChanges(
	options: CLIOptions,
	executor: CommandExecutor,
): Promise<void> {
	if (options.noAutoBookmark) return;

	verbose("Checking for unbookmarked changes...");
	const unbookmarked = await findUnbookmarkedChanges(executor);

	if (unbookmarked.length === 0) return;

	verbose(`Found ${unbookmarked.length} unbookmarked change(s)`);

	for (const change of unbookmarked) {
		await processUnbookmarkedChange(change, options, executor);
	}
}

async function processUnbookmarkedChange(
	change: { changeId: string; description: string },
	options: CLIOptions,
	executor: CommandExecutor,
): Promise<void> {
	verbose(`  ${change.changeId}: ${change.description}`);

	if (!options.dryRun) {
		const autoBookmark = await createAutoBookmark(executor, change);
		verbose(`  Created auto-bookmark: ${autoBookmark.name}`);
	} else {
		const bookmarkName = generateBookmarkName(
			change.description,
			change.changeId,
		);
		verbose(`  Would create: ${bookmarkName}`);
	}
}

function validateStackBookmarks(stack: StackInfo, options: CLIOptions): void {
	if (stack.bookmarks.length > 0) return;

	if (options.noAutoBookmark) {
		error("Error: No bookmarks found in stack");
		error("Create bookmarks with: jj bookmark create <name> -r @");
		Deno.exit(1);
	}

	if (options.dryRun) {
		verbose("Dry run complete. Would have created auto-bookmarks and PRs.");
		Deno.exit(0);
	}

	error("Error: No bookmarks found after auto-bookmark creation");
	Deno.exit(1);
}

async function resolveBookmarkConflict(
	executor: CommandExecutor,
	bookmark: string,
	targetCommitId: string | undefined,
): Promise<void> {
	// Use the provided commit ID from the stack, or find the local one
	let commitId = targetCommitId;

	if (!commitId) {
		// Fallback: Get the local commit ID for this bookmark (excluding @origin versions)
		const logResult = await executor.exec([
			"jj",
			"log",
			"-r",
			`bookmarks(exact:${bookmark}) ~ bookmarks(exact:${bookmark}@origin)`,
			"--no-graph",
			"-T",
			"commit_id",
			"--limit",
			"1",
		]);

		if (logResult.code !== 0 || !logResult.stdout.trim()) {
			return;
		}
		commitId = logResult.stdout.trim().split("\n")[0];
	}

	const setResult = await executor.exec([
		"jj",
		"bookmark",
		"set",
		bookmark,
		"-r",
		commitId,
	]);
	if (setResult.code === 0) {
		verbose(
			`  Resolved conflict for ${bookmark} to ${commitId.substring(0, 8)}`,
		);
	}
}

async function trackSingleBookmark(
	executor: CommandExecutor,
	bookmark: string,
	commitId: string | undefined,
): Promise<void> {
	const trackResult = await executor.exec([
		"jj",
		"bookmark",
		"track",
		`${bookmark}@origin`,
	]);

	if (trackResult.code !== 0) {
		return; // Bookmark might not exist on remote yet or already be tracked
	}

	verbose(`  Tracked ${bookmark}@origin`);

	// Check if tracking created a conflict (happens when local and remote diverged)
	const listResult = await executor.exec([
		"jj",
		"bookmark",
		"list",
		"--all",
		"-r",
		bookmark,
	]);

	if (listResult.stdout.includes("(conflicted)")) {
		await resolveBookmarkConflict(executor, bookmark, commitId);
	}
}

async function trackBookmarks(
	executor: CommandExecutor,
	bookmarks: Array<{ name: string; commitHash?: string }>,
): Promise<void> {
	for (const bookmark of bookmarks) {
		await trackSingleBookmark(executor, bookmark.name, bookmark.commitHash);
	}
}

function filterBaseBranches(
	bookmarks: Bookmark[],
	baseBranch?: string,
): Bookmark[] {
	const commonBaseNames = [
		"main",
		"master",
		"trunk",
		"develop",
		"production",
		"release",
	];

	return bookmarks.filter((b) => {
		// Filter out the configured base branch
		if (baseBranch && b.name === baseBranch) {
			return false;
		}
		// Also filter out common base branch names as a safety measure
		return !commonBaseNames.includes(b.name);
	});
}

export async function pushBookmarksToGitHub(
	options: CLIOptions,
	executor: CommandExecutor,
	stack: StackInfo,
): Promise<void> {
	output("Pushing to GitHub...");

	if (options.dryRun) {
		verbose("  (dry-run: would push all bookmarks)");
		return;
	}

	// Track all bookmarks in the stack to handle rebases properly
	await trackBookmarks(executor, stack.bookmarks);

	// Filter out base branches to avoid stale reference errors
	const bookmarksToPush = filterBaseBranches(
		stack.bookmarks,
		options.baseBranch,
	);

	// Build the push command with specific bookmarks (excluding base branches)
	// Note: We can't use --deleted with -b flags, so deleted bookmarks won't be pushed to remote
	const pushCmd = [
		"jj",
		"git",
		"push",
		...bookmarksToPush.flatMap((b) => ["-b", b.name]),
	];

	const pushResult = await executor.exec(pushCmd);
	if (pushResult.code !== 0) {
		// Filter out non-tracking bookmark warnings to reduce noise
		const lines = pushResult.stderr.split("\n");
		const relevantErrors = lines.filter((line) => {
			// Keep lines that are NOT non-tracking bookmark warnings
			return (
				!line.includes("Non-tracking remote bookmark") &&
				!line.includes("Run `jj bookmark track")
			);
		});

		error(`Error: Failed to push bookmarks: ${relevantErrors.join(" ")}`);
		Deno.exit(1);
	}
}

async function processPullRequest(
	pr: PRInfo,
	index: number,
	prChain: PRInfo[],
	options: CLIOptions,
	executor: CommandExecutor,
	_existingPRs: Map<string, ExistingPR>,
): Promise<PRChainInfo | null> {
	const prCount = index + 1;
	const isBottom = index === 0;
	const isDraft = !isBottom;

	if (pr.existingPR) {
		return await updateExistingPR(
			pr,
			prCount,
			prChain.length,
			options,
			executor,
			isDraft,
		);
	}
	return await createNewPR(
		pr,
		prCount,
		prChain.length,
		options,
		executor,
		isDraft,
	);
}

async function updateExistingPR(
	pr: PRInfo,
	prCount: number,
	totalPRs: number,
	options: CLIOptions,
	executor: CommandExecutor,
	_isDraft: boolean,
): Promise<PRChainInfo | null> {
	const existingPR = pr.existingPR;
	if (!existingPR) {
		// This shouldn't happen as this function is only called when existingPR exists
		error(`  No existing PR found for ${pr.bookmark}`);
		return null;
	}

	progress(
		prCount,
		totalPRs,
		`Updating PR #${existingPR.number}`,
		`${pr.bookmark} → ${pr.base}`,
	);

	if (!options.dryRun) {
		if (existingPR.baseRefName !== pr.base) {
			await updatePR(executor, {
				prNumber: existingPR.number,
				base: pr.base,
			});
			verbose(`  Updated base: ${existingPR.baseRefName} → ${pr.base}`);
		}

		return {
			bookmark: pr.bookmark,
			base: pr.base,
			prNumber: existingPR.number,
			isDraft: existingPR.isDraft,
			isReady: !existingPR.isDraft,
			commitMessage: pr.title,
		};
	}

	return null;
}

async function createNewPR(
	pr: PRInfo,
	prCount: number,
	totalPRs: number,
	options: CLIOptions,
	executor: CommandExecutor,
	isDraft: boolean,
): Promise<PRChainInfo | null> {
	progress(prCount, totalPRs, `Creating PR`, `${pr.bookmark} → ${pr.base}`);

	if (!options.dryRun) {
		const prNumber = await createPR(executor, {
			title: pr.title,
			body: `Initial PR for ${pr.bookmark}`,
			head: pr.bookmark,
			base: pr.base,
			draft: isDraft,
		});

		if (!isDraft) {
			output(`Creating PR #${prNumber}: ${pr.bookmark} → ${pr.base}`);
		} else {
			output(`Creating PR #${prNumber}: ${pr.bookmark} → ${pr.base} (draft)`);
		}

		return {
			bookmark: pr.bookmark,
			base: pr.base,
			prNumber,
			isDraft,
			isReady: !isDraft,
			commitMessage: pr.title,
		};
	}

	verbose(`  (dry-run: would create ${isDraft ? "draft" : "ready"} PR)`);
	return null;
}

async function updatePRDescriptions(
	createdPRs: PRChainInfo[],
	executor: CommandExecutor,
): Promise<void> {
	verbose("Updating PR descriptions...");

	for (let i = 0; i < createdPRs.length; i++) {
		const pr = createdPRs[i];
		if (!pr.prNumber) continue;

		const originalBody = await fetchPRBody(pr.prNumber, executor);
		const description = generateDescription({
			currentPR: pr,
			fullChain: createdPRs,
			position: i + 1,
			originalBody,
		});

		await updatePR(executor, {
			prNumber: pr.prNumber,
			body: description,
		});
	}
}

async function fetchPRBody(
	prNumber: number,
	executor: CommandExecutor,
): Promise<string> {
	const viewResult = await executor.exec([
		"gh",
		"pr",
		"view",
		prNumber.toString(),
		"--json",
		"body",
	]);

	if (viewResult.code !== 0) return "";

	try {
		const prData = JSON.parse(viewResult.stdout);
		return extractOriginalBody(prData.body || "");
	} catch {
		return "";
	}
}

function showSummary(
	createdPRs: PRChainInfo[],
	existingPRs: Map<string, ExistingPR>,
): void {
	safeLog("\n✨ Stack PRs created with full chain visualization!");

	const createdCount = createdPRs.filter(
		(pr) => !existingPRs.has(pr.bookmark),
	).length;
	const updatedCount = createdPRs.filter((pr) =>
		existingPRs.has(pr.bookmark),
	).length;
	const readyCount = createdPRs.filter((pr) => pr.isReady).length;
	const draftCount = createdPRs.filter((pr) => pr.isDraft).length;

	summary(createdCount, updatedCount, readyCount, draftCount);
}

interface AppContext {
	executor: CommandExecutor;
	options: CLIOptions & { baseBranch: string }; // baseBranch is guaranteed to be set
}

async function processStack(ctx: AppContext): Promise<void> {
	const deletedBookmarks = await cleanupAutoBookmarks(
		ctx.options,
		ctx.executor,
	);
	await handleUnbookmarkedChanges(ctx.options, ctx.executor);
	const stack = await detectAndValidateStack(ctx);
	await checkForConflicts(ctx);

	// Build PR chain and create missing bookmarks for dependent PRs
	const { allBookmarks, prChain, existingPRs } =
		await prepareBookmarksAndPRChain(ctx, stack, deletedBookmarks);

	// Now push all bookmarks (including auto-created ones)
	await pushBookmarksToGitHub(ctx.options, ctx.executor, {
		bookmarks: allBookmarks,
	});

	// Process PRs (create/update)
	await processPRsWithChain(ctx, prChain, existingPRs);
}

function handleReconcileFailure(err: string | undefined): never {
	const errorMessage = err || "Unknown error";
	error(`Error: Failed to reconcile remote bookmarks: ${errorMessage}`);
	Deno.exit(1);
}

function handleDryRunSuccess(): never {
	verbose("Would have successfully created PR stack after reconciliation");
	verbose("(This was a dry run - no changes were made)");
	Deno.exit(0);
}

async function handleRemoteBookmarksIfNeeded(ctx: AppContext): Promise<void> {
	const stackWithRemotes = await detectStackWithRemotes(
		ctx.executor,
		ctx.options.baseBranch,
	);

	if (!stackWithRemotes.hasRemoteOnlyBookmarks) {
		return;
	}

	const reconcileResult = await handleRemoteOnlyBookmarks(
		ctx.executor,
		ctx.options.baseBranch,
		ctx.options.dryRun,
	);

	if (!reconcileResult.success) {
		handleReconcileFailure(reconcileResult.error);
	}

	const count = reconcileResult.reconciledBookmarks.length;
	if (count === 0) {
		return;
	}

	output(`Created ${count} local bookmark(s) tracking remotes`);

	if (ctx.options.dryRun) {
		handleDryRunSuccess();
	}
}

async function detectAndValidateStack(ctx: AppContext): Promise<StackInfo> {
	verbose("Detecting stack...");

	// Check for non-linear stacks (BUG-004)
	await ensureLinearStack(ctx.executor);

	await handleRemoteBookmarksIfNeeded(ctx);

	const stack = await detectStack(ctx.executor, ctx.options.baseBranch);
	validateStackBookmarks(stack, ctx.options);
	output(`Local bookmarks: ${stack.bookmarks.length}`);
	return stack;
}

function logPRStack(prStackInfo: PRStackInfo): void {
	output("Detected PR stack with missing local bookmarks");
	verbose(
		"This typically happens when you switch computers after pushing a stack.",
	);

	if (prStackInfo.prs.length === 0) {
		return;
	}

	verbose("PR Stack found:");
	prStackInfo.prs.forEach((pr, i) => {
		const hasLocal = prStackInfo.existingLocalBookmarks.includes(
			pr.headRefName,
		);
		const status = hasLocal ? "✅" : "❌ missing";
		verbose(
			`  ${i + 1}. #${pr.number}: ${pr.headRefName} → ${pr.baseRefName} ${status}`,
		);
	});
}

function logMissingBookmarks(bookmarks: string[]): void {
	verbose(`Missing ${bookmarks.length} local bookmark(s):`);
	for (const bookmark of bookmarks) {
		verbose(`  ${bookmark}`);
	}
}

async function handlePRDetection(
	prStackInfo: PRStackInfo,
	executor: CommandExecutor,
	dryRun: boolean,
): Promise<{
	success: boolean;
	reconciledBookmarks: string[];
	error?: string;
}> {
	if (prStackInfo.missingLocalBookmarks.length === 0) {
		return { success: true, reconciledBookmarks: [] };
	}

	logPRStack(prStackInfo);
	logMissingBookmarks(prStackInfo.missingLocalBookmarks);

	if (dryRun) {
		verbose("DRY RUN: Would create local bookmarks tracking these remotes");
		return {
			success: true,
			reconciledBookmarks: prStackInfo.missingLocalBookmarks,
		};
	}

	output("Creating local bookmarks to track remotes...");
	const result = await reconcilePRBookmarks(
		executor,
		prStackInfo.missingLocalBookmarks,
		dryRun,
	);

	return {
		success: result.success,
		reconciledBookmarks: result.success ? result.createdBookmarks : [],
		error: result.success ? undefined : result.error,
	};
}

async function handleFallbackDetection(
	executor: CommandExecutor,
	baseBranch: string,
	dryRun: boolean,
): Promise<{
	success: boolean;
	reconciledBookmarks: string[];
	error?: string;
}> {
	const stackInfo = await detectStackWithRemotes(executor, baseBranch);

	if (!stackInfo.hasRemoteOnlyBookmarks) {
		return { success: true, reconciledBookmarks: [] };
	}

	output("Detected remote-only bookmarks in the stack");
	verbose("Remote bookmarks found:");
	for (const remote of stackInfo.remoteBookmarks) {
		verbose(`  ${remote.name}@${remote.remote}`);
	}

	if (dryRun) {
		verbose("DRY RUN: Would create local bookmarks tracking these remotes");
		return {
			success: true,
			reconciledBookmarks: stackInfo.remoteBookmarks.map((r) => r.name),
		};
	}

	const result = await reconcileRemoteBookmarks(executor, baseBranch, dryRun);
	return {
		success: result.success,
		reconciledBookmarks: result.createdBookmarks,
		error: result.error,
	};
}

export async function handleRemoteOnlyBookmarks(
	executor: CommandExecutor,
	baseBranch: string,
	dryRun: boolean,
): Promise<{
	success: boolean;
	reconciledBookmarks: string[];
	error?: string;
}> {
	try {
		const prStackInfo = await detectPRStack(executor, baseBranch);
		return await handlePRDetection(prStackInfo, executor, dryRun);
	} catch (_e) {
		return await handleFallbackDetection(executor, baseBranch, dryRun);
	}
}

async function ensureLinearStack(executor: CommandExecutor): Promise<void> {
	const linearityCheck = await checkStackLinearity(executor);
	if (linearityCheck.isLinear) {
		return;
	}

	error(`Error: ${linearityCheck.message}`);
	if (linearityCheck.problematicCommits.length > 0) {
		error("  Problematic commits:");
		for (const commit of linearityCheck.problematicCommits) {
			error(`    ${commit}`);
		}
	}
	error("This tool only supports linear stacks");
	error("Resolve merge commits or divergent branches first");
	Deno.exit(1);
}

async function checkForConflicts(ctx: AppContext): Promise<void> {
	verbose("Checking for conflicts...");

	const conflictCheck = await hasConflicts(
		ctx.executor,
		ctx.options.baseBranch,
	);

	if (!conflictCheck.hasConflicts) {
		return;
	}

	error("Error: Cannot create PRs - found conflicts in the stack");
	error("Conflicted commits:");
	for (const conflict of conflictCheck.conflictedCommits) {
		error(
			`  ${conflict.changeId} (${conflict.bookmark}): ${conflict.description}`,
		);
	}
	error("Jujutsu cannot push commits with conflicts to GitHub");
	error("Resolve conflicts with: jj edit <change-id>");
	Deno.exit(1);
}

export function reportCreatedBookmarks(
	createdBookmarks: string[],
	existingPRs: Map<string, ExistingPR>,
	stackSize: number,
): void {
	if (createdBookmarks.length === 0) return;

	const totalPRs = stackSize + createdBookmarks.length;
	output(
		`Detected PR chain: ${totalPRs} PRs (${stackSize} local bookmarks + ${createdBookmarks.length} dependent PRs)`,
	);

	for (const bookmark of createdBookmarks) {
		const pr = existingPRs.get(bookmark);
		if (pr) {
			verbose(
				`  • Creating local bookmark: ${bookmark} → ${pr.baseRefName} (PR #${pr.number})`,
			);
		}
	}
}

async function prepareBookmarksAndPRChain(
	ctx: AppContext,
	stack: StackInfo,
	deletedBookmarks: string[] = [],
): Promise<{
	allBookmarks: Bookmark[];
	prChain: PRInfo[];
	existingPRs: Map<string, ExistingPR>;
}> {
	verbose("Building PR chain...");
	const existingPRs = await findExistingPRs(ctx.executor);

	// Build PR chain and auto-create missing bookmarks for dependent PRs
	const { chain: prChain, createdBookmarks } = await buildPRChainWithAutoCreate(
		stack.bookmarks,
		existingPRs,
		ctx.options.baseBranch,
		ctx.executor,
		deletedBookmarks,
	);

	// Report on any bookmarks that were auto-created
	reportCreatedBookmarks(createdBookmarks, existingPRs, stack.bookmarks.length);

	// Combine original bookmarks with newly created ones
	const allBookmarkNames = new Set([
		...stack.bookmarks.map((b) => b.name),
		...createdBookmarks,
	]);

	// Convert to Bookmark objects for consistency
	const allBookmarks: Bookmark[] = [];
	for (const name of allBookmarkNames) {
		const existing = stack.bookmarks.find((b) => b.name === name);
		if (existing) {
			allBookmarks.push(existing);
		} else {
			// For auto-created bookmarks, we don't have commit messages
			allBookmarks.push({ name, commitMessage: "" });
		}
	}

	return { allBookmarks, prChain, existingPRs };
}

async function processPRsWithChain(
	ctx: AppContext,
	prChain: PRInfo[],
	existingPRs: Map<string, ExistingPR>,
): Promise<void> {
	const createdPRs = await createOrUpdatePRs(ctx, prChain, existingPRs);
	await finalizePRs(ctx, createdPRs, existingPRs);
}

async function createOrUpdatePRs(
	ctx: AppContext,
	prChain: PRInfo[],
	existingPRs: Map<string, ExistingPR>,
): Promise<PRChainInfo[]> {
	const createdPRs: PRChainInfo[] = [];
	for (let i = 0; i < prChain.length; i++) {
		const prInfo = await processPullRequest(
			prChain[i],
			i,
			prChain,
			ctx.options,
			ctx.executor,
			existingPRs,
		);
		if (prInfo) {
			createdPRs.push(prInfo);
		}
	}
	return createdPRs;
}

async function finalizePRs(
	ctx: AppContext,
	createdPRs: PRChainInfo[],
	existingPRs: Map<string, ExistingPR>,
): Promise<void> {
	if (!ctx.options.dryRun && createdPRs.length > 0) {
		await updatePRDescriptions(createdPRs, ctx.executor);
	}

	if (!ctx.options.dryRun) {
		showSummary(createdPRs, existingPRs);
	}
}

function handleError(err: unknown, options: CLIOptions): void {
	error(`Error: ${err instanceof Error ? err.message : String(err)}`);
	if (options.dryRun) {
		verbose("(This was a dry run - no changes were made)");
	}
	Deno.exit(1);
}

async function main() {
	// Install handlers for broken pipe errors (BUG-001)
	installBrokenPipeHandlers();

	const options = parseArguments(Deno.args);

	setVerboseMode(options.verbose);

	handleHelpAndVersion(options);
	handleValidationErrors(validateOptions(options));

	const executor = createSystemCommandExecutor();

	// Validate GitHub authentication early (BUG-006)
	await validateGitHubAuthOrExit(executor, options.dryRun);

	if (!options.baseBranch) {
		const detectedBase = await detectBaseBranch(executor);
		if (detectedBase) {
			options.baseBranch = detectedBase;
			verbose(`Auto-detected base branch: ${detectedBase}`);
		} else {
			// Fall back to "master" if auto-detection fails
			options.baseBranch = "master";
			verbose("Could not auto-detect base branch, using 'master'");
			verbose("Use --base <branch> to specify a different base branch");
		}
	}

	const ctx: AppContext = {
		executor,
		options: options as CLIOptions & { baseBranch: string },
	};

	try {
		await processStack(ctx);
	} catch (error) {
		handleError(error, options);
	}
}

if (import.meta.main) {
	await main();
}
