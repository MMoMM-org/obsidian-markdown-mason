import { describe, it, expect } from "vitest";
import {
	resolveFootnoteIdentity,
	applyFootnoteInlineRename,
	newRefDefinitions,
	formatF4Def,
	fromCitations,
	moveToResources,
	scanExistingRefs,
	countFootnoteDefs,
} from "../../src/core/footnotes";
import type { FootnoteRef, ExistingRef, ParseResult, OperationContext, MasonSettings } from "../../src/core/types";
import type { ResolvedRef } from "../../src/core/footnotes";

// ---------------------------------------------------------------------------
// T2.4  Footnote identity — fused O+D
//
// resolveFootnoteIdentity(incoming, existing) → { idMap, newRefs }
//   idMap: Record<number, number>  — maps incomingId → final id
//   newRefs: FootnoteRef[]         — genuinely new refs (id already remapped)
//
// applyFootnoteInlineRename(body, idMap) → EditPlan
//   Produces Edits (offsets vs body-as-original-doc) to rewrite [^n] markers.
//   Processes markers in reverse offset order so earlier edits do not shift
//   later offsets (ADR-1 requires offsets vs ORIGINAL doc — each edit is
//   independent and applied to the original).
//
// newRefDefinitions(newRefs) → string[]
//   Produces the definition lines for genuinely new refs, e.g.
//   "[^7]: snippet\n[Title](URL)"
//   T2.5 (M) will place these into the Resources section.
//
// Algorithm (SDD §Complex Logic — fused Footnote-Identity):
//   1. maxExisting = max numeric id in existing (alpha refs excluded)
//   2. seenInPaste: normalizedUrl → incomingId of first occurrence
//   3. For each ref in incoming (order preserved):
//      - if already mapped: continue (shouldn't happen for well-formed input)
//      - look up seenInPaste[norm]; if idMap has that first: dup-in-paste → reuse
//      - look up existingByUrl[norm]; if found: reuse existing id
//      - else: ++maxExisting; push newRef with remapped id
//      Record seenInPaste[norm] on first sight.
//   4. return { idMap, newRefs }
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const urlA = "https://example.com/alpha";
const urlB = "https://example.com/beta";

const makeRef = (overrides: Partial<FootnoteRef> & { incomingId: number; url: string }): FootnoteRef => ({
	snippet: "snippet",
	title: "A Title",
	...overrides,
});

const makeExisting = (id: number, url: string): ExistingRef => ({ id, url });

// ---------------------------------------------------------------------------
// PRIMARY GOLDEN TEST — exact SDD traced example
//
// Note already has [^6] (urlA) and [^A] (alpha — excluded from maxExisting).
// Paste: incoming[1]=urlB, incoming[2]=urlA (dup of existing), incoming[3]=urlB (dup in paste).
// Expected: idMap={1→7, 2→6, 3→7}; newRefs=[{id:7, url:urlB, ...}]
// ---------------------------------------------------------------------------

describe("resolveFootnoteIdentity — SDD traced golden example", () => {
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: urlB, title: "Beta Page", snippet: "B snippet" }),
		makeRef({ incomingId: 2, url: urlA, title: "Alpha Page", snippet: "A snippet" }),
		makeRef({ incomingId: 3, url: urlB, title: "Beta Page Again", snippet: "B snippet 2" }),
	];
	// Note: alpha ref [^A] must NOT appear in ExistingRef[] — ExistingRef is numeric-only.
	// maxExisting is derived from existing numeric ids only.
	const existing: ExistingRef[] = [
		makeExisting(6, urlA),
	];

	const result = resolveFootnoteIdentity(incoming, existing);

	it("maps incoming [1] (urlB, new) → 7", () => {
		expect(result.idMap[1]).toBe(7);
	});

	it("maps incoming [2] (urlA, reuse existing [^6]) → 6", () => {
		expect(result.idMap[2]).toBe(6);
	});

	it("maps incoming [3] (urlB, dup in paste of [1]→7) → 7", () => {
		expect(result.idMap[3]).toBe(7);
	});

	it("produces exactly one newRef with id=7 and url=urlB", () => {
		expect(result.newRefs).toHaveLength(1);
		expect(result.newRefs[0].id).toBe(7);
		expect(result.newRefs[0].url).toBe(urlB);
	});

	it("newRef[7] carries the title from the first occurrence (incoming[1])", () => {
		expect(result.newRefs[0].title).toBe("Beta Page");
	});
});

// ---------------------------------------------------------------------------
// maxExisting computation: alpha refs are excluded
// ---------------------------------------------------------------------------

describe("resolveFootnoteIdentity — alpha refs excluded from maxExisting", () => {
	// existing contains only numeric ids; alpha refs must never appear here
	// (ExistingRef.id is a number, so [^A] simply cannot be represented).
	// This test confirms that if existing has ids [3, 5], maxExisting = 5
	// and a new incoming ref gets id 6 (not confused by any alpha).
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: "https://newsite.com/page" }),
	];
	const existing: ExistingRef[] = [
		makeExisting(3, "https://other.com"),
		makeExisting(5, "https://another.com"),
	];

	it("maxExisting = 5 → new ref gets id 6", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, existing);
		expect(idMap[1]).toBe(6);
	});
});

