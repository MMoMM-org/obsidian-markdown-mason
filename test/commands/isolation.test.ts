/**
 * T2.2 — Isolation guarantees (ADR-19 / PRD Feature 4)
 *
 * Verifies that formatSelection recipe settings do NOT leak into:
 *   1. tidyFootnotes(ctx)  — the "Tidy footnotes" preset path
 *   2. Each individual built-in command / registry entry operation
 *   3. The mason.* API (buildRegistry().api.*)
 *
 * All tests are pure: they call exported functions directly with different
 * settings.formatSelection values and assert the output is identical.
 * No production change is expected for T2.2; if a test fails it proves
 * unintended leakage that must be fixed by removing recipe reads from that path.
 *
 * Design: uses factory functions (makeCtx) for fresh state per test.
 * No let/beforeEach mutation.
 */

import { describe, it, expect } from "vitest";
import { tidyFootnotes } from "../../src/core/noteFootnotes";
import { buildRegistry } from "../../src/core/registry";
import { applyToString } from "../../src/core/applyToString";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import type { MasonSettings, OperationContext, ParseResult } from "../../src/core/types";
import type { FormatSelectionRecipe } from "../../src/core/formatSelection";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a minimal all-stages-included recipe (all toggles ON). */
const RECIPE_ALL_ON: FormatSelectionRecipe = {
	cascade: true, normalize: true, fromCitations: true, identity: true, move: true,
	boxTable: true, reflow: true, dewrap: true, dehyphenate: true, decomposeLigatures: true,
	tidyWhitespace: true, normalizeBullets: true, normalizeOrdered: true,
};

/** Create a recipe with every toggle OFF. */
const RECIPE_ALL_OFF: FormatSelectionRecipe = {
	cascade: false, normalize: false, fromCitations: false, identity: false, move: false,
	boxTable: false, reflow: false, dewrap: false, dehyphenate: false, decomposeLigatures: false,
	tidyWhitespace: false, normalizeBullets: false, normalizeOrdered: false,
};

function makeSettings(recipe: Partial<FormatSelectionRecipe>): MasonSettings {
	return { ...DEFAULT_SETTINGS, formatSelection: recipe };
}

function makeCtx(doc: string, recipe: Partial<FormatSelectionRecipe>): OperationContext {
	return {
		doc,
		cursor: 0,
		input: "",
		settings: makeSettings(recipe),
	};
}

// Fixture: has bare citations, inline refs, and a def outside Resources.
const FIXTURE_TIDY = [
	"# Note",
	"",
	"See [1] and [^2].",
	"",
	"[^1]: First",
	"[https://a.com](https://a.com)",
	"[^2]: Second",
	"[https://b.com](https://b.com)",
].join("\n") + "\n";

// Simpler fixture for registry entry / API tests (just a heading gap).
const FIXTURE_HEADINGS = "# A\n\n### B\n\nContent.\n";

// Fixture for fromCitations entry
const FIXTURE_CITATIONS = "Text [1] inline.\n";

// Fixture for identity entry: has a renumber-worthy ref
const FIXTURE_IDENTITY = "See [^3] ref.\n\n[^3]: def\n[https://x.com](https://x.com)\n";

// Fixture for move entry
const FIXTURE_MOVE = "Body text.\n\n[^1]: def\n[https://x.com](https://x.com)\n";

// ---------------------------------------------------------------------------
// T2.2.1 — tidyFootnotes(ctx) is unaffected by settings.formatSelection
//
// tidyFootnotes reads settings.resourcesName (for the Resources section name)
// but must never read settings.formatSelection. Its stage gates come exclusively
// from its own `include` second parameter, not from the recipe.
// ---------------------------------------------------------------------------

