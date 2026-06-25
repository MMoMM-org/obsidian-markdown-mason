// T5.5A  pasteContext adapter — unit tests
//
// Mirrors selection.test.ts but for the paste OperationContext builder.
// Behaviour under test:
//   1. doc = editor.getValue() (full document)
//   2. cursor = posToOffset(getCursor()) — the insertion point
//   3. input = clipboardText (the paste payload, NOT a selection)
//   4. no selection property is set (paste has no selection range)
//   5. settings passed through unchanged
//
// The adapter is pure-ish: imports only the obsidian Editor type, no Obsidian runtime.

import { describe, it, expect } from "vitest";
import type { Editor, EditorPosition } from "obsidian";
import { pasteContext } from "../../src/sources/paste";
import type { MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Mock Editor factory — minimal surface needed by pasteContext
// ---------------------------------------------------------------------------

function makeEditor(doc: string, cursorPos: EditorPosition): Editor {
	const lines = doc.split("\n");

	function posToOffset(pos: EditorPosition): number {
		let offset = 0;
		for (let i = 0; i < pos.line; i++) {
			offset += (lines[i]?.length ?? 0) + 1;
		}
		return offset + pos.ch;
	}

	return {
		getValue: () => doc,
		getCursor: () => cursorPos,
		posToOffset,
		// Unused stubs required to satisfy the Editor type
		getSelection: () => "",
		listSelections: () => [{ anchor: cursorPos, head: cursorPos }],
		replaceSelection: () => undefined,
		replaceRange: () => undefined,
		setCursor: () => undefined,
		setSelection: () => undefined,
		setSelections: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lines.length - 1,
		somethingSelected: () => false,
		getRange: (from: EditorPosition, to: EditorPosition) =>
			doc.slice(posToOffset(from), posToOffset(to)),
		refresh: () => undefined,
		focus: () => undefined,
		blur: () => undefined,
		hasFocus: () => false,
		getScrollInfo: () => ({ top: 0, left: 0 }),
		scrollTo: () => undefined,
		scrollIntoView: () => undefined,
		undo: () => undefined,
		redo: () => undefined,
		exec: () => undefined,
		transaction: () => undefined,
		wordAt: () => null,
		offsetToPos: (offset: number) => {
			let remaining = offset;
			for (let i = 0; i < lines.length; i++) {
				const len = (lines[i]?.length ?? 0) + 1;
				if (remaining < len) return { line: i, ch: remaining };
				remaining -= len;
			}
			return { line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 };
		},
		processLines: () => undefined,
		getDoc: function () { return this as unknown as typeof this; },
		setLine: () => undefined,
	} as unknown as Editor;
}

const SETTINGS: MasonSettings = { debugLogging: false, resourcesName: "Resources" };

const DOC = "# Title\n\nSome existing content.\n";
// Offsets:
//   line 0: "# Title\n"                → 8 chars (0-7)
//   line 1: "\n"                        → 1 char  (8)
//   line 2: "Some existing content.\n"  → 23 chars (9-31)
// End of doc = offset 32

// ---------------------------------------------------------------------------
// pasteContext — cursor at end of document (typical paste point)
// ---------------------------------------------------------------------------

describe("pasteContext — cursor at end of document", () => {
	const cursorAtEnd: EditorPosition = { line: 2, ch: 22 }; // end of last content line
	const editor = makeEditor(DOC, cursorAtEnd);
	const clipboardText = "## Pasted heading\n\nPasted content.\n";

	it("doc is the full editor text (not the clipboard text)", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		expect(ctx.doc).toBe(DOC);
	});

	it("input is the clipboard text", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		expect(ctx.input).toBe(clipboardText);
	});

	it("cursor is posToOffset(getCursor()) — the insertion offset", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		// line 2, ch 22 → 8 + 1 + 22 = 31
		expect(ctx.cursor).toBe(31);
	});

	it("no selection property is set (paste has no selection range)", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		expect(ctx.selection).toBeUndefined();
	});

	it("settings are passed through unchanged", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		expect(ctx.settings).toBe(SETTINGS);
	});
});

// ---------------------------------------------------------------------------
// pasteContext — cursor at start of document
// ---------------------------------------------------------------------------

describe("pasteContext — cursor at start of document", () => {
	const cursorAtStart: EditorPosition = { line: 0, ch: 0 };
	const editor = makeEditor(DOC, cursorAtStart);
	const clipboardText = "Inserted at top.\n";

	it("cursor is 0 when caret is at the start", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		expect(ctx.cursor).toBe(0);
	});

	it("input is the clipboard text regardless of cursor position", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		expect(ctx.input).toBe(clipboardText);
	});
});

// ---------------------------------------------------------------------------
// pasteContext — cursor mid-document (inline paste)
// ---------------------------------------------------------------------------

describe("pasteContext — cursor in the middle of the document", () => {
	// Cursor at line 1 ch 0 (the blank line between title and content = offset 9)
	const cursorMid: EditorPosition = { line: 1, ch: 0 };
	const editor = makeEditor(DOC, cursorMid);
	const clipboardText = "Middle paste.\n";

	it("cursor reflects the mid-document insertion point", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		// line 1 ch 0 → 8 + 0 = 8
		expect(ctx.cursor).toBe(8);
	});

	it("doc is always the full document regardless of cursor", () => {
		const ctx = pasteContext(editor, SETTINGS, clipboardText);
		expect(ctx.doc).toBe(DOC);
	});
});

// ---------------------------------------------------------------------------
// pasteContext — empty clipboard (guard: no crash on empty input)
// ---------------------------------------------------------------------------

describe("pasteContext — empty clipboard text", () => {
	const cursor: EditorPosition = { line: 0, ch: 0 };
	const editor = makeEditor(DOC, cursor);

	it("input is empty string when clipboard is empty", () => {
		const ctx = pasteContext(editor, SETTINGS, "");
		expect(ctx.input).toBe("");
	});

	it("doc is still the full document", () => {
		const ctx = pasteContext(editor, SETTINGS, "");
		expect(ctx.doc).toBe(DOC);
	});
});
