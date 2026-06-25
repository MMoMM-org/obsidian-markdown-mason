// Adapter: build an OperationContext from an Obsidian Editor for a paste operation.
//
// PASTE MODEL
// -----------
// Unlike selection.ts (which reads selected text as the operation input), the
// paste adapter treats the CLIPBOARD TEXT as the operation input. The document
// (ctx.doc) is the current note text — unchanged by the paste; the script decides
// where and how to insert the clipboard content via its returned EditPlan.
//
// Field semantics:
//   doc    — editor.getValue(): the full current note text (before paste)
//   cursor — posToOffset(getCursor()): the insertion point (caret position)
//   input  — clipboardText: the raw clipboard payload (what the user copied)
//   selection — NOT set: paste has no prior selection range
//   settings — passed through from the caller
//
// CURSOR CONVENTION
// -----------------
// cursor = posToOffset(getCursor()) is the natural caret position — wherever
// the editor had focus when the paste command was invoked. Scripts use this as
// the insertion point when building their EditPlan (typically {from:cursor,
// to:cursor, insert:<formatted content>}).
//
// PURE-ISH ADAPTER
// ----------------
// This module imports only the obsidian Editor type (no runtime Obsidian calls).
// The clipboardText is supplied by the caller (main.ts reads it from
// navigator.clipboard.readText() and passes it in). This keeps pasteContext
// unit-testable without a clipboard or Obsidian environment.

import type { Editor } from "obsidian";
import type { MasonSettings, OperationContext } from "../core/types";

/**
 * Build an OperationContext for a paste operation.
 *
 * @param editor        — the active Obsidian Editor
 * @param settings      — current plugin settings
 * @param clipboardText — the raw text read from the clipboard (the paste payload)
 * @returns OperationContext with doc=full note, cursor=insertion point, input=clipboard
 */
export function pasteContext(
	editor: Editor,
	settings: MasonSettings,
	clipboardText: string,
): OperationContext {
	const doc = editor.getValue();
	const cursor = editor.posToOffset(editor.getCursor());

	return {
		doc,
		cursor,
		// No selection: paste operates on the cursor insertion point, not a selection range.
		input: clipboardText,
		settings,
	};
}
