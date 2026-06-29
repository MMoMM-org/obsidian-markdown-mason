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
 * Captured by running the 11-step fusedFormatNote on FIXTURE and observing
 * the resulting doc.
 *
 * Three newlines before "## Resources": the blank-line separator between the body
 * paragraph and the (deleted) def contributes one \n via slice(0,23), and the
 * wholeNoteMove insert begins with \n, producing \n\n + \n = \n\n\n.
 *
 * NOTE: dewrap (step 2) runs before tidyFootnotes (step 9). The two-line def
 * block "[^1]: def\n[url](https://x.com)" in FIXTURE is a multi-line paragraph
 * block (segmentBlocks classifies both lines as "paragraph" since there is no
 * footnote-definition block kind). dewrap joins them into the single line
 * "[^1]: def [url](https://x.com)" before tidyFootnotes moves it to Resources.
 */
const EXPECTED_ALL_ON =
	"# A\n\n## B\n\n[^1] note.\n\n\n## Resources\n\n[^1]: def [url](https://x.com)";

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
		dewrap: false, dehyphenate: false, decomposeLigatures: false,
		tidyWhitespace: false, normalizeBullets: false, normalizeOrdered: false,
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

// ---------------------------------------------------------------------------
// T4.1(a) — all-11-on byte-identity on a clean structured note
//
// A clean fixture has no pasted artifacts: single-line paragraphs, '-' bullets,
// sequential ordered list, fenced code block, H1 only (no gap), no hyphens at
// line end, no ligatures, no double spaces. All 11 steps must be no-ops → the
// resultDoc is byte-identical to the input (diffToEditPlan returns [] → no edit).
// ---------------------------------------------------------------------------

const CLEAN_FIXTURE =
	"# Title\n\nA clean paragraph with no artifacts.\n\n- item one\n- item two\n\n1. first\n2. second\n\n```\ncode\n```\n";

describe("T4.1(a) — all-11-on is byte-identical on a clean structured note", () => {
	beforeEach(() => clearNoticeLog());

	it("all 11 steps are no-ops on a clean note — resultDoc is byte-identical to input", () => {
		const { resultDoc } = runFormatSelection(CLEAN_FIXTURE, {});
		expect(resultDoc).toBe(CLEAN_FIXTURE);
	});
});

// ---------------------------------------------------------------------------
// T4.1(b) — per-step omission: each of the 6 new keys controls its step
//
// Each pair of tests:
//   key=true  → asserts the step's effect IS present   (RED before impl, GREEN after)
//   key=false → asserts the step's effect is ABSENT    (verifies the toggle works)
//              + asserts a different step (normalize) still ran (proves isolation)
// ---------------------------------------------------------------------------

