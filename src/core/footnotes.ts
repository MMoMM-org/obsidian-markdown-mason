// No obsidian import — this module is pure domain; unit-testable without Obsidian.
//
// T2.4  Footnote identity — fused O+D (ADR-2)
//
// resolveFootnoteIdentity(incoming, existing) → { idMap, newRefs }
//   Implements the fused O+D algorithm from SDD §Complex Logic.
//   idMap: Record<number, number>  — maps each incomingId to its final footnote id.
//   newRefs: ResolvedRef[]         — genuinely new refs with their resolved ids.
//
// applyFootnoteInlineRename(body, idMap) → EditPlan
//   Returns Edits (offsets vs the ORIGINAL body string, ADR-1) that rewrite
//   each [^n] marker whose n is a key in idMap.
//
// formatF4Def(ref) → string
//   Canonical F4 two-line formatter: "[^id]: snippet\n[title](url)".
//   Single source of F4 format in core.  newRefDefinitions delegates here.
//
// newRefDefinitions(newRefs) → string[]
//   Returns F4-format definition strings for each genuinely new ref by mapping
//   through formatF4Def.  T2.5 (M) will place these into the Resources section.
//   This is the clean seam: T2.4 owns identity + inline rewrite + def content;
//   T2.5 owns section placement (locating/creating "## Resources" and inserting).
//
// T2.5  Citation→Footnote (C) + move-to-Resources (M)
//
// fromCitations(parseResult) → EditPlan
//   Converts inline citation markers [n] → [^n] using ParseResult.inline
//   for the set of numeric ids to target.  Alpha markers are never altered.
//   Offsets vs the ORIGINAL body string (ADR-1).
//
// moveToResources(ctx, defs) → EditPlan
//   Places pre-formatted definition strings (two-line format: "[^n]: snippet"
//   + "[title](url)") into the note's Resources section (ADR-1 offsets vs doc).
//   Locates "## <resourcesName>" section; if absent, creates it at note end.
//   Never modifies orphaned lines.  Empty defs → empty plan.
//
//   Definition format (T2.4 → T2.5):
//     formatF4Def (canonical)    emits: "[^id]: snippet\n[title](url)" (F4 two-line)
//     newRefDefinitions delegates to formatF4Def — one canonical formatter in core.
//     moveToResources receives defs already in F4 format (produced by newRefDefinitions
//     or by callers mapping ResolvedRef[] through formatF4Def directly).
//
//   Caller composition of a two-place plan (ADR — body + defs in one plan):
//     const bodyEdits = fromCitations(parseResult);               // [n]→[^n] in body
//     const { idMap, newRefs } = resolveFootnoteIdentity(…);      // O+D resolution
//     const renameEdits = applyFootnoteInlineRename(…);           // [^n]→[^m] rename
//     const f4Defs = newRefDefinitions(newRefs);                  // F4 format (via formatF4Def)
//     const resourceEdits = moveToResources(ctx, f4Defs);         // section placement
//     const plan: EditPlan = [                               // ONE combined plan
//       ...bodyEdits, ...renameEdits, ...resourceEdits       // all vs ORIGINAL doc
//     ];
//     // Apply via Obsidian's editor.transaction() — single undo step (ADR F4.4).
//
// idMap representation: Record<number, number>
//   Chosen over Map<number,number> because:
//     - Direct bracket-notation access (idMap[n]) is more ergonomic in TS
//       and consistent with how the EditPlan consumer iterates markers.
//     - JSON-serialisable without conversion (easier to pass across seams).
//     - No iteration-order ambiguity for the small cardinality of footnote maps.

import type { Edit, EditPlan, FootnoteRef, ExistingRef, InlineMarker, ParseResult, OperationContext } from "./types";
import { normalizeUrl } from "./url";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A FootnoteRef that has been assigned its final resolved id by
 * resolveFootnoteIdentity.  The id field is authoritative; incomingId is
 * retained for traceability.
 */