describe("resolveFootnoteIdentity — empty existing: maxExisting = 0", () => {
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: "https://first.com" }),
		makeRef({ incomingId: 2, url: "https://second.com" }),
	];

	it("first new ref gets id 1 when no existing refs", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, []);
		expect(idMap[1]).toBe(1);
	});

	it("second new ref gets id 2", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, []);
		expect(idMap[2]).toBe(2);
	});

	it("both appear in newRefs", () => {
		const { newRefs } = resolveFootnoteIdentity(incoming, []);
		expect(newRefs).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// Intra-paste dedup: two incoming refs with the same URL collapse to ONE id
// ---------------------------------------------------------------------------

describe("resolveFootnoteIdentity — intra-paste duplicate URL collapses", () => {
	const sharedUrl = "https://shared.example.com/page";
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: sharedUrl, title: "First Occurrence" }),
		makeRef({ incomingId: 2, url: sharedUrl, title: "Second Occurrence" }),
	];

	it("both incomingIds map to the SAME final id", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, []);
		expect(idMap[1]).toBe(idMap[2]);
	});

	it("only ONE newRef is created (not two)", () => {
		const { newRefs } = resolveFootnoteIdentity(incoming, []);
		expect(newRefs).toHaveLength(1);
	});

	it("the shared id is non-zero (a valid footnote number)", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, []);
		expect(idMap[1]).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// Existing-URL reuse: yields the NON-sequential pre-existing id
// ---------------------------------------------------------------------------

describe("resolveFootnoteIdentity — existing-URL reuse gives non-sequential id", () => {
	// Existing has [^6]. New incoming for urlA (same as existing [^6]) should
	// reuse [^6], even though a new ref gets [^7]. This confirms reuse yields
	// the EXISTING id rather than a freshly incremented one.
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: urlB }), // brand new → gets 7
		makeRef({ incomingId: 2, url: urlA }), // exists as 6 → reuse 6 (non-sequential)
	];
	const existing: ExistingRef[] = [makeExisting(6, urlA)];

	it("existing-URL ref reuses id=6, not 7 or 8", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, existing);
		expect(idMap[2]).toBe(6);
	});

	it("the new ref still gets the next sequential id (7)", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, existing);
		expect(idMap[1]).toBe(7);
	});

	it("only the genuinely-new ref appears in newRefs", () => {
		const { newRefs } = resolveFootnoteIdentity(incoming, existing);
		expect(newRefs).toHaveLength(1);
		expect(newRefs[0].id).toBe(7);
	});
});

// ---------------------------------------------------------------------------
// URL normalization is applied: URLs differing only in trailing slash are deduped
// ---------------------------------------------------------------------------

describe("resolveFootnoteIdentity — normalized URLs are used as dedup keys", () => {
	const urlWithSlash = "https://example.com/path/";
	const urlWithoutSlash = "https://example.com/path";

	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: urlWithSlash }),
		makeRef({ incomingId: 2, url: urlWithoutSlash }),
	];

	it("treats trailing-slash and non-trailing-slash URLs as the same key", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, []);
		expect(idMap[1]).toBe(idMap[2]);
	});

	it("produces only one newRef", () => {
		const { newRefs } = resolveFootnoteIdentity(incoming, []);
		expect(newRefs).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Order preservation: incoming order is respected for id assignment
// ---------------------------------------------------------------------------

describe("resolveFootnoteIdentity — incoming order determines id assignment", () => {
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: "https://first.com" }),
		makeRef({ incomingId: 2, url: "https://second.com" }),
		makeRef({ incomingId: 3, url: "https://third.com" }),
	];

	it("ids are assigned in incoming order: 1→1, 2→2, 3→3 when no existing", () => {
		const { idMap } = resolveFootnoteIdentity(incoming, []);
		expect(idMap[1]).toBe(1);
		expect(idMap[2]).toBe(2);
		expect(idMap[3]).toBe(3);
	});
});

// ---------------------------------------------------------------------------
// applyFootnoteInlineRename — EditPlan for rewriting [^n] markers in body
//
// Produces Edits vs body-as-doc (offsets vs the ORIGINAL body string, ADR-1).
// Each edit is independent; the plan can be applied to the original body.
// ---------------------------------------------------------------------------

describe("applyFootnoteInlineRename — rewrites inline [^n] markers", () => {
	// body has [^1][^2][^3]; idMap={1:7, 2:6, 3:7}
	const body = "Sentence one[^1] and two[^2] and three[^3].";
	const idMap: Record<number, number> = { 1: 7, 2: 6, 3: 7 };

	it("returns a non-empty EditPlan (three markers → three edits)", () => {
		const plan = applyFootnoteInlineRename(body, idMap);
		expect(plan).toHaveLength(3);
	});

	it("applying the plan to the body produces the expected rewritten text", () => {
		const plan = applyFootnoteInlineRename(body, idMap);
		// Apply edits to the original body (sorted by offset, non-overlapping).
		// Since each edit replaces [^n] with [^m], character lengths may differ.
		// Apply in reverse order to preserve earlier offsets.
		const sorted = [...plan].sort((a, b) => b.from - a.from);
		let result = body;
		for (const edit of sorted) {
			result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
		}
		expect(result).toBe("Sentence one[^7] and two[^6] and three[^7].");
	});
});

describe("applyFootnoteInlineRename — no edits when idMap is empty", () => {
	it("returns an empty plan for empty idMap", () => {
		const plan = applyFootnoteInlineRename("body text [^1]", {});
		expect(plan).toHaveLength(0);
	});
});

describe("applyFootnoteInlineRename — does not rewrite [^n] when n not in idMap", () => {
	const body = "Text [^5] and [^6].";
	const idMap: Record<number, number> = { 1: 7 }; // [^5] and [^6] not in map

	it("returns no edits for markers not present in idMap", () => {
		const plan = applyFootnoteInlineRename(body, idMap);
		expect(plan).toHaveLength(0);
	});
});

describe("applyFootnoteInlineRename — handles same-id rewrite (idMap[n] === n)", () => {
	// When a ref already has the correct id (e.g. reuse existing), the edit
	// still works correctly (replaces [^n] with [^n] — a no-op, but valid).
	const body = "Text [^6].";
	const idMap: Record<number, number> = { 6: 6 };

	it("produces an edit (even if no-op) or correctly emits nothing for identity mapping", () => {
		const plan = applyFootnoteInlineRename(body, idMap);
		// Either 0 edits (optimization: skip identity) or 1 edit that rewrites [^6]->[^6].
		// Either is acceptable — test the resulting body is unchanged.
		const sorted = [...plan].sort((a, b) => b.from - a.from);
		let result = body;
		for (const edit of sorted) {
			result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
		}
		expect(result).toBe("Text [^6].");
	});
});

