// No obsidian import — this module is pure domain; unit-testable without Obsidian.

import { describe, expect, it } from "vitest";
import { perplexityWeb } from "../../catalog/parsers/perplexityWeb";
import { loadFixture } from "../fixtures";

// ---------------------------------------------------------------------------
// Contract documentation:
//
// snippet:        The link text (same as title; plain text, e.g. "thestar.com").
//                 Compact single-line defs do not need the raw markdown link —
//                 snippet is sane plain text for any downstream display.
//
// inline.marker:  The full `[text](url)` substring.  This is the REAL locator:
//                 the conversion stage searches body for this string and
//                 replaces it with the footnote reference.
//
// body:           The prose with inline links kept verbatim (unchanged).
//                 The conversion stage later replaces each marker in-place.
// ---------------------------------------------------------------------------

describe("perplexityWeb.canParse", () => {
	it("returns true for the web fixture", () => {
		const input = loadFixture("web");
		expect(perplexityWeb.canParse(input)).toBe(true);
	});

	it("returns false for the app fixture (has a Sources block)", () => {
		const input = loadFixture("app");
		expect(perplexityWeb.canParse(input)).toBe(false);
	});

	it("returns false for input that contains a [^n_n] footnote definition", () => {
		const syntheticInput = "[^1_1]: https://example.com Some footnote text here";
		expect(perplexityWeb.canParse(syntheticInput)).toBe(false);

		const webDownloadInput = loadFixture("webDownload");
		expect(perplexityWeb.canParse(webDownloadInput)).toBe(false);
	});

	it("returns false for input with a Citations: block", () => {
		const input = "Some prose.\n\nCitations:\n- https://example.com";
		expect(perplexityWeb.canParse(input)).toBe(false);
	});

	it("returns false for plain text with no inline links", () => {
		const input = "This is plain prose with no links at all.";
		expect(perplexityWeb.canParse(input)).toBe(false);
	});

	it("returns false for input with a Quellen block (German heading disqualifier)", () => {
		const input = "Quellen\n- https://example.com";
		expect(perplexityWeb.canParse(input)).toBe(false);
	});

	it("returns false for image-only input (no plain inline links)", () => {
		const input = "See ![a chart](https://example.com/c.png) here.";
		expect(perplexityWeb.canParse(input)).toBe(false);
	});

	it("returns true and excludes the image when input has both a plain link and an image", () => {
		const input = "Read [this article](https://example.com/article) and see ![diagram](https://example.com/d.png) for details.";
		expect(perplexityWeb.canParse(input)).toBe(true);
	});
});

describe("perplexityWeb.parse — image handling", () => {
	it("image-only input produces zero sources", () => {
		const input = "See ![a chart](https://example.com/c.png) here.";
		const result = perplexityWeb.parse(input);
		expect(result.sources).toHaveLength(0);
		expect(result.inline).toHaveLength(0);
	});

	it("mixed input: only the plain link becomes a source, not the image", () => {
		const input = "Read [this article](https://example.com/article) and see ![diagram](https://example.com/d.png).";
		const result = perplexityWeb.parse(input);
		expect(result.sources).toHaveLength(1);
		expect(result.sources[0]).toMatchObject({
			incomingId: 1,
			title: "this article",
			url: "https://example.com/article",
			snippet: "this article",
		});
	});
});

describe("perplexityWeb.parse — web fixture", () => {
	const input = loadFixture("web");
	const result = perplexityWeb.parse(input);

	it("produces 11 sources (one per inline link in document order)", () => {
		expect(result.sources).toHaveLength(11);
	});

	it("assigns sequential incomingId starting at 1", () => {
		const ids = result.sources.map((s) => s.incomingId);
		expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
	});

	it("first source — title is link text, url is href", () => {
		expect(result.sources[0]).toMatchObject({
			incomingId: 1,
			title: "thestar.com",
			url: "https://www.thestar.com.my/aseanplus/aseanplus-news/2025/12/18/japan-releases-first-sakura-forecast-for-2026-tokyo-to-see-blooms-from-mid-march",
		});
	});

	it("second source — title and url", () => {
		expect(result.sources[1]).toMatchObject({
			incomingId: 2,
			title: "n-kishou",
			url: "https://n-kishou.com/corp/news-contents/sakura/?lang=en",
		});
	});

	it("snippet equals the link text (title) for each source — plain text, not raw markdown link", () => {
		expect(result.sources[0].snippet).toBe("thestar.com");
		expect(result.sources[1].snippet).toBe("n-kishou");
	});

	it("produces 11 inline markers (one per link)", () => {
		expect(result.inline).toHaveLength(11);
	});

	it("inline markers have sequential n matching sources", () => {
		const ns = result.inline.map((m) => m.n);
		expect(ns).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
	});

	it("inline.marker equals the full [text](url) substring (same as snippet)", () => {
		expect(result.inline[0].marker).toBe(
			"[thestar.com](https://www.thestar.com.my/aseanplus/aseanplus-news/2025/12/18/japan-releases-first-sakura-forecast-for-2026-tokyo-to-see-blooms-from-mid-march)",
		);
		expect(result.inline[1].marker).toBe(
			"[n-kishou](https://n-kishou.com/corp/news-contents/sakura/?lang=en)",
		);
	});

	it("body contains the original prose verbatim (links kept as-is)", () => {
		// body must contain the original first link unchanged
		expect(result.body).toContain(
			"[thestar.com](https://www.thestar.com.my/aseanplus/aseanplus-news/2025/12/18/japan-releases-first-sakura-forecast-for-2026-tokyo-to-see-blooms-from-mid-march)",
		);
		// body must be identical to the trimmed input
		expect(result.body).toBe(input);
	});
});
