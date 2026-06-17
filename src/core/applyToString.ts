// No obsidian import — pure utility; unit-testable without Obsidian.

import type { EditPlan } from "./types";

/**
 * Apply an EditPlan to a document string and return the resulting string.
 *
 * Each Edit carries offsets against the ORIGINAL document (ADR-1), so edits
 * are independent of one another.  Applying them right-to-left (descending
 * `from`) ensures that higher-offset edits do not shift the offsets of
 * lower-offset edits, avoiding offset-drift.
 *
 * Tie-breaking for equal `from` offsets: edits sharing the same `from` are
 * applied in REVERSE plan order (highest original-index first in RTL), so the
 * first edit in the plan appears first in the output.  This ensures that, for
 * example, a body insert followed by a Resources insert at the same position
 * produces "body + resources" in the output (not "resources + body").
 *
 * Algorithm:
 *   1. Tag each edit with its original plan index.
 *   2. Sort by `from` descending; ties broken by original index descending.
 *   3. Apply each edit left-to-right in the sorted list, splicing against the
 *      accumulated result string.
 *   4. Return the final string.
 *
 * @param doc  The original document text.
 * @param plan An ordered set of Edits; may be empty (returns doc unchanged).
 * @returns    The transformed document string.
 */
export function applyToString(doc: string, plan: EditPlan): string {
	if (plan.length === 0) return doc;

	// Tag with original index for stable tie-breaking.
	const tagged = plan.map((edit, i) => ({ edit, i }));

	// Sort: descending `from`; ties broken by descending original index
	// (last edit in plan is processed first → appears earlier in output).
	tagged.sort((a, b) => {
		const byFrom = b.edit.from - a.edit.from;
		if (byFrom !== 0) return byFrom;
		return b.i - a.i;
	});

	let result = doc;
	for (const { edit } of tagged) {
		result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
	}

	return result;
}
