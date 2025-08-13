export interface PRChainInfo {
	bookmark: string;
	base: string;
	prNumber?: number;
	isDraft: boolean;
	isReady: boolean;
	commitMessage?: string;
}

export interface PRDescriptionOptions {
	currentPR: PRChainInfo;
	fullChain: PRChainInfo[];
	position: number;
	originalBody: string;
}

export class PRDescriptionGenerator {
	generateDescription(options: PRDescriptionOptions): string {
		const { currentPR, fullChain, position } = options;
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

		// Add commit message as the body
		if (currentPR.commitMessage) {
			sections.push("");
			sections.push(currentPR.commitMessage);
		}

		// Add separator
		sections.push("");
		sections.push("---");

		// Add full chain visualization
		const today = new Date().toISOString().split("T")[0];
		sections.push(`PR Stack (review in order) as of ${today}:`);

		// Add each PR in the chain as an ordered list
		for (let i = 0; i < fullChain.length; i++) {
			const pr = fullChain[i];
			const isCurrent = pr === currentPR;
			const orderNumber = i + 1;
			sections.push(this.formatChainItem(pr, isCurrent, orderNumber));
		}

		// Add footer
		sections.push("");
		sections.push("Created with jj (Jujutsu) stack-prs");

		return sections.join("\n");
	}

	extractOriginalBody(fullDescription: string): string {
		if (!fullDescription) return "";

		const lines = fullDescription.split("\n");
		const startIndex = this.findContentStart(lines);

		if (startIndex === -1) {
			return fullDescription;
		}

		const endIndex = this.findContentEnd(lines, startIndex);
		const bodyLines = this.extractBodyLines(lines, startIndex, endIndex);

		return bodyLines.join("\n");
	}

	private findContentStart(lines: string[]): number {
		const startMarkers = ["Stack position:", "Base:", "Depends on:"];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const isMetadata = startMarkers.some((marker) => line.startsWith(marker));

			if (!isMetadata && line.trim() !== "") {
				return i;
			}
		}

		return -1;
	}

	private findContentEnd(lines: string[], startIndex: number): number {
		const endMarkers = ["---", "Full chain of PRs", "PR Stack"];

		for (let i = startIndex; i < lines.length; i++) {
			const line = lines[i];
			if (endMarkers.some((marker) => line.includes(marker))) {
				return i;
			}
		}

		return lines.length;
	}

	private extractBodyLines(
		lines: string[],
		startIndex: number,
		endIndex: number,
	): string[] {
		const bodyLines = lines.slice(startIndex, endIndex);

		// Remove trailing empty lines
		while (
			bodyLines.length > 0 &&
			bodyLines[bodyLines.length - 1].trim() === ""
		) {
			bodyLines.pop();
		}

		return bodyLines;
	}

	formatPRStatus(isDraft: boolean, _isReady: boolean): string {
		if (isDraft) {
			return "draft";
		}
		return "ready for review";
	}

	formatChainItem(
		item: PRChainInfo,
		isCurrent: boolean,
		orderNumber: number,
	): string {
		const status = this.formatPRStatus(item.isDraft, item.isReady);

		let line: string;
		if (item.prNumber) {
			line = `PR #${item.prNumber}: ${item.bookmark} → ${item.base} (${status})`;
		} else {
			line = `${item.bookmark} → ${item.base} (${status})`;
		}

		if (isCurrent) {
			return `${orderNumber}. 👉 **You are here** 👉 **${line}**`;
		} else {
			return `${orderNumber}. ${line}`;
		}
	}
}
