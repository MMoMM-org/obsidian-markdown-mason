// src/core/fitToList.ts — spec-008: fit pasted content to the cursor's list context
//
// The paste-time sibling of headings.cascade(): cascade() reads the nearest
// heading ABOVE the cursor and shifts pasted heading levels to fit; fitToList()
// reads the LIST LINE the cursor sits in and reshapes the pasted text so it
// joins that list instead of breaking it.
//
// Unlike the applyTextCleanup steps this is NOT an (ctx) => EditPlan transform:
// it never edits the document, it rewrites the string that is about to be
// inserted. Insertion stays a single replaceSelection() — one undo entry.
//
// CON-2: zero obsidian imports.
//
// Contract: fitPasteToList(text, doc, cursor) returns `text` UNCHANGED whenever
// the cursor is not inside a list item. Every non-list paste is byte-identical
// to the pre-spec-008 behaviour.

import { segmentBlocks } from "./markdownBlocks";
import type { Block, BlockKind } from "./markdownBlocks";

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * The cursor line's list prefix.
 * Captures: (1) indent, (2) bullet glyph, (3) ordered digits, (4) ordered
 * terminator, (5) gap after the marker, (6) optional checkbox incl. its gap.
 *
 * The glyph class matches segmentBlocks()' own listItem class so that any line
 * classified as a list item here is also one there.
 */
const LIST_PREFIX =
	/^([ \t]*)(?:([-*+•–·])|(\d{1,9})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

/**
 * A pasted list line's own marker prefix. The checkbox is deliberately NOT
 * captured — it stays part of the item's content so `- [ ] foo` survives a
 * marker swap intact.
 */
const ITEM_MARKER = /^([ \t]*)(?:[-*+•–·]|\d{1,9}[.)])[ \t]+/;