describe("T2.2.1 — tidyFootnotes(ctx) is unaffected by settings.formatSelection", () => {
	it("all-on recipe and all-off recipe produce identical tidyFootnotes output", () => {
		const ctxAllOn  = makeCtx(FIXTURE_TIDY, RECIPE_ALL_ON);
		const ctxAllOff = makeCtx(FIXTURE_TIDY, RECIPE_ALL_OFF);

		const resultAllOn  = applyToString(FIXTURE_TIDY, tidyFootnotes(ctxAllOn));
		const resultAllOff = applyToString(FIXTURE_TIDY, tidyFootnotes(ctxAllOff));

		expect(resultAllOn).toBe(resultAllOff);
	});

	it("partial recipe { normalize: false, cascade: false } does not affect tidyFootnotes", () => {
		const ctxFull    = makeCtx(FIXTURE_TIDY, {});
		const ctxPartial = makeCtx(FIXTURE_TIDY, { normalize: false, cascade: false });

		const resultFull    = applyToString(FIXTURE_TIDY, tidyFootnotes(ctxFull));
		const resultPartial = applyToString(FIXTURE_TIDY, tidyFootnotes(ctxPartial));

		expect(resultFull).toBe(resultPartial);
	});

	it("{ fromCitations: false, identity: false, move: false } recipe does NOT suppress tidyFootnotes stages", () => {
		// Even when the recipe's footnote toggles are all false, tidyFootnotes(ctx)
		// (called with no include arg) still runs all stages — the include arg
		// defaults to { fromCitations:true, identity:true, move:true }.
		const ctxOn  = makeCtx(FIXTURE_TIDY, {});
		const ctxOff = makeCtx(FIXTURE_TIDY, { fromCitations: false, identity: false, move: false });

		const planOn  = tidyFootnotes(ctxOn);
		const planOff = tidyFootnotes(ctxOff);

		// Both should produce the SAME plan (formatSelection does not affect it)
		expect(planOn).toEqual(planOff);
	});
});

// ---------------------------------------------------------------------------
// T2.2.2 — Individual registry entry operations are unaffected by formatSelection
//
// Each entry.run(ctx) must produce the same EditPlan regardless of
// settings.formatSelection. The recipe is only read by fusedFormatNote, not by
// the individual operations.
// ---------------------------------------------------------------------------

describe("T2.2.2 — individual registry operations are unaffected by formatSelection", () => {
	const { entries } = buildRegistry();

	it("headings.normalize plan is identical regardless of formatSelection", () => {
		const entry = entries.find((e) => e.id === "headings.normalize")!;
		expect(entry).toBeDefined();

		const planAllOn  = entry.run(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_ON));
		const planAllOff = entry.run(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_OFF));

		expect(planAllOn).toEqual(planAllOff);
	});

	it("headings.cascade plan is identical regardless of formatSelection", () => {
		const entry = entries.find((e) => e.id === "headings.cascade")!;
		expect(entry).toBeDefined();

		// Cascade with cursor inside a doc — no selection → empty plan; still must be equal
		const planAllOn  = entry.run(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_ON));
		const planAllOff = entry.run(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_OFF));

		expect(planAllOn).toEqual(planAllOff);
	});

	it("footnotes.fromCitations plan is identical regardless of formatSelection", () => {
		const entry = entries.find((e) => e.id === "footnotes.fromCitations")!;
		expect(entry).toBeDefined();

		const planAllOn  = entry.run(makeCtx(FIXTURE_CITATIONS, RECIPE_ALL_ON));
		const planAllOff = entry.run(makeCtx(FIXTURE_CITATIONS, RECIPE_ALL_OFF));

		expect(planAllOn).toEqual(planAllOff);
	});

	it("footnotes.identity plan is identical regardless of formatSelection", () => {
		const entry = entries.find((e) => e.id === "footnotes.identity")!;
		expect(entry).toBeDefined();

		const planAllOn  = entry.run(makeCtx(FIXTURE_IDENTITY, RECIPE_ALL_ON));
		const planAllOff = entry.run(makeCtx(FIXTURE_IDENTITY, RECIPE_ALL_OFF));

		expect(planAllOn).toEqual(planAllOff);
	});

	it("footnotes.move plan is identical regardless of formatSelection", () => {
		const entry = entries.find((e) => e.id === "footnotes.move")!;
		expect(entry).toBeDefined();

		const planAllOn  = entry.run(makeCtx(FIXTURE_MOVE, RECIPE_ALL_ON));
		const planAllOff = entry.run(makeCtx(FIXTURE_MOVE, RECIPE_ALL_OFF));

		expect(planAllOn).toEqual(planAllOff);
	});
});

