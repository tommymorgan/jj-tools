#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { AutoBookmarkManager } from "./auto_bookmark.ts";
import {
	type CLIOptions,
	parseArguments,
	showHelp,
	validateOptions,
} from "./cli.ts";
import { type PRChainInfo, PRDescriptionGenerator } from "./pr_description.ts";
import {
	type ExistingPR,
	type PRInfo,
	PullRequestManager,
} from "./pr_manager.ts";
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
		console.log(showHelp());
		Deno.exit(0);
	}
}

function handleValidationErrors(errors: string[]): void {
	if (errors.length > 0) {
		console.error("❌ Invalid options:");
		for (const error of errors) {
			console.error(`  - ${error}`);
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

	console.log("🧹 Cleaning up auto-bookmarks...");
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
		console.log(`  - Deleted: ${bookmark}`);
	}
}

async function cleanupMergedAutoBookmarks(
	autoBookmarks: string[],
	autoBookmarkManager: AutoBookmarkManager,
): Promise<void> {
	const cleanupResult =
		await autoBookmarkManager.cleanupMergedAutoBookmarks(autoBookmarks);
	for (const deleted of cleanupResult.deleted) {
		console.log(`  - ${deleted}: PR merged/closed ✓ deleted`);
	}
}

async function handleUnbookmarkedChanges(
	options: CLIOptions,
	autoBookmarkManager: AutoBookmarkManager,
): Promise<void> {
	if (!options.autoBookmark) return;

	console.log("🔍 Checking for unbookmarked changes...");
	const unbookmarked = await autoBookmarkManager.findUnbookmarkedChanges();

	if (unbookmarked.length === 0) return;

	console.log(`⚠️  Found ${unbookmarked.length} unbookmarked change(s)`);

	for (const change of unbookmarked) {
		await processUnbookmarkedChange(change, options, autoBookmarkManager);
	}
}

async function processUnbookmarkedChange(
	change: { changeId: string; description: string },
	options: CLIOptions,
	autoBookmarkManager: AutoBookmarkManager,
): Promise<void> {
	console.log(`  - ${change.changeId}: ${change.description}`);

	if (!options.dryRun) {
		const autoBookmark = await autoBookmarkManager.createAutoBookmark(change);
		console.log(`  🔖 Created auto-bookmark: ${autoBookmark.name}`);
	} else {
		const bookmarkName = autoBookmarkManager.generateBookmarkName(
			change.description,
			change.changeId,
		);
		console.log(`  🔖 Would create: ${bookmarkName}`);
	}
}

function validateStackBookmarks(stack: StackInfo, options: CLIOptions): void {
	if (stack.bookmarks.length > 0) return;

	if (!options.autoBookmark) {
		console.error("❌ No bookmarks found in current stack!");
		console.error("\nCreate bookmarks for your changes. Examples:");
		console.error("  jj bookmark create <name> -r @   # for current change");
		console.error("  jj bookmark create <name> -r @-  # for previous change");
		console.error(
			"  jj bookmark create <name> -r @-- # for change before that",
		);
		console.error("\nOr use --auto-bookmark to automatically create bookmarks");
		Deno.exit(1);
	}

	if (options.dryRun) {
		console.log(
			"\n✨ Dry run complete. Would have created auto-bookmarks and PRs.",
		);
		Deno.exit(0);
	}

	console.error("❌ No bookmarks found after auto-bookmark creation!");
	Deno.exit(1);
}

async function pushBookmarksToGitHub(
	options: CLIOptions,
	executor: CommandExecutor,
): Promise<void> {
	console.log("🚀 Pushing bookmarks to GitHub...");

	if (options.dryRun) {
		console.log("  (dry-run: would push all bookmarks)");
		return;
	}

	const pushResult = await executor.exec(["jj", "git", "push", "--all"]);
	if (pushResult.code !== 0) {
		console.error("❌ Failed to push bookmarks:", pushResult.stderr);
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
		console.error(`  ❌ No existing PR found for ${pr.bookmark}`);
		return null;
	}

	console.log(
		`[${prCount}/${totalPRs}] 🔄 Updating PR #${existingPR.number}: ${pr.bookmark} → ${pr.base}`,
	);

	if (!options.dryRun) {
		if (existingPR.baseRefName !== pr.base) {
			await prManager.updatePR({
				prNumber: existingPR.number,
				base: pr.base,
			});
			console.log(`  📝 Updated base: ${existingPR.baseRefName} → ${pr.base}`);
		}

		console.log(`  ✅ Updated PR #${existingPR.number}`);
		return {
			bookmark: pr.bookmark,
			base: pr.base,
			prNumber: existingPR.number,
			isDraft: existingPR.isDraft,
			isReady: !existingPR.isDraft,
		};
	}

	console.log(`  ✅ Updated PR #${existingPR.number}`);
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
	console.log(
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
		console.log(`  ✅ Created PR #${prNumber} (${status})`);

		return {
			bookmark: pr.bookmark,
			base: pr.base,
			prNumber,
			isDraft,
			isReady: !isDraft,
		};
	}

	console.log(`  (dry-run: would create ${isDraft ? "draft" : "ready"} PR)`);
	return null;
}

async function updatePRDescriptions(
	createdPRs: PRChainInfo[],
	executor: CommandExecutor,
	descriptionGenerator: PRDescriptionGenerator,
	prManager: PullRequestManager,
): Promise<void> {
	console.log("📝 Updating PR descriptions...");

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
	console.log("\n✨ Stack PRs created with full chain visualization!");

	const createdCount = createdPRs.filter(
		(pr) => !existingPRs.has(pr.bookmark),
	).length;
	const updatedCount = createdPRs.filter((pr) =>
		existingPRs.has(pr.bookmark),
	).length;
	const readyCount = createdPRs.filter((pr) => pr.isReady).length;
	const draftCount = createdPRs.filter((pr) => pr.isDraft).length;

	console.log("\n📊 Summary:");
	if (createdCount > 0) console.log(`  • Created: ${createdCount} new PR(s)`);
	if (updatedCount > 0)
		console.log(`  • Updated: ${updatedCount} existing PR(s)`);
	console.log(`  • Ready for review: ${readyCount}`);
	console.log(`  • Drafts: ${draftCount}`);

	console.log("\nView your stack:");
	console.log("  gh pr list --author @me --state open");
	console.log("\nView in browser:");
	console.log("  gh pr list --author @me --state open --web");
}

interface AppContext {
	executor: CommandExecutor;
	prManager: PullRequestManager;
	autoBookmarkManager: AutoBookmarkManager;
	descriptionGenerator: PRDescriptionGenerator;
	options: CLIOptions;
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
	console.log("🔍 Detecting stack...");
	const stack = await detectStack(ctx.executor, ctx.options.baseBranch);
	validateStackBookmarks(stack, ctx.options);
	console.log(`📚 Found stack with ${stack.bookmarks.length} bookmark(s)`);
	return stack;
}

async function processPRs(ctx: AppContext, stack: StackInfo): Promise<void> {
	console.log("🔗 Building PR chain...");
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
	console.error(
		"❌ Error:",
		error instanceof Error ? error.message : String(error),
	);
	if (options.dryRun) {
		console.error("(This was a dry run - no changes were made)");
	}
	Deno.exit(1);
}

async function main() {
	const options = parseArguments(Deno.args);
	await handleHelp(options);
	handleValidationErrors(validateOptions(options));

	const executor = new SystemCommandExecutor();
	const ctx: AppContext = {
		executor,
		prManager: new PullRequestManager(executor),
		autoBookmarkManager: new AutoBookmarkManager(executor),
		descriptionGenerator: new PRDescriptionGenerator(),
		options,
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