/** Block kinds in which a list-looking line must NOT be treated as a list context. */
const BARRIER_KINDS: ReadonlySet<BlockKind> = new Set<BlockKind>([
	"fencedCode",
	"indentedCode",
	"frontmatter",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListContext {
	/** Leading whitespace of the cursor's line, verbatim. */
	indent: string;
	/** Bullet glyph ("-", "*", "+", …); empty string for an ordered context. */
	glyph: string;
	/** The ordinal on the cursor's line; null for a bullet context. */
	ordinal: number | null;
	/** "." or ")" for an ordered context, else null. */
	terminator: "." | ")" | null;
	/** True when the cursor's item carries a "[ ]" / "[x]" checkbox. */
	task: boolean;
	/** Whitespace between marker and content, verbatim. */
	gap: string;
	/** Offset of the first character of the cursor's line. */
	lineStart: number;
	/** Length of the full matched prefix (indent + marker + gap + checkbox). */
	prefixLen: number;
	/** Item text between the end of the prefix and the cursor. */
	beforeCursor: string;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Leading-whitespace width in columns; a tab counts as 4. */
function indentWidth(line: string): number {
	let w = 0;
	for (const ch of line) {
		if (ch === "\t") w += 4;
		else if (ch === " ") w += 1;
		else break;
	}
	return w;
}

/** The leading whitespace of a line, verbatim. */
function leadingWhitespace(line: string): string {
	return /^[ \t]*/.exec(line)![0];
}

/** 0-based index of the line containing `offset`. */
function lineIndexOf(doc: string, offset: number): number {
	let n = 0;
	for (let i = 0; i < offset && i < doc.length; i++) {
		if (doc[i] === "\n") n++;
	}
	return n;
}

/** The kind of the block containing `line`, or null when out of range. */
function blockKindAtLine(blocks: Block[], line: number): BlockKind | null {
	for (const b of blocks) {
		if (line >= b.startLine && line <= b.endLine) return b.kind;
	}
	return null;
}

/**
 * A `paragraph` block whose every line is indented is a list-item CONTINUATION
 * (a hard-wrapped item body), not a new paragraph — segmentBlocks() cannot tell
 * the two apart, but the indent can.
 */
function isIndentedParagraph(b: Block, lines: string[]): boolean {
	if (b.kind !== "paragraph") return false;
	for (let i = b.startLine; i <= b.endLine; i++) {
		if (indentWidth(lines[i]) === 0) return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// F1 — detectListContext
// ---------------------------------------------------------------------------

/**
 * Read the list context at `cursor`, or null when there is none.
 *
 * Returns null when the line carries no list prefix, when the caret sits before
 * or inside the marker, or when the line lives in a code/frontmatter block.
 */
export function detectListContext(doc: string, cursor: number): ListContext | null {
	const pos = Math.max(0, Math.min(cursor, doc.length));
	const lineStart = pos === 0 ? 0 : doc.lastIndexOf("\n", pos - 1) + 1;
	const nl = doc.indexOf("\n", lineStart);
	const lineEnd = nl === -1 ? doc.length : nl;
	const line = doc.slice(lineStart, lineEnd);

	const m = LIST_PREFIX.exec(line);
	if (m === null) return null;

	const prefixLen = m[0].length;
	const col = pos - lineStart;
	// The caret must be at or past the whole prefix — inside the marker is not
	// a list context (the user is still editing the marker itself).
	if (col < prefixLen) return null;

	const kind = blockKindAtLine(segmentBlocks(doc), lineIndexOf(doc, lineStart));
	if (kind !== null && BARRIER_KINDS.has(kind)) return null;

	return {
		indent: m[1],
		glyph: m[2] ?? "",
		ordinal: m[3] !== undefined ? parseInt(m[3], 10) : null,
		terminator: (m[4] as "." | ")" | undefined) ?? null,
		task: m[6] !== undefined,
		gap: m[5],
		lineStart,
		prefixLen,
		beforeCursor: line.slice(prefixLen, col),
	};
}

// ---------------------------------------------------------------------------
// F5 — resolveIndentUnit
// ---------------------------------------------------------------------------

/**
 * The whitespace that represents ONE indent level, resolved from what is
 * actually in use rather than from an Obsidian config API:
 *
 *   1. the note's own habit near the cursor,
 *   2. the pasted content's own nesting,
 *   3. a tab (Obsidian's default; renders correctly at any tabSize).
 */
export function resolveIndentUnit(doc: string, ctx: ListContext, pasted: string): string {
	const base = indentWidth(ctx.indent);

	const fromDoc = sniffDeeperIndent(doc.split("\n"), lineIndexOf(doc, ctx.lineStart), base);
	if (fromDoc !== null) return relativeTo(ctx.indent, fromDoc);

	const fromPaste = sniffPastedUnit(pasted);
	if (fromPaste !== null) return fromPaste;

	return "\t";
}

/** `deeper` expressed relative to `base` when it nests under it, else verbatim. */
function relativeTo(base: string, deeper: string): string {
	if (base !== "" && deeper.startsWith(base)) {
		const rest = deeper.slice(base.length);
		if (rest !== "") return rest;
	}
	return deeper;
}

/**
 * Walk outward from `line` through the contiguous non-blank run around it and
 * return the leading whitespace of the first line indented deeper than `base`.
 */
function sniffDeeperIndent(lines: string[], line: number, base: number): string | null {
	for (let i = line + 1; i < lines.length && lines[i].trim() !== ""; i++) {
		if (indentWidth(lines[i]) > base) return leadingWhitespace(lines[i]);
	}
	for (let i = line - 1; i >= 0 && lines[i].trim() !== ""; i--) {
		if (indentWidth(lines[i]) > base) return leadingWhitespace(lines[i]);
	}
	return null;
}

/** The indent step between the two shallowest levels of the pasted content's own list. */
function sniffPastedUnit(pasted: string): string | null {
	const lines = pasted.split("\n");
	let shallow: string | null = null;
	let deeper: string | null = null;

	for (const line of lines) {
		if (!ITEM_MARKER.test(line)) continue;
		const ws = leadingWhitespace(line);
		if (shallow === null || indentWidth(ws) < indentWidth(shallow)) {
			shallow = ws;
			deeper = null;
		} else if (indentWidth(ws) > indentWidth(shallow)
			&& (deeper === null || indentWidth(ws) < indentWidth(deeper))) {
			deeper = ws;
		}
	}

	return deeper === null || shallow === null ? null : relativeTo(shallow, deeper);
}

// ---------------------------------------------------------------------------
// Depth ranking (ADR-39)
// ---------------------------------------------------------------------------

/**
 * Map each pasted list-marker line to its RELATIVE depth within its own list run.
 *
 * Depth is the RANK of the line's indent width among the distinct widths in that
 * run — never a division by a guessed step size. Clipboard sources indent with
 * 2 spaces, 4 spaces, tabs or non-uniform mixes; ranking preserves the author's
 * hierarchy whatever they used.
 *
 * Blank blocks and indented continuation paragraphs do not break a run, so loose
 * lists and hard-wrapped items stay one hierarchy.
 */
function buildDepthRanks(blocks: Block[], lines: string[]): Map<number, number> {
	const depth = new Map<number, number>();
	let run: number[] = [];

	const flush = (): void => {
		if (run.length === 0) return;
		const widths = [...new Set(run.map((i) => indentWidth(lines[i])))].sort((a, b) => a - b);
		for (const i of run) depth.set(i, widths.indexOf(indentWidth(lines[i])));
		run = [];
	};

	for (const b of blocks) {
		if (b.kind === "blank" || isIndentedParagraph(b, lines)) continue;
		if (b.kind === "listItem") {
			for (let i = b.startLine; i <= b.endLine; i++) {
				if (ITEM_MARKER.test(lines[i])) run.push(i);
			}
			continue;
		}
		flush();
	}
	flush();

	return depth;
}

// ---------------------------------------------------------------------------
// F2–F4 — fitToList
// ---------------------------------------------------------------------------

/**
 * Reshape `text` so it joins the list described by `ctx`.
 *
 *   - every top-level paragraph becomes one item at the context level,
 *   - the blank lines that separated them are dropped,
 *   - a pasted list nests one level under the paragraph that introduces it
 *     (and stays at the context level when the paste starts with a list),
 *   - the first emitted line loses its generated prefix: it continues the line
 *     the cursor is already on.
 *
 * The result carries no trailing newline, so the caret lands at the end of the
 * last pasted item.
 */
export function fitToList(text: string, ctx: ListContext, indentUnit: string): string {
	if (text === "") return text;

	const lines = text.split("\n");
	const blocks = segmentBlocks(text);
	const depthOf = buildDepthRanks(blocks, lines);

	const out: string[] = [];
	let firstPrefixLen = -1;
	let ordinal = ctx.ordinal ?? 0;
	let sawParagraphItem = false;
	// Column at which the current item's CONTENT starts — where continuation
	// lines and verbatim blocks (code, tables) are re-anchored.
	let contentIndent = ctx.indent + " ".repeat(ctx.prefixLen - ctx.indent.length);
	let prevKind: BlockKind | null = null;

	const push = (prefix: string, body: string): void => {
		if (firstPrefixLen < 0) firstPrefixLen = prefix.length;
		out.push(prefix + body);
	};

	/**
	 * Emit one item at the CONTEXT level, consuming an ordinal for ordered
	 * contexts and re-anchoring the content column for anything that follows.
	 *
	 * Checkbox handling: in a task context the box belongs to the generated
	 * prefix, so a box the pasted line already carries is consumed rather than
	 * repeated — otherwise pasting a task list into "- [ ] " would double it
	 * (and doubling is invisible on the FIRST line, where the note supplies the
	 * prefix and the generated one is stripped). Outside a task context a pasted
	 * box is left alone as ordinary content.
	 */
	const emitContextItem = (body: string): void => {
		const pastedBox = /^\[[ xX]\][ \t]+/.exec(body);
		const text = ctx.task && pastedBox !== null ? body.slice(pastedBox[0].length) : body;
		const core = ctx.ordinal !== null
			? `${String(ordinal++)}${ctx.terminator ?? "."}`
			: ctx.glyph;
		const prefix = ctx.indent + core + ctx.gap + (ctx.task ? "[ ] " : "");
		push(prefix, text);
		contentIndent = ctx.indent + " ".repeat(prefix.length - ctx.indent.length);
	};

	for (const block of blocks) {
		if (block.kind === "blank") {
			prevKind = block.kind;
			continue; // F2: paragraph separators must not survive inside the list
		}

		if (block.kind === "listItem") {
			for (let i = block.startLine; i <= block.endLine; i++) {
				const line = lines[i];
				const marker = ITEM_MARKER.exec(line);
				if (marker === null) {
					// Marker-less line inside the item block — continuation content.
					push(contentIndent, line.trimStart());
					continue;
				}
				const depth = depthOf.get(i) ?? 0;
				// F3: a pasted list nests under the paragraph item that introduced it.
				const nestOffset = sawParagraphItem ? 1 : 0;
				const body = line.slice(marker[0].length);
				if (nestOffset === 0 && depth === 0) {
					// Sibling of the cursor's own item → adopt the context marker
					// so a pasted ordered list does not collide with a bullet
					// context (and vice versa). ADR-41.
					emitContextItem(body);
				} else {
					// Deeper than the context → keep the author's own marker.
					const prefix = ctx.indent + indentUnit.repeat(nestOffset + depth);
					push(prefix, line.slice(marker[1].length));
					contentIndent = prefix + " ".repeat(marker[0].length - marker[1].length);
				}
			}
			prevKind = block.kind;
			continue;
		}

		// A fully indented paragraph directly after a list item is that item's
		// hard-wrapped body, not a new item.
		if (prevKind === "listItem" && isIndentedParagraph(block, lines)) {
			for (let i = block.startLine; i <= block.endLine; i++) {
				push(contentIndent, lines[i].trimStart());
			}
			prevKind = block.kind;
			continue;
		}

		if (block.kind === "paragraph") {
			for (let i = block.startLine; i <= block.endLine; i++) {
				const body = lines[i].trimStart();
				if (i === block.startLine) {
					emitContextItem(body);
					sawParagraphItem = true;
				} else {
					// Un-dewrapped continuation line of the same paragraph.
					push(contentIndent, body);
				}
			}
			prevKind = block.kind;
			continue;
		}

		// F6: everything else (fenced code, tables, headings, quotes, breaks) is
		// emitted VERBATIM at the current item's content column — never re-marked
		// and never re-wrapped.
		for (let i = block.startLine; i <= block.endLine; i++) {
			push(contentIndent, lines[i]);
		}
		prevKind = block.kind;
	}

	if (out.length === 0) return text;
	// F4: the cursor already sits after a marker — the first line continues it.
	out[0] = out[0].slice(firstPrefixLen < 0 ? 0 : firstPrefixLen);
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Fit `text` to the list context at `cursor` in `doc`.
 *
 * Returns `text` unchanged when the cursor is not in a list item — the single
 * most important safety property of this module.
 */
export function fitPasteToList(text: string, doc: string, cursor: number): string {
	const ctx = detectListContext(doc, cursor);
	if (ctx === null) return text;

	const fitted = fitToList(text, ctx, resolveIndentUnit(doc, ctx, text));
	// "- Foo" + "Bar" → "- Foo Bar", never "- FooBar".
	const needsSpace = ctx.beforeCursor !== "" && !/[ \t]$/.test(ctx.beforeCursor);
	return needsSpace ? " " + fitted : fitted;
}
