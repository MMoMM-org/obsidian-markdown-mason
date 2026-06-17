import { describe, it, expect } from "vitest";
import type { InlineMarker } from "../../src/core/types";
import { loadFixture } from "../fixtures";
import { perplexityApp } from "../../src/parsers/perplexityApp";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const appFixture = loadFixture("app");

// ---------------------------------------------------------------------------
// canParse
// ---------------------------------------------------------------------------

describe("perplexityApp.canParse", () => {
	it("returns true for the app fixture (bare Sources block with [n] url lines)", () => {
		expect(perplexityApp.canParse(appFixture)).toBe(true);
	});

	it("returns false for an inline-only string with no Sources block", () => {
		const inlineOnly = "Some text with [1] reference but no sources section.\nAnother line.";
		expect(perplexityApp.canParse(inlineOnly)).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(perplexityApp.canParse("")).toBe(false);
	});

	it("returns true for a minimal valid sources block", () => {
		const minimal = "## Answer\n\nSome answer.[1]\n\nSources\n[1] Some title https://example.com/page\n";
		expect(perplexityApp.canParse(minimal)).toBe(true);
	});

	it("returns false when Sources header is present but no valid bracketed source entry lines follow", () => {
		const noEntries =
			"## Answer\n\nSome text.\n\nSources\nJust a paragraph, no bracketed entries.\n";
		expect(perplexityApp.canParse(noEntries)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// parse — sources
// ---------------------------------------------------------------------------

describe("perplexityApp.parse — sources", () => {
	it("collects all sources from both answer blocks", () => {
		const result = perplexityApp.parse(appFixture);
		// Block 1 has 15 sources ([1]–[15]), block 2 has 11 sources ([1]–[11])
		expect(result.sources).toHaveLength(26);
	});

	it("incomingId restarts at 1 within each answer block (block 1 starts at 1)", () => {
		const result = perplexityApp.parse(appFixture);
		// First source of block 1
		expect(result.sources[0].incomingId).toBe(1);
	});

	it("incomingId restarts at 1 within each answer block (block 2 starts at 1 again)", () => {
		const result = perplexityApp.parse(appFixture);
		// First source of block 2 (index 15, after 15 sources from block 1)
		expect(result.sources[15].incomingId).toBe(1);
	});

	it("block 1 last source has incomingId 15", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[14].incomingId).toBe(15);
	});

	it("block 2 last source has incomingId 11", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[25].incomingId).toBe(11);
	});

	it("parses block 1 source [1] url correctly", () => {
		const result = perplexityApp.parse(appFixture);
		const first = result.sources[0];
		expect(first.url).toBe("https://www.thestar.com.my/aseanplus/aseanplus-news/2025/12/18/japan-releases-first-sakura-forecast-for-2026-tokyo-to-see-blooms-from-mid-march");
	});

	it("parses block 1 source [1] title correctly", () => {
		const result = perplexityApp.parse(appFixture);
		const first = result.sources[0];
		// Title is the text between "]" and the url
		expect(first.title).toBe("Japan releases first sakura forecast for 2026; Tokyo to see ...");
	});

	it("snippet equals title for block 1 source [1]", () => {
		const result = perplexityApp.parse(appFixture);
		const first = result.sources[0];
		// Contract: snippet === title (simple, consistent short descriptor)
		expect(first.snippet).toBe(first.title);
	});

	it("parses block 1 source [3] url correctly", () => {
		const result = perplexityApp.parse(appFixture);
		const third = result.sources[2];
		expect(third.url).toBe("https://www.japan-guide.com/sakura/");
	});

	it("parses block 1 source [3] title correctly", () => {
		const result = perplexityApp.parse(appFixture);
		const third = result.sources[2];
		expect(third.title).toBe("Cherry Blossom Forecast 2026 - Japan Guide");
	});

	it("parses block 2 source [1] url correctly", () => {
		const result = perplexityApp.parse(appFixture);
		const block2First = result.sources[15];
		expect(block2First.url).toBe("https://n-kishou.com/corp/news-contents/sakura/?lang=en");
	});

	it("parses block 2 source [1] title correctly", () => {
		const result = perplexityApp.parse(appFixture);
		const block2First = result.sources[15];
		expect(block2First.title).toBe("Release of 2026 Cherry Blossom Forecast (14th forecast)");
	});
});

// ---------------------------------------------------------------------------
// parse — inline markers
// ---------------------------------------------------------------------------

describe("perplexityApp.parse — inline markers", () => {
	it("collects inline markers in document order", () => {
		const result = perplexityApp.parse(appFixture);
		// First inline marker in the document is [1] from the first prose line
		expect(result.inline[0]).toEqual({ marker: "[1]", n: 1 });
	});

	it("inline markers are present (multiple per line, e.g. [1][2][3][4][5][6])", () => {
		const result = perplexityApp.parse(appFixture);
		// First prose line: "...blooming around March 19–20....[1][2][3][4][5][6]"
		// So first 6 inline markers are [1][2][3][4][5][6]
		const first6 = result.inline.slice(0, 6).map((m: InlineMarker) => m.n);
		expect(first6).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("total inline marker count equals all [n] occurrences in fixture prose (54)", () => {
		// Empirically: block 1 contributes 28 markers, block 2 contributes 26 markers.
		// Source entry lines and bare Sources headers are excluded.
		const result = perplexityApp.parse(appFixture);
		expect(result.inline).toHaveLength(54);
	});

	it("block 1 contributes exactly 28 inline markers before block 2 begins", () => {
		// Block 1 prose markers are at indices 0..27; block 2 starts at index 28.
		// Confirmed empirically by counting [n] tokens on non-source, non-header lines
		// within the block-1 answer section (lines before the second ## Answer heading).
		const result = perplexityApp.parse(appFixture);
		// The 28th marker (index 27) is the last block-1 marker: [3] from the planning tip line.
		expect(result.inline[27]).toEqual({ marker: "[3]", n: 3 });
	});

	it("block 2 inline markers begin at index 28 with a contiguous run [1]–[8]", () => {
		// Block 2 first prose line: "...expected roughly from late April....[1][2][3][4][5][6][7][8]"
		// These are the first 8 markers of block 2, starting at inline index 28.
		const result = perplexityApp.parse(appFixture);
		const block2First8 = result.inline
			.slice(28, 36)
			.map((m: InlineMarker) => ({ marker: m.marker, n: m.n }));
		expect(block2First8).toEqual([
			{ marker: "[1]", n: 1 },
			{ marker: "[2]", n: 2 },
			{ marker: "[3]", n: 3 },
			{ marker: "[4]", n: 4 },
			{ marker: "[5]", n: 5 },
			{ marker: "[6]", n: 6 },
			{ marker: "[7]", n: 7 },
			{ marker: "[8]", n: 8 },
		]);
	});

	it("inline markers contain only numeric n values (no alpha markers)", () => {
		const result = perplexityApp.parse(appFixture);
		for (const m of result.inline) {
			expect(typeof m.n).toBe("number");
			expect(m.n).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// parse — body contract
// ---------------------------------------------------------------------------

describe("perplexityApp.parse — body", () => {
	// Contract: body = full input text with inline [n] markers retained.
	// Sources blocks are kept in body (not stripped) so downstream offsets work.
	it("body retains inline [n] markers from answer prose", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("[1][2][3]");
	});

	it("body contains the answer prose from block 1", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("sakura are forecast to start blooming around March 19");
	});

	it("body contains the answer prose from block 2", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("sakura are expected roughly from late April");
	});

	it("body contains the Sources marker lines (not stripped)", () => {
		const result = perplexityApp.parse(appFixture);
		// Sources blocks are retained so downstream offset-based rewrites work
		expect(result.body).toContain("Sources");
		expect(result.body).toContain("[1] Japan releases first sakura forecast");
	});
});
