// No obsidian import — this module is pure domain; unit-testable without Obsidian.
//
// cascade() — relative heading cascade for pasted/input content (ctx.input) relative
//   to the nearest heading ABOVE ctx.cursor in ctx.doc.
//
//   Algorithm (README §5 H):
//     1. Find nearest heading ABOVE cursor → ctxLevel.
//     2. target base = ctxLevel + 1.
//     3. Find minIn = smallest heading level in ctx.input. shift = target − minIn.
//     4. Apply shift to all headings; clamp to [1, 6].
//
//   Result: { plan: EditPlan; noContextHeading: boolean }
//     - plan: a single insert Edit at cursor (from=to=cursor, insert=transformed input).
//       Empty when: no context heading above cursor, or input has no headings.
//     - noContextHeading: true when there is no heading strictly above the cursor.
//       Phase 3 command layer must surface an Obsidian Notice in this case.
//
//   Edit model: ONE insert Edit at cursor.  The whole pasted block lands atomically
//   in a single CM6 transaction. Offsets are against the original ctx.doc (ADR-1).
//
// normalize() — whole-note heading gap closing over ctx.doc.
//   Closes gaps so that no heading skips a level (e.g. H1→H3 becomes H1→H2).
//   Returns: EditPlan of per-heading-line replacement Edits (offsets vs original doc).

import type { EditPlan, OperationContext } from "./types";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CascadeResult {
	plan: EditPlan;
	/** True when no heading exists strictly above ctx.cursor in ctx.doc. */
	noContextHeading: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface HeadingLine {
	/** 0-based character offset of the first `#` in the line within the string. */
	offset: number;
	/** Heading level 1–6. */
	level: number;
	/** Full line text (without trailing newline). */
	text: string;
}

/** Parse heading lines from a text, recording character offsets within that text. */
function parseHeadings(text: string): HeadingLine[] {
	const headings: HeadingLine[] = [];
	let pos = 0;
	for (const line of text.split("\n")) {
		const m = line.match(/^(#{1,6})\s/);
		if (m) {
			headings.push({ offset: pos, level: m[1].length, text: line });
		}
		pos += line.length + 1; // +1 for the \n
	}
	return headings;
}

/** Return the heading level 1–6 of the nearest heading STRICTLY above offset, or 0. */
function findContextLevel(doc: string, cursor: number): number {
	const textBefore = doc.slice(0, cursor);
	const headings = parseHeadings(textBefore);
	if (headings.length === 0) return 0;
	return headings[headings.length - 1].level;
}

/** Clamp a heading level to [1, 6]. */
function clampLevel(level: number): number {
	return Math.max(1, Math.min(6, level));
}

/** Rebuild a heading line with a new level, preserving text after the hashes. */
function replaceHeadingLevel(text: string, newLevel: number): string {
	return text.replace(/^#{1,6}/, "#".repeat(newLevel));
}

// ---------------------------------------------------------------------------
// cascade
// ---------------------------------------------------------------------------

export function cascade(ctx: OperationContext): CascadeResult {
	const input = ctx.input ?? "";

	const ctxLevel = findContextLevel(ctx.doc, ctx.cursor);
	if (ctxLevel === 0) {
		return { plan: [], noContextHeading: true };
	}

	const inputHeadings = parseHeadings(input);
	if (inputHeadings.length === 0) {
		return { plan: [], noContextHeading: false };
	}

	const minIn = Math.min(...inputHeadings.map((h) => h.level));
	const shift = ctxLevel + 1 - minIn;

	const transformed = applyShiftToText(input, shift);
	return {
		plan: [{ from: ctx.cursor, to: ctx.cursor, insert: transformed }],
		noContextHeading: false,
	};
}

/** Apply a shift to all headings in a text string, clamping to [1, 6]. */
function applyShiftToText(text: string, shift: number): string {
	return text.replace(/^(#{1,6})(\s)/gm, (_match, hashes: string, space: string) => {
		const newLevel = clampLevel(hashes.length + shift);
		return "#".repeat(newLevel) + space;
	});
}

// ---------------------------------------------------------------------------
// normalize
// ---------------------------------------------------------------------------

/**
 * Close heading level gaps across ctx.doc so no heading skips a level.
 * A heading may only be at most one level deeper than the previous heading.
 * If it skips, it is demoted to (prevLevel + 1).
 * The first heading in the document is always accepted at its natural level.
 *
 * Returns per-heading-line replacement Edits (offsets vs original ctx.doc).
 */
export function normalize(ctx: OperationContext): EditPlan {
	const headings = parseHeadings(ctx.doc);
	if (headings.length === 0) return [];

	const plan: EditPlan = [];
	let prevLevel = 0;

	for (const h of headings) {
		const targetLevel = prevLevel === 0
			? h.level // first heading: accept as-is
			: clampLevel(Math.min(h.level, prevLevel + 1));

		prevLevel = targetLevel;

		if (targetLevel === h.level) continue; // no change needed

		const newText = replaceHeadingLevel(h.text, targetLevel);
		// The edit replaces the entire heading line in the original doc.
		plan.push({
			from: h.offset,
			to: h.offset + h.text.length,
			insert: newText,
		});
	}

	return plan;
}
