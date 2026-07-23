// src/core/formatPipeline.ts — shared cleanup helper (spec 005, CON-2: no obsidian import)
//
// applyTextCleanup chains the 7 in-memory cleanup transforms that are also used
// in fusedFormatNote (commands.ts steps 1-7). Extracting them here lets the
// paste pipeline re-use the same logic without duplicating the gate pattern.
//
// Step order matches fusedFormatNote exactly:
//   -1. boxTable          (spec-007, default ON: box-drawing tables → Markdown tables)
//   0. reflow             (spec-006, opt-in/OFF: re-segment hard-wrapped OCR text)
//   1. dehyphenate        (MUST precede dewrap so join-on-space is not inserted)
//   2. dewrap
//   3. tidyWhitespace
//   4. decomposeLigatures
//   5. normalizeBullets
//   6. normalizeOrdered
//   7. normalize          (heading gap-close)
//
// Non-cleanup recipe keys (cascade, fromCitations, identity, move) are carried
// in the FormatSelectionRecipe type but are not consumed here — they control
// other pipeline stages handled by the command layer.

import { DEFAULT_SETTINGS } from "./types";
import type { EditPlan, OperationContext } from "./types";
import type { FormatSelectionRecipe } from "./formatSelection";
import { applyToString } from "./applyToString";
import { dehyphenate, dewrap, tidyWhitespace, decomposeLigatures } from "./cleanup";
import { reflow } from "./reflow";
import { boxTable } from "./boxTable";
import { normalizeBullets, normalizeOrdered } from "./lists";
import { normalize } from "./headings";

export type StepLogger = (line: string) => void;

/**
 * Apply the 7 cleanup transforms to `doc` in order, gated by the matching
 * boolean keys in `recipe`.
 *
 * @param doc    Source document text.
 * @param recipe Toggle map; only the 7 cleanup keys are consumed.
 * @param log    Optional logger; receives one line per step ("format: …").
 * @returns      Transformed document string.
 */
export function applyTextCleanup(
	doc: string,
	recipe: FormatSelectionRecipe,
	log?: StepLogger,
): string {
	const makeCtx = (doc: string): OperationContext => ({ doc, cursor: 0, settings: DEFAULT_SETTINGS });

	const step = (
		s: string,
		on: boolean,
		name: string,
		fn: (c: OperationContext) => EditPlan,
	): string => {
		if (!on) {
			log?.(`format: ${name} skipped (toggle off)`);
			return s;
		}
		const plan = fn(makeCtx(s));
		log?.(`format: ${name} ${plan.length} edit${plan.length === 1 ? "" : "s"}`);
		return plan.length ? applyToString(s, plan) : s;
	};

	let s = doc;
	// spec-007: boxTable runs FIRST so a drawn table becomes a real `table` block
	// before reflow/dewrap (which would otherwise mangle its border rows). Default ON.
	s = step(s, recipe.boxTable,           "boxTable",           boxTable);
	// spec-006: reflow runs next so its hard-wrap re-segmentation and compound-hyphen
	// handling win before dehyphenate/dewrap see the text. Default OFF (opt-in).
	s = step(s, recipe.reflow,             "reflow",             reflow);
	s = step(s, recipe.dehyphenate,        "dehyphenate",        dehyphenate);
	s = step(s, recipe.dewrap,             "dewrap",             dewrap);
	s = step(s, recipe.tidyWhitespace,     "tidyWhitespace",     tidyWhitespace);
	s = step(s, recipe.decomposeLigatures, "decomposeLigatures", decomposeLigatures);
	s = step(s, recipe.normalizeBullets,   "normalizeBullets",   normalizeBullets);
	s = step(s, recipe.normalizeOrdered,   "normalizeOrdered",   normalizeOrdered);
	s = step(s, recipe.normalize,          "normalize",          normalize);
	return s;
}
