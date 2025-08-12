import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parse as parseSemver, compare } from "@std/semver";

describe("Version Checking with semver library", () => {
	describe("semver validation", () => {
		it("should parse valid semantic versions", () => {
			// Assert - parse returns a SemVer object or throws
			assertEquals(parseSemver("1.2.3") !== null, true);
			assertEquals(parseSemver("0.0.0") !== null, true);
			assertEquals(parseSemver("10.20.30") !== null, true);
		});

		it("should throw for invalid versions", () => {
			// Helper to test if parsing throws
			const shouldThrow = (version: string) => {
				try {
					parseSemver(version);
					return false;
				} catch {
					return true;
				}
			};
			
			// Assert - parse throws on invalid versions
			assertEquals(shouldThrow("1.2"), true);
			assertEquals(shouldThrow("1.2.3.4"), true);
			assertEquals(shouldThrow("abc"), true);
		});
	});

	describe("version comparison", () => {
		it("should detect version is higher", () => {
			// Parse versions first
			const v1 = parseSemver("2.0.0");
			const v2 = parseSemver("1.0.0");
			const v3 = parseSemver("1.2.0");
			const v4 = parseSemver("1.1.0");
			const v5 = parseSemver("1.1.3");
			const v6 = parseSemver("1.1.2");
			
			// Assert - returns positive if first > second
			assertEquals(v1 && v2 && compare(v1, v2) > 0, true); // major bump
			assertEquals(v3 && v4 && compare(v3, v4) > 0, true); // minor bump
			assertEquals(v5 && v6 && compare(v5, v6) > 0, true); // patch bump
		});

		it("should detect version is lower", () => {
			// Parse versions first
			const v1 = parseSemver("1.0.0");
			const v2 = parseSemver("2.0.0");
			const v3 = parseSemver("1.1.0");
			const v4 = parseSemver("1.2.0");
			const v5 = parseSemver("1.1.2");
			const v6 = parseSemver("1.1.3");
			
			// Assert - returns negative if first < second
			assertEquals(v1 && v2 && compare(v1, v2) < 0, true);
			assertEquals(v3 && v4 && compare(v3, v4) < 0, true);
			assertEquals(v5 && v6 && compare(v5, v6) < 0, true);
		});

		it("should detect versions are equal", () => {
			const v1 = parseSemver("1.2.3");
			const v2 = parseSemver("1.2.3");
			
			// Assert - returns 0 if equal
			assertEquals(v1 && v2 && compare(v1, v2), 0);
		});
	});

	describe("version parsing", () => {
		it("should parse version components", () => {
			const version = parseSemver("1.2.3");
			
			// Assert
			assertEquals(version?.major, 1);
			assertEquals(version?.minor, 2);
			assertEquals(version?.patch, 3);
		});

		it("should handle prerelease versions", () => {
			const version = parseSemver("1.2.3-alpha.1");
			
			// Assert
			assertEquals(version?.major, 1);
			assertEquals(version?.minor, 2);
			assertEquals(version?.patch, 3);
			assertEquals(version?.prerelease, ["alpha", 1]);
		});
	});
});