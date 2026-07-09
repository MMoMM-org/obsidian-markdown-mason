// src/core/reflow.ts — OCR / slide reflow transform (CON-2: no plugin imports)
//
// PURPOSE
// -------
// Screen-capture OCR tools (e.g. TextSniper) emit slide text with HARD line
// breaks at the visual text-box width and NO blank line between bullets or
// paragraphs. The existing `dewrap` step cannot help: it only joins lines
// WITHIN a blank-line-separated paragraph block, and OCR text has no such
// separators — segmentBlocks() sees the whole capture as one contiguous run.
//
// `reflow` re-segments a contiguous run of text lines into logical blocks and
// re-joins the soft-wrapped lines inside each block, using three signals to
// decide where one block ends and the next begins:
//
//   1. MARKER      — the line starts with a bullet marker (•, ·, -, *, +, …).
//   2. TERMINAL    — the PREVIOUS line ends with sentence-terminal punctuation
//                    (. ! ? :). Only the line END is inspected, so a sentence
//                    that ends mid-line ("…failure point. The RPO…") never
//                    triggers a false split.
//   3. WIDTH       — the previous line was clearly SHORT (a deliberate break):
//                    the first word of the current line would easily have fit
//                    on it. This catches title/heading lines that carry no
//                    terminal punctuation (e.g. "Usage Scenarios"). Calibrated
//                    against the run's own widest line, so there is no fixed
//                    column assumption.
//
// MODE SWITCH
//   If ANY line in the run carries a bullet marker, the run is treated as a
//   LIST: only marker lines start a new block; every marker-less line is a
//   continuation. This keeps multi-sentence bullets intact (the TERMINAL/WIDTH
//   signals are suppressed, so a sentence end inside a bullet cannot split it).
//   Runs with no markers use the TERMINAL/WIDTH signals to recover paragraphs.
//
// OUTPUT mirrors the input structure (per spec 006 decision):
//   marker run  → a tight bullet list ("- …" lines, no blank between items)
//   marker-less → paragraphs separated by a blank line
//   A leading marker-less line before a list (the slide title) stays its own
//   paragraph above the list.
//
// KNOWN LIMITS (documented, acceptable for an opt-in transform — default OFF):
//   - A multi-sentence paragraph whose interior sentence ends EXACTLY at a wrap
//     boundary (full-width line ending in ".") splits early via TERMINAL. Rare;
//     natural wrapping fills lines maximally so this seldom coincides.
//   - Genuine end-of-line syllable hyphenation ("com-\nplex") is preserved as
//     "com-plex" (hyphen kept) rather than glued, because reflow cannot tell it
//     apart from a real compound ("on-\npremises" → "on-premises"). Compounds
//     are the common case in slide text; keeping the hyphen is the safe choice.

import type { Edit, EditPlan, OperationContext } from "./types";
import { segmentBlocks } from "./markdownBlocks";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/**
 * A break is treated as DELIBERATE (new block) via the width signal only when
 * the previous line plus the next word would have fit inside this fraction of
 * the run's widest line. Kept well below 1.0 so it fires only on clearly-short
 * lines (titles, list-item tails) and never on near-full soft-wrapped lines.
 */
const SHORT_LINE_RATIO = 0.66;

// Line kinds that participate in a reflow run. Everything else (headings,
// code, tables, blockquotes, frontmatter, thematic breaks, blank lines) is a
// barrier: it ends the current run and is left untouched.
const FLOWABLE = new Set(["paragraph", "listItem"]);

// Unordered bullet markers seen in OCR captures and Markdown, plus en/em dash.
const UNORDERED_RE = /^\s*([-*+•·‣▪◦–—])\s+(.*)$/;
// Ordered markers: "1." / "1)".
const ORDERED_RE = /^\s*(\d+[.)])\s+(.*)$/;
// Sentence-terminal punctuation, allowing trailing closing quotes/brackets.
const TERMINAL_RE = /[.!?:][)"'’”\]]*$/;

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

interface Marker {
	/** Marker to emit in the rendered output ("- " for unordered, "N. " for ordered). */
	markerOut: string;
	/** Item text with the marker stripped. */
	text: string;
}

/** Parse a leading bullet/ordered marker; null when the line has none. */
function parseMarker(line: string): Marker | null {
	const u = UNORDERED_RE.exec(line);
	if (u) return { markerOut: "- ", text: u[2]! };
	const o = ORDERED_RE.exec(line);
	if (o) return { markerOut: `${o[1]!} `, text: o[2]! };
	return null;
}

// ---------------------------------------------------------------------------
// Boundary signals
// ---------------------------------------------------------------------------

/** True when `line` (ignoring trailing spaces) ends a sentence. */
function endsWithTerminal(line: string): boolean {
	return TERMINAL_RE.test(line.replace(/\s+$/, ""));
}

