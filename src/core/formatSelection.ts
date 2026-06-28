// No obsidian import — pure core module (CON-2).
import type { MasonSettings } from "./types";

// ---------------------------------------------------------------------------
// FormatSelectionRecipe — five per-step toggles for the Format selection command.
// MasonSettings.formatSelection?: Partial<FormatSelectionRecipe> is defined in
// types.ts; absent field resolves to all-on via resolveFormatSelectionRecipe().
// ---------------------------------------------------------------------------

export interface FormatSelectionRecipe {
	cascade: boolean;
	normalize: boolean;
	fromCitations: boolean;
	identity: boolean;
	move: boolean;
}

export function resolveFormatSelectionRecipe(s: MasonSettings): FormatSelectionRecipe {
	const r = s.formatSelection ?? {};
	return {
		cascade:       r.cascade       ?? true,
		normalize:     r.normalize     ?? true,
		fromCitations: r.fromCitations ?? true,
		identity:      r.identity      ?? true,
		move:          r.move          ?? true,
	};
}
