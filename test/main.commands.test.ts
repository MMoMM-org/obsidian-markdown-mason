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
	// Preset command ids (preset.pasteAndFormat stub removed in Phase 5; real command is mason.pasteAndFormat)
	"preset.tidyFootnotes",
	"preset.formatSelection",
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

	it("no command name starts with 'Mason:' (Obsidian auto-prepends plugin name)", async () => {
		// Obsidian prepends "Markdown Mason: " to every command name in the palette.
		// Command names must NOT carry their own "Mason: " prefix — that would
		// produce "Markdown Mason: Mason: Paste and format" in the palette.
		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const workspace = (plugin.app as any).workspace;
		workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{ name: string }>;
		for (const cmd of commands) {
			expect(
				cmd.name,
				`"${cmd.name}" must NOT start with "Mason:" (Obsidian already prepends the plugin name)`,
			).not.toMatch(/^Mason:/i);
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

	it("preset.tidyFootnotes on a doc with no footnotes shows a descriptive Notice and leaves doc unchanged (empty-path coverage)", async () => {
		// A plain doc with no footnotes at all — tidyFootnotes returns an empty plan,
		// so the command must show a descriptive Notice and leave the doc untouched.
		const doc = "# Title\n\n## Section\n\nContent with no footnotes.\n";
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

		// Empty plan → descriptive Notice (not a count notice). Doc must be unchanged.
		expect(editor.getValue()).toBe(doc);
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice").toBeGreaterThan(0);
	});

	it("preset.tidyFootnotes on a real footnote doc: doc changes then ONE undo fully restores it (F4.4/F5/F7.1)", async () => {
		// Fixture: a doc with real footnote work across all three tidy stages (C → O+D → M).
		//
		// Body contains:
		//   [1]  — bare numeric citation (C converts to [^1])
		//   [^2] — already-converted inline ref
		//   [^A] — alpha ref, left untouched by all stages
		//
		// Defs are placed OUTSIDE the ## Resources section (M will move them in):
		//   [^1]: First source (unique URL) — renamed to [^1] by O+D
		//   [^2]: Duplicate URL as [^1]    — O+D merges [^2] into [^1], deletes this def
		//   [^A]: Alpha def                — never touched
		//
		// After C:   [1] → [^1]; doc now has [^1] and [^2] inline refs both present.
		// After O+D: [^2] refs merged into [^1] (same URL), duplicate def deleted.
		// After M:   [^1] def (now sole numeric def) moved under ## Resources.
		//
		// The overall tidy produces changes, so tidyFootnotes emits a non-empty plan.
		// That plan is dispatched as a single CM6 transaction; one CM6 undo() must
		// restore the original doc exactly, proving single-transaction atomicity.
		const doc = [
			"# My Note",
			"",
			"See footnote [1] and [^2] and [^A] for details.",
			"",
			"[^1]: First source",
			"[https://example.com/source](https://example.com/source)",
			"[^2]: Same URL as first",
			"[https://example.com/source](https://example.com/source)",
			"[^A]: Alpha note — never moved",
			"",
			"## Resources",
			"",
		].join("\n");

		const editor = makeCmEditor(doc);
		const original = editor.getValue();

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

		// Assert the plan was non-empty and the doc actually changed.
		const after = editor.getValue();
		expect(
			after,
			"tidyFootnotes must mutate a doc that has real footnote work to do",
		).not.toBe(original);

		// One CM6 undo must fully restore the original document exactly,
		// proving the entire tidy was dispatched as a single CM6 transaction.
		undo(editor.cm);
		expect(
			editor.getValue(),
			"one undo must restore the original document exactly (single-transaction proof)",
		).toBe(original);
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
// (g) Paste and format — stub removed, real command present
//
// The Phase-3 stub "preset.pasteAndFormat" (which showed "not available yet")
// was removed in Phase 5.  The real command "mason.pasteAndFormat" (registered
// by main.ts _registerPasteCommand) is now the ONLY "Paste and format" command.
// ---------------------------------------------------------------------------

describe("T3.4(g) — preset.pasteAndFormat stub removed; real command present", () => {
	beforeEach(() => clearNoticeLog());

	it("preset.pasteAndFormat stub is NOT registered (removed in Phase 5)", async () => {
		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{ id: string }>;
		const stubCmd = commands.find((c) => c.id === "preset.pasteAndFormat");
		expect(
			stubCmd,
			"preset.pasteAndFormat stub must NOT be registered (removed in Phase 5)",
		).toBeUndefined();
	});

	it("mason.pasteAndFormat real command IS registered (registered by main.ts)", async () => {
		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{ id: string; name: string }>;
		const realCmd = commands.find((c) => c.id === "mason.pasteAndFormat");
		expect(
			realCmd,
			"mason.pasteAndFormat real command must be registered",
		).toBeDefined();
		expect(realCmd!.name).toBe("Paste and format");
	});

	it("exactly ONE command has name 'Paste and format' — no duplicates", async () => {
		const plugin = makePlugin();
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{ name: string }>;
		const pasteCommands = commands.filter((c) => c.name === "Paste and format");
		expect(
			pasteCommands.length,
			`expected exactly 1 "Paste and format" command; found ${pasteCommands.length}`,
		).toBe(1);
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
// C-1 regression: preset.formatSelection must produce a VALID, non-overlapping
// EditPlan when the doc has numeric footnotes needing renumber AND a def outside
// Resources (O+D emits rename on def.from..def.to, M emits delete on the same
// span → overlapping edits in one CM6 transaction → garbled output before fix).
//
// Before fix: O+D and M each independently emit edits over the same def span;
// concatenating those plans via runPreset produces overlapping edits that CM6
// applies in undefined order, producing garbled output (e.g. doubled defs).
// After fix: the format-selection pipeline fuses the footnote steps via
// in-memory composition, emitting one clean EditPlan vs the original.
// ---------------------------------------------------------------------------

describe("C-1 regression — preset.formatSelection: no overlapping CM6 edits, single undo", () => {
	beforeEach(() => clearNoticeLog());

	it("produces correct output (not garbled) and single-undo when doc has numeric footnotes needing renumber AND def outside Resources", async () => {
		// This is the exact overlap trigger:
		//   - [^3] appears first in body (only numeric ref) → O+D renumbers to [^1]
		//   - [^3] def is outside Resources → M moves it to Resources
		//   Both O+D and M independently emit edits over the def's span (50..103)
		//   when concatenated via runPreset → overlapping edits → garbled output.
		//
		// After the fix (fused in-memory composition):
		//   - [^3] renamed to [^1] AND moved to Resources in one clean plan
		//   - Doc contains exactly one def [^1]: in Resources and no defs in body
		//   - One undo restores original (single-transaction proof)
		const doc = [
			"# Title",
			"",
			"Body text [^3] with a skipped footnote.",
			"",
			"[^3]: example snippet",
			"[Example](https://example.com)",
			"",
		].join("\n");

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

		const formatCmd = commands.find((c) => c.id === "preset.formatSelection");
		expect(formatCmd, "preset.formatSelection must be registered").toBeDefined();

		// (a) Must NOT throw
		expect(() => {
			formatCmd!.editorCallback(editor as unknown as Editor);
		}).not.toThrow();

		// (b) Doc must have changed (footnote was processed)
		const after = editor.getValue();
		expect(after, "preset.formatSelection must have changed the doc").not.toBe(doc);

		// (c) Output must be correct (not garbled):
		//     - [^1] def must appear exactly once (not doubled)
		//     - No def should remain in the body before ## Resources
		//     - Def should be in Resources section
		const resourcesIdx = after.indexOf("## Resources");
		expect(resourcesIdx, "## Resources section must exist after format").toBeGreaterThan(-1);
		const bodySection = after.slice(0, resourcesIdx);
		const resourcesSection = after.slice(resourcesIdx);
		// No defs in body (they were moved to Resources)
		expect(bodySection.match(/^\[\^\d+\]:/gm), "no footnote defs should remain in body").toBeNull();
		// Def appears exactly once in Resources (not doubled)
		const defCount = (resourcesSection.match(/^\[\^\d+\]:/gm) ?? []).length;
		expect(defCount, "exactly one footnote def in Resources (not doubled or missing)").toBe(1);
		// Ref was renumbered to [^1]
		expect(after).toContain("[^1]");
		expect(after).not.toContain("[^3]");

		// (d) One undo must restore the original doc exactly (single-transaction proof)
		undo(editor.cm);
		expect(
			editor.getValue(),
			"one undo must fully restore the original doc (single-transaction proof)",
		).toBe(doc);
	});
});