// ---------------------------------------------------------------------------
// W1 — dup-in-paste of an existing URL: second same-URL incoming ref must
// reuse the id already mapped for the first (which matched an existing ref),
// and must NOT produce a spurious newRef.
// ---------------------------------------------------------------------------

describe("resolveFootnoteIdentity — dup-in-paste of an existing URL", () => {
	// incoming[1] and incoming[2] both carry urlA, which already exists as [^6].
	// incoming[1] → hits existingByUrl → reuse 6.
	// incoming[2] → hits seenInPaste (firstInPaste=1, idMap[1]=6) → reuse 6.
	// newRefs must be empty (urlA is not genuinely new).
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: urlA, title: "Alpha Again", snippet: "snip1" }),
		makeRef({ incomingId: 2, url: urlA, title: "Alpha Once More", snippet: "snip2" }),
	];
	const existing: ExistingRef[] = [makeExisting(6, urlA)];

	const result = resolveFootnoteIdentity(incoming, existing);

	it("idMap[1] === 6 (first incoming urlA reuses existing [^6])", () => {
		expect(result.idMap[1]).toBe(6);
	});

	it("idMap[2] === 6 (second incoming urlA hits dup-in-paste branch, reuses same id)", () => {
		expect(result.idMap[2]).toBe(6);
	});

	it("newRefs is empty (urlA was not genuinely new)", () => {
		expect(result.newRefs).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// W2 — multi-digit ids in applyFootnoteInlineRename: [^10] must not be
// partially matched as [^1] + "0".  The regex /\[\^(\d+)\]/g is greedy and
// must consume all digits.  idMap={1:7} must rewrite [^1] but NOT [^10].
// ---------------------------------------------------------------------------

describe("applyFootnoteInlineRename — multi-digit id is not partially matched", () => {
	const body = "text [^1] and [^10]";
	const idMap: Record<number, number> = { 1: 7 };

	const applyPlan = (src: string, plan: ReturnType<typeof applyFootnoteInlineRename>): string => {
		const sorted = [...plan].sort((a, b) => b.from - a.from);
		let result = src;
		for (const edit of sorted) {
			result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
		}
		return result;
	};

	it("produces exactly ONE edit (only [^1] is in idMap, not [^10])", () => {
		const plan = applyFootnoteInlineRename(body, idMap);
		expect(plan).toHaveLength(1);
	});

	it("applying the plan rewrites [^1] → [^7] and leaves [^10] untouched", () => {
		const plan = applyFootnoteInlineRename(body, idMap);
		const result = applyPlan(body, plan);
		expect(result).toBe("text [^7] and [^10]");
	});
});

// ---------------------------------------------------------------------------
// formatF4Def — canonical F4 two-line definition formatter (F4.1 proof)
//
// Output format: "[^{id}]: {snippet}\n[{title}]({url})"
// Non-tautological: pins the exact format, not just presence of substrings.
// ---------------------------------------------------------------------------

describe("formatF4Def — produces canonical F4 two-line definition (direct proof)", () => {
	it("exact F4 format: snippet on line 1, markdown link on line 2", () => {
		const result = formatF4Def({
			id: 3,
			snippet: "some snippet",
			title: "Page Title",
			url: "https://example.com",
		});
		expect(result).toBe("[^3]: some snippet\n[Page Title](https://example.com)");
	});

	it("line 1 is '[^id]: snippet' — NOT title, NOT indented url", () => {
		const result = formatF4Def({ id: 1, snippet: "the snippet", title: "The Title", url: "https://x.com" });
		const line1 = result.split("\n")[0];
		expect(line1).toBe("[^1]: the snippet");
	});

	it("line 2 is a markdown link '[title](url)'", () => {
		const result = formatF4Def({ id: 1, snippet: "snip", title: "My Title", url: "https://y.com" });
		const line2 = result.split("\n")[1];
		expect(line2).toBe("[My Title](https://y.com)");
	});
});

// ---------------------------------------------------------------------------
// newRefDefinitions — produces F4 definition lines for new refs
//
// Delegates to formatF4Def — one canonical formatter in core.
// Output per ref: "[^{id}]: {snippet}\n[{title}]({url})"
// These strings are handed to T2.5 (M) for placement into Resources section.
// ---------------------------------------------------------------------------

describe("newRefDefinitions — produces F4-format definition strings", () => {
	const newRefs: ResolvedRef[] = [
		{ incomingId: 1, id: 7, url: urlB, title: "Beta Page", snippet: "B snippet" },
	];

	it("returns one definition string per newRef", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs).toHaveLength(1);
	});

	it("definition is exactly the F4 two-line format: snippet on line 1, link on line 2", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs[0]).toBe(`[^7]: B snippet\n[Beta Page](${urlB})`);
	});

	it("line 1 starts with [^7]: and carries the snippet (not the title)", () => {
		const defs = newRefDefinitions(newRefs);
		const line1 = defs[0].split("\n")[0];
		expect(line1).toBe("[^7]: B snippet");
	});

	it("line 2 is the markdown link '[title](url)'", () => {
		const defs = newRefDefinitions(newRefs);
		const line2 = defs[0].split("\n")[1];
		expect(line2).toBe(`[Beta Page](${urlB})`);
	});
});

