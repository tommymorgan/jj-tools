export interface PRChainInfo {
	bookmark: string;
	base: string;
	prNumber?: number;
	isDraft: boolean;
	isReady: boolean;
}

export interface PRDescriptionOptions {
	currentPR: PRChainInfo;
	fullChain: PRChainInfo[];
	position: number;
	originalBody: string;
}

export class PRDescriptionGenerator {
	generateDescription(options: PRDescriptionOptions): string {
		const { currentPR, fullChain, position, originalBody } = options;
		const totalPRs = fullChain.length;

		// Build header sections
		const sections: string[] = [];

		// Stack position
		sections.push(`Stack position: ${position} of ${totalPRs}`);

		// Base branch
		sections.push(`Base: \`${currentPR.base}\``);

		// Dependencies (if not bottom of stack)
		if (position > 1) {
			const dependsOn = fullChain[position - 2]; // Previous PR in chain
			if (dependsOn.prNumber) {
				sections.push(`Depends on: #${dependsOn.prNumber}`);
			}
		}

		// Add original body if exists
		if (originalBody) {
			sections.push("");
			sections.push(originalBody);
		}

		// Add separator
		sections.push("");
		sections.push("---");

		// Add full chain visualization
		const today = new Date().toISOString().split("T")[0];
		sections.push(`Full chain of PRs as of ${today}:`);

		// Add each PR in the chain
		for (let i = 0; i < fullChain.length; i++) {
			const pr = fullChain[i];
			const isCurrent = pr === currentPR;
			sections.push(this.formatChainItem(pr, isCurrent));
		}

		// Add footer
		sections.push("");
		sections.push("Created with jj (Jujutsu) stack-prs");

		return sections.join("\n");
	}

	extractOriginalBody(fullDescription: string): string {
		if (!fullDescription) return "";

		// Try to extract content between header metadata and chain visualization
		const lines = fullDescription.split("\n");
		const startMarkers = ["Stack position:", "Base:", "Depends on:"];
		const endMarkers = ["---", "Full chain of PRs"];

		let startIndex = -1;
		let endIndex = lines.length;

		// Find where metadata ends
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const isMetadata = startMarkers.some((marker) => line.startsWith(marker));

			if (!isMetadata && startIndex === -1 && line.trim() !== "") {
				startIndex = i;
				break;
			}
		}

		// Find where chain visualization starts
		for (let i = startIndex; i < lines.length; i++) {
			const line = lines[i];
			if (endMarkers.some((marker) => line.includes(marker))) {
				endIndex = i;
				break;
			}
		}

		// If no metadata found, return full description
		if (startIndex === -1) {
			return fullDescription;
		}

		// Extract the original body
		const bodyLines = lines.slice(startIndex, endIndex);

		// Remove trailing empty lines
		while (
			bodyLines.length > 0 &&
			bodyLines[bodyLines.length - 1].trim() === ""
		) {
			bodyLines.pop();
		}

		return bodyLines.join("\n");
	}

	formatPRStatus(isDraft: boolean, isReady: boolean): string {
		if (isDraft) {
			return "draft";
		}
		return "ready for review";
	}

	formatChainItem(item: PRChainInfo, isCurrent: boolean): string {
		const status = this.formatPRStatus(item.isDraft, item.isReady);

		let line: string;
		if (item.prNumber) {
			line = `PR #${item.prNumber}: ${item.bookmark} → ${item.base} (${status})`;
		} else {
			line = `${item.bookmark} → ${item.base} (${status})`;
		}

		if (isCurrent) {
			return `• **${line}**`;
		} else {
			return `• ${line}`;
		}
	}
}
