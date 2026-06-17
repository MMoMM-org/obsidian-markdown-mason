// Adapter: build an OperationContext from an Obsidian Editor selection.
//
// This is a thin converter — it reads Obsidian Editor state and produces a
// pure OperationContext for the operation layer. No editing happens here.
//
// Cursor convention: the HEAD of the selection (where the caret visually sits).
// For a left-to-right selection anchor < head, so head is the right edge.
// For a right-to-left selection head < anchor, so head is the left edge.
// Either way, `cursor` = posToOffset(selection.head) — the natural caret.
//
// selection.from / selection.to: always expressed as (min, max) offsets so
// downstream code can reliably slice doc[from:to] without order concerns.

import type { Editor } from "obsidian";
import type { MasonSettings, OperationContext } from "../core/types";

export function selectionContext(
	editor: Editor,
	settings: MasonSettings,
): OperationContext {
	const doc = editor.getValue();
	const [sel] = editor.listSelections();
	if (!sel) {
		throw new Error("selectionContext: editor has no selections");
	}
	const anchorOffset = editor.posToOffset(sel.anchor);
	const headOffset = editor.posToOffset(sel.head);

	const from = Math.min(anchorOffset, headOffset);
	const to = Math.max(anchorOffset, headOffset);
	const input = doc.slice(from, to);

	return {
		doc,
		cursor: headOffset,
		selection: { from, to },
		input,
		settings,
	};
}