describe("newRefDefinitions — returns empty array for no new refs", () => {
	it("returns [] for empty input", () => {
		const defs = newRefDefinitions([]);
		expect(defs).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// INTEGRATION — inline rename and new definitions agree on a single resolution
//
// Proves that applyFootnoteInlineRename and newRefDefinitions are in sync when
// fed the same resolveFootnoteIdentity result.  Both emitters must refer to the
// same id (7 for urlB) and the reused existing id (6 for urlA) must NOT produce
// a new definition.
//
// Golden inputs (SDD traced example):
//   incoming = [{incomingId:1, urlB}, {incomingId:2, urlA}, {incomingId:3, urlB}]
//   existing = [{id:6, urlA}]
//   → idMap = {1:7, 2:6, 3:7}, newRefs = [{id:7, url:urlB, ...}]
// ---------------------------------------------------------------------------

describe("integration — inline rename and new definitions in sync from one resolution", () => {
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: urlB, title: "Beta Page", snippet: "B snippet" }),
		makeRef({ incomingId: 2, url: urlA, title: "Alpha Page", snippet: "A snippet" }),
		makeRef({ incomingId: 3, url: urlB, title: "Beta Page Again", snippet: "B snippet 2" }),
	];
	const existing: ExistingRef[] = [makeExisting(6, urlA)];

	const { idMap, newRefs } = resolveFootnoteIdentity(incoming, existing);

	const body = "Intro [^1] and [^2] then [^3] end.";

	const applyPlan = (src: string, plan: ReturnType<typeof applyFootnoteInlineRename>): string => {
		const sorted = [...plan].sort((a, b) => b.from - a.from);
		let result = src;
		for (const edit of sorted) {
			result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
		}
		return result;
	};

	it("rewritten body has inline markers updated to [^7], [^6], [^7] in sync with idMap", () => {
		const plan = applyFootnoteInlineRename(body, idMap);
		const rewritten = applyPlan(body, plan);
		expect(rewritten).toBe("Intro [^7] and [^6] then [^7] end.");
	});

	it("new definitions contain exactly one entry — for id 7 (urlB) only", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs).toHaveLength(1);
	});

	it("the single new definition is for [^7] in F4 format — snippet line 1, link line 2", () => {
		const defs = newRefDefinitions(newRefs);
		// newRefs[0] is from incoming[0]: title="Beta Page", snippet="B snippet", url=urlB
		expect(defs[0]).toBe(`[^7]: B snippet\n[Beta Page](${urlB})`);
	});

	it("no new definition is emitted for id 6 (urlA was reused from existing, not new)", () => {
		const defs = newRefDefinitions(newRefs);
		const hasId6Def = defs.some((d) => d.startsWith("[^6]:"));
		expect(hasId6Def).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// T2.5  fromCitations — Citation→Footnote inline rewrite (C)
//
// Converts inline citation markers [n] → [^n] in ParseResult.body using the
// positions from inline: InlineMarker[].  Alphabetic markers like [A] are
// never altered.  Empty/no citations → empty EditPlan.
//
// ADR-1: offsets vs the ORIGINAL body string.
// ---------------------------------------------------------------------------

/** Shared applyPlan helper (reverse-sorted, ADR-1 compliant). */
const applyPlan = (src: string, plan: { from: number; to: number; insert: string }[]): string => {
	const sorted = [...plan].sort((a, b) => b.from - a.from);
	let result = src;
	for (const edit of sorted) {
		result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
	}
	return result;
};

const makeParseResult = (overrides: Partial<ParseResult>): ParseResult => ({
	body: "",
	inline: [],
	sources: [],
	...overrides,
});

describe("fromCitations — basic citation-to-footnote rewrite", () => {
	// body has [1] and [2] inline citation markers.
	// ParseResult.inline lists both with their numeric n values.
	// fromCitations should rewrite [1]→[^1] and [2]→[^2].
	const body = "First claim[1] and second claim[2].";
	const pr = makeParseResult({
		body,
		inline: [
			{ marker: "[1]", n: 1 },
			{ marker: "[2]", n: 2 },
		],
	});

	it("produces two edits (one per inline citation marker)", () => {
		const plan = fromCitations(pr);
		expect(plan).toHaveLength(2);
	});

	it("applying the plan rewrites [1]→[^1] and [2]→[^2]", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toBe("First claim[^1] and second claim[^2].");
	});

	it("each edit targets the exact source span of [n]", () => {
		const plan = fromCitations(pr);
		// First [1] is at index 11; length 3
		expect(plan.some((e) => e.from === 11 && e.to === 14 && e.insert === "[^1]")).toBe(true);
	});
});

describe("fromCitations — allowedIds restricts conversion (F-1)", () => {
	const body = "First claim[1] and second claim[2].";
	const pr = makeParseResult({
		body,
		inline: [
			{ marker: "[1]", n: 1 },
			{ marker: "[2]", n: 2 },
		],
	});

	it("converts only ids in the allowed set; the rest stay plain [n]", () => {
		const plan = fromCitations(pr, new Set([1]));
		const result = applyPlan(body, plan);
		// [1] resolved → footnote; [2] unresolved → left as a plain citation number.
		expect(result).toBe("First claim[^1] and second claim[2].");
	});

	it("an empty allowed set converts nothing (no dangling footnotes)", () => {
		expect(fromCitations(pr, new Set())).toHaveLength(0);
	});

	it("omitting allowedIds keeps the original convert-all behaviour", () => {
		expect(fromCitations(pr)).toHaveLength(2);
	});
});

describe("fromCitations — alphabetic markers are never altered", () => {
	// [A] is an alpha marker; it must be ignored even if it appears in inline
	// (the spec says alpha markers like [A] are NEVER treated as citations).
	const body = "Note[A] and citation[1].";
	const pr = makeParseResult({
		body,
		// Only numeric n=1 is in inline; alpha [A] would never be in inline
		// (InlineMarker.n is a number), so it simply isn't present.
		inline: [{ marker: "[1]", n: 1 }],
	});

	it("alpha marker [A] in body is not touched", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toContain("[A]");
	});

	it("only [1] is rewritten to [^1]", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toBe("Note[A] and citation[^1].");
	});
});

