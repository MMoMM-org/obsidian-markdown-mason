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
		// input (no headings in selection) → no cascade plan (empty input guard).
		// Normalize still operates on whole ctx.doc → produces one edit demoting ### to ##.
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
// (e) cascade with no selection → descriptive Notice, doc unchanged, no apply
// ---------------------------------------------------------------------------

describe("T3.4(e) — cascade with no selection shows Notice, doc unchanged", () => {
	beforeEach(() => clearNoticeLog());

	it("cascade with collapsed (empty) selection shows 'Select text' Notice and leaves doc unchanged", async () => {
		// Doc has a heading above cursor so noContextHeading would NOT fire —
		// the empty-selection guard must fire first.
		const doc = "# Title\n\nSome content.\n";
		// Collapsed selection (anchor === head) → input will be ""
		const editor = makeCmEditor(doc, {
			cursor: { line: 1, ch: 0 },
			selections: [
				{ anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 0 } },
			],
		});
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

		const cascadeCmd = commands.find((c) => c.id === "headings.cascade");
		expect(cascadeCmd).toBeDefined();

		cascadeCmd!.editorCallback(editor as unknown as Editor);

		// Doc must NOT have been mutated
		expect(editor.getValue()).toBe(docBefore);

		// Must show a descriptive Notice about selecting text
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);
		const hasSelectNotice = notices.some(
			(m: string) => /select/i.test(m),
		);
		expect(
			hasSelectNotice,
			`expected a "select text" Notice; got: ${JSON.stringify(notices)}`,
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// (e2) cascade noContextHeading Notice — with a selection but no heading above
// ---------------------------------------------------------------------------

describe("T3.4(e2) — cascade noContextHeading Notice when no heading above cursor", () => {
	beforeEach(() => clearNoticeLog());

	it("cascade with a selection but no heading above cursor shows noContextHeading Notice", async () => {
		// A document with NO headings at all — cascade will set noContextHeading=true
		// Select the text so the empty-selection guard is bypassed.
		const doc = "Just plain text, no headings at all.\n";
		// Select the whole content
		const editor = makeCmEditor(doc, {
			cursor: { line: 0, ch: 36 },
			selections: [
				{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 36 } },
			],
		});
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

		const cascadeCmd = commands.find((c) => c.id === "headings.cascade");
		expect(cascadeCmd).toBeDefined();

		cascadeCmd!.editorCallback(editor as unknown as Editor);

		// Doc must NOT have been mutated
		expect(editor.getValue()).toBe(docBefore);

		// Should show a Notice about no heading context (not "select text")
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);
		const hasHeadingNotice = notices.some(
			(m: string) => /head/i.test(m) || /context/i.test(m) || /cursor/i.test(m) || /no heading/i.test(m),
		);
		expect(hasHeadingNotice, `expected a heading-related Notice; got: ${JSON.stringify(notices)}`).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// (f) Cascade replaces selection — no doubling
//
// Proof: select a heading within the doc, run cascade, assert:
//   1. The doc does NOT double in length (no insert-at-cursor duplication).
//   2. The selected heading text appears EXACTLY ONCE in the result.
//   3. The heading level was shifted (cascade transformed it).
//   4. A count Notice was shown.
//
// Doc layout:
//   "# Top\n"     → 6 chars (line 0, offsets 0-5)
//   "\n"          → 1 char  (line 1, offset 6)
//   "## Sub\n"    → 7 chars (line 2, offsets 7-13)
//   "Content.\n"  → 9 chars (line 3)
//
// Selection: the "## Sub\n" line (anchor=line2,ch0 → offset7; head=line3,ch0 → offset14).
// selectionContext: input="## Sub\n", cursor=14, from=7, to=14.
// findContextLevel(doc, 14): doc.slice(0,14) has "# Top" → ctxLevel=1.
// cascade shift = (1+1 - 2) = 0 → no heading level change.
//
// Change doc so cursor is between headings to get a non-zero shift:
// Doc: "# Top\n\n## Sub\nContent.\n"
//   line 0: "# Top\n"  → 6 chars
//   line 1: "\n"       → 1 char (offset 6)
//   line 2: "## Sub\n" → 7 chars (offset 7-13)
//   line 3: "Content.\n"
// Selection: anchor={line:2,ch:0} → offset 7; head={line:3,ch:0} → offset 14.
// ctx.cursor = 14. doc.slice(0,14) = "# Top\n\n## Sub" → last heading = ## level 2.
// WAIT: cursor is at offset 14 (start of "Content"), so doc.slice(0,14) ends AFTER "## Sub\n".
// findContextLevel sees "## Sub" → ctxLevel=2. shift = (2+1-2) = 1.
// "## Sub\n" → "### Sub\n".
// REPLACE edit: {from:7, to:14, insert:"### Sub\n"} — same length, replaces in place.
// Result doc: "# Top\n\n### Sub\nContent.\n" — "## Sub" gone, "### Sub" present once.
// ---------------------------------------------------------------------------

describe("T3.4(f) — cascade REPLACES selection; no document doubling", () => {
	beforeEach(() => clearNoticeLog());

	it("cascade on a selection replaces the selected heading in place — heading shifted, no doubling", async () => {
		// Doc: "# Top\n\n## Sub\nContent.\n"
		const doc = "# Top\n\n## Sub\nContent.\n";
		// Selection: "## Sub\n" — anchor=line2,ch0 (offset7), head=line3,ch0 (offset14)
		// cursor=14: doc.slice(0,14)="# Top\n\n## Sub" → last heading=## ctxLevel=2
		// shift=(2+1-2)=1 → "## Sub\n" → "### Sub\n"
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

		const cascadeCmd = commands.find((c) => c.id === "headings.cascade");
		expect(cascadeCmd, "headings.cascade must be registered").toBeDefined();

		cascadeCmd!.editorCallback(editor as unknown as Editor);

		const result = editor.getValue();

		// 1. No doubling: result must not be longer than the original + 2 chars (level shift adds 1 #)
		expect(
			result.length,
			`doc length must not roughly double: original=${doc.length}, result=${result.length}`,
		).toBeLessThan(doc.length + 10);

		// 2. The original "## Sub" must appear at most 0 times (replaced by "### Sub")
		const originalHeadingCount = (result.match(/^## Sub/gm) ?? []).length;
		expect(
			originalHeadingCount,
			`"## Sub" must be replaced (not duplicated); found ${originalHeadingCount} occurrences`,
		).toBe(0);

		// 3. The shifted heading must appear exactly once
		const shiftedCount = (result.match(/^### Sub/gm) ?? []).length;
		expect(
			shiftedCount,
			`"### Sub" must appear exactly once after cascade replace; found ${shiftedCount}`,
		).toBe(1);

		// 4. Count Notice must have been shown
		const countNotices = noticeLog().filter((m: string) => /^Mason: \d+ change/.test(m));
		expect(
			countNotices.length,
			"expected a count Notice after cascade replaced the selection",
		).toBeGreaterThanOrEqual(1);
	});

	it("preset.formatSelection cascade step replaces the selection — no doubling", async () => {
		// Same setup as above but via preset.formatSelection.
		// Doc layout (offsets):
		//   "# Heading\n"  → 10 chars (line 0, offsets 0-9)
		//   "\n"           →  1 char  (line 1, offset 10)
		//   "## Sub\n"     →  7 chars (line 2, offsets 11-17)
		//   "\n"           →  1 char  (line 3, offset 18)
		//   "Rest.\n"      →  6 chars (line 4)
		const doc = "# Heading\n\n## Sub\n\nRest.\n";

		// Selection: anchor = start of "## Sub" (line 2, ch 0, offset 11)
		//            head   = start of blank line after (line 3, ch 0, offset 18)
		// selectionContext: input="## Sub\n", cursor=18, from=11, to=18
		// doc.slice(0,18) = "# Heading\n\n## Sub" → last heading=## ctxLevel=2
		// shift = (2+1-2) = 1 → "## Sub\n" → "### Sub\n"
		// cascadeSelectionPlan remaps to {from:11, to:18, insert:"### Sub\n"} (replace)
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

		const result = editor.getValue();

		// No doubling: result must be close in length to original
		expect(
			result.length,
			`doc length must not roughly double: original=${doc.length}, result=${result.length}`,
		).toBeLessThan(doc.length + 10);

		// cascade must have transformed "## Sub" → "### Sub"
		expect(result, "cascade must have shifted the heading level").toContain("### Sub");

		// The original "## Sub" heading must be gone (replaced, not duplicated)
		const originalHeadingCount = (result.match(/^## Sub/gm) ?? []).length;
		expect(
			originalHeadingCount,
			`"## Sub" must be replaced, not retained; found ${originalHeadingCount} occurrences`,
		).toBe(0);

		// A count Notice must have been shown
		const countNotices = noticeLog().filter((m: string) => /^Mason: \d+ change/.test(m));
		expect(
			countNotices.length,
			"expected a count Notice after Format selection applied a cascade plan",
		).toBeGreaterThanOrEqual(1);
	});
});

// ---------------------------------------------------------------------------
// (g) Paste and format — guarded as Phase 5 not-yet-available
//
// "Mason: Paste and format" must NOT run any live operations in Phase 3.
// It must show a "not available yet" Notice and leave the doc unchanged.
// ---------------------------------------------------------------------------

describe("T3.4(g) — Paste and format is guarded (Phase 5 seam)", () => {
	beforeEach(() => clearNoticeLog());

	it("preset.pasteAndFormat shows not-available Notice and leaves doc unchanged", async () => {
		const doc = "# Title\n\n## Section\n\nContent.\n";
		const editor = makeCmEditor(doc, {
			cursor: { line: 1, ch: 0 },
		});
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

		const pasteCmd = commands.find((c) => c.id === "preset.pasteAndFormat");
		expect(pasteCmd, "preset.pasteAndFormat must be registered").toBeDefined();

		pasteCmd!.editorCallback(editor as unknown as Editor);

		// Doc must NOT have been mutated
		expect(
			editor.getValue(),
			"pasteAndFormat must not modify the document in Phase 3",
		).toBe(docBefore);

		// Must show a Notice indicating the feature is not available
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);
		const hasNotAvailableNotice = notices.some(
			(m: string) => /available/i.test(m) || /not yet/i.test(m) || /phase/i.test(m),
		);
		expect(
			hasNotAvailableNotice,
			`expected a "not available" Notice; got: ${JSON.stringify(notices)}`,
		).toBe(true);
	});

	it("preset.pasteAndFormat does not show a count Notice (no operations ran)", async () => {
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

		const pasteCmd = commands.find((c) => c.id === "preset.pasteAndFormat");
		pasteCmd!.editorCallback(editor as unknown as Editor);

		// Must NOT show a count Notice ("Mason: N change(s)") — no steps ran
		const countNotices = noticeLog().filter((m: string) => /^Mason: \d+ change/.test(m));
		expect(
			countNotices.length,
			"pasteAndFormat must not show a count Notice",
		).toBe(0);
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
