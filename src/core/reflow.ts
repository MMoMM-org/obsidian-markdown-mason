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
// NESTING
//   A marker line keeps its nesting level. The level is the RANK of the line's
//   indent width among the distinct widths in the run (ADR-39, as in
//   fitToList) — never a division by a guessed step size, so a capture that
//   mixes 2-space, 4-space and tab indents keeps its hierarchy. The step
//   EMITTED is the run's own level-0→1 step, so an already-tidy nested list
//   renders back byte-identical and reflow stays a no-op on it. Continuation
//   lines carry no marker and are folded into their item, so their own indent
//   is irrelevant.
//
// KNOWN LIMITS (documented, acceptable for an opt-in transform — default OFF):
//   - A multi-sentence paragraph whose interior sentence ends EXACTLY at a wrap
//     boundary (full-width line ending in ".") splits early via TERMINAL. Rare;
//     natural wrapping fills lines maximally so this seldom coincides.
//   - An indented sub-bullet drawn with a glyph segmentBlocks() does not know
//     (◦ ‣ ▪) is classified as indentedCode, a run BARRIER, so reflow never
//     sees it. Only [-*+•–·] and ordered markers nest; the flat ◦ case (no
//     indent) still reflows, because then it is an ordinary paragraph line.
//   - Genuine end-of-line syllable hyphenation ("com-\nplex") is preserved as
//     "com-plex" (hyphen kept) rather than glued, because reflow cannot tell it
//     apart from a real compound ("on-\npremises" → "on-premises"). Compounds
//     are the common case in slide text; keeping the hyphen is the safe choice.

import type { Edit, EditPlan, OperationContext } from "./types";
import { segmentBlocks } from "./markdownBlocks";
import { indentWidth } from "./indent";

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
// Group 1 is the line's own indent — the nesting signal, kept as \s* (not
// [ \t]*) so a capture that indents with NBSP still parses as a marker AND
// keeps its level (indentWidth() counts any whitespace as a column).
const UNORDERED_RE = /^(\s*)([-*+•·‣▪◦–—])\s+(.*)$/;
// Ordered markers: "1." / "1)".
const ORDERED_RE = /^(\s*)(\d+[.)])\s+(.*)$/;
// Sentence-terminal punctuation, allowing trailing closing quotes/brackets.
const TERMINAL_RE = /[.!?:][)"'’”\]]*$/;

// ---------------------------------------------------------------------------
// Marker parsing
// ---------------------------------------------------------------------------

interface Marker {
	/** The line's own leading whitespace, verbatim — ranked into a nesting level. */
	indent: string;
	/** Marker to emit in the rendered output ("- " for unordered, "N. " for ordered). */
	markerOut: string;
	/** Item text with the marker stripped. */
	text: string;
}

/** Parse a leading bullet/ordered marker; null when the line has none. */
function parseMarker(line: string): Marker | null {
	const u = UNORDERED_RE.exec(line);
	if (u) return { indent: u[1], markerOut: "- ", text: u[3] };
	const o = ORDERED_RE.exec(line);
	if (o) return { indent: o[1], markerOut: `${o[2]} `, text: o[3] };
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
	/** Rendered indent for this item; "" for paragraphs and level-0 items. */
	indent: string;
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

/**
 * Build the level → indent mapping for one run's marker lines.
 *
 * Returns a function from a parsed marker to the indent it should be RENDERED
 * with. A run with at most one distinct indent width has no hierarchy to keep,
 * so every item renders flush left — which is what a flat OCR capture wants.
 */
function buildNesting(markers: Array<Marker | null>): (m: Marker) => string {
	const items = markers.filter((m): m is Marker => m !== null);
	const widths = [...new Set(items.map((m) => indentWidth(m.indent)))].sort((a, b) => a - b);
	if (widths.length <= 1) return () => "";

	const step = resolveStep(items, widths[0], widths[1]);
	return (m) => step.repeat(widths.indexOf(indentWidth(m.indent)));
}

/**
 * The whitespace of ONE nesting level, taken from the run's own step between
 * its two shallowest levels: tabs stay tabs, 2 spaces stay 2 spaces.
 */
function resolveStep(items: Marker[], shallowWidth: number, deeperWidth: number): string {
	const shallow = items.find((m) => indentWidth(m.indent) === shallowWidth)!.indent;
	const deeper = items.find((m) => indentWidth(m.indent) === deeperWidth)!.indent;
	return deeper.startsWith(shallow) && deeper.length > shallow.length
		? deeper.slice(shallow.length)
		: deeper;
}

/** Group the run's raw lines into logical segments. */
function groupLines(lines: string[]): Segment[] {
	const markers = lines.map(parseMarker);
	const runHasMarker = markers.some((m) => m !== null);
	const indentFor = buildNesting(markers);
	const maxWidth = Math.max(...lines.map((l) => l.replace(/\s+$/, "").length));
	const segments: Segment[] = [];

	for (let k = 0; k < lines.length; k++) {
		const line = lines[k];
		const marker = markers[k];

		let boundary: boolean;
		if (k === 0) {
			boundary = true;
		} else if (runHasMarker) {
			// LIST mode: only a marker starts a new block; everything else continues.
			boundary = marker !== null;
		} else {
			// PARAGRAPH mode.
			const prev = lines[k - 1].replace(/\s+$/, "");
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
				segments.push({
					isBullet: true,
					indent: indentFor(marker),
					markerOut: marker.markerOut,
					text: marker.text.trim(),
				});
			} else {
				segments.push({ isBullet: false, indent: "", markerOut: "", text: line.trim() });
			}
		} else {
			appendContinuation(segments[segments.length - 1], line.trim());
		}
	}

	return segments;
}

/** Render segments back to text: tight list for bullets, blank line elsewhere. */
function renderSegments(segments: Segment[]): string {
	let out = "";
	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i];
		if (i > 0) {
			const prev = segments[i - 1];
			// Consecutive bullets form a tight list; any other adjacency gets a blank line.
			out += prev.isBullet && seg.isBullet ? "\n" : "\n\n";
		}
		out += seg.isBullet ? seg.indent + seg.markerOut + seg.text : seg.text;
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
		if (!FLOWABLE.has(blocks[i].kind)) {
			i++;
			continue;
		}
		// Extend to the end of this contiguous flowable run.
		let j = i;
		while (j + 1 < blocks.length && FLOWABLE.has(blocks[j + 1].kind)) j++;

		const edit = reflowRun(ctx.doc, blocks[i].startOffset, blocks[j].endOffset);
		if (edit) plan.push(edit);
		i = j + 1;
	}

	return plan;
}