describe("fromCitations — empty inline → empty EditPlan", () => {
	it("returns [] when inline is empty", () => {
		const pr = makeParseResult({ body: "No citations here.", inline: [] });
		const plan = fromCitations(pr);
		expect(plan).toHaveLength(0);
	});

	it("returns [] when body is empty and inline is empty", () => {
		const pr = makeParseResult({ body: "", inline: [] });
		const plan = fromCitations(pr);
		expect(plan).toHaveLength(0);
	});
});

describe("fromCitations — does NOT renumber; existing [^n] pass through unchanged", () => {
	// C does not renumber — it only converts [n]→[^n].
	// If body already has existing [^n] footnote markers, those are left alone.
	// fromCitations only targets markers explicitly listed in inline[].
	const body = "Existing[^3] and new citation[1].";
	const pr = makeParseResult({
		body,
		inline: [{ marker: "[1]", n: 1 }],
	});

	it("leaves existing [^3] untouched", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toContain("[^3]");
	});

	it("converts citation [1] to [^1]", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toBe("Existing[^3] and new citation[^1].");
	});
});

describe("fromCitations — multiple occurrences of the same n are each rewritten", () => {
	// If [1] appears twice in body and inline has two entries for n=1,
	// both occurrences must be rewritten.
	const body = "First[1] and again[1].";
	const pr = makeParseResult({
		body,
		inline: [
			{ marker: "[1]", n: 1 },
			{ marker: "[1]", n: 1 },
		],
	});

	it("produces two edits for two occurrences of [1]", () => {
		const plan = fromCitations(pr);
		expect(plan).toHaveLength(2);
	});

	it("both occurrences are rewritten to [^1]", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toBe("First[^1] and again[^1].");
	});
});

// ---------------------------------------------------------------------------
// T2.5  moveToResources — definition placement (M)
//
// Accepts an OperationContext (ctx.doc = full note, ctx.settings.resourcesName)
// and a string[] of formatted definitions in two-line format:
//   "[^n]: snippet"
//   "[title](url)"
//
// Returns an EditPlan (offsets vs ORIGINAL doc, ADR-1):
//   - If defs is empty → return [].
//   - If "## <resourcesName>" section exists → append defs after existing content
//     in that section (before next "## " heading or EOF), preserving orphans.
//   - If section absent and defs non-empty → insert at note end:
//     "\n## <resourcesName>\n\n<defs joined by \n\n>"
//
// The two-line format per def: "[^n]: snippet\n[title](url)"
// (Both newRefDefinitions and direct callers produce this same F4 format.)
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: MasonSettings = {
	debugLogging: false,
	resourcesName: "Resources",
};

const makeCtx = (doc: string, overrides: Partial<MasonSettings> = {}): OperationContext => ({
	doc,
	cursor: 0,
	settings: { ...DEFAULT_SETTINGS, ...overrides },
});

describe("moveToResources — empty defs → empty EditPlan (no section created)", () => {
	it("returns [] when defs array is empty", () => {
		const ctx = makeCtx("Some note without resources.\n");
		const plan = moveToResources(ctx, []);
		expect(plan).toHaveLength(0);
	});

	it("does not insert an empty ## Resources section", () => {
		const ctx = makeCtx("Some note.\n");
		const plan = moveToResources(ctx, []);
		expect(plan).toHaveLength(0);
	});
});

describe("moveToResources — no existing section → creates ## Resources at note end", () => {
	const doc = "# Title\n\nSome body text.\n";
	const defs = ["[^1]: A snippet\n[A Title](https://example.com)"];

	it("returns exactly one edit (an insert at end of doc)", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan).toHaveLength(1);
	});

	it("the edit is an insert (from === to)", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan[0].from).toBe(plan[0].to);
	});

	it("the inserted text contains '## Resources'", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan[0].insert).toContain("## Resources");
	});

	it("the inserted text contains the definition", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan[0].insert).toContain("[^1]: A snippet");
		expect(plan[0].insert).toContain("[A Title](https://example.com)");
	});

	it("applying the plan produces a doc that ends with the Resources section", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("## Resources");
		expect(result).toContain("[^1]: A snippet");
	});

	it("insert offset is at the end of the original doc (ADR-1)", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan[0].from).toBe(doc.length);
	});
});

describe("moveToResources — configurable resourcesName", () => {
	const doc = "# Title\n\nBody.\n";
	const defs = ["[^1]: snippet\n[Link](https://x.com)"];

	it("uses settings.resourcesName instead of 'Resources' when configured", () => {
		const ctx = makeCtx(doc, { resourcesName: "References" });
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("## References");
		expect(result).not.toContain("## Resources");
	});
});

describe("moveToResources — existing ## Resources section: appends after existing content", () => {
	// Note has an existing ## Resources section with one entry and an orphaned line.
	const existingEntry = "[^5]: Old snippet\n[Old Title](https://old.com)";
	const orphan = "Some orphaned text";
	const doc = `# Title\n\nBody text.\n\n## Resources\n\n${existingEntry}\n${orphan}\n`;
	const defs = ["[^7]: New snippet\n[New Title](https://new.com)"];

	it("returns exactly one edit", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan).toHaveLength(1);
	});

	it("the insert is an insert edit (from === to), not a replacement", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan[0].from).toBe(plan[0].to);
	});

	it("applying the plan: new def appears inside Resources section", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		const resourcesIdx = result.indexOf("## Resources");
		const newDefIdx = result.indexOf("[^7]: New snippet");
		expect(newDefIdx).toBeGreaterThan(resourcesIdx);
	});

	it("applying the plan: orphaned text is preserved unchanged", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain(orphan);
	});

	it("applying the plan: old entry is preserved", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("[^5]: Old snippet");
	});
});