// ---------------------------------------------------------------------------
// T2.2.3 — buildRegistry().api.* is unaffected by settings.formatSelection
//
// The mason.* API functions receive an OperationContext and call core functions
// directly. They must not read ctx.settings.formatSelection.
// ---------------------------------------------------------------------------

describe("T2.2.3 — buildRegistry().api.* output is unaffected by formatSelection", () => {
	const { api } = buildRegistry();

	it("api.headings.normalize is identical regardless of formatSelection", () => {
		const planAllOn  = api.headings.normalize(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_ON));
		const planAllOff = api.headings.normalize(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_OFF));
		expect(planAllOn).toEqual(planAllOff);
	});

	it("api.headings.cascade is identical regardless of formatSelection", () => {
		const planAllOn  = api.headings.cascade(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_ON));
		const planAllOff = api.headings.cascade(makeCtx(FIXTURE_HEADINGS, RECIPE_ALL_OFF));
		expect(planAllOn).toEqual(planAllOff);
	});

	it("api.util.normalizeUrl is unaffected (no ctx dependency)", () => {
		const result1 = api.util.normalizeUrl("https://Example.COM/path/");
		const result2 = api.util.normalizeUrl("https://Example.COM/path/");
		// Both calls with same input must produce the same output
		expect(result1).toBe(result2);
	});
});

// ---------------------------------------------------------------------------
// T2.2.4 — api.footnotes.* is unaffected by settings.formatSelection
//
// These three methods are the core of the format-selection recipe but they
// belong to the mason.* API which must never read ctx.settings.formatSelection.
// Each test compares all-on vs all-off (and one partial) recipe to prove that
// the recipe toggle values do not leak into the API output.
// ---------------------------------------------------------------------------

/** Minimal ParseResult fixture with one inline citation and one source. */
const makeParseResult = (overrides: Partial<ParseResult> = {}): ParseResult => ({
	body: "Text with [1] citation.",
	inline: [{ marker: "[1]", n: 1 }],
	sources: [
		{
			incomingId: 1,
			snippet: "Example snippet",
			title: "Example source",
			url: "https://example.com",
		},
	],
	...overrides,
});

/** Partial recipe: only the heading toggles differ; footnote toggles stay default. */
const RECIPE_PARTIAL: FormatSelectionRecipe = {
	cascade: false, normalize: false, fromCitations: true, identity: true, move: true,
	boxTable: true, reflow: false, dewrap: true, dehyphenate: true, decomposeLigatures: true,
	tidyWhitespace: true, normalizeBullets: true, normalizeOrdered: true,
};

