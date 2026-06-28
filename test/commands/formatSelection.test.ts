/**
 * T2.1 — Gate fusedFormatNote on the FormatSelectionRecipe
 *
 * Tests the "Format selection" command (preset.formatSelection) which calls
 * fusedFormatNote internally. Since fusedFormatNote is private, all assertions
 * go through the command's editorCallback, accessed via registerCommands().
 *
 * Fixture: "# A\n\n### B\n\n[1] note.\n\n[^1]: def\n[url](https://x.com)\n"
 *   — heading gap (H1→H3),  bare citation [1], single def with link line.
 *
 * EXPECTED_ALL_ON is the byte-identical baseline captured from the CURRENT
 * (pre-change) fusedFormatNote by tracing the pipeline manually:
 *   1. normalize: "### B" → "## B"
 *   2. cascade: no-op (zero-length selection, input = "")
 *   3. tidyFootnotes (all stages):
 *        C:   [1]  → [^1]
 *        O+D: already id=1, no renumber
 *        M:   def outside Resources → create "## Resources" at end, move def in
 *   4. diffToEditPlan(original, afterM) → one Edit
 *
 * Resulting doc:
 *   "# A\n\n## B\n\n[^1] note.\n\n## Resources\n\n[^1]: def\n[url](https://x.com)"
 *   (trailing \n removed because the def deletion removes it and the insert
 *   appended by wholeNoteMove does not end with \n)
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Editor, EditorPosition, EditorSelection } from "obsidian";
import { clearNoticeLog, noticeLog } from "../__mocks__/obsidian";
import { registerCommands } from "../../src/commands";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import type { MasonSettings } from "../../src/core/types";
import type { FormatSelectionRecipe } from "../../src/core/formatSelection";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history } from "@codemirror/commands";

// ---------------------------------------------------------------------------
// Fixture + expected constants
// ---------------------------------------------------------------------------

const FIXTURE = "# A\n\n### B\n\n[1] note.\n\n[^1]: def\n[url](https://x.com)\n";

/**
 * Byte-identical expected output when all recipe toggles are ON.
 * Captured by running the pre-change fusedFormatNote on FIXTURE and observing
 * the resulting doc (tests ran and output was recorded from the failure diff).
 *
 * Three newlines before "## Resources": the blank-line separator between the body
 * paragraph and the (deleted) def contributes one \n via slice(0,23), and the
 * wholeNoteMove insert begins with \n, producing \n\n + \n = \n\n\n.
 */
const EXPECTED_ALL_ON =
	"# A\n\n## B\n\n[^1] note.\n\n\n## Resources\n\n[^1]: def\n[url](https://x.com)";

// ---------------------------------------------------------------------------
// Headless CM6 editor — mirrors the helper in test/main.commands.test.ts
// ---------------------------------------------------------------------------

interface HeadlessCm {
	state: EditorState;
	dispatch(...specs: TransactionSpec[]): void;
}

interface HeadlessEditor {
	cm: HeadlessCm;
}

interface CmEditorOptions {
	cursor?: EditorPosition;
	selections?: EditorSelection[];
}

function makeCmEditor(doc: string, opts: CmEditorOptions = {}): HeadlessEditor & Editor {
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

	const lines = doc.split("\n");

	function posToOffset(pos: EditorPosition): number {
		let offset = 0;
		for (let i = 0; i < pos.line; i++) {
			offset += (lines[i]?.length ?? 0) + 1;
		}
		return offset + pos.ch;
	}

	const defaultCursor: EditorPosition = opts.cursor ?? { line: 0, ch: 0 };
	const defaultSelections: EditorSelection[] = opts.selections ?? [
		{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
	];

	return {
		cm,
		getValue: () => currentState.doc.toString(),
		getSelection: () => "",
		listSelections: (): EditorSelection[] => defaultSelections,
		getCursor: () => defaultCursor,
		posToOffset,
		refresh: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lines.length - 1,
		somethingSelected: () => false,
		getRange: () => "",
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
				const len = (lines[i]?.length ?? 0) + 1;
				if (remaining < len) return { line: i, ch: remaining };
				remaining -= len;
			}
			return { line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 };
		},
		processLines: () => undefined,
		getDoc: function () { return this as unknown as typeof this; },
		setLine: () => undefined,
	} as unknown as HeadlessEditor & Editor;
}