describe("moveToResources — Resources section followed by another ## heading", () => {
	// New defs must NOT be inserted after the next ## heading.
	const doc = "# Title\n\nBody.\n\n## Resources\n\n[^1]: Old\n[Old](https://old.com)\n\n## Next Section\n\nMore content.\n";
	const defs = ["[^2]: New\n[New](https://new.com)"];

	it("new def appears before '## Next Section'", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		const newDefIdx = result.indexOf("[^2]: New");
		const nextSectionIdx = result.indexOf("## Next Section");
		expect(newDefIdx).toBeLessThan(nextSectionIdx);
	});

	it("## Next Section is preserved", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("## Next Section");
	});
});

describe("moveToResources — multiple defs are all inserted", () => {
	const doc = "# Title\n\nBody.\n";
	const defs = [
		"[^1]: First snippet\n[First](https://first.com)",
		"[^2]: Second snippet\n[Second](https://second.com)",
	];

	it("all definitions appear in the result", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("[^1]: First snippet");
		expect(result).toContain("[^2]: Second snippet");
	});
});

describe("moveToResources — orphaned resources (no [^n]: prefix) are NOT modified", () => {
	// An orphaned resource is a snippet+link pair with no "[^n]:" prefix.
	// These must be left exactly as they are — no deletion, movement, or modification.
	const orphanedLine = "Some snippet without footnote marker";
	const doc = `# Title\n\nBody.\n\n## Resources\n\n${orphanedLine}\n`;
	const defs = ["[^1]: New snippet\n[New](https://new.com)"];

	it("orphaned line is still present after moveToResources", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain(orphanedLine);
	});

	it("the plan is not a replacement of the orphaned line (no 'to' span covering it)", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		// All edits must be inserts (from === to), not replacements
		for (const edit of plan) {
			expect(edit.from).toBe(edit.to);
		}
	});
});

describe("moveToResources — two-line definition format (passthrough check)", () => {
	// The F4 spec mandates: "[^n]: snippet" on line 1, "[title](url)" on line 2.
	// moveToResources receives pre-formatted defs in this exact format.
	const doc = "# Title\n\nBody.\n";
	const defs = ["[^3]: A snippet about something\n[The Title](https://example.org/page)"];

	it("inserted content contains the snippet on the first definition line", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("[^3]: A snippet about something");
	});

	it("inserted content contains the link on the second definition line", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("[The Title](https://example.org/page)");
	});
});

// ---------------------------------------------------------------------------
// END-TO-END — formatF4Def + moveToResources produces F4 format in the doc
//
// Proves that F4 format is PRODUCED by core (not just passed through):
// resolveFootnoteIdentity → newRefDefinitions (via formatF4Def) → moveToResources
// → doc contains "[^id]: snippet" on line 1 and "[title](url)" on line 2.
//
// Golden setup: incoming has urlB (new) and urlA (reuses existing [^6]).
// Only urlB becomes a newRef with id=7.  urlA produces no new def.
// Expected Resources section:
//   [^7]: B snippet
//   [Beta Page](https://example.com/beta)
// ---------------------------------------------------------------------------

describe("end-to-end — formatF4Def → moveToResources places F4 format in doc (F4.1 proof)", () => {
	const incoming: FootnoteRef[] = [
		makeRef({ incomingId: 1, url: urlB, title: "Beta Page", snippet: "B snippet" }),
		makeRef({ incomingId: 2, url: urlA, title: "Alpha Page", snippet: "A snippet" }),
		makeRef({ incomingId: 3, url: urlB, title: "Beta Page Again", snippet: "B snippet 2" }),
	];
	const existing: ExistingRef[] = [makeExisting(6, urlA)];

	const { newRefs } = resolveFootnoteIdentity(incoming, existing);
	// newRefs has exactly one entry: id=7, urlB, title="Beta Page", snippet="B snippet"

	const doc = "# Title\n\nBody text.\n";
	const ctx = makeCtx(doc);

	const f4Defs = newRefs.map(formatF4Def);
	const plan = moveToResources(ctx, f4Defs);
	const result = applyPlan(doc, plan);

	it("only one new def is produced (urlB is new; urlA reuses existing [^6])", () => {
		expect(f4Defs).toHaveLength(1);
	});

	it("the doc now contains a ## Resources section", () => {
		expect(result).toContain("## Resources");
	});

	it("line 1 of the def has the snippet: '[^7]: B snippet'", () => {
		expect(result).toContain("[^7]: B snippet");
	});

	it("line 2 of the def has the markdown link: '[Beta Page](urlB)'", () => {
		expect(result).toContain(`[Beta Page](${urlB})`);
	});

	it("the snippet line appears before the link line in the doc", () => {
		const snippetIdx = result.indexOf("[^7]: B snippet");
		const linkIdx = result.indexOf(`[Beta Page](${urlB})`);
		expect(snippetIdx).toBeGreaterThan(-1);
		expect(linkIdx).toBeGreaterThan(snippetIdx);
	});

	it("no [^6] definition is created (urlA was reused from existing, not new)", () => {
		expect(result).not.toContain("[^6]: ");
	});
});

// ---------------------------------------------------------------------------
// REGRESSION — Bug 1: buildSectionAppend trailing newline
//
// When ## Resources is followed by another ## heading, the inserted defs
// must end with "\n" so the next heading stays on its own line and is not
// concatenated into the last definition line.
// ---------------------------------------------------------------------------

