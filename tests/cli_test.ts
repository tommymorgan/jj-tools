import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
	type CLIOptions,
	parseArguments,
	showHelp,
	validateOptions,
} from "../src/cli.ts";

describe("CLI Parser", () => {
	describe("parseArguments", () => {
		it("should parse default options with no arguments", () => {
			// Arrange
			const args: string[] = [];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.baseBranch, undefined); // Now auto-detected
			assertEquals(options.autoBookmark, false);
			assertEquals(options.keepAuto, false);
			assertEquals(options.cleanupAllAuto, false);
			assertEquals(options.help, false);
			assertEquals(options.dryRun, false);
		});

		it("should parse custom base branch", () => {
			// Arrange
			const args = ["--base", "develop"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.baseBranch, "develop");
		});

		it("should parse auto-bookmark flag", () => {
			// Arrange
			const args = ["--auto-bookmark"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.autoBookmark, true);
		});

		it("should parse keep-auto flag", () => {
			// Arrange
			const args = ["--keep-auto"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.keepAuto, true);
		});

		it("should parse cleanup-all-auto flag", () => {
			// Arrange
			const args = ["--cleanup-all-auto"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.cleanupAllAuto, true);
		});

		it("should parse dry-run flag", () => {
			// Arrange
			const args = ["--dry-run"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.dryRun, true);
		});

		it("should parse version flag", () => {
			// Arrange
			const args = ["--version"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.version, true);
		});

		it("should parse version flag short form", () => {
			// Arrange
			const args = ["-v"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.version, true);
		});

		it("should parse help flag", () => {
			// Arrange
			const args = ["--help"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.help, true);
		});

		it("should parse short form flags", () => {
			// Arrange
			const args = ["-h"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.help, true);
		});

		it("should parse multiple flags together", () => {
			// Arrange
			const args = ["--base", "main", "--auto-bookmark", "--dry-run"];

			// Act
			const options = parseArguments(args);

			// Assert
			assertEquals(options.baseBranch, "main");
			assertEquals(options.autoBookmark, true);
			assertEquals(options.dryRun, true);
		});
	});

	describe("validateOptions", () => {
		it("should accept valid options", () => {
			// Arrange
			const options: CLIOptions = {
				baseBranch: "master",
				autoBookmark: false,
				keepAuto: false,
				cleanupAllAuto: false,
				help: false,
				version: false,
				dryRun: false,
			};

			// Act
			const errors = validateOptions(options);

			// Assert
			assertEquals(errors.length, 0);
		});

		it("should reject conflicting cleanup options", () => {
			// Arrange
			const options: CLIOptions = {
				baseBranch: "master",
				autoBookmark: false,
				keepAuto: true,
				cleanupAllAuto: true,
				help: false,
				version: false,
				dryRun: false,
			};

			// Act
			const errors = validateOptions(options);

			// Assert
			assertEquals(errors.length, 1);
			assertEquals(
				errors[0],
				"Cannot use --keep-auto and --cleanup-all-auto together",
			);
		});

		it("should accept undefined base branch (will be auto-detected)", () => {
			// Arrange
			const options: CLIOptions = {
				baseBranch: undefined,
				autoBookmark: false,
				keepAuto: false,
				cleanupAllAuto: false,
				help: false,
				version: false,
				dryRun: false,
			};

			// Act
			const errors = validateOptions(options);

			// Assert
			assertEquals(errors.length, 0); // No errors, base will be auto-detected
		});
	});

	describe("showHelp", () => {
		it("should return help text", () => {
			// Act
			const helpText = showHelp();

			// Assert
			assertExists(helpText);
			assertEquals(helpText.includes("jj-stack-prs"), true);
			assertEquals(
				helpText.includes("Create GitHub PRs from Jujutsu stack"),
				true,
			);
			assertEquals(helpText.includes("OPTIONS:"), true);
			assertEquals(helpText.includes("--base"), true);
			assertEquals(helpText.includes("--auto-bookmark"), true);
			assertEquals(helpText.includes("--keep-auto"), true);
			assertEquals(helpText.includes("--cleanup-all-auto"), true);
			assertEquals(helpText.includes("--dry-run"), true);
			assertEquals(helpText.includes("--help"), true);
			assertEquals(helpText.includes("EXAMPLES:"), true);
		});

		it("should include usage examples", () => {
			// Act
			const helpText = showHelp();

			// Assert
			assertEquals(helpText.includes("jj-stack-prs"), true);
			assertEquals(helpText.includes("jj-stack-prs --base develop"), true);
			assertEquals(helpText.includes("jj-stack-prs --auto-bookmark"), true);
		});
	});
});