export interface ResolvedRef extends FootnoteRef {
	/** Final footnote number after O+D resolution. */
	id: number;
}

// ---------------------------------------------------------------------------
// resolveFootnoteIdentity
// ---------------------------------------------------------------------------

/**
 * Fused O+D identity resolution (SDD §Complex Logic — fused Footnote-Identity).
 *
 * Steps:
 *   1. maxExisting = max numeric id in existing (alpha refs are excluded by
 *      ExistingRef's numeric id type — they never appear here).
 *   2. Build existingByUrl: normalizedUrl → existing.id.
 *   3. Iterate incoming in original order:
 *      a. Skip if already mapped (defensive; well-formed input won't hit this).
 *      b. If this normalised URL was already seen in-paste:
 *           - The first occurrence already resolved; re-use its id.
 *      c. Else if this URL matches an existing note ref: re-use existing.id.
 *      d. Else: assign ++maxExisting, push to newRefs.
 *      In all cases, record seenInPaste[norm] = incomingId on first sight (b/c).
 */
export function resolveFootnoteIdentity(
	incoming: FootnoteRef[],
	existing: ExistingRef[],
): { idMap: Record<number, number>; newRefs: ResolvedRef[] } {
	const maxStart = existing.reduce((m, e) => Math.max(m, e.id), 0);
	let maxExisting = maxStart;

	const existingByUrl = buildExistingByUrl(existing);
	const seenInPaste: Record<string, number> = {};
	const idMap: Record<number, number> = {};
	const newRefs: ResolvedRef[] = [];

	for (const ref of incoming) {
		if (idMap[ref.incomingId] !== undefined) continue; // already mapped

		const norm = normalizeUrl(ref.url);
		const firstInPaste = seenInPaste[norm];

		if (firstInPaste !== undefined) {
			// Duplicate URL in paste: re-use the id already assigned to the
			// first occurrence.
			idMap[ref.incomingId] = idMap[firstInPaste];
			continue;
		}

		// Record this incomingId as the first to claim this normalised URL.
		seenInPaste[norm] = ref.incomingId;

		const existingId = existingByUrl[norm];
		if (existingId !== undefined) {
			// URL already known in the note: re-use the existing id.
			idMap[ref.incomingId] = existingId;
		} else {
			// Genuinely new: assign the next sequential id.
			const newId = ++maxExisting;
			idMap[ref.incomingId] = newId;
			newRefs.push({ ...ref, id: newId });
		}
	}

	return { idMap, newRefs };
}

// ---------------------------------------------------------------------------
// countFootnoteDefs — count distinct footnote definition ids in an EditPlan
// ---------------------------------------------------------------------------

/**
 * Count the number of DISTINCT footnote definition ids across all inserts in a plan.
 *
 * A footnote definition line matches /^\[\^(\d+)\]:/m — it must appear at the
 * start of a line (multiline mode).  Inline references like "[^1]" that do not
 * have a trailing colon are NOT counted.
 *
 * Returns the number of distinct ids (via a Set), so a [^n]: definition appearing
 * in multiple edits is counted only once.
 *
 * Typical use: after a script run, call countFootnoteDefs(outcome.plan) to produce
 * a user-facing "N footnotes filed" notice rather than reporting raw edit count.
 */
export function countFootnoteDefs(plan: EditPlan): number {
	const seen = new Set<string>();
	const re = /^\[\^(\d+)\]:/gm;
	for (const edit of plan) {
		let m: RegExpExecArray | null;
		re.lastIndex = 0;
		while ((m = re.exec(edit.insert)) !== null) {
			seen.add(m[1]);
		}
	}
	return seen.size;
}

/** Build a normalizedUrl → id lookup from the existing refs. */
function buildExistingByUrl(existing: ExistingRef[]): Record<string, number> {
	const map: Record<string, number> = {};
	for (const e of existing) {
		map[normalizeUrl(e.url)] = e.id;
	}
	return map;
}

// ---------------------------------------------------------------------------
// scanExistingRefs — reverse-parse F4 two-line definitions in the note doc
// ---------------------------------------------------------------------------