describe("T2.2.4 — api.footnotes.* output is unaffected by formatSelection", () => {
	const { api } = buildRegistry();

	it("api.footnotes.fromCitations is identical for all-on vs all-off recipe", () => {
		const parseResult = makeParseResult();
		const planAllOn  = api.footnotes.fromCitations(makeCtx(FIXTURE_CITATIONS, RECIPE_ALL_ON),  parseResult);
		const planAllOff = api.footnotes.fromCitations(makeCtx(FIXTURE_CITATIONS, RECIPE_ALL_OFF), parseResult);
		expect(planAllOn).toEqual(planAllOff);
	});

	it("api.footnotes.fromCitations is identical for all-on vs partial recipe", () => {
		const parseResult = makeParseResult();
		const planAllOn   = api.footnotes.fromCitations(makeCtx(FIXTURE_CITATIONS, RECIPE_ALL_ON),  parseResult);
		const planPartial = api.footnotes.fromCitations(makeCtx(FIXTURE_CITATIONS, RECIPE_PARTIAL), parseResult);
		expect(planAllOn).toEqual(planPartial);
	});

	it("api.footnotes.identity is identical for all-on vs all-off recipe", () => {
		const parseResult = makeParseResult({
			body: "See [^3] ref.\n\n[^3]: def\n[https://x.com](https://x.com)\n",
			inline: [{ marker: "[^3]", n: 3 }],
			sources: [],
		});
		const planAllOn  = api.footnotes.identity(makeCtx(FIXTURE_IDENTITY, RECIPE_ALL_ON),  parseResult);
		const planAllOff = api.footnotes.identity(makeCtx(FIXTURE_IDENTITY, RECIPE_ALL_OFF), parseResult);
		expect(planAllOn).toEqual(planAllOff);
	});

	it("api.footnotes.identity is identical for all-on vs partial recipe", () => {
		const parseResult = makeParseResult({
			body: "See [^3] ref.\n\n[^3]: def\n[https://x.com](https://x.com)\n",
			inline: [{ marker: "[^3]", n: 3 }],
			sources: [],
		});
		const planAllOn   = api.footnotes.identity(makeCtx(FIXTURE_IDENTITY, RECIPE_ALL_ON),  parseResult);
		const planPartial = api.footnotes.identity(makeCtx(FIXTURE_IDENTITY, RECIPE_PARTIAL), parseResult);
		expect(planAllOn).toEqual(planPartial);
	});

	it("api.footnotes.move is identical for all-on vs all-off recipe", () => {
		const planAllOn  = api.footnotes.move(makeCtx(FIXTURE_MOVE, RECIPE_ALL_ON));
		const planAllOff = api.footnotes.move(makeCtx(FIXTURE_MOVE, RECIPE_ALL_OFF));
		expect(planAllOn).toEqual(planAllOff);
	});

	it("api.footnotes.move is identical for all-on vs partial recipe", () => {
		const planAllOn   = api.footnotes.move(makeCtx(FIXTURE_MOVE, RECIPE_ALL_ON));
		const planPartial = api.footnotes.move(makeCtx(FIXTURE_MOVE, RECIPE_PARTIAL));
		expect(planAllOn).toEqual(planPartial);
	});
});

// ---------------------------------------------------------------------------
// T4.3.1 — New cleanup/lists RegistryEntry.run() calls are recipe-blind
//
// Even with settings.formatSelection set to all-off, each of the six new
// commands produces a non-empty EditPlan when invoked on trigger content.
// The recipe toggles are read ONLY by fusedFormatNote; command paths
// delegate directly to pure transforms.
// ---------------------------------------------------------------------------

