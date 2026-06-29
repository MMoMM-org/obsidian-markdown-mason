// src/core/lists.ts — Phase 3: list transforms (CON-2: zero obsidian imports)
//
// Exports:
//   normalizeBullets  — replace non-'-' leading bullet markers with '-'
//   normalizeOrdered  — renumber ordered list items sequentially per indent level

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

// ---------------------------------------------------------------------------
// T3.2 — normalizeOrdered
// ---------------------------------------------------------------------------

/** One level in the indent stack used by normalizeOrdered. */
interface StackLevel {
	indent: number;
	counter: number;
}

/**
 * Pattern matching an ordered list line.
 * Captures: (1) leading whitespace, (2) digit run, (3) terminator ('.' or ')').
 * Lines that do not match (bullets, alpha 'a.', roman 'i.') are skipped.
 */
const ORDERED_RE = /^(\s*)(\d+)([.)])/;

/**
 * Renumber ordered list items sequentially per nesting level.
 *
 * Uses an indent stack to track per-level counters. Only lines matching
 * /^(\s*)(\d+)([.)])/ are renumbered; all other listItem lines (bullets,
 * alpha/roman markers) are skipped without affecting the stack — this
 * keeps mixed ordered/bullet lists from corrupting the counter state.
 *
 * The stack persists across blank lines between list items so loose lists
 * (blank lines separating items) are renumbered as one continuous sequence.
 */
export function normalizeOrdered(ctx: OperationContext): EditPlan {
	const edits: EditPlan = [];
	const docLines = ctx.doc.split("\n");
	const stack: StackLevel[] = [];

	for (const block of segmentBlocks(ctx.doc)) {
		if (block.kind !== "listItem") continue;

		let lineOffset = block.startOffset;
		for (let i = block.startLine; i <= block.endLine; i++) {
			const line = docLines[i]!;
			const m = ORDERED_RE.exec(line);
			if (m !== null) {
				const indent = m[1]!.length;
				const digits = m[2]!;
				const counter = resolveCounter(stack, indent);
				if (counter !== parseInt(digits, 10)) {
					const digitOffset = lineOffset + indent;
					edits.push({ from: digitOffset, to: digitOffset + digits.length, insert: String(counter) });
				}
			}
			// Non-matching listItem lines (bullets, alpha, roman) are skipped here.
			// The stack is not updated for them, keeping numbering state intact.
			lineOffset += line.length + 1;
		}
	}

	return edits;
}

/**
 * Update the indent stack for the given indent depth and return the counter
 * that this line should carry.
 *
 * Stack rules:
 *   - Empty stack or indent > top → push new level (counter starts at 1).
 *   - indent === top.indent → same level, increment counter.
 *   - indent < top.indent → pop levels until top.indent <= indent;
 *       if exact match, increment; otherwise push a new level (counter = 1).
 */
function resolveCounter(stack: StackLevel[], indent: number): number {
	if (stack.length === 0 || indent > stack[stack.length - 1]!.indent) {
		stack.push({ indent, counter: 1 });
		return 1;
	}

	const top = stack[stack.length - 1]!;
	if (indent === top.indent) {
		top.counter += 1;
		return top.counter;
	}

	// indent < top.indent — pop until we find a level with indent <= current
	while (stack.length > 0 && stack[stack.length - 1]!.indent > indent) {
		stack.pop();
	}

	if (stack.length > 0 && stack[stack.length - 1]!.indent === indent) {
		stack[stack.length - 1]!.counter += 1;
		return stack[stack.length - 1]!.counter;
	}

	// No exact match found after popping — treat as new level
	stack.push({ indent, counter: 1 });
	return 1;
}
