// src/core/cleanup.ts — Phase 2 cleanup transforms (CON-2 compliant: no plugin imports)
import type { EditPlan, OperationContext } from "./types";
import { segmentBlocks, maskInlineCode } from "./markdownBlocks";
import type { BlockKind } from "./markdownBlocks";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Blocks that must never be modified by any cleanup transform. */
function isProtectedBlock(kind: BlockKind): boolean {
	return kind === "fencedCode" || kind === "indentedCode" || kind === "frontmatter";
}

// ---------------------------------------------------------------------------
// T2.1 — dehyphenate
// ---------------------------------------------------------------------------

/**
 * Join end-of-line hyphenation: `lowercase-\nlowercase` → `lowercaselowercase`.
 * Pattern restricted strictly to [a-z] on BOTH sides.
 * Skips fencedCode, indentedCode, frontmatter blocks.
 * Skips inline code spans via maskInlineCode applied to the full block text.
 */
export function dehyphenate(ctx: OperationContext): EditPlan {
	const blocks = segmentBlocks(ctx.doc);
	const plan: EditPlan = [];

	for (const block of blocks) {
		if (isProtectedBlock(block.kind)) continue;

		const text = ctx.doc.slice(block.startOffset, block.endOffset);
		// maskInlineCode on the full block text handles cross-line code spans:
		// the \n inside `co-\nde` becomes \0, suppressing pattern detection.
		const masked = maskInlineCode(text);
		const rx = /([a-z])-\n([a-z])/g;
		let m: RegExpExecArray | null;
		while ((m = rx.exec(masked)) !== null) {
			// m.index = position of first [a-z]; +1 = '-'; +2 = '\n'
			plan.push({
				from: block.startOffset + m.index + 1,
				to: block.startOffset + m.index + 3,
				insert: "",
			});
		}
	}

	return plan;
}

// ---------------------------------------------------------------------------
// T2.2 — dewrap
// ---------------------------------------------------------------------------

/**
 * Join soft-wrapped paragraph lines back into a single line per paragraph.
 * Only "paragraph" blocks are processed; all other block kinds are skipped.
 */
export function dewrap(ctx: OperationContext): EditPlan {
	const blocks = segmentBlocks(ctx.doc);
	const plan: EditPlan = [];
	for (const block of blocks) {
		if (block.kind !== "paragraph") continue;
		const text = ctx.doc.slice(block.startOffset, block.endOffset);
		const hasTrailing = text.endsWith("\n");
		const raw = hasTrailing ? text.slice(0, -1) : text;
		const lineArr = raw.split("\n");
		if (lineArr.length <= 1) continue;
		const joined = lineArr.join(" ");
		const insert = hasTrailing ? joined + "\n" : joined;
		plan.push({ from: block.startOffset, to: block.endOffset, insert });
	}
	return plan;
}

// ---------------------------------------------------------------------------
// T2.3 — decomposeLigatures
// ---------------------------------------------------------------------------

/**
 * Closed enumeration of glyph-to-ASCII replacements.
 * INVARIANT: no value contains W, w, VV, or vv.
 */
export const GLYPH_MAP: Readonly<Record<string, string>> = {
	"ﬁ": "fi",   // ﬁ
	"ﬂ": "fl",   // ﬂ
	"ﬀ": "ff",   // ﬀ
	"ﬃ": "ffi",  // ﬃ
	"ﬄ": "ffl",  // ﬄ
	"æ": "ae",   // æ
	"œ": "oe",   // œ
	"“": '"',    // "
	"”": '"',    // "
	"‘": "'",    // '
	"’": "'",    // '
	"—": "-",    // — em dash
	"–": "-",    // – en dash
	"…": "...",  // …
} as const;

/**
 * Replace canonical ligatures and punctuation glyphs with ASCII equivalents.
 * Skips fencedCode, indentedCode, and frontmatter blocks; skips inline code
 * spans via maskInlineCode applied to the full block text (handles cross-line spans).
 */
