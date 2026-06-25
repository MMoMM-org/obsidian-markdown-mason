import { describe, it, expect } from "vitest";
import type { Editor, EditorPosition, EditorSelection } from "obsidian";
import { selectionContext } from "../../src/sources/selection";
import type { MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// T3.3 selectionContext adapter
//
// Behaviour under test:
//   1. Returns an OperationContext with doc = full editor text.
//   2. Returns selection offsets (from, to) derived via posToOffset.
//   3. Returns input = the selected substring.
//   4. Returns cursor = the selection HEAD offset.
//   5. Settings are passed through unchanged.
//   6. Empty/collapsed selection: selection.from === to, input = "".
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock Editor factory
//
// posToOffset converts an EditorPosition (line/ch) to a flat offset by
// scanning the doc text line by line — consistent with the stored content.
// ---------------------------------------------------------------------------

const DOC = "Hello, world!\nSecond line here.\nThird line.";
// Offsets:
//   line 0: "Hello, world!\n"  → chars 0-13 (14 chars incl. \n)
//   line 1: "Second line here.\n" → chars 14-31 (18 chars incl. \n)
//   line 2: "Third line."       → chars 32-42

function makeEditor(doc: string, selection: EditorSelection): Editor {
	const lines = doc.split("\n");

	function posToOffset(pos: EditorPosition): number {
		let offset = 0;
		for (let i = 0; i < pos.line; i++) {
			offset += lines[i]!.length + 1; // +1 for \n
		}
		return offset + pos.ch;
	}

	return {
		getValue: () => doc,
		getSelection: () => {
			const fromOffset = posToOffset(selection.anchor);
			const toOffset = posToOffset(selection.head);
			// Return substring between the two offsets (anchor may be > head)
			const start = Math.min(fromOffset, toOffset);
			const end = Math.max(fromOffset, toOffset);
			return doc.slice(start, end);
		},
		listSelections: () => [selection],
		getCursor: (side?: "from" | "to" | "head" | "anchor") => {
			if (side === "from" || side === "anchor") return selection.anchor;
			return selection.head; // "to", "head", or undefined → head
		},
		posToOffset,
		// Satisfy abstract interface — unused by the adapter
		refresh: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lines.length - 1,
		somethingSelected: () => {
			const a = posToOffset(selection.anchor);
			const h = posToOffset(selection.head);
			return a !== h;
		},
		getRange: (from: EditorPosition, to: EditorPosition) =>
			doc.slice(posToOffset(from), posToOffset(to)),
		replaceSelection: () => undefined,
		replaceRange: () => undefined,
		setCursor: () => undefined,
		setSelection: () => undefined,
		setSelections: () => undefined,
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
				const len = lines[i]!.length + 1;
				if (remaining < len) {
					return { line: i, ch: remaining };
				}
				remaining -= len;
			}
			return { line: lines.length - 1, ch: lines[lines.length - 1]!.length };
		},
		processLines: () => undefined,
		getDoc: function () { return this as unknown as typeof this; },
		setLine: () => undefined,
	} as unknown as Editor;
}

const SETTINGS: MasonSettings = { debugLogging: false, resourcesName: "Resources" };

// ---------------------------------------------------------------------------
// Active selection (anchor before head — left-to-right selection)
// ---------------------------------------------------------------------------

describe("selectionContext — active selection (anchor < head)", () => {
	// Select "world" at line 0, chars 7-12 (offset 7 to 12)
	const sel: EditorSelection = {
		anchor: { line: 0, ch: 7 },
		head:   { line: 0, ch: 12 },
	};
	const editor = makeEditor(DOC, sel);

	it("doc is the full editor text", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.doc).toBe(DOC);
	});

	it("selection.from and .to are offsets via posToOffset", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.selection).toEqual({ from: 7, to: 12 });
	});

	it("input is the selected substring", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.input).toBe("world");
	});

	it("cursor is the HEAD offset (12)", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.cursor).toBe(12);
	});

	it("settings are passed through unchanged", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.settings).toBe(SETTINGS);
	});
});

// ---------------------------------------------------------------------------
// Active selection (head before anchor — right-to-left selection)
// ---------------------------------------------------------------------------

describe("selectionContext — active selection (head < anchor)", () => {
	// Reverse selection: head at line 1 ch 0 (offset 14), anchor at line 1 ch 6 (offset 20)
	const sel: EditorSelection = {
		anchor: { line: 1, ch: 6 },
		head:   { line: 1, ch: 0 },
	};
	const editor = makeEditor(DOC, sel);

	it("selection.from is the smaller offset", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.selection).toEqual({ from: 14, to: 20 });
	});

	it("cursor is the HEAD offset (14, not 20)", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.cursor).toBe(14);
	});

	it("input is the selected substring (from < to slice)", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.input).toBe("Second");
	});
});

// ---------------------------------------------------------------------------
// Collapsed / empty selection (cursor with no selection)
// ---------------------------------------------------------------------------

describe("selectionContext — collapsed (empty) selection", () => {
	// Cursor at line 2 ch 0 (offset 32), no text selected
	const sel: EditorSelection = {
		anchor: { line: 2, ch: 0 },
		head:   { line: 2, ch: 0 },
	};
	const editor = makeEditor(DOC, sel);

	it("selection.from === selection.to", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.selection?.from).toBe(32);
		expect(ctx.selection?.to).toBe(32);
	});

	it("input is an empty string", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.input).toBe("");
	});

	it("cursor equals the collapsed offset", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.cursor).toBe(32);
	});
});

// ---------------------------------------------------------------------------
// Multi-line selection
// ---------------------------------------------------------------------------

describe("selectionContext — multi-line selection", () => {
	// Select from line 0 ch 7 (offset 7) to line 1 ch 6 (offset 20)
	const sel: EditorSelection = {
		anchor: { line: 0, ch: 7 },
		head:   { line: 1, ch: 6 },
	};
	const editor = makeEditor(DOC, sel);

	it("selection spans both lines correctly", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.selection).toEqual({ from: 7, to: 20 });
	});

	it("input is the text from offset 7 to 20", () => {
		const ctx = selectionContext(editor, SETTINGS);
		expect(ctx.input).toBe(DOC.slice(7, 20));
	});
});

// ---------------------------------------------------------------------------
// Degenerate editor — listSelections() returns empty array (W1 guard)
// ---------------------------------------------------------------------------

describe("selectionContext — no selections (defensive guard)", () => {
	const editor = {
		getValue: () => DOC,
		listSelections: () => [] as EditorSelection[],
	} as unknown as Editor;

	it("throws with a message containing 'no selections'", () => {
		expect(() => selectionContext(editor, SETTINGS)).toThrow(/no selections/);
	});
});
