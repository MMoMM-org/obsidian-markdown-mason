import { describe, it, expect } from "vitest";
import {
	resolveFootnoteIdentity,
	applyFootnoteInlineRename,
	newRefDefinitions,
} from "../../src/core/footnotes";
import type { FootnoteRef, ExistingRef } from "../../src/core/types";
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
//   "[^7]: Title\n    URL"
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
// newRefDefinitions — produces definition lines for new refs
//
// Output per ref: "[^{id}]: {title}\n    {url}"
// These strings are handed to T2.5 (M) for placement into Resources section.
// ---------------------------------------------------------------------------

describe("newRefDefinitions — produces formatted definition strings", () => {
	const newRefs: ResolvedRef[] = [
		{ incomingId: 1, id: 7, url: urlB, title: "Beta Page", snippet: "snip" },
	];

	it("returns one definition string per newRef", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs).toHaveLength(1);
	});

	it("definition starts with [^7]:", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs[0]).toMatch(/^\[\^7\]:/);
	});

	it("definition contains the title", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs[0]).toContain("Beta Page");
	});

	it("definition contains the url", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs[0]).toContain(urlB);
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

	it("the single new definition is for [^7] matching the inline rewrite", () => {
		const defs = newRefDefinitions(newRefs);
		expect(defs[0]).toMatch(/^\[\^7\]:/);
		expect(defs[0]).toContain("Beta Page");
		expect(defs[0]).toContain(urlB);
	});

	it("no new definition is emitted for id 6 (urlA was reused from existing, not new)", () => {
		const defs = newRefDefinitions(newRefs);
		const hasId6Def = defs.some((d) => d.startsWith("[^6]:"));
		expect(hasId6Def).toBe(false);
	});
});