describe("moveToResources — Bug 1 regression: next ## heading stays at line-start after append", () => {
	// Resources section is followed immediately by ## Other.
	// After appending a new def, the char immediately before "## Other" must be "\n".
	const doc = "## Resources\n[^1]: s\n[t](u)\n## Other\n";
	const defs = ["[^2]: new\n[New](https://new.com)"];

	it("result contains '\\n## Other' (heading stays at line-start, not fused to def)", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		expect(result).toContain("\n## Other");
	});

	it("## Other is still a heading line (not fused to previous content)", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		const result = applyPlan(doc, plan);
		// The heading must appear at the very start of a line
		const lines = result.split("\n");
		expect(lines.some((l) => l === "## Other")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// REGRESSION — Bug 2: fromCitations must not rewrite [n] inside markdown links
//
// A citation [1] appearing as the display text of a link [1](url) must not
// be rewritten — only standalone [1] citations should become [^1].
// ---------------------------------------------------------------------------

describe("fromCitations — Bug 2 regression: [n](url) link text is not rewritten", () => {
	// Body has [1](https://example.com) (a markdown link) AND cite[1] (a citation).
	// Only the standalone [1] should become [^1]; the link display text is unchanged.
	const body = "[1](https://example.com) and cite[1].";
	const pr = makeParseResult({
		body,
		inline: [{ marker: "[1]", n: 1 }],
	});

	it("link display text [1](url) is NOT rewritten", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toContain("[1](https://example.com)");
	});

	it("standalone citation [1] IS rewritten to [^1]", () => {
		const plan = fromCitations(pr);
		const result = applyPlan(body, plan);
		expect(result).toBe("[1](https://example.com) and cite[^1].");
	});
});

// ---------------------------------------------------------------------------
// REGRESSION — Bug 3: sectionEndOffset off-by-one at EOF
//
// When the Resources section runs to EOF and the doc ends with "\n",
// split("\n") yields a trailing empty element that causes sectionEndOffset
// to overshoot doc.length by 1.  The offset must be clamped to doc.length.
// ---------------------------------------------------------------------------

describe("moveToResources — Bug 3 regression: existing section at EOF offset pin", () => {
	// Resources section runs to EOF (no trailing ## heading).
	const doc = "# Title\n\n## Resources\n\n[^1]: old\n[Old](https://old.com)\n";
	const defs = ["[^2]: new\n[New](https://new.com)"];

	it("edit offset is <= doc.length (not off-by-one past EOF)", () => {
		const ctx = makeCtx(doc);
		const plan = moveToResources(ctx, defs);
		expect(plan).toHaveLength(1);
		expect(plan[0].from).toBeLessThanOrEqual(doc.length);
	});
});

// ---------------------------------------------------------------------------
// T7.2  scanExistingRefs — scans F4 two-line definitions in the note doc
//
// Reverse-parses the note's existing F4 two-line definitions into ExistingRef[]:
//   line 1: "[^{id}]: {snippet}"   (id must be NUMERIC)
//   line 2: "[{title}]({url})"
//
// Rules:
//   - Alpha markers ([^a]:, [^note]:) are skipped.
//   - Empty doc / no defs → [].
//   - A numeric [^n]: def with no parseable url line: include with url="" so
//     that its id still raises maxExisting (new paste ids never collide with it).
//   - Multiple defs are all returned.
// ---------------------------------------------------------------------------

describe("scanExistingRefs — empty doc returns []", () => {
	it("returns [] for empty string", () => {
		expect(scanExistingRefs("")).toEqual([]);
	});

	it("returns [] for a doc with no footnote definitions", () => {
		const doc = "# Title\n\nSome prose without any footnotes.\n";
		expect(scanExistingRefs(doc)).toEqual([]);
	});
});

describe("scanExistingRefs — parses a single F4 two-line definition", () => {
	// F4 format: "[^id]: snippet\n[title](url)"
	const doc = [
		"## Resources",
		"",
		"[^1]: some snippet",
		"[Some Title](https://example.com/page)",
		"",
	].join("\n");

	it("returns exactly one ExistingRef", () => {
		expect(scanExistingRefs(doc)).toHaveLength(1);
	});

	it("extracted id is 1", () => {
		const refs = scanExistingRefs(doc);
		expect(refs[0].id).toBe(1);
	});

	it("extracted url is the raw url from line 2", () => {
		const refs = scanExistingRefs(doc);
		expect(refs[0].url).toBe("https://example.com/page");
	});
});

describe("scanExistingRefs — parses multiple F4 two-line definitions", () => {
	const doc = [
		"## Resources",
		"",
		"[^1]: first snippet",
		"[First Title](https://first.com/a)",
		"",
		"[^2]: second snippet",
		"[Second Title](https://second.com/b)",
		"",
	].join("\n");

	it("returns two ExistingRefs", () => {
		expect(scanExistingRefs(doc)).toHaveLength(2);
	});

	it("ids are 1 and 2 respectively", () => {
		const refs = scanExistingRefs(doc);
		const ids = refs.map((r) => r.id).sort((a, b) => a - b);
		expect(ids).toEqual([1, 2]);
	});

	it("urls match those in the definitions", () => {
		const refs = scanExistingRefs(doc);
		const urls = refs.map((r) => r.url).sort();
		expect(urls).toContain("https://first.com/a");
		expect(urls).toContain("https://second.com/b");
	});
});

describe("scanExistingRefs — alpha [^a]: definitions are skipped", () => {
	const doc = [
		"[^a]: alpha footnote",
		"[Alpha](https://alpha.com)",
		"",
		"[^note]: named footnote",
		"[Note](https://note.com)",
		"",
		"[^3]: numeric footnote",
		"[Three](https://three.com)",
		"",
	].join("\n");

	it("skips alpha [^a]: definition — not included in result", () => {
		const refs = scanExistingRefs(doc);
		expect(refs.every((r) => typeof r.id === "number" && r.id > 0)).toBe(true);
	});

	it("skips [^note]: definition — only numeric ids are included", () => {
		const refs = scanExistingRefs(doc);
		// Only [^3] is numeric; result must have exactly one ref
		expect(refs).toHaveLength(1);
	});

	it("numeric [^3] is included with id=3", () => {
		const refs = scanExistingRefs(doc);
		expect(refs[0].id).toBe(3);
		expect(refs[0].url).toBe("https://three.com");
	});
});

describe("scanExistingRefs — numeric def with no parseable url line still contributes its id", () => {
	// A numeric [^5]: def that is NOT followed by a [title](url) line.
	// The id must still be in the result so maxExisting rises past 5.
	const doc = [
		"[^5]: orphaned snippet — no link line follows",
		"This is just prose, not a markdown link.",
		"",
	].join("\n");

	it("returns one ref with id=5", () => {
		const refs = scanExistingRefs(doc);
		expect(refs).toHaveLength(1);
		expect(refs[0].id).toBe(5);
	});

	it("url is empty string (no parseable link)", () => {
		const refs = scanExistingRefs(doc);
		expect(refs[0].url).toBe("");
	});

	it("maxExisting offset: resolveFootnoteIdentity with this ref offsets new ids past 5", () => {
		const refs = scanExistingRefs(doc);
		const { idMap } = resolveFootnoteIdentity(
			[makeRef({ incomingId: 1, url: "https://brand-new.com" })],
			refs,
		);
		expect(idMap[1]).toBeGreaterThan(5);
	});
});

describe("scanExistingRefs — multi-digit ids are parsed correctly", () => {
	const doc = [
		"[^12]: twelve snippet",
		"[Twelve](https://twelve.com)",
		"",
		"[^99]: ninety-nine snippet",
		"[NinetyNine](https://ninetynine.com)",
		"",
	].join("\n");

	it("parses id=12 correctly", () => {
		const refs = scanExistingRefs(doc);
		expect(refs.some((r) => r.id === 12)).toBe(true);
	});

	it("parses id=99 correctly", () => {
		const refs = scanExistingRefs(doc);
		expect(refs.some((r) => r.id === 99)).toBe(true);
	});
});

describe("scanExistingRefs — max id raises offset for new paste", () => {
	// Note already has [^1] and [^2] with F4 defs in Resources.
	// Pasting new content → new ids must start at 3 or higher, never 1 or 2.
	const doc = [
		"# Note",
		"",
		"Existing text.[^1][^2]",
		"",
		"## Resources",
		"",
		"[^1]: first snippet",
		"[First](https://first.example.com)",
		"",
		"[^2]: second snippet",
		"[Second](https://second.example.com)",
		"",
	].join("\n");

	const existingRefs = scanExistingRefs(doc);

	it("scans two refs with ids 1 and 2", () => {
		const ids = existingRefs.map((r) => r.id).sort((a, b) => a - b);
		expect(ids).toEqual([1, 2]);
	});

	it("new paste ref gets id 3 — not 1 or 2", () => {
		const { idMap } = resolveFootnoteIdentity(
			[makeRef({ incomingId: 1, url: "https://brand-new.com/page" })],
			existingRefs,
		);
		expect(idMap[1]).toBe(3);
	});

	it("new paste ref id is neither 1 nor 2 (no collision)", () => {
		const { idMap } = resolveFootnoteIdentity(
			[makeRef({ incomingId: 1, url: "https://brand-new.com/page" })],
			existingRefs,
		);
		expect(idMap[1]).not.toBe(1);
		expect(idMap[1]).not.toBe(2);
	});
});

// ---------------------------------------------------------------------------
// countFootnoteDefs — counts DISTINCT footnote definition ids across an EditPlan
// ---------------------------------------------------------------------------

describe("countFootnoteDefs — counts distinct [^n]: definition ids across EditPlan inserts", () => {
	it("returns 0 for an empty plan", () => {
		expect(countFootnoteDefs([])).toBe(0);
	});

	it("returns 0 when no insert contains a footnote definition line", () => {
		const plan = [
			{ from: 0, to: 5, insert: "## Answer\n\nSome prose here." },
		];
		expect(countFootnoteDefs(plan)).toBe(0);
	});

	it("counts a single [^1]: definition in one edit", () => {
		const plan = [
			{ from: 10, to: 10, insert: "\n[^1]: My snippet\n[Title](https://example.com)\n" },
		];
		expect(countFootnoteDefs(plan)).toBe(1);
	});

	it("counts two distinct [^1]: and [^2]: definitions in one edit", () => {
		const plan = [
			{
				from: 0,
				to: 0,
				insert: "\n[^1]: first snippet\n[A](https://a.com)\n\n[^2]: second snippet\n[B](https://b.com)\n",
			},
		];
		expect(countFootnoteDefs(plan)).toBe(2);
	});

	it("counts distinct ids across multiple edits", () => {
		const plan = [
			{ from: 0, to: 0, insert: "prose [^1]\n" },
			{ from: 100, to: 100, insert: "\n[^1]: first\n[A](https://a.com)\n\n[^2]: second\n[B](https://b.com)\n" },
		];
		expect(countFootnoteDefs(plan)).toBe(2);
	});

	it("deduplicates the same [^n]: id appearing in multiple edits", () => {
		const plan = [
			{ from: 0, to: 0, insert: "\n[^1]: first definition\n[A](https://a.com)\n" },
			{ from: 50, to: 50, insert: "\n[^1]: duplicate definition\n[B](https://b.com)\n" },
		];
		// Same id [^1] in both edits → counted once
		expect(countFootnoteDefs(plan)).toBe(1);
	});

	it("ignores inline [^n] references (not definitions)", () => {
		// "[^1]" without trailing ":" is an inline reference, not a definition
		const plan = [
			{ from: 0, to: 0, insert: "Some prose with [^1] and [^2] inline references.\n" },
		];
		expect(countFootnoteDefs(plan)).toBe(0);
	});

	it("only matches [^n]: at the start of a line (not mid-line)", () => {
		// A [^1]: that appears mid-line must NOT be counted
		const plan = [
			{ from: 0, to: 0, insert: "See this note: [^1]: not a definition\n" },
		];
		expect(countFootnoteDefs(plan)).toBe(0);
	});

	it("handles compact single-line defs ('[^n]: [title](url)')", () => {
		const plan = [
			{ from: 0, to: 0, insert: "\n[^3]: [Example](https://example.com)\n[^4]: [Other](https://other.com)\n" },
		];
		expect(countFootnoteDefs(plan)).toBe(2);
	});
});
