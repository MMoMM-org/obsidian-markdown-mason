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
import type { MasonSettings, OperationContext } from "../../src/core/types";
import type { FormatSelectionRecipe } from "../../src/core/formatSelection";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

/** Create a minimal all-stages-included recipe (all toggles ON). */
const RECIPE_ALL_ON: FormatSelectionRecipe = {
	cascade: true, normalize: true, fromCitations: true, identity: true, move: true,
};

/** Create a recipe with every toggle OFF. */
const RECIPE_ALL_OFF: FormatSelectionRecipe = {
	cascade: false, normalize: false, fromCitations: false, identity: false, move: false,
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
