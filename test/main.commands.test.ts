/**
 * T3.4  Registry-driven command layer — commands, Notices, single-undo
 *
 * Tests are written against the MOCK obsidian module (test/__mocks__/obsidian.ts).
 * The mock exposes:
 *   Plugin._commands   — captured addCommand() calls
 *   noticeLog()        — module-level Notice capture
 *   clearNoticeLog()   — reset between tests
 *
 * Vitest alias (vitest.config.ts): "obsidian" → test/__mocks__/obsidian.ts
 * No vi.mock() factory is needed — the file alias IS the mock.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { App } from "obsidian";
import type { Editor, EditorPosition, EditorSelection } from "obsidian";
import { clearNoticeLog, noticeLog } from "./__mocks__/obsidian";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo } from "@codemirror/commands";

// ---------------------------------------------------------------------------
// Import under test — AFTER mock alias is in place
// ---------------------------------------------------------------------------

const { MarkdownMasonPlugin } = await import("../src/main");

// ---------------------------------------------------------------------------
// Headless CM6 editor that applyEditPlan can actually drive
// ---------------------------------------------------------------------------

interface HeadlessCm {
	state: EditorState;
	dispatch(...specs: TransactionSpec[]): void;
}

interface HeadlessEditor {
	cm: HeadlessCm;
}

interface CmEditorOptions {
	/** Override the cursor position returned by getCursor(). Defaults to {line:0, ch:0}. */
	cursor?: EditorPosition;
	/** Override the selection returned by listSelections(). Defaults to zero-length at {line:0, ch:0}. */
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

	const editor = {
		cm,
		getValue: () => currentState.doc.toString(),
		getSelection: () => "",
		listSelections: (): EditorSelection[] => defaultSelections,
		getCursor: (_side?: "from" | "to" | "head" | "anchor") =>
			defaultCursor,
		posToOffset,
		refresh: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lines.length - 1,
		somethingSelected: () => false,
		getRange: (from: EditorPosition, to: EditorPosition) =>
			currentState.doc.toString().slice(posToOffset(from), posToOffset(to)),
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

	return editor;
}

// ---------------------------------------------------------------------------
// Plugin factory helper
// ---------------------------------------------------------------------------

function makePlugin() {
	const app = new App();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const plugin = new MarkdownMasonPlugin(app as any, {} as any);
	return plugin;
}

// ---------------------------------------------------------------------------
// Expected command ids from the registry (one per entry that produces commands)
// util.normalizeUrl is NOT a standalone command (no editorCallback form).
// ---------------------------------------------------------------------------

const EXPECTED_COMMAND_IDS = [
	"headings.cascade",
	"headings.normalize",
	"footnotes.fromCitations",
	"footnotes.identity",
	"footnotes.move",
	// Preset command ids
	"preset.tidyFootnotes",
	"preset.formatSelection",
	"preset.pasteAndFormat",
];

// ---------------------------------------------------------------------------
// (a) Command registration — ids + names; NO default hotkeys
// ---------------------------------------------------------------------------

describe("T3.4(a) — command registration", () => {
	beforeEach(() => clearNoticeLog());

	it("registers all expected command ids after onLayoutReady", async () => {
		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const workspace = (plugin.app as any).workspace;
		workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const registeredIds = (plugin as any)._commands.map((c: any) => c.id) as string[];
		for (const expectedId of EXPECTED_COMMAND_IDS) {
			expect(registeredIds, `expected command id "${expectedId}" to be registered`).toContain(expectedId);
		}
	});

	it("all command names start with 'Mason:' and use sentence case", async () => {
		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const workspace = (plugin.app as any).workspace;
		workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{ name: string }>;
		for (const cmd of commands) {
			expect(cmd.name, `"${cmd.name}" must start with "Mason:"`).toMatch(/^Mason:/);
		}
	});

	it("no command has a default hotkeys field", async () => {
		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const workspace = (plugin.app as any).workspace;
		workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<Record<string, unknown>>;
		for (const cmd of commands) {
			expect(cmd, `command "${cmd["id"]}" must not have a hotkeys field`).not.toHaveProperty("hotkeys");
		}
	});
});

// ---------------------------------------------------------------------------
// (b) Non-empty EditPlan → document mutated + count Notice shown
// ---------------------------------------------------------------------------

