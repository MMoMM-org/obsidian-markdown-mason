// No obsidian import — this module is pure domain; unit-testable without Obsidian.
//
// Whole-note footnote operations (Phase 4):
//
//   parseNoteFootnotes(doc, resourcesName?) → NoteFootnoteParse
//     Scans a full note document and returns the positions of:
//       inlineRefs   — [^n] and [^alpha] inline references (positions vs doc)
//       bareCitations — [n] bare numeric citation markers (not [n](url))
//       defs         — [^n]: and [^alpha]: definition blocks (positions vs doc)
//       resourcesSection — { from, to } of the ## <resourcesName> section, or null
//
//   wholeNoteFromCitations(ctx) → EditPlan   [C]
//     Converts bare [n] citations in ctx.doc to [^n] footnote refs.
//     Alphabetic markers [A] are never altered.  Offsets vs ORIGINAL ctx.doc (ADR-1).
//
//   wholeNoteIdentity(ctx) → EditPlan   [O+D]
//     Renumbers all numeric [^n] footnotes gap-free in first-reference order.
//     Dedups by URL (same URL → one footnote number).
//     Collapses duplicate definitions of the same id.
//     Alpha footnotes ([^A], [^second]) are not renumbered, not counted toward max.
//     Offsets vs ORIGINAL ctx.doc (ADR-1).
//
//   wholeNoteMove(ctx) → EditPlan   [M]
//     Moves all numeric footnote definition blocks that are NOT already in the
//     ## <resourcesName> section into that section (creating it at note end if absent).
//     Orphaned lines in an existing Resources section are preserved untouched.
//     Alpha defs are NOT moved.  Empty defs → empty plan.
//     Offsets vs ORIGINAL ctx.doc (ADR-1).
//
//   tidyFootnotes(ctx) → EditPlan   [C → O+D → M]
//     Composes C → O+D → M using applyToString for intermediate stages (to avoid
//     offset-shift bugs across ops), then emits ONE EditPlan of edits against the
//     ORIGINAL ctx.doc.  This is the implementation of the "Tidy footnotes" preset
//     (F5); using a fused tidy rather than independent op chaining because the three
//     ops are not offset-independent — C produces new [^n] refs that O+D must process
//     at their new positions.  A single fused impl is correct; independent chaining
//     against the same original doc would re-use stale offsets.
//
// ADR choice: fused tidy vs independent chaining
//   C changes raw text offsets (bare [n] expands to [^n], +1 char per marker).
//   O+D renames [^n] refs including those just created by C.  Running O+D with
//   offsets from the post-C document and then translating back to original-doc
//   offsets is error-prone.  Instead: apply C to a scratch string, run O+D on
//   that string, apply M on the O+D result, then diff original→final to produce
//   the plan.  The final plan is computed as a single replace-all edit per changed
//   line (or as character-level edits) vs the original doc.
//
//   Strategy chosen: build the fully-transformed string via applyToString chaining,
//   then emit a single whole-doc replacement if anything changed.  This guarantees
//   one atomic EditPlan item → one CM6 transaction → one undo step.
//
//   For C/O+D/M invoked INDEPENDENTLY (as single ops from commands), the function
//   operates on ctx.doc directly and emits character-level edits vs ctx.doc.

import type { EditPlan, OperationContext } from "./types";
import { applyToString } from "./applyToString";
import { normalizeUrl } from "./url";
import {
	resourcesSectionName,
	resourcesCreateHeading,
	findResourcesSectionByName,
} from "./resourcesHeading";

// ---------------------------------------------------------------------------
// Public types returned by parseNoteFootnotes
// ---------------------------------------------------------------------------

export interface NoteInlineRef {
	/** The footnote id string, e.g. "1", "A", "second". */
	id: string;
	isAlpha: boolean;
	/** Byte offset of "[^id]" start in the doc. */
	from: number;
	/** Byte offset just past the closing "]". */
	to: number;
}

export interface NoteBareCitation {
	/** Numeric value of the bare [n] marker. */
	n: number;
	/** Byte offset of "[n]" start in the doc. */
	from: number;
	/** Byte offset just past the closing "]". */
	to: number;
}

