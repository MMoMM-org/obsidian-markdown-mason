import { describe, it, expect } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";
import { applyEditPlan } from "../../src/sources/apply";
import type { EditPlan } from "../../src/core/types";

// ---------------------------------------------------------------------------
// T3.2  applyEditPlan — atomic CM6 transaction
//
// Behaviour under test:
//   1. A two-range EditPlan dispatched in one CM6 transaction — both
//      from/to offsets are against the ORIGINAL document (ADR-1).
//      After dispatch the doc contains both inserts at the correct
//      positions and they did NOT shift each other, proving single-
//      transaction semantics.
//   2. The selection/cursor is placed at the mapped end of the FIRST
//      (body) edit's insert — offset `from + insert.length` mapped
//      through the full changeset.
//   3. One call to @codemirror/commands `undo` reverts the entire
//      EditPlan (PRD F4.4 / F7.1) — proving one atomic transaction
//      = one undo step.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Headless CM6 editor — wraps EditorState so EditorView (DOM) is not needed.
// Exposes { cm: { state, dispatch } } which mirrors the internal field that
// applyEditPlan reaches via `(editor as any).cm`.
// ---------------------------------------------------------------------------

interface HeadlessCm {
	state: EditorState;
	dispatch(...specs: TransactionSpec[]): void;
}

interface HeadlessEditor {
	cm: HeadlessCm;
}

const makeEditor = (doc: string): HeadlessEditor => {
	let currentState = EditorState.create({ doc, extensions: [history()] });

	const cm: HeadlessCm = {
		get state(): EditorState {
			return currentState;
		},
		dispatch(...specs: TransactionSpec[]): void {
			for (const spec of specs) {
				currentState = currentState.update(spec).state;
			}
		},
	};

	return { cm };
};

// ---------------------------------------------------------------------------
// Test document: 201 characters — long enough to have a clear body region
// (around offset 10) and a near-end tail region (around offset 190).
// ---------------------------------------------------------------------------

// prettier-ignore
const DOC =
	"# Note Title\n" +                        // 0–13  (14 chars)
	"\n" +                                     // 14    (1 char)
	"Body content lives here in the note.\n" + // 15–52 (38 chars)
	"\n" +                                     // 53    (1 char)
	"Middle section with some additional text.\n" + // 54–95 (42 chars)
	"\n" +                                     // 96    (1 char)
	"Another paragraph that pads the document.\n" + // 97–139 (43 chars)
	"\n" +                                     // 140   (1 char)
	"Penultimate line to reach target length.\n" + // 141–182 (42 chars)
	"\n" +                                     // 183   (1 char)
	"Z end.";                                  // 184–189 (6 chars) → total 190

// Sanity: confirm offsets before testing.
// DOC.length should be 190; body insert at 10, tail insert at 185.

// ---------------------------------------------------------------------------
// (a) + (b) — two-range plan applies atomically; cursor at mapped body-end
// ---------------------------------------------------------------------------

describe("applyEditPlan — two-range atomic dispatch", () => {
	it("(a) applies both inserts; each appears at the correct original-doc offset", () => {
		const editor = makeEditor(DOC);
		const bodyInsert = "[BODY]";
		const tailInsert = "[TAIL]";

		const plan: EditPlan = [
			{ from: 10, to: 10, insert: bodyInsert },    // body: offset 10 in original
			{ from: 185, to: 185, insert: tailInsert },  // tail: offset 185 in original
		];

		applyEditPlan(editor as never, plan);

		const result = editor.cm.state.doc.toString();

		// Both inserts must be present.
		expect(result).toContain(bodyInsert);
		expect(result).toContain(tailInsert);

		// Body insert lands at original offset 10 — the first 10 chars are unchanged.
		expect(result.slice(0, 10)).toBe(DOC.slice(0, 10));
		expect(result.slice(10, 10 + bodyInsert.length)).toBe(bodyInsert);

		// Tail insert lands at original offset 185 + bodyInsert.length (CM6 maps it
		// through the changeset — offset 185 in original is now at 185 + 6 = 191).
		const tailPos = 185 + bodyInsert.length;
		expect(result.slice(tailPos, tailPos + tailInsert.length)).toBe(tailInsert);

		// Total length must increase by both inserts.
		expect(result.length).toBe(DOC.length + bodyInsert.length + tailInsert.length);
	});

	it("(b) cursor lands at the mapped end of the body insert (from + insert.length)", () => {
		const editor = makeEditor(DOC);
		const bodyInsert = "[BODY]";

		const plan: EditPlan = [
			{ from: 10, to: 10, insert: bodyInsert },
			{ from: 185, to: 185, insert: "[TAIL]" },
		];

		applyEditPlan(editor as never, plan);

		// The cursor (selection anchor = head) should be at offset 10 + 6 = 16.
		const cursor = editor.cm.state.selection.main.head;
		expect(cursor).toBe(10 + bodyInsert.length);
	});
});

// ---------------------------------------------------------------------------
// (c) — one undo reverts the entire EditPlan (atomic transaction = one step)
// ---------------------------------------------------------------------------

describe("applyEditPlan — single undo reverts entire plan (F4.4 / F7.1)", () => {
	it("(c) one undo call restores the original document exactly", () => {
		const editor = makeEditor(DOC);

		const plan: EditPlan = [
			{ from: 10, to: 10, insert: "[BODY]" },
			{ from: 185, to: 185, insert: "[TAIL]" },
		];

		applyEditPlan(editor as never, plan);

		// Confirm the plan was applied.
		expect(editor.cm.state.doc.toString()).not.toBe(DOC);

		// Call undo exactly once using the @codemirror/commands undo command.
		undo(editor.cm);

		// The document must be back to the original — proving the EditPlan was
		// dispatched as a SINGLE transaction (one undo step).
		expect(editor.cm.state.doc.toString()).toBe(DOC);
	});
});

// ---------------------------------------------------------------------------
// Edge case — empty plan does nothing (no dispatch)
// ---------------------------------------------------------------------------

describe("applyEditPlan — empty plan", () => {
	it("does not modify the document when plan is empty", () => {
		const editor = makeEditor(DOC);

		applyEditPlan(editor as never, []);

		expect(editor.cm.state.doc.toString()).toBe(DOC);
	});
});
