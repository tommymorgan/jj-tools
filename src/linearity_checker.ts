import type { CommandExecutor } from "./stack_detection.ts";

export interface LinearityCheckResult {
	isLinear: boolean;
	problematicCommits: string[];
	message: string;
}

/**
 * Checks if the current stack is linear (no merges or divergent branches)
 * A linear stack means each commit has at most one parent (except the root)
 */
export async function checkStackLinearity(
	executor: CommandExecutor,
): Promise<LinearityCheckResult> {
	// Check for merge commits
	const mergeResult = await checkForMergeCommits(executor);
	if (!mergeResult.isLinear) {
		return mergeResult;
	}

	// Check for divergent branches
	const divergenceResult = await checkForDivergentBranches(executor);
	if (!divergenceResult.isLinear) {
		return divergenceResult;
	}

	return {
		isLinear: true,
		problematicCommits: [],
		message: "Stack is linear",
	};
}

async function checkForMergeCommits(
	executor: CommandExecutor,
): Promise<LinearityCheckResult> {
	const result = await executor.exec([
		"jj",
		"log",
		"-r",
		"::@ & trunk()..",
		"--no-graph",
		"--template",
		'if(parents.len() > 1, change_id ++ " MERGE " ++ parents.len() ++ "\\n", "")',
	]);

	if (result.code !== 0) {
		return {
			isLinear: false,
			problematicCommits: [],
			message: `Failed to check stack linearity: ${result.stderr}`,
		};
	}

	const mergeCommits = parseMergeCommits(result.stdout);

	if (mergeCommits.length > 0) {
		return {
			isLinear: false,
			problematicCommits: mergeCommits,
			message: `Non-linear stack detected! Found ${mergeCommits.length} merge commit(s)`,
		};
	}

	return {
		isLinear: true,
		problematicCommits: [],
		message: "No merge commits found",
	};
}

function parseMergeCommits(output: string): string[] {
	const mergeCommits: string[] = [];
	const lines = output.split("\n").filter((line) => line.trim());

	for (const line of lines) {
		if (line.includes("MERGE")) {
			const [changeId, , parentCount] = line.split(" ");
			mergeCommits.push(`${changeId} (${parentCount} parents)`);
		}
	}

	return mergeCommits;
}

async function checkForDivergentBranches(
	executor: CommandExecutor,
): Promise<LinearityCheckResult> {
	const result = await executor.exec([
		"jj",
		"log",
		"-r",
		"::@ & trunk()..",
		"--no-graph",
		"--template",
		'change_id ++ " " ++ children.len() ++ "\\n"',
	]);

	if (result.code !== 0) {
		return {
			isLinear: true, // Assume linear if we can't check
			problematicCommits: [],
			message: "Could not check for divergent branches",
		};
	}

	const divergentCommits = parseDivergentCommits(result.stdout);

	if (divergentCommits.length > 0) {
		return {
			isLinear: false,
			problematicCommits: divergentCommits,
			message: `Non-linear stack detected! Found ${divergentCommits.length} divergent commit(s)`,
		};
	}

	return {
		isLinear: true,
		problematicCommits: [],
		message: "No divergent branches found",
	};
}

function parseDivergentCommits(output: string): string[] {
	const divergentCommits: string[] = [];
	const lines = output.split("\n").filter((line) => line.trim());

	for (const line of lines) {
		const [changeId, childCount] = line.split(" ");
		if (childCount && Number.parseInt(childCount) > 1) {
			divergentCommits.push(`${changeId} (${childCount} children)`);
		}
	}

	return divergentCommits;
}