export interface NoteDef {
	/** The footnote id string, e.g. "1", "A". */
	id: string;
	isAlpha: boolean;
	/** Text of the snippet / rest of line after "[^id]: ". */
	snippet: string;
	/** URL from the second (link) line, if present. */
	url?: string;
	/** Link title from the second line, if present. */
	title?: string;
	/** Raw text of this def block (one or two lines). */
	raw: string;
	/** Byte offset of the first character of the def block in the doc. */
	from: number;
	/** Byte offset just past the last character of the def block (incl. trailing "\n"). */
	to: number;
}

export interface NoteResourcesSection {
	/** Offset of the start of the "## <name>" heading line. */
	from: number;
	/** Offset just past the end of the section (before the next ## or EOF). */
	to: number;
}

export interface NoteFootnoteParse {
	inlineRefs: NoteInlineRef[];
	bareCitations: NoteBareCitation[];
	defs: NoteDef[];
	resourcesSection: NoteResourcesSection | null;
}

// ---------------------------------------------------------------------------
// parseNoteFootnotes
// ---------------------------------------------------------------------------

/**
 * Scan a full note document and return all footnote-related positions.
 *
 * @param doc The full note text.
 * @param resourcesName The Resources section heading (default "Resources").
 */
export function parseNoteFootnotes(doc: string, resourcesName: string = "Resources"): NoteFootnoteParse {
	const lines = doc.split("\n");
	const defSet = buildDefSet(lines);

	const defs = parseDefs(lines, defSet, doc.length);
	const resourcesSection = findResourcesSection(lines, resourcesName, doc.length);
	const inlineRefs = parseInlineRefs(doc);
	const bareCitations = parseBareCitations(doc);

	return { inlineRefs, bareCitations, defs, resourcesSection };
}

// ---------------------------------------------------------------------------
// Internal: identify which line indices are definition start lines
// ---------------------------------------------------------------------------

/** Build a Set of 0-based line indices that begin a footnote definition. */
function buildDefSet(lines: string[]): Set<number> {
	const set = new Set<number>();
	for (let i = 0; i < lines.length; i++) {
		if (/^\[\^[^\]]+\]:/.test(lines[i])) {
			set.add(i);
		}
	}
	return set;
}

// ---------------------------------------------------------------------------
// Internal: parse definition blocks
// ---------------------------------------------------------------------------

function parseDefs(lines: string[], defSet: Set<number>, docLength: number): NoteDef[] {
	const defs: NoteDef[] = [];
	let lineOffset = 0;

	for (let i = 0; i < lines.length; i++) {
		const lineLen = lines[i].length + 1; // +1 for the \n

		if (!defSet.has(i)) {
			lineOffset += lineLen;
			continue;
		}

		const line1 = lines[i];
		const idMatch = /^\[\^([^\]]+)\]: (.*)$/.exec(line1);
		if (!idMatch) {
			lineOffset += lineLen;
			continue;
		}

		const id = idMatch[1];
		const isAlpha = !/^\d+$/.test(id);
		const snippet = idMatch[2];

		const from = lineOffset;

		// Check if next line is a markdown link "[title](url)"
		const nextLine = lines[i + 1];
		const linkMatch = nextLine ? /^\[([^\]]*)\]\(([^)]+)\)$/.exec(nextLine) : null;

		let to: number;
		let raw: string;
		let url: string | undefined;
		let title: string | undefined;

		if (linkMatch) {
			title = linkMatch[1];
			url = linkMatch[2];
			// Two-line def: include both lines + their newlines, clamped to docLength.
			to = Math.min(lineOffset + lineLen + (lines[i + 1].length + 1), docLength);
			raw = line1 + "\n" + lines[i + 1];
			i++; // skip the link line in outer loop
			lineOffset += lineLen + (lines[i].length + 1);
		} else {
			// Single-line def: clamp to docLength (last line may lack trailing \n).
			to = Math.min(lineOffset + lineLen, docLength);
			raw = line1;
			lineOffset += lineLen;
		}

		defs.push({ id, isAlpha, snippet, url, title, raw, from, to });
		continue;
	}

	return defs;
}

// ---------------------------------------------------------------------------
// Internal: parse inline [^id] references (not part of definition lines)
// ---------------------------------------------------------------------------

