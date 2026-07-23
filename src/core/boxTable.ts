// src/core/boxTable.ts — box-drawing table transform (spec 007, CON-2: no plugin imports)
//
// PURPOSE
// -------
// Terminal tools (Claude Code, psql, docker, many TUIs) render tables with
// BOX-DRAWING characters — ┌ ┬ ┐ ├ ┼ ┤ └ ┴ ┘ ─ │ and heavy/double variants, or
// the ASCII "+ - |" frame. Pasted into a note these are not Markdown tables:
// they are prose lines full of border glyphs. This transform reconstructs the
// column grid and re-emits a real Markdown table.
//
// DETECTION (near-zero false positives)
//   A run of lines qualifies when it STARTS with a TOP-RULE — a border line
//   carrying a corner/junction glyph (┌┬┐├┼┤…┏┓╔╗… or ASCII "+") plus a
//   horizontal dash — and contains at least one CONTENT row (a line with a
//   column separator │ ┃ ║ | and substantive text). Ordinary prose never opens
//   with a full "┌──┬──┐" rule, and a Markdown table (which has NO border rule
//   and starts with a content row) is never matched → left untouched.
//
// SAFETY
//   - Fenced code (``` fences) and frontmatter are barriers (never scanned).
//     Indented (4-space) blocks are NOT treated as a barrier: terminal
//     scrollback pastes arrive indented and segmentBlocks would mis-read the
//     whole table as `indentedCode`. The top-rule border is a strong enough
//     signal to convert anyway; the flush-left output drops the stray indent.
//   - A ragged grid (a content row whose column count differs from the header)
//     is BAILED on rather than mis-aligned (spec 007 F5 / ADR-34).
//   - Idempotent: the output has no border glyphs, so a second pass finds no
//     top-rule and does nothing.

import type { Edit, EditPlan, OperationContext } from "./types";
import { segmentBlocks } from "./markdownBlocks";

// ---------------------------------------------------------------------------
// Character classes
// ---------------------------------------------------------------------------

// Column separators (vertical bars), light/heavy/double + ASCII pipe.
const SEP_RE = /[│┃║|]/;
// Candidate separator glyphs, checked in priority order when a table mixes them.
const SEP_CANDIDATES = ["│", "┃", "║", "|"];
// Corner/junction glyphs — their presence marks a genuine frame rule.
const CORNER_RE = /[┌┬┐├┼┤└┴┘┏┳┓┣╋┫┗┻┛╔╦╗╠╬╣╚╩╝+]/;
// Horizontal rule glyphs.
const HRULE_RE = /[─━═\-=]/;
// A border line consists solely of frame glyphs, separators, dashes and spaces.
const FRAME_ONLY_RE = /^[\s┌┬┐├┼┤└┴┘─┏┳┓┣╋┫┗┻┛━╔╦╗╠╬╣╚╩╝═│┃║|+=-]+$/;

type LineKind = "border" | "content" | "other";

/** Classify a single physical line for run detection. */
function classify(line: string): LineKind {
	const t = line.trim();
	if (t === "") return "other";
	// All-frame line (borders, rules, all-empty-cell rows) → border.
	if (FRAME_ONLY_RE.test(t)) return "border";
	// Otherwise a line carrying a separator plus real text is a content row.
	if (SEP_RE.test(line)) return "content";
	return "other";
}

/** A top/bottom rule: a border line with a corner glyph and a horizontal dash. */
function isTopRule(line: string): boolean {
	return classify(line) === "border" && CORNER_RE.test(line) && HRULE_RE.test(line);
}

// ---------------------------------------------------------------------------
// Cell splitting
// ---------------------------------------------------------------------------

/**
 * Pick the separator glyph this table uses: the candidate with the most
 * occurrences across its content rows. Splitting on that single character (not
 * the whole class) means a literal ASCII "|" inside a │-delimited cell is kept
 * as content, not mistaken for a column boundary.
 */
function detectSeparator(contentLines: string[]): string {
	let best = SEP_CANDIDATES[0];
	let bestCount = -1;
	for (const c of SEP_CANDIDATES) {
		let n = 0;
		for (const line of contentLines) n += line.split(c).length - 1;
		if (n > bestCount) {
			bestCount = n;
			best = c;
		}
	}
	return best;
}

/** Split a content row into trimmed cells, dropping the outer border padding. */
function splitCells(line: string, sep: string): string[] {
	const parts = line.split(sep); // plain-string split — no regex, sep may be "|"
	// Drop one leading / trailing empty produced by the outer separators.
	if (parts.length > 1 && parts[0].trim() === "") parts.shift();
	if (parts.length > 1 && parts[parts.length - 1].trim() === "") parts.pop();
	return parts.map((c) => c.trim());
}