// ---------------------------------------------------------------------------
// Minimal CommandHost — avoids importing MarkdownMasonPlugin (and settingsTab)
// ---------------------------------------------------------------------------

type CmdRecord = { id: string; name: string; editorCallback(e: Editor): void };

function makeCommandHost(settings: MasonSettings): { _commands: CmdRecord[]; settings: MasonSettings } {
	const cmds: CmdRecord[] = [];
	const host = {
		addCommand(cmd: CmdRecord): CmdRecord {
			cmds.push(cmd);
			return cmd;
		},
		settings,
	};
	registerCommands(host);
	return { _commands: cmds, settings };
}

function findFormatCmd(host: { _commands: CmdRecord[] }): CmdRecord {
	const cmd = host._commands.find((c) => c.id === "preset.formatSelection");
	if (!cmd) throw new Error("preset.formatSelection not registered");
	return cmd;
}

/** Run "Format selection" with the given recipe and return the resulting doc + notices. */
function runFormatSelection(
	doc: string,
	recipe: Partial<FormatSelectionRecipe>,
	editorOpts: CmEditorOptions = {},
): { resultDoc: string; notices: string[] } {
	const settings: MasonSettings = { ...DEFAULT_SETTINGS, formatSelection: recipe };
	const host = makeCommandHost(settings);
	const cmd = findFormatCmd(host);
	const editor = makeCmEditor(doc, editorOpts);
	clearNoticeLog();
	cmd.editorCallback(editor as unknown as Editor);
	return { resultDoc: editor.getValue(), notices: noticeLog() as string[] };
}

// ---------------------------------------------------------------------------
// T2.1(a) — all-on: byte-identical regression
// ---------------------------------------------------------------------------

describe("T2.1(a) — all-on produces byte-identical output to legacy fusedFormatNote", () => {
	beforeEach(() => clearNoticeLog());

	it("output matches the pre-change baseline constant when all recipe flags are on", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, {});
		expect(resultDoc).toBe(EXPECTED_ALL_ON);
	});

	it("explicit all-true recipe produces the same output as empty (default) recipe", () => {
		const { resultDoc: fromEmpty } = runFormatSelection(FIXTURE, {});
		const { resultDoc: fromExplicit } = runFormatSelection(FIXTURE, {
			cascade: true, normalize: true, fromCitations: true, identity: true, move: true,
		});
		expect(fromEmpty).toBe(fromExplicit);
	});
});

// ---------------------------------------------------------------------------
// T2.1(b) — move:false: def stays inline, citations + normalize still apply
// ---------------------------------------------------------------------------

describe("T2.1(b) — move:false keeps def inline; citations and normalize still apply", () => {
	beforeEach(() => clearNoticeLog());

	it("def stays in body when move is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { move: false });
		expect(resultDoc).toContain("[^1]: def");
	});

	it("no Resources section is created when move is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { move: false });
		expect(resultDoc).not.toContain("## Resources");
	});

	it("citations are still converted when move is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { move: false });
		expect(resultDoc).toContain("[^1] note.");
		expect(resultDoc).not.toContain("[1] note.");
	});

	it("headings are still normalized when move is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { move: false });
		expect(resultDoc).toMatch(/^## B$/m);
		expect(resultDoc).not.toMatch(/^### B$/m);
	});
});

// ---------------------------------------------------------------------------
// T2.1(c) — normalize:false: heading gap not closed; other steps still apply
// ---------------------------------------------------------------------------

describe("T2.1(c) — normalize:false preserves heading gap; citations and move still apply", () => {
	beforeEach(() => clearNoticeLog());

	it("heading gap is NOT closed when normalize is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { normalize: false });
		expect(resultDoc).toMatch(/^### B$/m);
	});

	it("citations are still converted when normalize is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { normalize: false });
		expect(resultDoc).toContain("[^1] note.");
		expect(resultDoc).not.toContain("[1] note.");
	});

	it("def is still moved to Resources when normalize is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { normalize: false });
		expect(resultDoc).toContain("## Resources");
		// Def should NOT remain in body (it was moved)
		const resourcesIdx = resultDoc.indexOf("## Resources");
		const bodySection = resultDoc.slice(0, resourcesIdx);
		expect(bodySection).not.toContain("[^1]: def");
	});
});

