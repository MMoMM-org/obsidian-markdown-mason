// No obsidian import — pure core module (CON-2).
import type { MasonSettings } from "./types";

// ---------------------------------------------------------------------------
// FormatSelectionRecipe — five per-step toggles for the Format selection command.
// T1.2 will add formatSelection?: Partial<FormatSelectionRecipe> to MasonSettings.
// Until then we access the field via a cast so this module compiles without
// modifying types.ts.
// ---------------------------------------------------------------------------

export interface FormatSelectionRecipe {
	cascade: boolean;
	normalize: boolean;
	fromCitations: boolean;
	identity: boolean;
	move: boolean;
}

export function resolveFormatSelectionRecipe(s: MasonSettings): FormatSelectionRecipe {
	// T1.2 adds formatSelection to MasonSettings; cast until then.
	const r = (s as { formatSelection?: Partial<FormatSelectionRecipe> }).formatSelection ?? {};
	return {
		cascade:       r.cascade       ?? true,
		normalize:     r.normalize     ?? true,
		fromCitations: r.fromCitations ?? true,
		identity:      r.identity      ?? true,
		move:          r.move          ?? true,
	};
}
