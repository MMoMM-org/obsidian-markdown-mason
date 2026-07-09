// No obsidian import — pure core module (CON-2).
import type { MasonSettings } from "./types";

// ---------------------------------------------------------------------------
// FormatSelectionRecipe — eleven per-step toggles for the Format selection command.
// MasonSettings.formatSelection?: Partial<FormatSelectionRecipe> is defined in
// types.ts; absent field resolves to all-on via resolveFormatSelectionRecipe().
// ---------------------------------------------------------------------------

export interface FormatSelectionRecipe {
	cascade: boolean;
	normalize: boolean;
	fromCitations: boolean;
	identity: boolean;
	move: boolean;
	// spec-006 addition (OCR / slide reflow — opt-in, default OFF)
	reflow:             boolean;
	// spec-004 additions (flat keys — ADR-22)
	dewrap:             boolean;
	dehyphenate:        boolean;
	decomposeLigatures: boolean;
	tidyWhitespace:     boolean;
	normalizeBullets:   boolean;
	normalizeOrdered:   boolean;
}

export function resolveFormatSelectionRecipe(s: MasonSettings): FormatSelectionRecipe {
	const r = s.formatSelection ?? {};
	return {
		cascade:       r.cascade       ?? true,
		normalize:     r.normalize     ?? true,
		fromCitations: r.fromCitations ?? true,
		identity:      r.identity      ?? true,
		move:          r.move          ?? true,
		// spec-006 — opt-in OCR reflow, OFF by default (the only key that is not all-on)
		reflow:             r.reflow            ?? false,
		// spec-004
		dewrap:             r.dewrap            ?? true,
		dehyphenate:        r.dehyphenate       ?? true,
		decomposeLigatures: r.decomposeLigatures ?? true,
		tidyWhitespace:     r.tidyWhitespace    ?? true,
		normalizeBullets:   r.normalizeBullets  ?? true,
		normalizeOrdered:   r.normalizeOrdered  ?? true,
	};
}
