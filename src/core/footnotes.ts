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
// newRefDefinitions(newRefs) → string[]
//   Returns formatted definition strings "[^id]: Title\n    URL" for each
//   genuinely new ref.  T2.5 (M) will place these into the Resources section.
//   This is the clean seam: T2.4 owns identity + inline rewrite + def content;
//   T2.5 owns section placement (locating/creating "## Resources" and inserting).
//
// idMap representation: Record<number, number>
//   Chosen over Map<number,number> because:
//     - Direct bracket-notation access (idMap[n]) is more ergonomic in TS
//       and consistent with how the EditPlan consumer iterates markers.
//     - JSON-serialisable without conversion (easier to pass across seams).
//     - No iteration-order ambiguity for the small cardinality of footnote maps.

import type { EditPlan, FootnoteRef, ExistingRef } from "./types";
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

/** Build a normalizedUrl → id lookup from the existing refs. */
function buildExistingByUrl(existing: ExistingRef[]): Record<string, number> {
	const map: Record<string, number> = {};
	for (const e of existing) {
		map[normalizeUrl(e.url)] = e.id;
	}
	return map;
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
// newRefDefinitions
// ---------------------------------------------------------------------------

/**
 * Format definition lines for genuinely new refs.
 *
 * Output format per ref:
 *   "[^{id}]: {title}\n    {url}"
 *
 * This two-line format is the standard Markdown Mason Resources entry.
 * T2.5 (M / move-to-Resources) consumes this output and is responsible for
 * locating or creating the "## Resources" section and inserting the lines.
 * T2.4 deliberately stops here — it produces the content, not the placement.
 */
export function newRefDefinitions(newRefs: ResolvedRef[]): string[] {
	return newRefs.map((ref) => `[^${ref.id}]: ${ref.title}\n    ${ref.url}`);
}
