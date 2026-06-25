// Shared helper for web and web-download scripts.
// No obsidian import — pure utility.

import type { EditPlan, FootnoteRef, InlineMarker } from "../../src/core/types";
import { applyToString } from "../../src/core/applyToString";

/**
 * Filter sources to those whose incomingId appears at least once in the
 * inline marker list.  Sources that are listed in the Sources block (or
 * produced by the parser) but never cited in prose are excluded so they
 * don't produce orphan footnote defs in the Resources section.
 */
export function filterCitedSources(sources: FootnoteRef[], inline: InlineMarker[]): FootnoteRef[] {
	const citedIds = new Set(inline.map((m) => m.n));
	return sources.filter((s) => citedIds.has(s.incomingId));
}

/**
 * Replace each InlineMarker.marker string in body with `[^n]` where n is the
 * marker's sequential number.
 *
 * Handles multiple occurrences of the same marker string correctly by scanning
 * the body for each distinct marker and collecting ALL its occurrence offsets
 * left-to-right, then distributing them to the InlineMarker entries for that
 * marker (which also appear in left-to-right document order).
 *
 * Uses applyToString for the final splice (right-to-left application avoids
 * offset drift from earlier replacements).
 *
 * @param body   The prose string to transform.
 * @param inline InlineMarker array (in document order).
 * @returns      The transformed body with marker strings replaced by [^n].
 */
export function replaceMarkersInBody(body: string, inline: InlineMarker[]): string {
	if (inline.length === 0) return body;

	// Group InlineMarker entries by marker string, preserving document order
	// within each group.
	const byMarker = new Map<string, InlineMarker[]>();
	for (const m of inline) {
		const group = byMarker.get(m.marker);
		if (group) {
			group.push(m);
		} else {
			byMarker.set(m.marker, [m]);
		}
	}

	const plan: EditPlan = [];

	for (const [markerStr, entries] of byMarker) {
		// Find all occurrence offsets of this marker string in body (left-to-right).
		const offsets: number[] = [];
		let searchFrom = 0;
		while (true) {
			const idx = body.indexOf(markerStr, searchFrom);
			if (idx === -1) break;
			offsets.push(idx);
			searchFrom = idx + markerStr.length;
		}

		// Pair each offset with the corresponding InlineMarker entry (same order).
		const count = Math.min(offsets.length, entries.length);
		for (let i = 0; i < count; i++) {
			const offset = offsets[i];
			const entry = entries[i];
			plan.push({
				from: offset,
				to: offset + markerStr.length,
				insert: `[^${entry.n}]`,
			});
		}
	}

	return applyToString(body, plan);
}
