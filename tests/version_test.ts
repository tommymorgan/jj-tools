import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getVersion, showVersion } from "../src/version.ts";

describe("Version utilities", () => {
	describe("getVersion", () => {
		it("should return a valid semantic version string", () => {
			// Act
			const version = getVersion();

			// Assert - should match semantic versioning pattern
			const semverPattern = /^\d+\.\d+\.\d+$/;
			assertEquals(semverPattern.test(version), true);
		});

		it("should return same version when called multiple times", () => {
			// Act - call twice
			const version1 = getVersion();
			const version2 = getVersion();

			// Assert - should return same value
			assertEquals(version1, version2);
		});
	});

	describe("showVersion", () => {
		it("should include program name and version", () => {
			// Act
			const versionString = showVersion();
			const version = getVersion();

			// Assert
			assertEquals(versionString, `jj-stack-prs version ${version}`);
		});
	});
});