export function decomposeLigatures(ctx: OperationContext): EditPlan {
	const blocks = segmentBlocks(ctx.doc);
	const plan: EditPlan = [];

	for (const block of blocks) {
		if (isProtectedBlock(block.kind)) continue;

		const text = ctx.doc.slice(block.startOffset, block.endOffset);
		// Mask the full block text so cross-line inline code spans are detected.
		// A span like `ﬂow\nacross` crosses a line boundary; masking per-line
		// would miss it. maskedBlock[i] === "\0" iff absolute block position i
		// is inside an inline code span.
		const maskedBlock = maskInlineCode(text);
		const lines = text.split("\n");
		let lineOffset = block.startOffset;

		for (const line of lines) {
			if (line.length > 0) {
				let newLine = "";
				let changed = false;
				for (let i = 0; i < line.length; i++) {
					const ch = line[i];
					// Absolute position within maskedBlock for this character.
					const blockPos = (lineOffset - block.startOffset) + i;
					if (maskedBlock[blockPos] === "\0") {
						newLine += ch; // inside inline code span — preserve
					} else if (GLYPH_MAP[ch] !== undefined) {
						newLine += GLYPH_MAP[ch];
						changed = true;
					} else {
						newLine += ch;
					}
				}
				if (changed) {
					plan.push({ from: lineOffset, to: lineOffset + line.length, insert: newLine });
				}
			}
			lineOffset += line.length + 1;
		}
	}

	return plan;
}

// ---------------------------------------------------------------------------
// T2.4 — tidyWhitespace
// ---------------------------------------------------------------------------

/**
 * Three sub-passes over non-protected, non-blank, non-tableRow blocks:
 *   1. Collapse runs of 2+ spaces in the non-leading portion of each line.
 *      Skips tableRow blocks entirely (alignment spaces are significant).
 *   2. Strip trailing whitespace ([ \t]+$) from each line.
 *   3. Collapse runs of 3+ consecutive blank lines to a single blank line.
 *
 * Protected blocks (fencedCode, indentedCode, frontmatter) are never modified.
 * Passes 1+2 are merged into one edit per changed line to avoid overlap.
 * Pass 3 emits one contiguous edit per qualifying blank run.
 */
export function tidyWhitespace(ctx: OperationContext): EditPlan {
	const blocks = segmentBlocks(ctx.doc);
	const plan: EditPlan = [];

	// Passes 1+2: per-line edits on non-protected, non-blank, non-tableRow blocks
	for (const block of blocks) {
		if (isProtectedBlock(block.kind)) continue;
		if (block.kind === "blank") continue;
		if (block.kind === "tableRow") continue;

		const text = ctx.doc.slice(block.startOffset, block.endOffset);
		const lines = text.split("\n");
		let lineOffset = block.startOffset;

		for (const line of lines) {
			if (line.length > 0) {
				// Pass 1: collapse non-leading double-space runs
				const leadingLen = /^\s*/.exec(line)![0].length;
				const leading = line.slice(0, leadingLen);
				const body = line.slice(leadingLen).replace(/  +/g, " ");
				// Pass 2: strip trailing whitespace
				const tidy = (leading + body).replace(/[ \t]+$/, "");
				if (tidy !== line) {
					plan.push({ from: lineOffset, to: lineOffset + line.length, insert: tidy });
				}
			}
			lineOffset += line.length + 1;
		}
	}

	// Pass 3: blank-line squeeze — 3+ consecutive blank blocks → keep first, remove rest
	const blankRuns: Array<typeof blocks> = [];
	let currentRun: typeof blocks = [];

	for (const block of blocks) {
		if (block.kind === "blank") {
			currentRun.push(block);
		} else if (currentRun.length > 0) {
			blankRuns.push(currentRun);
			currentRun = [];
		}
	}
	if (currentRun.length > 0) blankRuns.push(currentRun);

	for (const run of blankRuns) {
		if (run.length >= 3) {
			// One contiguous edit: remove blanks [1..end] in one slice
			plan.push({
				from: run[1].startOffset,
				to: run[run.length - 1].endOffset,
				insert: "",
			});
		}
	}

	return plan;
}
