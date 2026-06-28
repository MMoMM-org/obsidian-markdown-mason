import { describe, it, expect } from "vitest";
import {
	resolveFormatSelectionRecipe,
	type FormatSelectionRecipe,
} from "../../src/core/formatSelection";
import type { MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// T1.1  FormatSelectionRecipe resolver
//
// resolveFormatSelectionRecipe() reads s.formatSelection and applies defaults
// so every caller receives a fully-populated recipe. The five fine toggles are:
//   cascade | normalize | fromCitations | identity | move
// All default to true when absent.
// ---------------------------------------------------------------------------

const makeSettings = (
	formatSelection?: Partial<FormatSelectionRecipe>,
): MasonSettings => ({
	debugLogging: false,
	resourcesName: "Resources",
	...(formatSelection !== undefined ? { formatSelection } : {}),
});

// ---------------------------------------------------------------------------
// No formatSelection field at all — every toggle defaults to true
// ---------------------------------------------------------------------------

describe("resolveFormatSelectionRecipe — no formatSelection field", () => {
	it("returns cascade=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).cascade).toBe(true);
	});

	it("returns normalize=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).normalize).toBe(true);
	});

	it("returns fromCitations=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).fromCitations).toBe(true);
	});

	it("returns identity=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).identity).toBe(true);
	});

	it("returns move=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).move).toBe(true);
	});

	it("result has exactly five keys", () => {
		const keys = Object.keys(resolveFormatSelectionRecipe(makeSettings())).sort();
		expect(keys).toEqual(["cascade", "fromCitations", "identity", "move", "normalize"]);
	});
});

// ---------------------------------------------------------------------------
// Partial override — only move disabled; the other four remain true
// ---------------------------------------------------------------------------

describe("resolveFormatSelectionRecipe — partial { move: false }", () => {
	const recipe = resolveFormatSelectionRecipe(makeSettings({ move: false }));

	it("sets move=false", () => {
		expect(recipe.move).toBe(false);
	});

	it("keeps cascade=true", () => {
		expect(recipe.cascade).toBe(true);
	});

	it("keeps normalize=true", () => {
		expect(recipe.normalize).toBe(true);
	});

	it("keeps fromCitations=true", () => {
		expect(recipe.fromCitations).toBe(true);
	});

	it("keeps identity=true", () => {
		expect(recipe.identity).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Explicit all-false — returned verbatim, no defaults applied over explicit false
// ---------------------------------------------------------------------------

describe("resolveFormatSelectionRecipe — explicit all-false", () => {
	const allFalse: FormatSelectionRecipe = {
		cascade: false,
		normalize: false,
		fromCitations: false,
		identity: false,
		move: false,
	};
	const recipe = resolveFormatSelectionRecipe(makeSettings(allFalse));

	it("cascade is false", () => {
		expect(recipe.cascade).toBe(false);
	});

	it("normalize is false", () => {
		expect(recipe.normalize).toBe(false);
	});

	it("fromCitations is false", () => {
		expect(recipe.fromCitations).toBe(false);
	});

	it("identity is false", () => {
		expect(recipe.identity).toBe(false);
	});

	it("move is false", () => {
		expect(recipe.move).toBe(false);
	});
});