function parseInlineRefs(doc: string): NoteInlineRef[] {
	// Build a set of character ranges that belong to definition lines.
	// We'll skip matches that fall within a def-line range.
	const defRanges = buildDefLineRanges(doc);

	const refs: NoteInlineRef[] = [];
	const re = /\[\^([^\]]+)\](?!:)/g; // [^id] NOT followed by ":" (which would be a def)
	let m: RegExpExecArray | null;

	while ((m = re.exec(doc)) !== null) {
		const from = m.index;
		const to = from + m[0].length;

		// Skip if this match is inside a definition line
		if (isInDefLine(from, defRanges)) continue;

		const id = m[1];
		const isAlpha = !/^\d+$/.test(id);

		refs.push({ id, isAlpha, from, to });
	}

	return refs;
}

// ---------------------------------------------------------------------------
// Internal: parse bare [n] citations (not [n](url), not already-converted [^n])
// ---------------------------------------------------------------------------

function parseBareCitations(doc: string): NoteBareCitation[] {
	const defRanges = buildDefLineRanges(doc);
	const citations: NoteBareCitation[] = [];
	// Match [n] not followed by "(" — excludes markdown links [n](url)
	// Must not be preceded by "^" — excludes [^n]
	const re = /(?<!\^)\[(\d+)\](?!\()/g;
	let m: RegExpExecArray | null;

	while ((m = re.exec(doc)) !== null) {
		const from = m.index;
		const to = from + m[0].length;

		// Skip if inside a definition line
		if (isInDefLine(from, defRanges)) continue;

		citations.push({ n: Number(m[1]), from, to });
	}

	return citations;
}

// ---------------------------------------------------------------------------
// Internal: compute character ranges for definition-start lines
// ---------------------------------------------------------------------------

interface Range {
	from: number;
	to: number;
}

function buildDefLineRanges(doc: string): Range[] {
	const ranges: Range[] = [];
	const lines = doc.split("\n");
	let offset = 0;

	for (const line of lines) {
		if (/^\[\^[^\]]+\]:/.test(line)) {
			ranges.push({ from: offset, to: offset + line.length });
		}
		offset += line.length + 1;
	}

	return ranges;
}