// ---------------------------------------------------------------------------
// T2.1(d) — fromCitations:false: bare [n] not converted; other steps apply
// ---------------------------------------------------------------------------

describe("T2.1(d) — fromCitations:false: [1] stays as [1]; normalize and move still apply", () => {
	beforeEach(() => clearNoticeLog());

	it("bare citation [1] is NOT converted when fromCitations is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { fromCitations: false });
		expect(resultDoc).toContain("[1] note.");
		expect(resultDoc).not.toContain("[^1] note.");
	});

	it("headings are still normalized when fromCitations is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { fromCitations: false });
		expect(resultDoc).toMatch(/^## B$/m);
		expect(resultDoc).not.toMatch(/^### B$/m);
	});

	it("def is still moved to Resources when fromCitations is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, { fromCitations: false });
		expect(resultDoc).toContain("## Resources");
	});
});

// ---------------------------------------------------------------------------
// T2.1(e) — identity:false: footnotes not renumbered; other steps apply
// Separate fixture where renumbering would occur (ref [^3] → should become [^1]).
// ---------------------------------------------------------------------------

describe("T2.1(e) — identity:false: [^3] stays [^3]; other steps still apply", () => {
	beforeEach(() => clearNoticeLog());

	const FIXTURE_IDENTITY = "# A\n\nSee [^3] ref.\n\n[^3]: def\n[url](https://x.com)\n";

	it("with identity=true (all-on), [^3] is renumbered to [^1]", () => {
		const { resultDoc } = runFormatSelection(FIXTURE_IDENTITY, {});
		expect(resultDoc).toContain("[^1]");
		expect(resultDoc).not.toContain("[^3]");
	});

	it("with identity=false, [^3] is NOT renumbered", () => {
		const { resultDoc } = runFormatSelection(FIXTURE_IDENTITY, { identity: false });
		expect(resultDoc).toContain("[^3]");
	});

	it("def is still moved to Resources when identity is false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE_IDENTITY, { identity: false });
		expect(resultDoc).toContain("## Resources");
	});
});

// ---------------------------------------------------------------------------
// T2.1(f) — cascade:false: heading NOT shifted even with a real selection
// Fixture: "# A\n\n## B\n\n[1] ref.\n\n[^1]: def\n[url](https://x.com)\n"
// Selection covering "## B\n" — cascade=true shifts to "### B", false leaves it.
// ---------------------------------------------------------------------------