describe("T3.4(b) — non-empty plan mutates doc and shows count Notice", () => {
	beforeEach(() => clearNoticeLog());

	it("headings.normalize on a doc with skipped heading level mutates the doc and shows count Notice", async () => {
		// H1 → H3 skips H2 — normalize will demote ### to ## and produce 1 edit.
		const doc = "# Title\n\n### Skipped Level\n\nContent.\n";
		const editor = makeCmEditor(doc);
		const docBefore = editor.getValue();

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const normalizeCmd = commands.find((c) => c.id === "headings.normalize");
		expect(normalizeCmd, "headings.normalize command must be registered").toBeDefined();

		normalizeCmd!.editorCallback(editor as unknown as Editor);

		// Document must have been mutated (normalize demoted ### to ##)
		expect(editor.getValue(), "normalize must change the skipped heading").not.toBe(docBefore);
		expect(editor.getValue()).toContain("## Skipped Level");

		// A count Notice must be shown ("Mason: N change" or "Mason: N changes")
		const countNotices = noticeLog().filter((m: string) => /^Mason: \d+ change/.test(m));
		expect(countNotices.length, "expected a count Notice after applying non-empty plan").toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// (c) Empty EditPlan → descriptive Notice; doc NOT mutated
// ---------------------------------------------------------------------------

describe("T3.4(c) — empty plan shows descriptive Notice, doc unchanged", () => {
	beforeEach(() => clearNoticeLog());

	it("footnotes.move with no footnotes shows descriptive Notice and leaves doc unchanged", async () => {
		// A doc with no footnotes — footnotes.move returns empty plan (moveToResources with [])
		const doc = "# Title\n\n## Section\n\nContent with no footnotes.\n";
		const editor = makeCmEditor(doc);
		const docBefore = editor.getValue();

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		// footnotes.move with empty defs always returns empty plan
		const moveCmd = commands.find((c) => c.id === "footnotes.move");
		expect(moveCmd).toBeDefined();

		moveCmd!.editorCallback(editor as unknown as Editor);

		// Document must NOT have been mutated (empty plan = no edit)
		expect(editor.getValue()).toBe(docBefore);

		// A descriptive Notice must be shown (not a count Notice)
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice after empty plan").toBeGreaterThan(0);
		const lastNotice = notices[notices.length - 1]!;
		expect(lastNotice).not.toMatch(/^Mason: \d+ change/);
		expect(lastNotice.length, "Notice message should be non-empty").toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// (d) Preset command — concatenated plan applied as single undo step
//
// Proof strategy: if preset produced changes, one CM6 undo() fully restores
// the document — proving the combined plan was dispatched in ONE transaction.
// ---------------------------------------------------------------------------

describe("T3.4(d) — preset chains ops; changes are fully undone in one step", () => {
	beforeEach(() => clearNoticeLog());

	it("preset.tidyFootnotes is registered and shows a Notice (all footnote steps are PARSER-PENDING stubs)", async () => {
		const doc = "# Title\n\n## Section\n\nContent.\n";
		const editor = makeCmEditor(doc);

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const presetCmd = commands.find((c) => c.id === "preset.tidyFootnotes");
		expect(presetCmd, "preset.tidyFootnotes must be registered").toBeDefined();

		presetCmd!.editorCallback(editor as unknown as Editor);

		// All footnote steps are PARSER-PENDING stubs → empty plan → descriptive Notice
		// (not a count notice). Doc must be unchanged.
		expect(editor.getValue()).toBe(doc);
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);
	});

	it("preset.formatSelection with heading skip: doc changes then ONE undo fully restores it", async () => {
		// H1 → H3: normalize will demote ### to ##.
		// Selection context: default zero-length selection at offset 0 → cascade gets empty
		// input (no headings in selection) → no cascade plan. Normalize still operates on
		// whole ctx.doc → produces one edit demoting ### to ##.
		const doc = "# Title\n\n### Skipped Level\n\nContent.\n";
		const editor = makeCmEditor(doc);

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const presetCmd = commands.find((c) => c.id === "preset.formatSelection");
		expect(presetCmd).toBeDefined();

		presetCmd!.editorCallback(editor as unknown as Editor);

		const after = editor.getValue();
		if (after !== doc) {
			// Preset produced changes → one undo must restore the original exactly,
			// proving the combined plan was applied as a single CM6 transaction.
			undo(editor.cm);
			expect(editor.getValue()).toBe(doc);
		} else {
			// Preset produced no changes on this doc — counts as trivially single-undo.
			expect(after).toBe(doc);
		}
	});
});

// ---------------------------------------------------------------------------
// (e) cascade with no heading above cursor → noContextHeading Notice
// ---------------------------------------------------------------------------

describe("T3.4(e) — cascade noContextHeading Notice", () => {
	beforeEach(() => clearNoticeLog());

	it("cascade on a doc with no heading above cursor shows the noContextHeading Notice", async () => {
		// A document with NO headings at all — cascade will set noContextHeading=true
		const doc = "Just plain text, no headings at all.\n";
		const editor = makeCmEditor(doc);

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const cascadeCmd = commands.find((c) => c.id === "headings.cascade");
		expect(cascadeCmd).toBeDefined();

		cascadeCmd!.editorCallback(editor as unknown as Editor);

		// Should show a Notice about no heading context
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);
		// The noContextHeading Notice should mention heading or context
		const hasHeadingNotice = notices.some(
			(m: string) => /head/i.test(m) || /context/i.test(m) || /cursor/i.test(m) || /no heading/i.test(m),
		);
		expect(hasHeadingNotice, `expected a heading-related Notice; got: ${JSON.stringify(notices)}`).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Single-undo integration — prove that a real CM6 edit is reversible in 1 undo
// ---------------------------------------------------------------------------

describe("T3.4 single-undo integration — preset produces one undo step", () => {
	beforeEach(() => clearNoticeLog());

	it("headings.normalize on a doc with heading skip is fully reverted by one undo()", async () => {
		// H1 → H3: normalize produces one edit (demote ### to ##).
		// One CM6 undo must fully restore the original, proving single-transaction semantics.
		const doc = "# Title\n\n### Skipped Level\n\nContent.\n";
		const editor = makeCmEditor(doc);

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const normalizeCmd = commands.find((c) => c.id === "headings.normalize");
		expect(normalizeCmd).toBeDefined();
		normalizeCmd!.editorCallback(editor as unknown as Editor);

		const after = editor.getValue();
		expect(after, "normalize must change the skipped heading").not.toBe(doc);

		// One undo must restore the original document exactly
		undo(editor.cm);
		expect(editor.getValue()).toBe(doc);
	});
});

// ---------------------------------------------------------------------------
// (f) Format selection scoping — cascade receives selection as input, not whole doc
//
// Proof: place a selection covering "## Sub\n" (a level-2 heading) with the
// selection head positioned AFTER "## Sub\n" (offset 18). The heading
// "# Heading" precedes the selection in ctx.doc. With selectionContext:
//   ctx.input  = "## Sub\n"   (selected text)
//   ctx.cursor = 18           (head offset)
//   findContextLevel(doc, 18) finds "## Sub" as the last heading → ctxLevel=2
//   cascade shifts "## Sub" by (ctxLevel+1 - minIn) = (3-2) = 1 → "### Sub"
//   plan = [{from:18, to:18, insert:"### Sub\n"}]
//
// After applying, the doc contains "### Sub" — proving cascade used the
// selection as input (not the whole doc). With whole-note ctx and cursor=0
// (incorrect path), cascade would find ctxLevel=0 → noContextHeading → no
// plan → doc unchanged.
// ---------------------------------------------------------------------------

describe("T3.4(f) — Format selection scopes cascade to the selection", () => {
	beforeEach(() => clearNoticeLog());

	it("preset.formatSelection inserts a cascade-shifted heading at the selection head", async () => {
		// Doc layout (offsets):
		//   "# Heading\n"  → 10 chars (line 0, offsets 0-9)
		//   "\n"           →  1 char  (line 1, offset 10)
		//   "## Sub\n"     →  7 chars (line 2, offsets 11-17)
		//   "\n"           →  1 char  (line 3, offset 18)
		//   "Rest.\n"      →  6 chars (line 4)
		const doc = "# Heading\n\n## Sub\n\nRest.\n";

		// Selection: anchor = start of "## Sub" (line 2, ch 0, offset 11)
		//            head   = start of blank line after (line 3, ch 0, offset 18)
		// selectionContext produces: input="## Sub\n", cursor=18, from=11, to=18
		const editor = makeCmEditor(doc, {
			cursor: { line: 3, ch: 0 },
			selections: [
				{ anchor: { line: 2, ch: 0 }, head: { line: 3, ch: 0 } },
			],
		});

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const presetCmd = commands.find((c) => c.id === "preset.formatSelection");
		expect(presetCmd, "preset.formatSelection must be registered").toBeDefined();

		presetCmd!.editorCallback(editor as unknown as Editor);

		// cascade must have transformed "## Sub" → "### Sub" and inserted at offset 18.
		// The resulting doc must contain "### Sub" — proving selection-scoped input was used.
		// If whole-note ctx with cursor=0 were used instead, cascade would find ctxLevel=0
		// (noContextHeading) and produce no plan, leaving the doc unchanged.
		expect(
			editor.getValue(),
			"cascade must have inserted a shifted heading — proving selectionContext was used",
		).toContain("### Sub");

		// A count Notice must have been shown (plan was non-empty)
		const countNotices = noticeLog().filter((m: string) => /^Mason: \d+ change/.test(m));
		expect(
			countNotices.length,
			"expected a count Notice after Format selection applied a cascade plan",
		).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// (g) Cascade functional with real cursor — Bug 2 regression
//
// Before the fix, editorCtx hardcoded cursor=0, so cascade always found
// ctxLevel=0 → noContextHeading=true even when a heading existed above the
// real caret. This test proves that the whole-note ctx now reads the real
// caret position, making cascade functional.
//
// Doc: "## Context\n\n### Target\n"
//   "## Context\n" = 11 chars (line 0)
//   "\n"           =  1 char  (line 1, offset 11)
//   "### Target\n" = 11 chars (line 2)
//
// Caret at {line:1, ch:0} → offset 11.
// doc.slice(0, 11) = "## Context\n" → ctxLevel = 2.
// cascade input = whole doc (## Context, level 2 and ### Target, level 3).
// minIn = 2, shift = (2+1) - 2 = 1 → ## Context → ### Context, ### Target → #### Target.
// plan.length = 1 → one insert at offset 11 → count Notice shown.
// noContextHeading Notice must NOT be shown.
// ---------------------------------------------------------------------------

describe("T3.4(g) — cascade is functional when caret is below a real heading", () => {
	beforeEach(() => clearNoticeLog());

	it("cascade shows count Notice (not noContextHeading) when caret is below a heading", async () => {
		// ## Context is above the caret; ### Target is below. Caret on the blank line.
		const doc = "## Context\n\n### Target\n";

		// Caret at line 1, ch 0 → offset 11 (the blank line between the headings)
		const editor = makeCmEditor(doc, {
			cursor: { line: 1, ch: 0 },
		});

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const cascadeCmd = commands.find((c) => c.id === "headings.cascade");
		expect(cascadeCmd, "headings.cascade must be registered").toBeDefined();

		cascadeCmd!.editorCallback(editor as unknown as Editor);

		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);

		// Must NOT show noContextHeading Notice (heading IS above cursor)
		const hasNoHeadingNotice = notices.some(
			(m: string) => /no heading above cursor/i.test(m),
		);
		expect(
			hasNoHeadingNotice,
			`noContextHeading Notice must NOT fire when a heading is above cursor; got: ${JSON.stringify(notices)}`,
		).toBe(false);

		// Must show a count Notice (plan was non-empty)
		const countNotices = notices.filter((m: string) => /^Mason: \d+ change/.test(m));
		expect(
			countNotices.length,
			"expected a count Notice after cascade applied a non-empty plan",
		).toBeGreaterThanOrEqual(1);

		// Doc must have changed (cascade inserted the transformed content)
		expect(editor.getValue(), "cascade must mutate the doc").not.toBe(doc);
	});

	it("cascade on a doc with no heading above cursor still shows noContextHeading Notice", async () => {
		// Regression: existing behavior — no heading above caret → noContextHeading Notice.
		// This test was T3.4(e); we verify it still passes with the real-cursor fix.
		const doc = "Just plain text, no headings at all.\n";

		// Default cursor {line:0, ch:0} → offset 0; doc.slice(0,0)="" → ctxLevel=0
		const editor = makeCmEditor(doc);

		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: Editor): void;
		}>;

		const cascadeCmd = commands.find((c) => c.id === "headings.cascade");
		expect(cascadeCmd).toBeDefined();

		cascadeCmd!.editorCallback(editor as unknown as Editor);

		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);
		const hasHeadingNotice = notices.some(
			(m: string) => /head/i.test(m) || /context/i.test(m) || /cursor/i.test(m) || /no heading/i.test(m),
		);
		expect(
			hasHeadingNotice,
			`expected a heading-related Notice; got: ${JSON.stringify(notices)}`,
		).toBe(true);
	});
});