function isInDefLine(offset: number, defRanges: Range[]): boolean {
	for (const r of defRanges) {
		if (offset >= r.from && offset < r.to) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Internal: find the Resources section bounds
// ---------------------------------------------------------------------------

function findResourcesSection(lines: string[], resourcesName: string, docLength: number): NoteResourcesSection | null {
	// Name-based, level-agnostic: an existing section with this name is adopted
	// at whatever heading level it already has (see resourcesHeading.ts).
	const section = findResourcesSectionByName(lines, resourcesSectionName(resourcesName), docLength);
	return section === null ? null : { from: section.from, to: section.to };
}

// ---------------------------------------------------------------------------
// wholeNoteFromCitations — C operation (whole-note)
// ---------------------------------------------------------------------------

/**
 * Convert bare [n] citation markers in ctx.doc to [^n] footnote refs.
 * Alpha markers and markdown links are untouched. Offsets vs original doc (ADR-1).
 */
export function wholeNoteFromCitations(ctx: OperationContext): EditPlan {
	const { doc } = ctx;
	const parse = parseNoteFootnotes(doc, ctx.settings.resourcesName);

	if (parse.bareCitations.length === 0) return [];

	const plan: EditPlan = parse.bareCitations.map((cite) => ({
		from: cite.from,
		to: cite.to,
		insert: `[^${cite.n}]`,
	}));

	return plan.sort((a, b) => a.from - b.from);
}

// ---------------------------------------------------------------------------
// wholeNoteIdentity — O+D operation (whole-note renumber + dedup)
// ---------------------------------------------------------------------------

/**
 * Renumber numeric footnotes gap-free in first-reference order, deduplicate by URL,
 * and collapse duplicate definitions of the same id.
 * Alpha footnotes are preserved unchanged. Offsets vs original doc (ADR-1).
 */
export function wholeNoteIdentity(ctx: OperationContext): EditPlan {
	const { doc } = ctx;
	const parse = parseNoteFootnotes(doc, ctx.settings.resourcesName);

	// Collect numeric inline refs in document order (first-reference order).
	const numericRefs = parse.inlineRefs.filter((r) => !r.isAlpha);
	const numericDefs = parse.defs.filter((d) => !d.isAlpha);

	if (numericRefs.length === 0 && numericDefs.length === 0) return [];

	// Build the renaming map: oldId (string) → newId (number)
	const { idMap, canonicalDef } = buildRenameMap(numericRefs, numericDefs);

	// Check if anything actually changes
	const anyChange = Object.entries(idMap).some(([old, newId]) => String(newId) !== old);
	const anyDupDef = numericDefs.length > canonicalDef.size;
	if (!anyChange && !anyDupDef) return [];

	const plan: EditPlan = [];

	// 1. Rename inline refs
	for (const ref of numericRefs) {
		const newId = idMap[ref.id];
		if (newId === undefined) continue;
		const newMarker = `[^${newId}]`;
		const oldMarker = doc.slice(ref.from, ref.to);
		if (newMarker === oldMarker) continue;
		plan.push({ from: ref.from, to: ref.to, insert: newMarker });
	}

	// 2. Replace definition blocks: canonical defs get renamed; duplicates get deleted.
	for (const def of numericDefs) {
		const newId = idMap[def.id];
		if (newId === undefined) continue;

		const isCanonical = canonicalDef.get(def.id) === def;

		if (!isCanonical) {
			// Duplicate definition: delete it (replace with empty string).
			plan.push({ from: def.from, to: def.to, insert: "" });
			continue;
		}

		// Rename this def: replace [^oldId]: with [^newId]:
		const newDefText = renameDef(def, String(newId));
		if (newDefText !== def.raw) {
			// Replace the entire def block (from..to) with the renamed version.
			// Append "\n" only when the original span included a trailing newline
			// (def.to > def.from + def.raw.length). When the def is the last line
			// of the doc and has no trailing newline, def.to was clamped to docLength
			// and appending "\n" would spuriously grow the document (S-1).
			const hasTrailingNewline = def.to > def.from + def.raw.length;
			const insertText = hasTrailingNewline ? newDefText + "\n" : newDefText;
			plan.push({ from: def.from, to: def.to, insert: insertText });
		}
	}

	return plan.sort((a, b) => a.from - b.from);
}

/** Build a map from old string id → new numeric id, and track the canonical def per old id. */
function buildRenameMap(
	numericRefs: NoteInlineRef[],
	numericDefs: NoteDef[],
): { idMap: Record<string, number>; canonicalDef: Map<string, NoteDef> } {
	// Assign new ids in first-reference order (by position in doc).
	// Dedup by URL: same normalizedUrl → same new id.

	const seenOldIdsSet = new Set<string>(); // dedup tracker
	const seenOldIds: string[] = []; // first-appearance order of old ids from inline refs
	for (const ref of numericRefs) {
		if (!seenOldIdsSet.has(ref.id)) {
			seenOldIdsSet.add(ref.id);
			seenOldIds.push(ref.id);
		}
	}

	// Also include def ids that have no inline ref (orphan defs) — they still need renaming.
	const defOnlyIdsSet = new Set<string>(); // dedup tracker
	const defOnlyIds: string[] = [];
	for (const def of numericDefs) {
		if (!seenOldIdsSet.has(def.id) && !defOnlyIdsSet.has(def.id)) {
			defOnlyIdsSet.add(def.id);
			defOnlyIds.push(def.id);
		}
	}

	// Build a lookup: old id → def(s) so we can extract URLs for dedup.
	const defsByOldId = new Map<string, NoteDef[]>();
	for (const def of numericDefs) {
		if (!defsByOldId.has(def.id)) defsByOldId.set(def.id, []);
		defsByOldId.get(def.id)!.push(def);
	}

	// Assign new ids: deduplicate by URL.
	const urlToNewId = new Map<string, number>(); // normalizedUrl → assigned new id
	const idMap: Record<string, number> = {};
	let nextId = 1;

	for (const oldId of [...seenOldIds, ...defOnlyIds]) {
		if (idMap[oldId] !== undefined) continue;

		// Find the URL for this old id (from its first def).
		const defs = defsByOldId.get(oldId) ?? [];
		const primaryDef = defs[0];
		const url = primaryDef?.url ? normalizeUrl(primaryDef.url) : "";

		if (url && urlToNewId.has(url)) {
			// Duplicate URL: reuse the already-assigned new id.
			idMap[oldId] = urlToNewId.get(url)!;
		} else {
			// New: assign next id.
			idMap[oldId] = nextId;
			if (url) urlToNewId.set(url, nextId);
			nextId++;
		}
	}

	// For each old id, pick the canonical def (the first occurrence).
	// Duplicate defs with the same url as an earlier id will be deleted.
	const canonicalDef = new Map<string, NoteDef>();

	for (const [oldId, defsForId] of defsByOldId.entries()) {
		const newId = idMap[oldId];
		if (newId === undefined) continue;

		// Check if this old id maps to a new id that another old id already claimed.
		// If so, this old id's def is a duplicate → delete all of them.
		const isDupOfAnother = Object.entries(idMap).some(
			([otherId, otherNewId]) => otherId !== oldId && otherNewId === newId && canonicalDef.has(otherId),
		);

		if (isDupOfAnother) {
			// All defs for this old id are duplicates of something we already have.
			// They'll all be deleted via the "not canonical" path.
			continue;
		}

		// The first def for this id becomes canonical.
		canonicalDef.set(oldId, defsForId[0]);
	}

	return { idMap, canonicalDef };
}

/** Rename the [^oldId]: prefix in a def's raw text to [^newId]:. */
function renameDef(def: NoteDef, newId: string): string {
	const oldPrefix = `[^${def.id}]:`;
	const newPrefix = `[^${newId}]:`;
	return def.raw.replace(oldPrefix, newPrefix);
}

// ---------------------------------------------------------------------------
// wholeNoteMove — M operation (whole-note move to Resources)
// ---------------------------------------------------------------------------

/**
 * Move all numeric footnote definition blocks that are NOT already inside the
 * ## <resourcesName> section into that section.
 * Alpha defs are not touched. Orphan lines in existing Resources are preserved.
 * Creates the Resources section at note end if absent (only when there are defs to move).
 * Offsets vs original doc (ADR-1).
 */
export function wholeNoteMove(ctx: OperationContext): EditPlan {
	const { doc, settings } = ctx;
	const parse = parseNoteFootnotes(doc, settings.resourcesName);

	// Find numeric defs that are outside the Resources section.
	const defsToMove = getDefsToMove(parse);

	if (defsToMove.length === 0) return [];

	// Format the defs to insert.
	const formattedDefs = defsToMove.map((def) => formatDef(def));

	// Build the plan: delete each def from its current location + insert into Resources.
	const plan: EditPlan = [];

	// Delete each def from its current body location.
	for (const def of defsToMove) {
		plan.push({ from: def.from, to: def.to, insert: "" });
	}

	// Insert all defs into the Resources section (or create it). When the section
	// already exists, headingLine is unused (we insert at its end); when it does
	// not, the configured heading — at the user's chosen level — is created.
	const headingLine = resourcesCreateHeading(settings.resourcesName);
	const insertOffset = parse.resourcesSection
		? findSectionInsertOffset(doc, headingLine, parse.resourcesSection)
		: null;

	if (insertOffset === null) {
		// Create Resources section at note end.
		const sep = formattedDefs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
		const content = `\n${headingLine}\n\n${formattedDefs.join(sep)}`;
		plan.push({ from: doc.length, to: doc.length, insert: content });
	} else {
		// Append to existing Resources section.
		const sep = formattedDefs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
		const content = "\n" + formattedDefs.join(sep) + "\n";
		plan.push({ from: insertOffset, to: insertOffset, insert: content });
	}

	return plan.sort((a, b) => a.from - b.from);
}

/** Return numeric defs that are outside the Resources section. */
function getDefsToMove(parse: NoteFootnoteParse): NoteDef[] {
	const numericDefs = parse.defs.filter((d) => !d.isAlpha);
	if (!parse.resourcesSection) return numericDefs;

	const { from: secFrom, to: secTo } = parse.resourcesSection;
	return numericDefs.filter((def) => def.from < secFrom || def.from >= secTo);
}

/** Format a NoteDef back into its string representation (for insertion). */
function formatDef(def: NoteDef): string {
	if (def.url && def.title !== undefined) {
		return `[^${def.id}]: ${def.snippet}\n[${def.title}](${def.url})`;
	}
	return `[^${def.id}]: ${def.snippet}`;
}

/** Find the insert offset within an existing Resources section. */
function findSectionInsertOffset(doc: string, _headingLine: string, section: NoteResourcesSection): number {
	// Insert at the end of the section (just before secTo, which is either
	// the next ## heading or EOF).
	return Math.min(section.to, doc.length);
}

// ---------------------------------------------------------------------------
// tidyFootnotes — C → O+D → M fused (whole-note Tidy)
// ---------------------------------------------------------------------------

/** Selectively enable or disable each stage of the fused tidy pipeline. */
export interface FootnoteSteps {
	fromCitations?: boolean;
	identity?: boolean;
	move?: boolean;
}

/**
 * Compose C → O+D → M using intermediate string application to avoid offset drift.
 * Emits ONE EditPlan of edits vs the ORIGINAL ctx.doc (ADR-1), implementing
 * a single atomic undo step.
 *
 * Each stage can be independently disabled via `include`; omitted flags default
 * to `true` so a no-arg call is byte-identical to the original all-stages behaviour.
 * A skipped stage contributes [] and passes the scratch string through unchanged.
 *
 * Design choice: fused rather than independent chaining.
 *   Independent chaining of C/O+D/M against the same original doc is incorrect
 *   because C changes text lengths (bare [n] expands to [^n]), which shifts all
 *   subsequent offsets. Instead: apply each op to a scratch string in sequence,
 *   then emit the difference between the original and the fully-transformed doc
 *   as a minimal set of edits vs the original. The minimal-diff approach is
 *   line-based (delete changed lines, insert new lines) since footnote edits are
 *   line-granular. If the doc is unchanged, return [].
 */
export function tidyFootnotes(ctx: OperationContext, include: FootnoteSteps = {}): EditPlan {
	const inc = {
		fromCitations: include.fromCitations ?? true,
		identity:      include.identity      ?? true,
		move:          include.move          ?? true,
	};
	const original = ctx.doc;

	// Stage 1: C — convert bare citations (gated).
	const cPlan = inc.fromCitations ? wholeNoteFromCitations(ctx) : [];
	const afterC = applyToString(original, cPlan);

	// Stage 2: O+D — renumber and dedup on the post-C doc (gated).
	const ctxAfterC: OperationContext = { ...ctx, doc: afterC };
	const odPlan = inc.identity ? wholeNoteIdentity(ctxAfterC) : [];
	const afterOD = applyToString(afterC, odPlan);

	// Stage 3: M — move defs on the post-O+D doc (gated).
	const ctxAfterOD: OperationContext = { ...ctx, doc: afterOD };
	const mPlan = inc.move ? wholeNoteMove(ctxAfterOD) : [];
	const afterM = applyToString(afterOD, mPlan);

	// If nothing changed, return empty plan.
	if (afterM === original) return [];

	// Emit the difference as a single whole-doc replacement.
	// Strategy: find the minimal prefix/suffix that matches and emit a single edit
	// covering the changed middle region. This produces the smallest possible plan
	// while still being a single CM6 transaction (one undo step).
	return diffToEditPlan(original, afterM);
}

/**
 * Compute a minimal EditPlan that transforms `original` into `transformed`.
 *
 * Strategy: find the longest common prefix and suffix, then emit a single Edit
 * for the changed middle region. This produces at most one Edit and is always
 * valid (offsets vs original, ADR-1). If the strings are identical, returns [].
 *
 * Exported so commands.ts can use it to build fused format pipelines.
 */
export function diffToEditPlan(original: string, transformed: string): EditPlan {
	if (original === transformed) return [];

	// Find common prefix length.
	let prefixLen = 0;
	const minLen = Math.min(original.length, transformed.length);
	while (prefixLen < minLen && original[prefixLen] === transformed[prefixLen]) {
		prefixLen++;
	}

	// Find common suffix length (starting from the end, not overlapping prefix).
	let suffixLen = 0;
	while (
		suffixLen < original.length - prefixLen &&
		suffixLen < transformed.length - prefixLen &&
		original[original.length - 1 - suffixLen] === transformed[transformed.length - 1 - suffixLen]
	) {
		suffixLen++;
	}

	const from = prefixLen;
	const to = original.length - suffixLen;
	const insert = transformed.slice(prefixLen, transformed.length - suffixLen);

	return [{ from, to, insert }];
}
