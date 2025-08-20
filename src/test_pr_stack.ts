#!/usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

import { detectPRStack, reconcilePRBookmarks } from "./pr_stack_detector.ts";
import type { CommandExecutor } from "./stack_detection.ts";

const realExecutor: CommandExecutor = {
	exec: async (cmd: string[]) => {
		const process = new Deno.Command(cmd[0], {
			args: cmd.slice(1),
			stdout: "piped",
			stderr: "piped",
		});
		const result = await process.output();
		const decoder = new TextDecoder();
		return {
			stdout: decoder.decode(result.stdout),
			stderr: decoder.decode(result.stderr),
			code: result.code,
		};
	},
};

async function testPRStackDetection() {
	console.log("🔍 Testing PR-aware Stack Detection\n");

	try {
		// Detect the PR stack
		const stackInfo = await detectPRStack(realExecutor);

		console.log(`📊 Found ${stackInfo.prs.length} PRs in the stack:\n`);

		if (stackInfo.prs.length > 0) {
			console.log("PR Stack (bottom to top):");
			for (let i = 0; i < stackInfo.prs.length; i++) {
				const pr = stackInfo.prs[i];
				const hasLocal = stackInfo.existingLocalBookmarks.includes(
					pr.headRefName,
				);
				console.log(
					`  ${i + 1}. #${pr.number}: ${pr.headRefName} → ${pr.baseRefName}`,
				);
				console.log(`     ${pr.title}`);
				console.log(
					`     Local bookmark: ${hasLocal ? "✅ EXISTS" : "❌ MISSING"}`,
				);
			}
		}

		if (stackInfo.missingLocalBookmarks.length > 0) {
			console.log(
				`\n⚠️  Missing ${stackInfo.missingLocalBookmarks.length} local bookmark(s):`,
			);
			for (const bookmark of stackInfo.missingLocalBookmarks) {
				console.log(`  - ${bookmark}`);
			}

			console.log("\n🔧 Testing reconciliation (dry-run):");
			const result = await reconcilePRBookmarks(
				realExecutor,
				stackInfo.missingLocalBookmarks,
				true, // dry-run
			);

			if (result.success) {
				console.log(
					`\n✅ Would create ${result.createdBookmarks.length} local bookmark(s)`,
				);
			} else {
				console.log(`\n❌ Reconciliation would fail: ${result.error}`);
			}
		} else {
			console.log("\n✅ All PR bookmarks exist locally!");
		}
	} catch (error) {
		console.error("❌ Error:", error);
	}
}

// Run the test
if (import.meta.main) {
	await testPRStackDetection();
}