/**
 * Scan a note document for existing F4 two-line footnote definitions and
 * return their numeric ids and urls as ExistingRef[].
 *
 * F4 two-line format (produced by formatF4Def):
 *   line 1: "[^{id}]: {snippet}"   — id must be numeric; alpha defs are skipped
 *   line 2: "[{title}]({url})"     — markdown link carrying the url
 *
 * Tolerant recovery: a numeric [^n]: def whose following line is not a parseable
 * markdown link still contributes an ExistingRef with url="" so its id raises
 * maxExisting and new paste ids never collide with it.
 *
 * Empty doc / no defs → [].
 *
 * Note: the same scanner could later serve the whole-note ctx.doc registry
 * (registry.ts TODO(Phase 4)) — that is a separate concern left for future work.
 */
export function scanExistingRefs(doc: string): ExistingRef[] {
	const refs: ExistingRef[] = [];
	const lines = doc.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const id = parseNumericDefLine(lines[i]);
		if (id === null) continue;

		const url = parseUrlLine(lines[i + 1]);
		refs.push({ id, url });
	}

	return refs;
}

/** Match "[^{digits}]: ..." and return the numeric id, or null if not matched. */
function parseNumericDefLine(line: string): number | null {
	const m = /^\[\^(\d+)\]:/.exec(line);
	if (!m) return null;
	return Number(m[1]);
}

/** Match "[{title}]({url})" and return the url, or "" if not parseable. */
function parseUrlLine(line: string | undefined): string {
	if (!line) return "";
	const m = /^\[[^\]]*\]\(([^)]+)\)/.exec(line);
	return m ? m[1] : "";
}

// ---------------------------------------------------------------------------
// applyFootnoteInlineRename
// ---------------------------------------------------------------------------

/**
 * Produce an EditPlan that rewrites [^n] inline markers in body according to
 * idMap.  Offsets are vs the ORIGINAL body string (ADR-1).
 *
 * Only markers whose numeric n appears as a key in idMap are rewritten.
 * Markers are matched by /\[\^(\d+)\]/g; alpha markers ([^A]) are not matched
 * and are left untouched.
 *
 * @param body Prose-only content; must NOT contain definition lines ("[^n]:"). Pass ParseResult.body, not full doc text.
 */
export function applyFootnoteInlineRename(
	body: string,
	idMap: Record<number, number>,
): EditPlan {
	const plan: EditPlan = [];
	const re = /\[\^(\d+)\]/g;
	let m: RegExpExecArray | null;

	while ((m = re.exec(body)) !== null) {
		const n = Number(m[1]);
		const newId = idMap[n];
		if (newId === undefined) continue;
		plan.push({
			from: m.index,
			to: m.index + m[0].length,
			insert: `[^${newId}]`,
		});
	}

	return plan;
}

// ---------------------------------------------------------------------------
// formatF4Def — canonical F4 two-line definition formatter
// ---------------------------------------------------------------------------

/**
 * Produce the canonical F4 two-line footnote definition for a single ref.
 *
 * Format (F4.1):
 *   "[^{id}]: {snippet}"   ← line 1: anchor + snippet
 *   "[{title}]({url})"     ← line 2: markdown link
 *
 * This is the single canonical source of F4 format in core.
 * newRefDefinitions delegates here; callers that need F4 defs for
 * moveToResources should map their ResolvedRef[] through this function.
 */
export function formatF4Def(ref: { id: number; snippet: string; title: string; url: string }): string {
	return `[^${ref.id}]: ${ref.snippet}\n[${ref.title}](${ref.url})`;
}

// ---------------------------------------------------------------------------
// formatFootnoteLink — single-line compact definition formatter
// ---------------------------------------------------------------------------

/**
 * Produce a single-line compact footnote definition for web and web-download refs.
 *
 * Format: "[^{id}]: [{title}]({url})"
 *
 * Used by web/download scripts where the snippet would duplicate the link.
 * The app parser uses the two-line formatF4Def instead.
 */