describe("T4.1(b) — per-step omission: each new key independently controls its step", () => {
	beforeEach(() => clearNoticeLog());

	// --- dewrap ---

	it("dewrap:true — two consecutive paragraph lines are joined into one", () => {
		const fixture = "# Heading\n\nFirst line\nsecond line.\n\nSecond paragraph.\n";
		const { resultDoc } = runFormatSelection(fixture, { dewrap: true });
		expect(resultDoc).toContain("First line second line.");
		expect(resultDoc).not.toContain("First line\nsecond line.");
	});

	it("dewrap:false — wrapped lines stay separate; normalize still closes heading gap", () => {
		const fixture = "# Heading\n\n### Sub\n\nFirst line\nsecond line.\n\nSecond paragraph.\n";
		const { resultDoc } = runFormatSelection(fixture, { dewrap: false });
		expect(resultDoc).toContain("First line\nsecond line.");
		expect(resultDoc).toMatch(/^## Sub$/m);
		expect(resultDoc).not.toMatch(/^### Sub$/m);
	});

	// --- dehyphenate ---

	it("dehyphenate:true — hyphen-newline between lowercase letters is removed", () => {
		const fixture = "# Heading\n\nlong-\nword continues here.\n";
		const { resultDoc } = runFormatSelection(fixture, { dehyphenate: true });
		expect(resultDoc).toContain("longword continues here.");
		expect(resultDoc).not.toContain("long-\nword");
	});

	it("dehyphenate:false — hyphen preserved (not joined away); normalize still closes heading gap", () => {
		const fixture = "# Heading\n\n### Sub\n\nlong-\nword continues here.\n";
		const { resultDoc } = runFormatSelection(fixture, { dehyphenate: false });
		// dehyphenate did NOT run — the hyphen character is preserved in the output.
		// (dewrap still joins the two-line paragraph, but does NOT remove the hyphen;
		// result contains "long-" rather than "longword".)
		expect(resultDoc).not.toContain("longword");
		expect(resultDoc).toContain("long-");
		// normalize DID run
		expect(resultDoc).toMatch(/^## Sub$/m);
		expect(resultDoc).not.toMatch(/^### Sub$/m);
	});

	// --- decomposeLigatures ---

	it("decomposeLigatures:true — smart double-quotes are replaced with ASCII quotes", () => {
		const fixture = "# Heading\n\nUse “quoted text” here.\n";
		const { resultDoc } = runFormatSelection(fixture, { decomposeLigatures: true });
		expect(resultDoc).toContain('"quoted text"');
		expect(resultDoc).not.toContain("“");
	});

	it("decomposeLigatures:false — smart quotes stay; normalize still closes heading gap", () => {
		const fixture = "# Heading\n\n### Sub\n\nUse “quoted text” here.\n";
		const { resultDoc } = runFormatSelection(fixture, { decomposeLigatures: false });
		expect(resultDoc).toContain("“");
		expect(resultDoc).toMatch(/^## Sub$/m);
		expect(resultDoc).not.toMatch(/^### Sub$/m);
	});

	// --- tidyWhitespace ---

	it("tidyWhitespace:true — double spaces in body text are collapsed to single", () => {
		const fixture = "# Heading\n\nWord  extra  spaces.\n";
		const { resultDoc } = runFormatSelection(fixture, { tidyWhitespace: true });
		expect(resultDoc).toContain("Word extra spaces.");
		expect(resultDoc).not.toContain("Word  extra");
	});

	it("tidyWhitespace:false — double spaces stay; normalize still closes heading gap", () => {
		const fixture = "# Heading\n\n### Sub\n\nWord  extra  spaces.\n";
		const { resultDoc } = runFormatSelection(fixture, { tidyWhitespace: false });
		expect(resultDoc).toContain("Word  extra  spaces.");
		expect(resultDoc).toMatch(/^## Sub$/m);
		expect(resultDoc).not.toMatch(/^### Sub$/m);
	});

	// --- normalizeBullets ---

	it("normalizeBullets:true — asterisk bullet markers are replaced with hyphens", () => {
		const fixture = "# Heading\n\n* item one\n* item two\n";
		const { resultDoc } = runFormatSelection(fixture, { normalizeBullets: true });
		expect(resultDoc).toContain("- item one");
		expect(resultDoc).not.toContain("* item one");
	});

	it("normalizeBullets:false — asterisk bullets stay; normalize still closes heading gap", () => {
		const fixture = "# Heading\n\n### Sub\n\n* item one\n* item two\n";
		const { resultDoc } = runFormatSelection(fixture, { normalizeBullets: false });
		expect(resultDoc).toContain("* item one");
		expect(resultDoc).toMatch(/^## Sub$/m);
		expect(resultDoc).not.toMatch(/^### Sub$/m);
	});

	// --- normalizeOrdered ---

	it("normalizeOrdered:true — out-of-sequence numbers are renumbered from 1", () => {
		const fixture = "# Heading\n\n2. first item\n3. second item\n";
		const { resultDoc } = runFormatSelection(fixture, { normalizeOrdered: true });
		expect(resultDoc).toContain("1. first item");
		expect(resultDoc).toContain("2. second item");
		expect(resultDoc).not.toContain("3. second item");
	});

	it("normalizeOrdered:false — out-of-sequence numbers stay; normalize still closes heading gap", () => {
		const fixture = "# Heading\n\n### Sub\n\n2. first item\n3. second item\n";
		const { resultDoc } = runFormatSelection(fixture, { normalizeOrdered: false });
		expect(resultDoc).toContain("2. first item");
		expect(resultDoc).toMatch(/^## Sub$/m);
		expect(resultDoc).not.toMatch(/^### Sub$/m);
	});
});

// ---------------------------------------------------------------------------
// T4.1(c) — all 6 new steps trigger together → exactly one Edit
//
// Combined fixture triggers all 6 new steps simultaneously:
//   normalizeBullets:  * → -
//   normalizeOrdered:  2. → 1.
//   dewrap:            two-line paragraph joined
//   dehyphenate:       hyphen-newline removed
//   decomposeLigatures: smart quotes → ASCII
//   tidyWhitespace:    double space collapsed
//
// The result should differ from the input → diffToEditPlan returns one Edit
// → notice is "Mason: 1 change".
// ---------------------------------------------------------------------------

describe("T4.1(c) — all 6 new steps trigger together → exactly one Edit", () => {
	beforeEach(() => clearNoticeLog());

	const COMBINED_FIXTURE =
		"# Heading\n\n* item one\n* item two\n\n2. first\n3. second\n\nFirst line\nsecond line.\n\nlong-\nword continues.\n\nUse “quoted text” here.\n\nWord  extra  spaces.\n";

	it("all 6 new steps fire together — notice shows 'Mason: 1 change'", () => {
		const { notices } = runFormatSelection(COMBINED_FIXTURE, {});
		expect(notices).toContain("Mason: 1 change");
	});
});

// ---------------------------------------------------------------------------
// T4.1(d) — live-read: dewrap toggle on the same settings object
//
// Proves fusedFormatNote reads settings fresh each invocation: flipping
// dewrap:false on the same host.settings object after the first call must
// change the result of the second call.
// ---------------------------------------------------------------------------

describe("T4.1(d) — live-read: dewrap toggle on same settings object", () => {
	beforeEach(() => clearNoticeLog());

	it("flipping dewrap:false after first call leaves lines separate — proves fresh settings read", () => {
		const settings: MasonSettings = { ...DEFAULT_SETTINGS, formatSelection: {} };
		const host = makeCommandHost(settings);
		const cmd = findFormatCmd(host);

		const fixture = "# Heading\n\nFirst line\nsecond line.\n";

		// First call: dewrap=true (default) — two lines joined into one
		const editor1 = makeCmEditor(fixture);
		clearNoticeLog();
		cmd.editorCallback(editor1 as unknown as Editor);
		const result1 = editor1.getValue();

		// Flip dewrap off on the same settings object (same reference the closure holds)
		host.settings.formatSelection = { dewrap: false };
		settings.formatSelection = { dewrap: false };

		// Second call: dewrap=false — lines should stay separate
		const editor2 = makeCmEditor(fixture);
		clearNoticeLog();
		cmd.editorCallback(editor2 as unknown as Editor);
		const result2 = editor2.getValue();

		// Results must differ — proves fresh read
		expect(result1).not.toBe(result2);
		// Specific: second result keeps the newline between the two lines
		expect(result2).toContain("First line\nsecond line.");
	});
});
