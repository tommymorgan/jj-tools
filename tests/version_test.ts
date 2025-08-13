import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getVersion, showVersion } from "../src/version.ts";

describe("Version utilities", () => {
	describe("getVersion", () => {
		it("should return version from deno.json", async () => {
			// Act
			const version = await getVersion();

			// Assert - we know it's 0.1.8 from deno.json
			assertEquals(version, "0.1.8");
		});

		it("should cache version after first read", async () => {
			// Act - call twice
			const version1 = await getVersion();
			const version2 = await getVersion();

			// Assert - should return same value
			assertEquals(version1, version2);
			assertEquals(version1, "0.1.8");
		});
	});

	describe("showVersion", () => {
		it("should format version string correctly", async () => {
			// Act
			const versionString = await showVersion();

			// Assert
			assertEquals(versionString, "jj-stack-prs version 0.1.8");
		});
	});
});
