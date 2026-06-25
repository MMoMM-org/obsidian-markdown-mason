// Adapter: build an OperationContext for a whole-note operation.
//
// TOCTOU mitigation (SDD Building Block View, Implementation Gotcha):
//   vault.process / vault.read operate on the saved file on disk. When the
//   note is open in an editor the in-memory text may differ from the file —
//   the user may have unsaved edits. Reading from the vault in that state
//   risks a time-of-check / time-of-use inconsistency where we operate on
//   stale content while the editor holds the true current state. Therefore:
//     • When an editor is present  → read from editor.getValue()  (live text)
//     • When no editor is present  → read from vault.read(file)   (disk text)
//
// Cursor convention: 0 (start of document). Whole-note operations replace or
// restructure the entire document; there is no meaningful "insertion point",
// so we anchor to the start and let apply.ts place the cursor after the edit.
//
// No selection is set: whole-note context has no partial selection range.
// input = the full document text (whole-note source payload).

import type { Editor, TFile, Vault } from "obsidian";
import type { MasonSettings, OperationContext } from "../core/types";

export interface NoteContextOptions {
	editor: Editor | undefined;
	vault: Vault;
	file: TFile;
	settings: MasonSettings;
}

export async function noteContext(opts: NoteContextOptions): Promise<OperationContext> {
	const { editor, vault, file, settings } = opts;

	// Prefer the editor path to avoid TOCTOU vs. an open editor (SDD gotcha).
	const doc = editor !== undefined
		? editor.getValue()
		: await vault.read(file);

	return {
		doc,
		cursor: 0,
		input: doc,
		settings,
	};
}