describe("T4.3.1 — new cleanup/lists commands are recipe-blind (RegistryEntry.run)", () => {
	const { entries } = buildRegistry();

	it("cleanup.dewrap: run() on multi-line paragraph returns non-empty plan with all-off recipe", () => {
		const entry = entries.find((e) => e.id === "cleanup.dewrap")!;
		expect(entry, "entry cleanup.dewrap must exist").toBeDefined();
		const ctx = makeCtx("# H\n\nFirst line\nsecond line.\n", RECIPE_ALL_OFF);
		const plan = entry.run(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("cleanup.dehyphenate: run() on soft-hyphenated word returns non-empty plan with all-off recipe", () => {
		const entry = entries.find((e) => e.id === "cleanup.dehyphenate")!;
		expect(entry, "entry cleanup.dehyphenate must exist").toBeDefined();
		const ctx = makeCtx("long-\nword continues.\n", RECIPE_ALL_OFF);
		const plan = entry.run(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("cleanup.decomposeLigatures: run() on doc with smart quotes returns non-empty plan with all-off recipe", () => {
		const entry = entries.find((e) => e.id === "cleanup.decomposeLigatures")!;
		expect(entry, "entry cleanup.decomposeLigatures must exist").toBeDefined();
		const ctx = makeCtx("He said “hello”.\n", RECIPE_ALL_OFF);
		const plan = entry.run(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("cleanup.tidyWhitespace: run() on doc with double spaces returns non-empty plan with all-off recipe", () => {
		const entry = entries.find((e) => e.id === "cleanup.tidyWhitespace")!;
		expect(entry, "entry cleanup.tidyWhitespace must exist").toBeDefined();
		const ctx = makeCtx("Word  extra  spaces.\n", RECIPE_ALL_OFF);
		const plan = entry.run(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("lists.normalizeBullets: run() on * bullet list returns non-empty plan with all-off recipe", () => {
		const entry = entries.find((e) => e.id === "lists.normalizeBullets")!;
		expect(entry, "entry lists.normalizeBullets must exist").toBeDefined();
		const ctx = makeCtx("* item one\n* item two\n", RECIPE_ALL_OFF);
		const plan = entry.run(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("lists.normalizeOrdered: run() on out-of-sequence list returns non-empty plan with all-off recipe", () => {
		const entry = entries.find((e) => e.id === "lists.normalizeOrdered")!;
		expect(entry, "entry lists.normalizeOrdered must exist").toBeDefined();
		const ctx = makeCtx("2. first item\n3. second item\n", RECIPE_ALL_OFF);
		const plan = entry.run(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// T4.3.2 — mason.cleanup.* and mason.lists.* API methods are recipe-blind
// ---------------------------------------------------------------------------

describe("T4.3.2 — mason.cleanup and mason.lists API methods are recipe-blind", () => {
	const { api } = buildRegistry();

	it("api.cleanup.dewrap on multi-line paragraph returns non-empty plan regardless of settings", () => {
		const ctx = makeCtx("# H\n\nFirst line\nsecond line.\n", RECIPE_ALL_OFF);
		const plan = api.cleanup.dewrap(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("api.cleanup.dewrap plan is identical for all-on vs all-off recipe", () => {
		const doc = "# H\n\nFirst line\nsecond line.\n";
		const planOn  = api.cleanup.dewrap(makeCtx(doc, RECIPE_ALL_ON));
		const planOff = api.cleanup.dewrap(makeCtx(doc, RECIPE_ALL_OFF));
		expect(planOn).toEqual(planOff);
	});

	it("api.lists.normalizeBullets on * list returns non-empty plan regardless of settings", () => {
		const ctx = makeCtx("* item one\n* item two\n", RECIPE_ALL_OFF);
		const plan = api.lists.normalizeBullets(ctx);
		expect(plan.length).toBeGreaterThan(0);
	});

	it("api.lists.normalizeBullets plan is identical for all-on vs all-off recipe", () => {
		const doc = "* item one\n* item two\n";
		const planOn  = api.lists.normalizeBullets(makeCtx(doc, RECIPE_ALL_ON));
		const planOff = api.lists.normalizeBullets(makeCtx(doc, RECIPE_ALL_OFF));
		expect(planOn).toEqual(planOff);
	});

	it("api.cleanup.dehyphenate plan is identical for all-on vs all-off recipe", () => {
		const doc = "long-\nword continues.\n";
		const planOn  = api.cleanup.dehyphenate(makeCtx(doc, RECIPE_ALL_ON));
		const planOff = api.cleanup.dehyphenate(makeCtx(doc, RECIPE_ALL_OFF));
		expect(planOn).toEqual(planOff);
	});

	it("api.cleanup.decomposeLigatures plan is identical for all-on vs all-off recipe", () => {
		const doc = "He said “hello”.\n";
		const planOn  = api.cleanup.decomposeLigatures(makeCtx(doc, RECIPE_ALL_ON));
		const planOff = api.cleanup.decomposeLigatures(makeCtx(doc, RECIPE_ALL_OFF));
		expect(planOn).toEqual(planOff);
	});

	it("api.cleanup.tidyWhitespace plan is identical for all-on vs all-off recipe", () => {
		const doc = "Word  extra  spaces.\n";
		const planOn  = api.cleanup.tidyWhitespace(makeCtx(doc, RECIPE_ALL_ON));
		const planOff = api.cleanup.tidyWhitespace(makeCtx(doc, RECIPE_ALL_OFF));
		expect(planOn).toEqual(planOff);
	});

	it("api.lists.normalizeOrdered plan is identical for all-on vs all-off recipe", () => {
		const doc = "2. first item\n3. second item\n";
		const planOn  = api.lists.normalizeOrdered(makeCtx(doc, RECIPE_ALL_ON));
		const planOff = api.lists.normalizeOrdered(makeCtx(doc, RECIPE_ALL_OFF));
		expect(planOn).toEqual(planOff);
	});
});

// ---------------------------------------------------------------------------
// T4.3.3 — spec-003 individual commands produce identical results with/without
//           the 6 new recipe keys set to false
// ---------------------------------------------------------------------------

describe("T4.3.3 — spec-003 individual commands are unaffected by new recipe keys", () => {
	const { entries } = buildRegistry();

	// Recipe WITHOUT the new 6 keys dominant (old behavior: all 5 spec-003 keys on,
	// 6 new keys off — simulates a caller that sets new keys false)
	const recipeOld: FormatSelectionRecipe = {
		cascade: true, normalize: true, fromCitations: true, identity: true, move: true,
		boxTable: false, reflow: false, dewrap: false, dehyphenate: false, decomposeLigatures: false,
		tidyWhitespace: false, normalizeBullets: false, normalizeOrdered: false,
	};
	// Recipe WITH the new 6 keys also enabled
	const recipeNew: FormatSelectionRecipe = RECIPE_ALL_ON;

	it("headings.normalize produces identical plan with old vs new recipe", () => {
		const entry = entries.find((e) => e.id === "headings.normalize")!;
		const planOld = entry.run(makeCtx(FIXTURE_HEADINGS, recipeOld));
		const planNew = entry.run(makeCtx(FIXTURE_HEADINGS, recipeNew));
		expect(planOld).toEqual(planNew);
	});

	it("headings.cascade produces identical plan with old vs new recipe", () => {
		const entry = entries.find((e) => e.id === "headings.cascade")!;
		const planOld = entry.run(makeCtx(FIXTURE_HEADINGS, recipeOld));
		const planNew = entry.run(makeCtx(FIXTURE_HEADINGS, recipeNew));
		expect(planOld).toEqual(planNew);
	});

	it("footnotes.fromCitations produces identical plan with old vs new recipe", () => {
		const entry = entries.find((e) => e.id === "footnotes.fromCitations")!;
		const planOld = entry.run(makeCtx(FIXTURE_CITATIONS, recipeOld));
		const planNew = entry.run(makeCtx(FIXTURE_CITATIONS, recipeNew));
		expect(planOld).toEqual(planNew);
	});

	it("footnotes.identity produces identical plan with old vs new recipe", () => {
		const entry = entries.find((e) => e.id === "footnotes.identity")!;
		const planOld = entry.run(makeCtx(FIXTURE_IDENTITY, recipeOld));
		const planNew = entry.run(makeCtx(FIXTURE_IDENTITY, recipeNew));
		expect(planOld).toEqual(planNew);
	});

	it("footnotes.move produces identical plan with old vs new recipe", () => {
		const entry = entries.find((e) => e.id === "footnotes.move")!;
		const planOld = entry.run(makeCtx(FIXTURE_MOVE, recipeOld));
		const planNew = entry.run(makeCtx(FIXTURE_MOVE, recipeNew));
		expect(planOld).toEqual(planNew);
	});
});

// ---------------------------------------------------------------------------
// T4.3.4 — "Tidy footnotes" is unaffected by the 6 new recipe keys
//
// Already covered by T2.2.1: the RECIPE_ALL_ON and RECIPE_ALL_OFF constants
// defined at the top of this file include all 11 keys (the 5 spec-003 keys
// plus the 6 new spec-004 keys: dewrap, dehyphenate, decomposeLigatures,
// tidyWhitespace, normalizeBullets, normalizeOrdered).  The three tests in
// T2.2.1 compare all-on vs all-off recipes and assert identical tidyFootnotes
// output, which already exercises all new toggles.  No additional test needed.
// ---------------------------------------------------------------------------