describe("T2.1(f) — cascade:false: heading NOT shifted with an active selection", () => {
	beforeEach(() => clearNoticeLog());

	// Doc: "# A\n\n## B\n\n[1] ref.\n\n[^1]: def\n[url](https://x.com)\n"
	// line 0: "# A"   (offset 0)
	// line 1: ""       (offset 4)
	// line 2: "## B"   (offset 5)
	// line 3: ""       (offset 10)
	// Selection: anchor=(line2,ch0)→offset5, head=(line3,ch0)→offset10
	// input = "## B\n", cursor=10
	// ctxLevel = findContextLevel(doc, 10) = last heading in slice(0,10)="# A\n\n## B" = level 2
	// shift = 2+1−2 = 1 → "## B\n" → "### B\n"
	const FIXTURE_CASCADE = "# A\n\n## B\n\n[1] ref.\n\n[^1]: def\n[url](https://x.com)\n";
	const selOpts: CmEditorOptions = {
		cursor: { line: 3, ch: 0 },
		selections: [{ anchor: { line: 2, ch: 0 }, head: { line: 3, ch: 0 } }],
	};

	it("with cascade=true, heading is shifted from ## B to ### B", () => {
		const { resultDoc } = runFormatSelection(FIXTURE_CASCADE, {}, selOpts);
		// Use line-anchored regex: "## B" is a substring of "### B", so .toContain("## B")
		// would match even after cascade. We must check for an exact heading-level match.
		expect(resultDoc).toMatch(/^### B$/m);
		expect(resultDoc).not.toMatch(/^## B$/m);
	});

	it("with cascade=false, heading stays at ## B even with an active selection", () => {
		const { resultDoc } = runFormatSelection(FIXTURE_CASCADE, { cascade: false }, selOpts);
		expect(resultDoc).toMatch(/^## B$/m);
		expect(resultDoc).not.toMatch(/^### B$/m);
	});
});

// ---------------------------------------------------------------------------
// T2.1(g) — all-off: returns [] → "Nothing to format" Notice, doc unchanged
// ---------------------------------------------------------------------------

describe("T2.1(g) — all-off: empty plan → Nothing to format Notice, doc unchanged", () => {
	beforeEach(() => clearNoticeLog());

	const ALL_OFF: FormatSelectionRecipe = {
		cascade: false, normalize: false, fromCitations: false, identity: false, move: false,
	};

	it("doc is unchanged when all recipe flags are false", () => {
		const { resultDoc } = runFormatSelection(FIXTURE, ALL_OFF);
		expect(resultDoc).toBe(FIXTURE);
	});

	it("shows 'Nothing to format' Notice when plan is empty", () => {
		const { notices } = runFormatSelection(FIXTURE, ALL_OFF);
		expect(notices).toContain("Nothing to format");
	});

	it("does NOT show a count Notice when all-off", () => {
		const { notices } = runFormatSelection(FIXTURE, ALL_OFF);
		const countNotices = notices.filter((m) => /^Mason: \d+ change/.test(m));
		expect(countNotices).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// T2.1(h) — atomicity: any non-empty result is exactly one Edit
// The count Notice "Mason: 1 change" proves the EditPlan has length 1.
// diffToEditPlan always returns at most one Edit (by design); this test
// is a regression guard against future changes that break that invariant.
// ---------------------------------------------------------------------------

describe("T2.1(h) — atomicity: non-empty result is exactly one CM6 transaction", () => {
	beforeEach(() => clearNoticeLog());

	it("non-empty plan shows 'Mason: 1 change' (single Edit from diffToEditPlan)", () => {
		const { notices } = runFormatSelection(FIXTURE, {});
		const countNotices = notices.filter((m) => /^Mason: \d+ change/.test(m));
		expect(countNotices).toHaveLength(1);
		expect(countNotices[0]).toBe("Mason: 1 change");
	});

	it("move:false still produces exactly one Edit when doc changes", () => {
		// normalize + fromCitations fire → one combined diff edit
		const { notices } = runFormatSelection(FIXTURE, { move: false });
		const countNotices = notices.filter((m) => /^Mason: \d+ change/.test(m));
		expect(countNotices).toHaveLength(1);
		expect(countNotices[0]).toBe("Mason: 1 change");
	});
});

// ---------------------------------------------------------------------------
// T2.1(i) — live effect: flip a flag on the SAME settings → changed result
// Guards against future caching of the recipe at host-construction time.
// ---------------------------------------------------------------------------

describe("T2.1(i) — live effect: fresh recipe read per invocation", () => {
	beforeEach(() => clearNoticeLog());

	it("changing settings.formatSelection between calls changes the result", () => {
		// Build a mutable settings object and a persistent host
		const settings: MasonSettings = { ...DEFAULT_SETTINGS, formatSelection: {} };
		const host = makeCommandHost(settings);
		const cmd = findFormatCmd(host);

		// First run: all-on → def moved to Resources
		const editor1 = makeCmEditor(FIXTURE);
		clearNoticeLog();
		cmd.editorCallback(editor1 as unknown as Editor);
		const result1 = editor1.getValue();

		// Mutate settings on the host's settings object (same object reference)
		host.settings.formatSelection = { move: false };
		// Also mutate the settings variable (both should point to the same object
		// that the command closure reads each invocation)
		settings.formatSelection = { move: false };

		// Second run on the same fixture with move:false
		const editor2 = makeCmEditor(FIXTURE);
		clearNoticeLog();
		cmd.editorCallback(editor2 as unknown as Editor);
		const result2 = editor2.getValue();

		// Results MUST differ — proves the command reads settings fresh each time
		expect(result1).not.toBe(result2);
		// Specific: first has Resources, second does not
		expect(result1).toContain("## Resources");
		expect(result2).not.toContain("## Resources");
	});
});
