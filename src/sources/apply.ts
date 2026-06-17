// Adapter: apply an EditPlan to an Obsidian Editor via its internal CM6 view.
//
// This is the ONLY module that reaches into `editor.cm`. All offsets in an
// EditPlan are expressed against the ORIGINAL document (ADR-1). CM6 accepts
// a sorted array of non-overlapping changes and applies them atomically in a
// single transaction, so we sort by `from` ascending and dispatch once.
//
// Cursor decision: after the transaction the cursor is placed at the mapped
// end of the FIRST edit's insertion — `sorted[0].from + sorted[0].insert.length`.
// This is the position in the new document immediately after the primary
// (body) text has been inserted, which is the natural place for the editor
// to resume input. Because this is the lowest-`from` edit, no prior change
// in the same changeset shifts it, so the arithmetic is exact without
// additional mapPos calls.
//
// CM6 change ordering: CM6 requires changes sorted by position (ascending)
// when passed as an array. We sort by `from` ascending here; we do NOT adjust
// the `to` offsets — all offsets remain relative to the original document and
// CM6 handles the atomic mapping internally.

import type { Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import type { EditPlan } from "../core/types";

export function applyEditPlan(editor: Editor, plan: EditPlan): void {
	if (plan.length === 0) {
		return;
	}

	const view = (editor as unknown as { cm: EditorView }).cm;

	// Sort by from ascending — CM6 requires this ordering.
	const sorted = [...plan].sort((a, b) => a.from - b.from);

	// Map to CM6 change specs; all from/to are vs the original document.
	const changes = sorted.map(({ from, to, insert }) => ({ from, to, insert }));

	// Place cursor at the end of the first (body) edit's insertion in the new doc.
	// sorted[0].from is unchanged by prior changes (it is the lowest offset),
	// so from + insert.length is the exact position after the inserted text.
	const firstEdit = sorted[0];
	const cursorPos = firstEdit.from + firstEdit.insert.length;

	view.dispatch({
		changes,
		selection: EditorSelection.cursor(cursorPos),
	});
}
