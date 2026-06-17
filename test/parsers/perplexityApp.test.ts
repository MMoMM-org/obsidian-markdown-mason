import { describe, it, expect } from "vitest";
import type { InlineMarker } from "../../src/core/types";
import { loadFixture } from "../fixtures";
import { perplexityApp } from "../../src/parsers/perplexityApp";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const appFixture = loadFixture("app");

// ---------------------------------------------------------------------------
// canParse — UNCHANGED contract
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
// parse — sources (globally-unique sequential incomingIds across blocks)
// ---------------------------------------------------------------------------

describe("perplexityApp.parse — sources", () => {
	it("collects all sources from both answer blocks", () => {
		const result = perplexityApp.parse(appFixture);
		// Block 1 has 15 sources, block 2 has 11 sources → 26 total
		expect(result.sources).toHaveLength(26);
	});

	it("sources incomingIds are globally-unique sequential 1..26", () => {
		const result = perplexityApp.parse(appFixture);
		const ids = result.sources.map((s) => s.incomingId);
		expect(ids).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
	});

	it("block 1 first source has incomingId 1", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[0].incomingId).toBe(1);
	});

	it("block 1 first source url matches the thestar.com.my fixture line", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[0].url).toBe(
			"https://www.thestar.com.my/aseanplus/aseanplus-news/2025/12/18/japan-releases-first-sakura-forecast-for-2026-tokyo-to-see-blooms-from-mid-march",
		);
	});

	it("block 1 last source has incomingId 15", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[14].incomingId).toBe(15);
	});

	it("block 2 first source has incomingId 16 (global offset applied)", () => {
		const result = perplexityApp.parse(appFixture);
		// index 15 = block 2's first entry; local [1] → global 16
		expect(result.sources[15].incomingId).toBe(16);
	});

	it("block 2 first source url matches n-kishou.com Sapporo entry", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[15].url).toBe(
			"https://n-kishou.com/corp/news-contents/sakura/?lang=en",
		);
	});

	it("block 2 first source title matches the Sapporo sources line", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[15].title).toBe(
			"Release of 2026 Cherry Blossom Forecast (14th forecast)",
		);
	});

	it("block 2 last source has incomingId 26 (offset 15 + local 11)", () => {
		const result = perplexityApp.parse(appFixture);
		// index 25 = block 2's last entry; local [11] → global 26
		expect(result.sources[25].incomingId).toBe(26);
	});

	it("snippet equals title for all sources", () => {
		const result = perplexityApp.parse(appFixture);
		for (const s of result.sources) {
			expect(s.snippet).toBe(s.title);
		}
	});

	it("parses block 1 source [3] url correctly", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[2].url).toBe("https://www.japan-guide.com/sakura/");
	});

	it("parses block 1 source [3] title correctly", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.sources[2].title).toBe("Cherry Blossom Forecast 2026 - Japan Guide");
	});
});

// ---------------------------------------------------------------------------
// parse — inline markers (n values are GLOBAL incomingIds)
// ---------------------------------------------------------------------------

describe("perplexityApp.parse — inline markers", () => {
	it("total inline marker count equals all [n] occurrences in fixture prose (54)", () => {
		// Block 1: 28 markers; block 2: 26 markers (renumbered to global).
		const result = perplexityApp.parse(appFixture);
		expect(result.inline).toHaveLength(54);
	});

	it("first inline marker in document order is global [1]", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.inline[0]).toEqual<InlineMarker>({ marker: "[1]", n: 1 });
	});

	it("first 6 inline markers are block 1 markers [1]–[6] (unchanged, offset 0)", () => {
		const result = perplexityApp.parse(appFixture);
		const first6 = result.inline.slice(0, 6).map((m: InlineMarker) => m.n);
		expect(first6).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it("block 1 last marker (index 27) is [3] (planning tip final citation)", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.inline[27]).toEqual<InlineMarker>({ marker: "[3]", n: 3 });
	});

	it("block 2 first prose inline marker starts at index 28 with global n=16", () => {
		// Block 2 prose local [1] → global [16] (offset +15)
		const result = perplexityApp.parse(appFixture);
		expect(result.inline[28]).toEqual<InlineMarker>({ marker: "[16]", n: 16 });
	});

	it("block 2 first line contributes 8 markers [16]–[23] at indices 28–35", () => {
		// Block 2 first prose line: ...[1][2][3][4][5][6][7][8] → [16]–[23]
		const result = perplexityApp.parse(appFixture);
		const block2First8 = result.inline
			.slice(28, 36)
			.map((m: InlineMarker) => ({ marker: m.marker, n: m.n }));
		expect(block2First8).toEqual([
			{ marker: "[16]", n: 16 },
			{ marker: "[17]", n: 17 },
			{ marker: "[18]", n: 18 },
			{ marker: "[19]", n: 19 },
			{ marker: "[20]", n: 20 },
			{ marker: "[21]", n: 21 },
			{ marker: "[22]", n: 22 },
			{ marker: "[23]", n: 23 },
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
// parse — body (Sources blocks stripped; prose markers renumbered globally)
// ---------------------------------------------------------------------------

describe("perplexityApp.parse — body", () => {
	it("body retains answer prose from block 1", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("sakura are forecast to start blooming around March 19");
	});

	it("body retains answer prose from block 2", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("sakura are expected roughly from late April");
	});

	it("body does NOT contain a bare Sources marker line", () => {
		const result = perplexityApp.parse(appFixture);
		// The word "Sources" alone on a line must not appear
		expect(result.body).not.toMatch(/^Sources\s*$/m);
	});

	it("body does NOT contain source-entry lines with n-kishou.com url", () => {
		// Block 2 Sources lines removed; URL should not appear in body
		const result = perplexityApp.parse(appFixture);
		expect(result.body).not.toContain("https://n-kishou.com");
	});

	it("body does NOT contain source-entry lines with thestar.com.my url", () => {
		// Block 1 Sources lines removed
		const result = perplexityApp.parse(appFixture);
		expect(result.body).not.toContain("https://www.thestar.com.my");
	});

	it("body does NOT contain source-entry bracket form '[1] Japan releases'", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).not.toContain("[1] Japan releases");
	});

	it("body block-2 prose uses global marker [16] not local [1] for first Sapporo citation", () => {
		// After renumbering, the first prose marker of block 2 becomes [16]
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain(
			"late April, with peak around the last week of April.[16][17]",
		);
	});

	it("body still contains ## Answer headings", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("## Answer");
	});

	it("body still contains ## Question headings", () => {
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("## Question");
	});

	it("body block-1 prose markers are unchanged (offset 0)", () => {
		// Block 1 prose should still have the original [1][2][3][4][5][6] form
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("[1][2][3][4][5][6]");
	});

	it("body retains the second ## Question heading (inter-block content not dropped)", () => {
		// The second ## Question heading sits between block 1's Sources and block 2's ## Answer.
		// Without the inSources-reset fix it would be silently dropped.
		const result = perplexityApp.parse(appFixture);
		expect((result.body.match(/^## Question$/gm) ?? []).length).toBe(2);
	});

	it("body retains the Sapporo question text from between Sources1 and Answer2", () => {
		// "When will it be in Sapporo?" follows the second ## Question heading.
		// Without the fix, inSources stays true through that line and drops it.
		const result = perplexityApp.parse(appFixture);
		expect(result.body).toContain("When will it be in Sapporo?");
	});
});
