// test/releaseNotes.test.ts — spec 009: CHANGELOG.md → splash notes.
// Fixtures mirror the repository's own CHANGELOG.md shape verbatim.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// @ts-expect-error — plain .mjs build-time module, no type declarations
import { extractReleaseNotes, cleanBullet } from "../scripts/releaseNotes.mjs";

const CHANGELOG = `## [0.8.1](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.8.0...0.8.1) (2026-08-31)

### Bug Fixes

* **scripts:** pass local id to removeCommand so script commands actually unregister ([#35](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/35)) ([3bfde5a](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/3bfde5ab)), closes [#25](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/25)

## [0.8.0](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.7.1...0.8.0) (2026-07-23)

### Features

* **cleanup:** box-drawing table → Markdown table transform (spec 007) ([#26](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/26)) ([de33b9c](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/de33b9cb))

# [0.6.0](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.5.0...0.6.0) (2026-06-30)

### Features

* **scripts:** vetted-repo script library with full lifecycle ([#20](https://x/20))
* **ui:** settings tab segments

### Bug Fixes

* **release:** drop spurious issue links ([#21](https://x/21))
`;

describe("cleanBullet", () => {
	it("strips the marker, link groups, the closes trailer and emphasis", () => {
		expect(
			cleanBullet(
				"* **scripts:** pass local id to removeCommand so script commands actually unregister " +
				"([#35](https://x/35)) ([3bfde5a](https://x/c)), closes [#25](https://x/25)",
			),
		).toBe("scripts: pass local id to removeCommand so script commands actually unregister");
	});

	it("keeps the scope and any (spec NNN) reference as prose", () => {
		expect(cleanBullet("* **cleanup:** box-drawing table → Markdown table transform (spec 007) ([#26](https://x/26))"))
			.toBe("cleanup: box-drawing table → Markdown table transform (spec 007)");
	});

	it("keeps the text of a bare inline link", () => {
		expect(cleanBullet("* see [the docs](https://x/docs) for details"))
			.toBe("see the docs for details");
	});

	it("collapses whitespace runs", () => {
		expect(cleanBullet("*   spaced    out   ")).toBe("spaced out");
	});
});

describe("extractReleaseNotes", () => {
	const EMPTY = { features: [], fixes: [] };

	it("reads the topmost section by default", () => {
		// 0.8.1 is topmost: no Features subsection, one Bug Fixes bullet.
		expect(extractReleaseNotes(CHANGELOG)).toEqual({
			features: [],
			fixes: ["scripts: pass local id to removeCommand so script commands actually unregister"],
		});
	});

	it("reads a '##' section by version", () => {
		expect(extractReleaseNotes(CHANGELOG, "0.8.0")).toEqual({
			features: ["cleanup: box-drawing table → Markdown table transform (spec 007)"],
			fixes: [],
		});
	});

	it("reads a '#' major section and every bullet in it", () => {
		expect(extractReleaseNotes(CHANGELOG, "0.6.0")).toEqual({
			features: [
				"scripts: vetted-repo script library with full lifecycle",
				"ui: settings tab segments",
			],
			fixes: ["release: drop spurious issue links"],
		});
	});

	it("keeps the two subsections apart — neither leaks into the other", () => {
		const notes = extractReleaseNotes(CHANGELOG, "0.6.0") as { features: string[]; fixes: string[] };
		expect(notes.features.some((n) => n.includes("drop spurious issue links"))).toBe(false);
		expect(notes.fixes.some((n) => n.includes("settings tab segments"))).toBe(false);
	});

	it("falls back to the topmost section for an unknown version", () => {
		expect(extractReleaseNotes(CHANGELOG, "9.9.9")).toEqual(extractReleaseNotes(CHANGELOG));
	});

	it("returns both groups empty for empty, malformed and non-string input, never throwing", () => {
		expect(extractReleaseNotes("")).toEqual(EMPTY);
		expect(extractReleaseNotes("no headings at all\njust prose\n")).toEqual(EMPTY);
		expect(extractReleaseNotes("## [1.0.0](u) (d)\n\n### Features\n\n")).toEqual(EMPTY);
		expect(extractReleaseNotes(undefined as unknown as string)).toEqual(EMPTY);
		expect(extractReleaseNotes(null as unknown as string)).toEqual(EMPTY);
	});

	it("parses the repository's real CHANGELOG.md without throwing", () => {
		const real = readFileSync(resolve(__dirname, "../CHANGELOG.md"), "utf-8");
		expect(extractReleaseNotes(real, "0.8.0")).toEqual({
			features: ["cleanup: box-drawing table → Markdown table transform (spec 007)"],
			fixes: [],
		});
		// 0.9.1 is the fix-only release that motivated reading Bug Fixes at all.
		const v091 = extractReleaseNotes(real, "0.9.1") as { features: string[]; fixes: string[] };
		expect(v091.features).toEqual([]);
		expect(v091.fixes).toEqual([
			"reflow: keep list nesting instead of flattening every item to level 0",
		]);
		expect(() => extractReleaseNotes(real)).not.toThrow();
	});
});
