#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { validateGitHubAuthOrExit } from "./auth_validator.ts";
import { AutoBookmarkManager } from "./auto_bookmark.ts";
import { detectBaseBranch } from "./base_detector.ts";
import {
	type CLIOptions,
	parseArguments,
	showHelp,
	validateOptions,
} from "./cli.ts";
import { checkStackLinearity } from "./linearity_checker.ts";
import { type PRChainInfo, PRDescriptionGenerator } from "./pr_description.ts";
import {
	type ExistingPR,
	type PRInfo,
	PullRequestManager,
} from "./pr_manager.ts";
import {
	installBrokenPipeHandlers,
	safeError,
	safeLog,
} from "./safe_output.ts";
import {
	type CommandExecutor,
	detectStack,
	type StackInfo,
} from "./stack_detection.ts";

// Real command executor that runs system commands
class SystemCommandExecutor implements CommandExecutor {
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
	}
}

// Helper functions to reduce complexity
async function handleHelp(options: CLIOptions): Promise<void> {
	if (options.help) {
		safeLog(showHelp());
		Deno.exit(0);
	}
}

function handleValidationErrors(errors: string[]): void {
	if (errors.length > 0) {
		safeError("❌ Invalid options:");
		for (const error of errors) {
			safeError(`  - ${error}`);
		}
		Deno.exit(1);
	}
}

async function cleanupAutoBookmarks(
	options: CLIOptions,
	executor: CommandExecutor,
	autoBookmarkManager: AutoBookmarkManager,
): Promise<void> {
	if (options.keepAuto) return;

	safeLog("🧹 Cleaning up auto-bookmarks...");
	const autoBookmarks = await autoBookmarkManager.findAutoBookmarks();

	if (options.cleanupAllAuto) {
		await forceCleanupAllAutoBookmarks(autoBookmarks, options, executor);
	} else if (autoBookmarks.length > 0) {
		await cleanupMergedAutoBookmarks(autoBookmarks, autoBookmarkManager);
	}
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
		safeLog(`  - Deleted: ${bookmark}`);
	}
}

async function cleanupMergedAutoBookmarks(
	autoBookmarks: string[],
	autoBookmarkManager: AutoBookmarkManager,
): Promise<void> {
	const cleanupResult =
		await autoBookmarkManager.cleanupMergedAutoBookmarks(autoBookmarks);
	for (const deleted of cleanupResult.deleted) {
		safeLog(`  - ${deleted}: PR merged/closed ✓ deleted`);
	}
}

async function handleUnbookmarkedChanges(
	options: CLIOptions,
	autoBookmarkManager: AutoBookmarkManager,
): Promise<void> {
	if (!options.autoBookmark) return;

	safeLog("🔍 Checking for unbookmarked changes...");
	const unbookmarked = await autoBookmarkManager.findUnbookmarkedChanges();

	if (unbookmarked.length === 0) return;

	safeLog(`⚠️  Found ${unbookmarked.length} unbookmarked change(s)`);

	for (const change of unbookmarked) {
		await processUnbookmarkedChange(change, options, autoBookmarkManager);
	}
}

async function processUnbookmarkedChange(
	change: { changeId: string; description: string },
	options: CLIOptions,
	autoBookmarkManager: AutoBookmarkManager,
): Promise<void> {
	safeLog(`  - ${change.changeId}: ${change.description}`);

	if (!options.dryRun) {
		const autoBookmark = await autoBookmarkManager.createAutoBookmark(change);
		safeLog(`  🔖 Created auto-bookmark: ${autoBookmark.name}`);
	} else {
		const bookmarkName = autoBookmarkManager.generateBookmarkName(
			change.description,
			change.changeId,
		);
		safeLog(`  🔖 Would create: ${bookmarkName}`);
	}
}

function validateStackBookmarks(stack: StackInfo, options: CLIOptions): void {
	if (stack.bookmarks.length > 0) return;

	if (!options.autoBookmark) {
		safeError("❌ No bookmarks found in current stack!");
		safeError("\nCreate bookmarks for your changes. Examples:");
		safeError("  jj bookmark create <name> -r @   # for current change");
		safeError("  jj bookmark create <name> -r @-  # for previous change");
		safeError("  jj bookmark create <name> -r @-- # for change before that");
		safeError("\nOr use --auto-bookmark to automatically create bookmarks");
		Deno.exit(1);
	}

	if (options.dryRun) {
		safeLog(
			"\n✨ Dry run complete. Would have created auto-bookmarks and PRs.",
		);
		Deno.exit(0);
	}

	safeError("❌ No bookmarks found after auto-bookmark creation!");
	Deno.exit(1);
}

