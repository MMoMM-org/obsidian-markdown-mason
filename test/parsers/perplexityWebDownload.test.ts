// No obsidian import — this module is pure domain; unit-testable without Obsidian.

import { describe, it, expect } from "vitest";
import { loadFixture } from "../fixtures";
import { perplexityWebDownload } from "../../src/parsers/perplexityWebDownload";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const webDownload = loadFixture("webDownload");

// ---------------------------------------------------------------------------
// canParse
// ---------------------------------------------------------------------------

describe("perplexityWebDownload.canParse", () => {
	it("returns true for the web-download fixture", () => {
		expect(perplexityWebDownload.canParse(webDownload)).toBe(true);
	});

	it("returns false for the app fixture", () => {
		expect(perplexityWebDownload.canParse(loadFixture("app"))).toBe(false);
	});

	it("returns false for the web fixture", () => {
		expect(perplexityWebDownload.canParse(loadFixture("web"))).toBe(false);
	});

	it("returns false for plain text with no definition lines", () => {
		expect(perplexityWebDownload.canParse("some text [^1_1] more text")).toBe(false);
	});

	it("returns true for minimal input containing a definition line", () => {
		expect(
			perplexityWebDownload.canParse("[^1_1]: https://example.com"),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// parse — body
// ---------------------------------------------------------------------------

describe("perplexityWebDownload.parse — body", () => {
	it("strips <img> tags", () => {
		const { body } = perplexityWebDownload.parse(webDownload);
		expect(body).not.toContain("<img");
	});

	it("strips hidden <span style> tags and their content", () => {
		const { body } = perplexityWebDownload.parse(webDownload);
		expect(body).not.toContain("<span");
		expect(body).not.toContain("style=");
	});

	it("strips ⁂ glyphs", () => {
		const { body } = perplexityWebDownload.parse(webDownload);
		expect(body).not.toContain("⁂");
	});

	it("strips <div align=\"center\"> wrappers", () => {
		const { body } = perplexityWebDownload.parse(webDownload);
		expect(body).not.toContain("<div");
		expect(body).not.toContain("align=\"center\"");
	});

	it("preserves the --- answer separator", () => {
		const { body } = perplexityWebDownload.parse(webDownload);
		expect(body).toContain("---");
	});

	it("retains inline [^a_b] markers in the prose", () => {
		const { body } = perplexityWebDownload.parse(webDownload);
		expect(body).toContain("[^1_1]");
		expect(body).toContain("[^2_1]");
	});

	it("does NOT contain definition lines in the body", () => {
		const { body } = perplexityWebDownload.parse(webDownload);
		// Definition lines look like: [^1_1]: https://...
		expect(body).not.toMatch(/\[\^\w+_\w+\]:\s+https?:\/\//);
	});
});

// ---------------------------------------------------------------------------
// parse — sources contract
//
// incomingId scheme: sequential 1..N across the whole document, in
// definition-line order. Answer 1 defs (^1_1..^1_15) → ids 1..15.
// Answer 2 defs (^2_1..^2_11) → ids 16..26.
//
// title  : new URL(url).host
// snippet: the raw URL string (same as url)
// ---------------------------------------------------------------------------

describe("perplexityWebDownload.parse — sources", () => {
	it("extracts 26 sources total (15 from answer 1, 11 from answer 2)", () => {
		const { sources } = perplexityWebDownload.parse(webDownload);
		expect(sources).toHaveLength(26);
	});

	it("first source: [^1_1] → id=1, url and title from thestar.com.my", () => {
		const { sources } = perplexityWebDownload.parse(webDownload);
		const first = sources[0];
		expect(first.incomingId).toBe(1);
		expect(first.url).toBe(
			"https://www.thestar.com.my/aseanplus/aseanplus-news/2025/12/18/japan-releases-first-sakura-forecast-for-2026-tokyo-to-see-blooms-from-mid-march",
		);
		expect(first.title).toBe("www.thestar.com.my");
		expect(first.snippet).toBe(first.url);
	});

	it("second source: [^1_2] → id=2, n-kishou.com host", () => {
		const { sources } = perplexityWebDownload.parse(webDownload);
		const s = sources[1];
		expect(s.incomingId).toBe(2);
		expect(s.url).toBe("https://n-kishou.com/corp/news-contents/sakura/?lang=en");
		expect(s.title).toBe("n-kishou.com");
		expect(s.snippet).toBe(s.url);
	});

	it("15th source (last of answer 1): id=15", () => {
		const { sources } = perplexityWebDownload.parse(webDownload);
		const s = sources[14];
		expect(s.incomingId).toBe(15);
		expect(s.url).toBe(
			"https://whereandwander.com/ultimate-tokyo-cherry-blossom-planning-guide-best-spots/",
		);
		expect(s.title).toBe("whereandwander.com");
	});

	it("16th source (first of answer 2): [^2_1] → id=16", () => {
		const { sources } = perplexityWebDownload.parse(webDownload);
		const s = sources[15];
		expect(s.incomingId).toBe(16);
		expect(s.url).toBe("https://n-kishou.com/corp/news-contents/sakura/?lang=en");
		expect(s.title).toBe("n-kishou.com");
		expect(s.snippet).toBe(s.url);
	});

	it("26th source (last of answer 2): [^2_11] → id=26", () => {
		const { sources } = perplexityWebDownload.parse(webDownload);
		const last = sources[25];
		expect(last.incomingId).toBe(26);
		expect(last.url).toBe("https://www.youtube.com/watch?v=5oS-cBg_lj8");
		expect(last.title).toBe("www.youtube.com");
	});

	it("incomingIds are unique and sequential starting at 1", () => {
		const { sources } = perplexityWebDownload.parse(webDownload);
		const ids = sources.map((s) => s.incomingId);
		expect(ids).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
	});
});

// ---------------------------------------------------------------------------
// parse — inline markers
// ---------------------------------------------------------------------------

describe("perplexityWebDownload.parse — inline markers", () => {
	it("maps inline [^1_1] to n=1 (first source)", () => {
		const { inline } = perplexityWebDownload.parse(webDownload);
		const first = inline.find((m) => m.marker === "[^1_1]");
		expect(first).toBeDefined();
		expect(first!.n).toBe(1);
	});

	it("maps inline [^1_2] to n=2", () => {
		const { inline } = perplexityWebDownload.parse(webDownload);
		const m = inline.find((m) => m.marker === "[^1_2]");
		expect(m).toBeDefined();
		expect(m!.n).toBe(2);
	});

	it("maps inline [^2_1] to n=16 (first source of answer 2)", () => {
		const { inline } = perplexityWebDownload.parse(webDownload);
		const m = inline.find((m) => m.marker === "[^2_1]");
		expect(m).toBeDefined();
		expect(m!.n).toBe(16);
	});

	it("maps inline [^2_11] to n=26 (last source)", () => {
		const { inline } = perplexityWebDownload.parse(webDownload);
		// [^2_11] does not appear inline in the fixture (it's hidden), so this
		// tests that [^2_9] maps to n=24 (answer 2 source 9 = global 24)
		const m = inline.find((m) => m.marker === "[^2_9]");
		expect(m).toBeDefined();
		expect(m!.n).toBe(24);
	});

	it("inline markers are in document order", () => {
		const { inline } = perplexityWebDownload.parse(webDownload);
		// The very first inline marker in the fixture is [^1_1] on line 5
		expect(inline[0].marker).toBe("[^1_1]");
	});

	it("does NOT include inline markers from hidden <span> blocks", () => {
		// Hidden spans contain [^1_12]..[^1_15] and [^2_10]..[^2_11]
		// These should not appear as inline markers since they're stripped
		const { inline } = perplexityWebDownload.parse(webDownload);
		const hiddenAnsw1 = inline.filter((m) =>
			["[^1_12]", "[^1_13]", "[^1_14]", "[^1_15]"].includes(m.marker),
		);
		expect(hiddenAnsw1).toHaveLength(0);
	});

	it("markers n values correspond to valid source incomingIds", () => {
		const { inline, sources } = perplexityWebDownload.parse(webDownload);
		const sourceIds = new Set(sources.map((s) => s.incomingId));
		for (const marker of inline) {
			expect(sourceIds.has(marker.n)).toBe(true);
		}
	});
});
