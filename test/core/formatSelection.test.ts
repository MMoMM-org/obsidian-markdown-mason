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

	it("returns dewrap=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).dewrap).toBe(true);
	});

	it("returns dehyphenate=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).dehyphenate).toBe(true);
	});

	it("returns decomposeLigatures=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).decomposeLigatures).toBe(true);
	});

	it("returns tidyWhitespace=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).tidyWhitespace).toBe(true);
	});

	it("returns normalizeBullets=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).normalizeBullets).toBe(true);
	});

	it("returns normalizeOrdered=true", () => {
		expect(resolveFormatSelectionRecipe(makeSettings()).normalizeOrdered).toBe(true);
	});

	it("result has exactly eleven keys", () => {
		const keys = Object.keys(resolveFormatSelectionRecipe(makeSettings())).sort();
		expect(keys).toEqual([
			"cascade",
			"decomposeLigatures",
			"dehyphenate",
			"dewrap",
			"fromCitations",
			"identity",
			"move",
			"normalize",
			"normalizeBullets",
			"normalizeOrdered",
			"tidyWhitespace",
		]);
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

	it("keeps dewrap=true", () => {
		expect(recipe.dewrap).toBe(true);
	});

	it("keeps dehyphenate=true", () => {
		expect(recipe.dehyphenate).toBe(true);
	});

	it("keeps decomposeLigatures=true", () => {
		expect(recipe.decomposeLigatures).toBe(true);
	});

	it("keeps tidyWhitespace=true", () => {
		expect(recipe.tidyWhitespace).toBe(true);
	});

	it("keeps normalizeBullets=true", () => {
		expect(recipe.normalizeBullets).toBe(true);
	});

	it("keeps normalizeOrdered=true", () => {
		expect(recipe.normalizeOrdered).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Partial override — one new key disabled; the other ten remain true
// ---------------------------------------------------------------------------

describe("resolveFormatSelectionRecipe — partial { dewrap: false }", () => {
	const recipe = resolveFormatSelectionRecipe(makeSettings({ dewrap: false }));

	it("sets dewrap=false", () => {
		expect(recipe.dewrap).toBe(false);
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

	it("keeps move=true", () => {
		expect(recipe.move).toBe(true);
	});

	it("keeps dehyphenate=true", () => {
		expect(recipe.dehyphenate).toBe(true);
	});

	it("keeps decomposeLigatures=true", () => {
		expect(recipe.decomposeLigatures).toBe(true);
	});

	it("keeps tidyWhitespace=true", () => {
		expect(recipe.tidyWhitespace).toBe(true);
	});

	it("keeps normalizeBullets=true", () => {
		expect(recipe.normalizeBullets).toBe(true);
	});

	it("keeps normalizeOrdered=true", () => {
		expect(recipe.normalizeOrdered).toBe(true);
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
		dewrap: false,
		dehyphenate: false,
		decomposeLigatures: false,
		tidyWhitespace: false,
		normalizeBullets: false,
		normalizeOrdered: false,
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

	it("dewrap is false", () => {
		expect(recipe.dewrap).toBe(false);
	});

	it("dehyphenate is false", () => {
		expect(recipe.dehyphenate).toBe(false);
	});

	it("decomposeLigatures is false", () => {
		expect(recipe.decomposeLigatures).toBe(false);
	});

	it("tidyWhitespace is false", () => {
		expect(recipe.tidyWhitespace).toBe(false);
	});

	it("normalizeBullets is false", () => {
		expect(recipe.normalizeBullets).toBe(false);
	});

	it("normalizeOrdered is false", () => {
		expect(recipe.normalizeOrdered).toBe(false);
	});
});