async function pushBookmarksToGitHub(
	options: CLIOptions,
	executor: CommandExecutor,
): Promise<void> {
	safeLog("🚀 Pushing bookmarks to GitHub...");

	if (options.dryRun) {
		safeLog("  (dry-run: would push all bookmarks)");
		return;
	}

	const pushResult = await executor.exec(["jj", "git", "push", "--all"]);
	if (pushResult.code !== 0) {
		safeError("❌ Failed to push bookmarks:", pushResult.stderr);
		Deno.exit(1);
	}
}

async function processPullRequest(
	pr: PRInfo,
	index: number,
	prChain: PRInfo[],
	options: CLIOptions,
	prManager: PullRequestManager,
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
			prManager,
			isDraft,
		);
	}
	return await createNewPR(
		pr,
		prCount,
		prChain.length,
		options,
		prManager,
		isDraft,
	);
}

async function updateExistingPR(
	pr: PRInfo,
	prCount: number,
	totalPRs: number,
	options: CLIOptions,
	prManager: PullRequestManager,
	_isDraft: boolean,
): Promise<PRChainInfo | null> {
	const existingPR = pr.existingPR;
	if (!existingPR) {
		// This shouldn't happen as this function is only called when existingPR exists
		safeError(`  ❌ No existing PR found for ${pr.bookmark}`);
		return null;
	}

	safeLog(
		`[${prCount}/${totalPRs}] 🔄 Updating PR #${existingPR.number}: ${pr.bookmark} → ${pr.base}`,
	);

	if (!options.dryRun) {
		if (existingPR.baseRefName !== pr.base) {
			await prManager.updatePR({
				prNumber: existingPR.number,
				base: pr.base,
			});
			safeLog(`  📝 Updated base: ${existingPR.baseRefName} → ${pr.base}`);
		}

		safeLog(`  ✅ Updated PR #${existingPR.number}`);
		return {
			bookmark: pr.bookmark,
			base: pr.base,
			prNumber: existingPR.number,
			isDraft: existingPR.isDraft,
			isReady: !existingPR.isDraft,
		};
	}

	safeLog(`  ✅ Updated PR #${existingPR.number}`);
	return null;
}

async function createNewPR(
	pr: PRInfo,
	prCount: number,
	totalPRs: number,
	options: CLIOptions,
	prManager: PullRequestManager,
	isDraft: boolean,
): Promise<PRChainInfo | null> {
	safeLog(
		`[${prCount}/${totalPRs}] 🆕 Creating PR: ${pr.bookmark} → ${pr.base}`,
	);

	if (!options.dryRun) {
		const prNumber = await prManager.createPR({
			title: pr.title,
			body: `Initial PR for ${pr.bookmark}`,
			head: pr.bookmark,
			base: pr.base,
			draft: isDraft,
		});

		const status = isDraft ? "draft" : "ready for review";
		safeLog(`  ✅ Created PR #${prNumber} (${status})`);

		return {
			bookmark: pr.bookmark,
			base: pr.base,
			prNumber,
			isDraft,
			isReady: !isDraft,
		};
	}

	safeLog(`  (dry-run: would create ${isDraft ? "draft" : "ready"} PR)`);
	return null;
}

async function updatePRDescriptions(
	createdPRs: PRChainInfo[],
	executor: CommandExecutor,
	descriptionGenerator: PRDescriptionGenerator,
	prManager: PullRequestManager,
): Promise<void> {
	safeLog("📝 Updating PR descriptions...");

	for (let i = 0; i < createdPRs.length; i++) {
		const pr = createdPRs[i];
		if (!pr.prNumber) continue;

		const originalBody = await fetchPRBody(
			pr.prNumber,
			executor,
			descriptionGenerator,
		);
		const description = descriptionGenerator.generateDescription({
			currentPR: pr,
			fullChain: createdPRs,
			position: i + 1,
			originalBody,
		});

		await prManager.updatePR({
			prNumber: pr.prNumber,
			body: description,
		});
	}
}

async function fetchPRBody(
	prNumber: number,
	executor: CommandExecutor,
	descriptionGenerator: PRDescriptionGenerator,
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
		return descriptionGenerator.extractOriginalBody(prData.body || "");
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

	safeLog("\n📊 Summary:");
	if (createdCount > 0) safeLog(`  • Created: ${createdCount} new PR(s)`);
	if (updatedCount > 0) safeLog(`  • Updated: ${updatedCount} existing PR(s)`);
	safeLog(`  • Ready for review: ${readyCount}`);
	safeLog(`  • Drafts: ${draftCount}`);

	safeLog("\nView your stack:");
	safeLog("  gh pr list --author @me --state open");
	safeLog("\nView in browser:");
	safeLog("  gh pr list --author @me --state open --web");
}