export function formatFootnoteLink(ref: { id: number; title: string; url: string }): string {
	return `[^${ref.id}]: [${ref.title}](${ref.url})`;
}

// ---------------------------------------------------------------------------
// compactRefDefinitions — single-line formatter for web/download refs
// ---------------------------------------------------------------------------

/**
 * Format single-line compact definition strings for genuinely new refs.
 *
 * Delegates to formatFootnoteLink.  Mirrors newRefDefinitions but produces
 * compact single-line defs: "[^{id}]: [{title}]({url})" — no snippet line.
 *
 * Used by perplexityWeb and perplexityWebDownload scripts.
 * perplexityApp continues to use newRefDefinitions (two-line F4).
 */
export function compactRefDefinitions(newRefs: ResolvedRef[]): string[] {
	return newRefs.map(formatFootnoteLink);
}

// ---------------------------------------------------------------------------
// newRefDefinitions
// ---------------------------------------------------------------------------

/**
 * Format definition lines for genuinely new refs.
 *
 * Delegates to formatF4Def — the canonical F4 two-line formatter — so there
 * is exactly one place in core that produces the F4 format.
 *
 * Output format per ref (F4.1):
 *   "[^{id}]: {snippet}"
 *   "[{title}]({url})"
 *
 * T2.5 (M / move-to-Resources) consumes this output and is responsible for
 * locating or creating the "## Resources" section and inserting the lines.
 * T2.4 deliberately stops here — it produces the content, not the placement.
 */
export function newRefDefinitions(newRefs: ResolvedRef[]): string[] {
	return newRefs.map(formatF4Def);
}

// ---------------------------------------------------------------------------
// fromCitations — T2.5 (C) Citation→Footnote inline rewrite
// ---------------------------------------------------------------------------

/**
 * Produce an EditPlan that rewrites inline citation markers [n] → [^n] in
 * parseResult.body.  Only markers listed in parseResult.inline are targeted;
 * alpha markers (InlineMarker.n is a number so alpha is structurally excluded)
 * and any numeric markers NOT in inline are left untouched.
 *
 * Strategy: scan body for occurrences of each distinct [n] pattern (one regex
 * per unique n), in left-to-right order, yielding one Edit per match.  The
 * inline array may list the same n multiple times (one entry per occurrence),
 * so produce exactly as many edits as inline entries for each n.
 *
 * Offsets vs ORIGINAL body string (ADR-1).
 */
export function fromCitations(parseResult: ParseResult): EditPlan {
	if (parseResult.inline.length === 0) return [];

	// Count how many edits we need for each n value, per inline entries.
	const targetCount = countTargets(parseResult.inline);
	const plan: EditPlan = [];

	for (const [n, count] of Object.entries(targetCount)) {
		const numeric = Number(n);
		const re = new RegExp(`\\[${numeric}\\](?!\\()`, "g");
		let m: RegExpExecArray | null;
		let found = 0;

		while ((m = re.exec(parseResult.body)) !== null && found < count) {
			plan.push({
				from: m.index,
				to: m.index + m[0].length,
				insert: `[^${numeric}]`,
			});
			found++;
		}
	}

	// Sort edits by offset ascending (consistent output order).
	return plan.sort((a, b) => a.from - b.from);
}

/** Count occurrences of each n in the inline marker list. */
function countTargets(inline: InlineMarker[]): Record<number, number> {
	const counts: Record<number, number> = {};
	for (const marker of inline) {
		counts[marker.n] = (counts[marker.n] ?? 0) + 1;
	}
	return counts;
}

// ---------------------------------------------------------------------------
// moveToResources — T2.5 (M) definition placement
// ---------------------------------------------------------------------------