/**
 * True when `prev` was short enough that the first word of `curr` would have
 * comfortably fit on it — i.e. the break was deliberate, not a forced wrap.
 */
function isDeliberateShortBreak(prev: string, curr: string, maxWidth: number): boolean {
	const prevLen = prev.replace(/\s+$/, "").length;
	const firstWord = curr.trim().split(/\s+/)[0] ?? "";
	return prevLen + 1 + firstWord.length <= maxWidth * SHORT_LINE_RATIO;
}

// ---------------------------------------------------------------------------
// Segment model
// ---------------------------------------------------------------------------

interface Segment {
	isBullet: boolean;
	markerOut: string; // "" for paragraphs
	text: string;
}

/** Append a continuation line to a segment, preserving compound hyphens. */
function appendContinuation(seg: Segment, cont: string): void {
	if (seg.text === "") {
		seg.text = cont;
	} else if (/[A-Za-z]-$/.test(seg.text)) {
		// "…on-" + "premises…" → "…on-premises…" (no inserted space).
		seg.text += cont;
	} else {
		seg.text += " " + cont;
	}
}

/** Group the run's raw lines into logical segments. */
function groupLines(lines: string[]): Segment[] {
	const runHasMarker = lines.some((l) => parseMarker(l) !== null);
	const maxWidth = Math.max(...lines.map((l) => l.replace(/\s+$/, "").length));
	const segments: Segment[] = [];

	for (let k = 0; k < lines.length; k++) {
		const line = lines[k]!;
		const marker = parseMarker(line);

		let boundary: boolean;
		if (k === 0) {
			boundary = true;
		} else if (runHasMarker) {
			// LIST mode: only a marker starts a new block; everything else continues.
			boundary = marker !== null;
		} else {
			// PARAGRAPH mode.
			const prev = lines[k - 1]!.replace(/\s+$/, "");
			if (/[A-Za-z]-$/.test(prev)) {
				// A trailing hyphen means the word was split across the wrap — always
				// a continuation, never a boundary (guards short compound-break lines).
				boundary = false;
			} else {
				// Otherwise: sentence-terminal punctuation or a deliberate short break.
				boundary = endsWithTerminal(prev) || isDeliberateShortBreak(prev, line, maxWidth);
			}
		}

		if (boundary) {
			if (marker) {
				segments.push({ isBullet: true, markerOut: marker.markerOut, text: marker.text.trim() });
			} else {
				segments.push({ isBullet: false, markerOut: "", text: line.trim() });
			}
		} else {
			appendContinuation(segments[segments.length - 1]!, line.trim());
		}
	}

	return segments;
}

/** Render segments back to text: tight list for bullets, blank line elsewhere. */
function renderSegments(segments: Segment[]): string {
	let out = "";
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;
		if (i > 0) {
			const prev = segments[i - 1]!;
			// Consecutive bullets form a tight list; any other adjacency gets a blank line.
			out += prev.isBullet && seg.isBullet ? "\n" : "\n\n";
		}
		out += seg.isBullet ? seg.markerOut + seg.text : seg.text;
	}
	return out;
}

/** Reflow one contiguous run [start, end); null when nothing changes. */
function reflowRun(doc: string, start: number, end: number): Edit | null {
	const text = doc.slice(start, end);
	const hasTrailing = text.endsWith("\n");
	const raw = hasTrailing ? text.slice(0, -1) : text;
	const lines = raw.split("\n");
	if (lines.length <= 1) return null; // single line — nothing to reflow

	const rendered = renderSegments(groupLines(lines)) + (hasTrailing ? "\n" : "");
	if (rendered === text) return null;
	return { from: start, to: end, insert: rendered };
}

// ---------------------------------------------------------------------------
// Public transform
// ---------------------------------------------------------------------------

/**
 * Reflow hard-wrapped OCR/slide text into paragraphs and bullet lists.
 * Operates on maximal runs of consecutive paragraph/listItem blocks; all other
 * block kinds (code, headings, tables, blockquotes, frontmatter, blanks) are
 * barriers that bound a run and are never modified.
 */
export function reflow(ctx: OperationContext): EditPlan {
	const blocks = segmentBlocks(ctx.doc);
	const plan: EditPlan = [];

	let i = 0;
	while (i < blocks.length) {
		if (!FLOWABLE.has(blocks[i]!.kind)) {
			i++;
			continue;
		}
		// Extend to the end of this contiguous flowable run.
		let j = i;
		while (j + 1 < blocks.length && FLOWABLE.has(blocks[j + 1]!.kind)) j++;

		const edit = reflowRun(ctx.doc, blocks[i]!.startOffset, blocks[j]!.endOffset);
		if (edit) plan.push(edit);
		i = j + 1;
	}

	return plan;
}