interface AppContext {
	executor: CommandExecutor;
	prManager: PullRequestManager;
	autoBookmarkManager: AutoBookmarkManager;
	descriptionGenerator: PRDescriptionGenerator;
	options: CLIOptions & { baseBranch: string }; // baseBranch is guaranteed to be set
}

async function processStack(ctx: AppContext): Promise<void> {
	// Step 1: Clean up auto bookmarks
	await cleanupAutoBookmarks(
		ctx.options,
		ctx.executor,
		ctx.autoBookmarkManager,
	);

	// Step 2: Handle unbookmarked changes
	await handleUnbookmarkedChanges(ctx.options, ctx.autoBookmarkManager);

	// Step 3: Detect and validate stack
	const stack = await detectAndValidateStack(ctx);

	// Step 4: Push bookmarks to GitHub
	await pushBookmarksToGitHub(ctx.options, ctx.executor);

	// Step 5: Process PRs
	await processPRs(ctx, stack);
}

async function detectAndValidateStack(ctx: AppContext): Promise<StackInfo> {
	safeLog("🔍 Detecting stack...");

	// Check for non-linear stacks (BUG-004)
	await ensureLinearStack(ctx.executor);

	const stack = await detectStack(ctx.executor, ctx.options.baseBranch);
	validateStackBookmarks(stack, ctx.options);
	safeLog(`📚 Found stack with ${stack.bookmarks.length} bookmark(s)`);
	return stack;
}

async function ensureLinearStack(executor: CommandExecutor): Promise<void> {
	const linearityCheck = await checkStackLinearity(executor);
	if (linearityCheck.isLinear) {
		return;
	}

	safeError(`❌ ${linearityCheck.message}`);
	if (linearityCheck.problematicCommits.length > 0) {
		safeError("  Problematic commits:");
		for (const commit of linearityCheck.problematicCommits) {
			safeError(`    - ${commit}`);
		}
	}
	safeError("\n⚠️  This tool only supports linear stacks!");
	safeError(
		"  Please resolve merge commits or divergent branches before using jj-stack-prs.",
	);
	safeError("  You can use 'jj rebase' to linearize your stack.");
	Deno.exit(1);
}

async function processPRs(ctx: AppContext, stack: StackInfo): Promise<void> {
	safeLog("🔗 Building PR chain...");
	const existingPRs = await ctx.prManager.findExistingPRs(stack.bookmarks);
	const prChain = await ctx.prManager.buildPRChain(
		stack.bookmarks,
		existingPRs,
		ctx.options.baseBranch,
	);

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
			ctx.prManager,
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
		await updatePRDescriptions(
			createdPRs,
			ctx.executor,
			ctx.descriptionGenerator,
			ctx.prManager,
		);
	}

	if (!ctx.options.dryRun) {
		showSummary(createdPRs, existingPRs);
	}
}

function handleError(error: unknown, options: CLIOptions): void {
	safeError(
		"❌ Error:",
		error instanceof Error ? error.message : String(error),
	);
	if (options.dryRun) {
		safeError("(This was a dry run - no changes were made)");
	}
	Deno.exit(1);
}

async function main() {
	// Install handlers for broken pipe errors (BUG-001)
	installBrokenPipeHandlers();

	const options = parseArguments(Deno.args);
	await handleHelp(options);
	handleValidationErrors(validateOptions(options));

	const executor = new SystemCommandExecutor();

	// Validate GitHub authentication early (BUG-006)
	await validateGitHubAuthOrExit(executor, options.dryRun);

	// Auto-detect base branch if not provided
	if (!options.baseBranch) {
		const detectedBase = await detectBaseBranch(executor);
		if (detectedBase) {
			options.baseBranch = detectedBase;
			safeLog(`🔍 Auto-detected base branch: ${detectedBase}`);
		} else {
			// Fall back to "master" if auto-detection fails
			options.baseBranch = "master";
			safeLog("⚠️  Could not auto-detect base branch, using 'master'");
			safeLog("   Use --base <branch> to specify a different base branch");
		}
	}

	const ctx: AppContext = {
		executor,
		prManager: new PullRequestManager(executor),
		autoBookmarkManager: new AutoBookmarkManager(executor),
		descriptionGenerator: new PRDescriptionGenerator(),
		options: options as CLIOptions & { baseBranch: string },
	};

	try {
		await processStack(ctx);
	} catch (error) {
		handleError(error, options);
	}
}

// Run main function
if (import.meta.main) {
	await main();
}