/** Escape a pipe so it cannot break the rendered Markdown table. */
function escapeCell(text: string): string {
	return text.replace(/\|/g, "\\|");
}

// ---------------------------------------------------------------------------
// Run → Markdown table
// ---------------------------------------------------------------------------

/**
 * Convert the raw lines of a detected run into a Markdown table string, or null
 * when the grid is ragged / degenerate (bail rather than corrupt).
 */
function renderRun(runLines: string[]): string | null {
	// Group physical content rows into logical rows, split by border lines.
	const groups: string[][] = [];
	let current: string[][] = []; // physical rows (each an array of cells)

	const flush = (): void => {
		if (current.length === 0) return;
		const cols = current[0].length;
		const merged: string[] = [];
		for (let c = 0; c < cols; c++) {
			const frags = current.map((row) => row[c]).filter((v) => v && v.length > 0);
			merged.push(frags.join(" "));
		}
		groups.push(merged);
		current = [];
	};

	const sep = detectSeparator(runLines.filter((l) => classify(l) === "content"));

	let columnCount = -1;
	for (const line of runLines) {
		const kind = classify(line);
		if (kind === "content") {
			const cells = splitCells(line, sep);
			if (columnCount === -1) columnCount = cells.length;
			else if (cells.length !== columnCount) return null; // ragged → bail
			current.push(cells);
		} else {
			// A border rule closes the current logical row.
			flush();
		}
	}
	flush();

	if (columnCount < 1 || groups.length < 1) return null;

	const header = groups[0].map(escapeCell);
	const delimiter = new Array(columnCount).fill("---");
	const out: string[] = [
		`| ${header.join(" | ")} |`,
		`| ${delimiter.join(" | ")} |`,
	];
	for (let g = 1; g < groups.length; g++) {
		out.push(`| ${groups[g].map(escapeCell).join(" | ")} |`);
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Public transform
// ---------------------------------------------------------------------------

/**
 * Convert box-drawing / ASCII-framed tables into Markdown tables. Scans raw
 * lines (so ASCII pipe frames that segmentBlocks would split are handled
 * uniformly) but treats code and frontmatter blocks as barriers.
 */
export function boxTable(ctx: OperationContext): EditPlan {
	const doc = ctx.doc;
	const lines = doc.split("\n");

	// Line-start offsets for edit ranges.
	const lineStarts = new Array<number>(lines.length);
	let off = 0;
	for (let i = 0; i < lines.length; i++) {
		lineStarts[i] = off;
		off += lines[i].length + 1;
	}

	// Mark lines inside fenced code / frontmatter as protected (never part of a
	// table). `indentedCode` is deliberately NOT protected — a terminal-scrollback
	// table pastes 4-space-indented and segmentBlocks would classify the whole
	// grid as indentedCode, so protecting it would skip exactly the tables we want.
	const isProtected = new Array<boolean>(lines.length).fill(false);
	for (const b of segmentBlocks(doc)) {
		if (b.kind === "fencedCode" || b.kind === "frontmatter") {
			for (let l = b.startLine; l <= b.endLine && l < lines.length; l++) isProtected[l] = true;
		}
	}

	const plan: EditPlan = [];
	let i = 0;
	while (i < lines.length) {
		if (isProtected[i] || !isTopRule(lines[i])) {
			i++;
			continue;
		}
		// Extend the run over border/content lines until anything else.
		let j = i;
		let hasContent = false;
		while (j + 1 < lines.length && !isProtected[j + 1]) {
			const kind = classify(lines[j + 1]);
			if (kind === "other") break;
			if (kind === "content") hasContent = true;
			j++;
		}

		if (hasContent) {
			const rendered = renderRun(lines.slice(i, j + 1));
			if (rendered !== null) {
				const start = lineStarts[i];
				const end = j + 1 < lines.length ? lineStarts[j + 1] : doc.length;
				const hasTrailingNL = end > start && doc[end - 1] === "\n";
				// A Markdown table only renders when a blank line separates it from the
				// surrounding text. Terminal pastes often put a caption line directly
				// above the frame (no blank), so insert one before/after whenever the
				// adjacent line is non-blank.
				const needLeadingBlank = i > 0 && lines[i - 1].trim() !== "";
				const needTrailingBlank = hasTrailingNL && j + 1 < lines.length && lines[j + 1].trim() !== "";
				const insert =
					(needLeadingBlank ? "\n" : "") +
					rendered +
					(hasTrailingNL ? "\n" : "") +
					(needTrailingBlank ? "\n" : "");
				if (insert !== doc.slice(start, end)) {
					const edit: Edit = { from: start, to: end, insert };
					plan.push(edit);
				}
			}
		}
		i = j + 1;
	}

	return plan;
}
