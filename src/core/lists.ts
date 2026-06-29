// src/core/lists.ts — Phase 3: list transforms (CON-2: zero obsidian imports)
//
// Exports:
//   normalizeBullets  — replace non-'-' leading bullet markers with '-'

import { segmentBlocks } from "./markdownBlocks";
import type { EditPlan, OperationContext } from "./types";

// ---------------------------------------------------------------------------
// T3.1 — normalizeBullets
// ---------------------------------------------------------------------------

/**
 * Pattern matching the leading bullet marker of a list line.
 * Captures: (1) leading whitespace, (2) bullet glyph, (3) space/tab after.
 * Only matches bullet-style markers — ordered items (digits) are excluded
 * because they don't match this character class.
 *
 * Glyphs: - * + • (U+2022) – (U+2013 en dash) · (U+00B7 middle dot)
 * All are single UTF-16 code units, so length is always 1.
 */
const BULLET_RE = /^(\s*)([-*+•–·])([ \t])/;

/**
 * Normalise bullet-list markers to '-'.
 *
 * For each line in "listItem" blocks: if the leading marker glyph is not '-',
 * emit an edit replacing only that glyph with '-'. Ordered items, paragraphs,
 * headings, code blocks, etc. are never touched. Checkbox syntax (- [ ], * [x])
 * is preserved automatically because only the single leading glyph is replaced.
 */
export function normalizeBullets(ctx: OperationContext): EditPlan {
	const edits: EditPlan = [];
	const docLines = ctx.doc.split("\n");

	for (const block of segmentBlocks(ctx.doc)) {
		if (block.kind !== "listItem") continue;

		let lineOffset = block.startOffset;
		for (let i = block.startLine; i <= block.endLine; i++) {
			const line = docLines[i]!;
			const m = BULLET_RE.exec(line);
			if (m !== null && m[2] !== "-") {
				const markerOffset = lineOffset + m[1]!.length;
				edits.push({ from: markerOffset, to: markerOffset + m[2]!.length, insert: "-" });
			}
			lineOffset += line.length + 1; // +1 for the \n character
		}
	}

	return edits;
}