/**
 * Produce an EditPlan that places pre-formatted definition strings into the
 * note's Resources section.  Offsets vs ORIGINAL ctx.doc (ADR-1).
 *
 * defs format (F4 two-line spec, caller's responsibility to build):
 *   "[^n]: snippet"
 *   "[title](url)"
 *
 * Behaviour:
 *   - Empty defs → return [] (no section created — F4.5).
 *   - Section "## <resourcesName>" found → insert defs after the section's
 *     existing content, before the next "## " heading or EOF.
 *   - Section absent → insert "\n## <name>\n\n<defs>" at note end (F4.2).
 *   - Orphaned lines inside an existing section are never touched (F4.3).
 *   - All edits are inserts (from === to), never replacements.
 */
export function moveToResources(ctx: OperationContext, defs: string[]): EditPlan {
	if (defs.length === 0) return [];

	const { doc, settings } = ctx;
	const headingLine = `## ${settings.resourcesName}`;
	const insertOffset = findSectionInsertOffset(doc, headingLine);

	if (insertOffset === null) {
		return [buildNoteEndInsert(doc, headingLine, defs)];
	}

	return [buildSectionAppend(insertOffset, defs)];
}

/**
 * Find the offset in doc at which to insert new defs inside an existing
 * "## <headingLine>" section.  The insertion point is just before the next
 * "## " heading (or EOF if the section runs to the end).
 *
 * Only top-level "## " headings terminate the section scan.  Sub-headings
 * (###, ####, …) inside the Resources section are valid content and do not
 * stop the scan.
 *
 * Returns null if the heading is not found.
 */
function findSectionInsertOffset(doc: string, headingLine: string): number | null {
	const lines = doc.split("\n");
	let inSection = false;
	let offset = 0;
	let sectionEndOffset: number | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (!inSection) {
			if (line === headingLine) {
				inSection = true;
			}
			offset += line.length + 1; // +1 for the newline
			continue;
		}

		// We are inside the section.  Stop when we hit the next ## heading.
		if (line.startsWith("## ")) {
			// Insert just before this heading (after the preceding newline).
			sectionEndOffset = offset;
			break;
		}

		offset += line.length + 1;
		sectionEndOffset = offset; // tentative: end of current line
	}

	if (!inSection) return null;

	// sectionEndOffset is set to the accumulated offset at the end of the section.
	// We want to insert at the end of the section content (offset points to after
	// the last character of the last line in the section, or before the next ##).
	// Clamp to doc.length to guard against the trailing-newline off-by-one where
	// split("\n") yields a final empty element and offset overshoots by 1 (ADR-1).
	return Math.min(sectionEndOffset!, doc.length);
}

/** Build an insert Edit that appends defs at the given offset within the section. */
function buildSectionAppend(offset: number, defs: string[]): Edit {
	// Use "\n\n" between defs when they are two-line (contain an internal newline),
	// otherwise use "\n" so single-line defs are consecutive with no blank line.
	// Note: a mixed batch (some defs with an internal newline, some without) is not
	// produced by any current caller — all defs in a batch share the same format.
	// If that changes, the separator must be computed per adjacent pair rather than
	// once per batch (i.e. sep(defs[i], defs[i+1]) based on whether defs[i] has "\n").
	const sep = defs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
	// Trailing "\n" ensures the next "## Heading" starts on its own line (Bug 1 fix).
	const content = "\n" + defs.join(sep) + "\n";
	return { from: offset, to: offset, insert: content };
}

/** Build an insert Edit that creates a new section at note end. */
function buildNoteEndInsert(doc: string, headingLine: string, defs: string[]): Edit {
	// Use "\n\n" between defs when they are two-line (contain an internal newline),
	// otherwise use "\n" so single-line defs are consecutive with no blank line.
	// Note: a mixed batch (some defs with an internal newline, some without) is not
	// produced by any current caller — all defs in a batch share the same format.
	// If that changes, the separator must be computed per adjacent pair rather than
	// once per batch (i.e. sep(defs[i], defs[i+1]) based on whether defs[i] has "\n").
	const sep = defs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
	const content = `\n${headingLine}\n\n${defs.join(sep)}`;
	return { from: doc.length, to: doc.length, insert: content };
}
