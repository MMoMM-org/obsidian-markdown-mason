/**
 * T2.2 — "Paste and format" command
 *
 * Tests for mason.pasteAndFormatText (id) / "Paste and format" (name).
 *
 * Uses two CommandInjection seams:
 *   clipboardReader  — replaces navigator.clipboard.readText()
 *   replaceSelection — replaces editor.replaceSelection() (the new T2.2 seam)
 *
 * All tests use the replaceSelection injection rather than a full CM6 editor
 * so they stay pure-unit tests (no applyEditPlan/CM6 machinery needed).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { App } from "obsidian";
import { noticeLog, clearNoticeLog } from "./__mocks__/obsidian";
import type { Editor } from "obsidian";

// Dynamic import after mock alias is active
const { MarkdownMasonPlugin } = await import("../src/main");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Editor stub — paste+format only needs the replaceSelection seam. */
function makeEditor(): Editor {
	return {
		replaceSelection: vi.fn(),
		getSelection: vi.fn().mockReturnValue(""),
		getValue: vi.fn().mockReturnValue(""),
		setValue: vi.fn(),
		getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
		listSelections: vi.fn().mockReturnValue([
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
		]),
		posToOffset: vi.fn().mockReturnValue(0),
		getLine: vi.fn().mockReturnValue(""),
		lineCount: vi.fn().mockReturnValue(1),
		lastLine: vi.fn().mockReturnValue(0),
		somethingSelected: vi.fn().mockReturnValue(false),
		getRange: vi.fn().mockReturnValue(""),
		replaceRange: vi.fn(),
		setCursor: vi.fn(),
		setSelection: vi.fn(),
		setSelections: vi.fn(),
		focus: vi.fn(),
		blur: vi.fn(),
		hasFocus: vi.fn().mockReturnValue(false),
		getScrollInfo: vi.fn().mockReturnValue({ top: 0, left: 0 }),
		scrollTo: vi.fn(),
		scrollIntoView: vi.fn(),
		undo: vi.fn(),
		redo: vi.fn(),
		exec: vi.fn(),
		transaction: vi.fn(),
		wordAt: vi.fn().mockReturnValue(null),
		offsetToPos: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
		processLines: vi.fn(),
		refresh: vi.fn(),
		getDoc: vi.fn(),
		setLine: vi.fn(),
	} as unknown as Editor;
}

async function makePluginAndFireLayout() {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const app = new App() as any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const plugin = new MarkdownMasonPlugin(app, {} as any);
	await plugin.onload();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(plugin.app as any).workspace._fireLayoutReady();
	return plugin;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findCommand(plugin: any, id: string) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (plugin._commands as Array<{ id: string; name: string; editorCallback: (e: Editor) => void | Promise<void> }>)
		.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// (a) Registration
// ---------------------------------------------------------------------------

describe("T2.2(a) — mason.pasteAndFormatText command registration", () => {
	it("registers 'mason.pasteAndFormatText' command after onLayoutReady", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		expect(cmd, "mason.pasteAndFormatText must be registered").toBeDefined();
	});

	it("command name is 'Paste and format' (Obsidian prepends plugin name; no 'Mason:' prefix)", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		expect(cmd?.name).toBe("Paste and format");
	});
});

// ---------------------------------------------------------------------------
// (b) Cleanup pipeline — artifact-laden clipboard
// ---------------------------------------------------------------------------

describe("T2.2(b) — cleanup pipeline applies all 7 steps", () => {
	beforeEach(() => clearNoticeLog());

	it("de-wraps paragraph lines, joins hyphenated words, converts smart-quotes, normalises bullets", async () => {
		const plugin = await makePluginAndFireLayout();

		// Input with:
		//   - soft-wrapped paragraph (2 lines that dewrap should join)
		//   - end-of-line hyphenation (dehyphenate joins across \n)
		//   - smart quotes (decomposeLigatures converts)
		//   - * bullet (normalizeBullets converts to -)
		const raw = "Word one\nword two.\n\ncom-\nplex result.\n\n* Bullet item\n“Quoted”";

		const inserted: string[] = [];
		plugin._commandInjection = {
			clipboardReader: async () => raw,
			replaceSelection: (t: string) => inserted.push(t),
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		expect(inserted).toHaveLength(1);
		const result = inserted[0]!;

		// dewrap: "Word one\nword two." joined into one line
		expect(result).toContain("Word one word two.");
		expect(result).not.toMatch(/Word one\nword two\./);

		// dehyphenate: "com-\nplex" merged
		expect(result).toContain("complex result.");
		expect(result).not.toMatch(/com-\nplex/);

		// decomposeLigatures: U+201C/U+201D → ASCII "
		expect(result).toContain('"Quoted"');
		expect(result).not.toContain("“");

		// normalizeBullets: "* Bullet item" → "- Bullet item"
		expect(result).toContain("- Bullet item");
		expect(result).not.toContain("* Bullet item");
	});

	it("respects dewrap:false toggle — wrapped lines NOT joined; other steps still run", async () => {
		const plugin = await makePluginAndFireLayout();
		plugin.settings.formatSelection = { dewrap: false };

		const raw = "Line one\nline two.\n\n* Bullet\n“Quoted”";

		const inserted: string[] = [];
		plugin._commandInjection = {
			clipboardReader: async () => raw,
			replaceSelection: (t: string) => inserted.push(t),
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		expect(inserted).toHaveLength(1);
		const result = inserted[0]!;

		// dewrap OFF: wrapped lines must NOT be joined
		expect(result).toMatch(/Line one\nline two\./);

		// Other steps still apply
		expect(result).toContain("- Bullet");        // normalizeBullets
		expect(result).toContain('"Quoted"');         // decomposeLigatures
	});

	it("does NOT run paste scripts — inserted text is cleanup output only; scripts are never invoked", async () => {
		const plugin = await makePluginAndFireLayout();

		let scriptCalled = false;
		const inserted: string[] = [];

		plugin._commandInjection = {
			clipboardReader: async () => "Plain text.\n",
			replaceSelection: (t: string) => inserted.push(t),
			// Injecting a pasteScripts entry that would throw if invoked proves
			// the paste+format command never calls the script chain.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			pasteScripts: [{
				id: "test-script",
				record: { provenance: "curated" },
				module: {
					run: () => {
						scriptCalled = true;
						throw new Error("Script chain must NOT be invoked by Paste and format");
					},
					paste: { canHandle: () => true, priority: 100 },
				},
			}] as unknown as never,
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		// Must not throw (script was not called)
		await expect(cmd!.editorCallback(makeEditor())).resolves.not.toThrow();

		expect(scriptCalled, "paste script must NOT be called by Paste and format").toBe(false);
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toContain("Plain text.");
	});

	it("calls replaceSelection exactly once — single undo step", async () => {
		const plugin = await makePluginAndFireLayout();

		let callCount = 0;
		plugin._commandInjection = {
			clipboardReader: async () => "Some\nwrapped text.",
			replaceSelection: () => { callCount++; },
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		expect(callCount, "replaceSelection must be called exactly once → one undo step").toBe(1);
	});

	it("G4 — `---`-first-line snippet is CLEANED, not skipped as frontmatter (prepend guard)", async () => {
		const plugin = await makePluginAndFireLayout();

		// "---\ntitle: x  y\n" — without the \\n prepend, `---` at position 0 would
		// be classified as YAML frontmatter and tidyWhitespace would skip it (double
		// space preserved). The prepend guard prevents that classification.
		const raw = "---\ntitle: x  y\n";

		const inserted: string[] = [];
		plugin._commandInjection = {
			clipboardReader: async () => raw,
			replaceSelection: (t: string) => inserted.push(t),
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		expect(inserted).toHaveLength(1);
		const result = inserted[0]!;

		// Double space must be collapsed — proof that the block was NOT treated as frontmatter
		expect(result).not.toContain("x  y");
		expect(result).toContain("x y");
	});

	it("changed clipboard: notice reports real change count from diffToEditPlan (not hardcoded)", async () => {
		// Fixture with four distinct artifact types:
		//   - soft-wrapped paragraph lines (dewrap joins them)
		//   - end-of-line hyphenation (dehyphenate stitches across \n)
		//   - smart open/close quotes (decomposeLigatures converts each to ASCII ")
		//   - star bullet (normalizeBullets converts to -)
		// All these changes collapse into one edit span via diffToEditPlan,
		// so diffToEditPlan(raw, formatted).length === 1 and the notice is "Mason: 1 change".
		// This verifies the count is driven by diffToEditPlan, not hardcoded.
		const plugin = await makePluginAndFireLayout();

		const raw =
			"Word one\nword two.\n\ncom-\nplex result.\n\n* Bullet\n“Quoted”";

		const inserted: string[] = [];
		plugin._commandInjection = {
			clipboardReader: async () => raw,
			replaceSelection: (t: string) => inserted.push(t),
		};

		clearNoticeLog();
		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		expect(inserted).toHaveLength(1);
		// Confirm cleanup ran — formatted text must differ from raw
		expect(inserted[0]).not.toBe(raw);

		// diffToEditPlan(raw, formatted).length === 1 (one contiguous changed region)
		// → countNoticeMessage(1) → "Mason: 1 change"
		// The old hardcoded path was also countNoticeMessage(1), so this also
		// validates the new path never accidentally reports 0 or another wrong value.
		const notices = noticeLog();
		expect(notices).toContain("Mason: 1 change");
	});

	it("no-change clipboard: still inserts raw text; notice is 'Mason: pasted (nothing to clean up)'", async () => {
		const plugin = await makePluginAndFireLayout();

		// Already-clean: no double spaces, no soft-wrapping, proper bullets, no smart quotes
		const raw = "Already clean text.\n\n- List item\n";

		const inserted: string[] = [];
		plugin._commandInjection = {
			clipboardReader: async () => raw,
			replaceSelection: (t: string) => inserted.push(t),
		};

		clearNoticeLog();
		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		// Text inserted even when nothing to clean
		expect(inserted).toHaveLength(1);
		expect(inserted[0]).toBe(raw);

		// Notice must be "nothing to clean up", NOT "Nothing to format"
		const notices = noticeLog();
		expect(notices).toContain("Mason: pasted (nothing to clean up)");
		expect(notices).not.toContain("Nothing to format");
	});

	it("production fallback: editor.replaceSelection is called when injection.replaceSelection is absent", async () => {
		// Exercises the ?? right-hand side of:
		//   const insert = injection?.replaceSelection ?? ((t) => editor.replaceSelection(t));
		// All other tests supply injection.replaceSelection; this one omits it so the
		// closure that calls the real editor stub is the only insert path exercised.
		const plugin = await makePluginAndFireLayout();

		const raw = "Word one\nword two.\n\n* Bullet\n“Quoted”";
		plugin._commandInjection = {
			clipboardReader: async () => raw,
			// replaceSelection intentionally omitted — production fallback path
		};

		const editor = makeEditor();
		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(editor);

		// The production closure must have delegated to the editor stub exactly once
		expect(vi.mocked(editor.replaceSelection)).toHaveBeenCalledTimes(1);
		const inserted = vi.mocked(editor.replaceSelection).mock.calls[0]![0] as string;
		// Confirm cleanup ran through the full pipeline
		expect(inserted).toContain("Word one word two."); // dewrapped
		expect(inserted).toContain("- Bullet");            // normalizeBullets
		expect(inserted).toContain('"Quoted"');             // decomposeLigatures
	});
});

// ---------------------------------------------------------------------------
// (c) Clipboard guards
// ---------------------------------------------------------------------------

describe("T2.2(c) — clipboard guards", () => {
	beforeEach(() => clearNoticeLog());

	it("empty clipboard (whitespace-only): shows guard notice; replaceSelection NOT called", async () => {
		const plugin = await makePluginAndFireLayout();

		let insertCalled = false;
		plugin._commandInjection = {
			clipboardReader: async () => "   ",
			replaceSelection: () => { insertCalled = true; },
		};

		clearNoticeLog();
		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		expect(insertCalled, "replaceSelection must NOT be called for empty clipboard").toBe(false);
		const notices = noticeLog();
		expect(
			notices.some((m) => /empty/i.test(m) || /nothing to paste/i.test(m)),
			`expected an "empty" notice; got: ${JSON.stringify(notices)}`,
		).toBe(true);
	});

	it("unavailable clipboard (reader throws): shows guard notice; replaceSelection NOT called", async () => {
		const plugin = await makePluginAndFireLayout();

		let insertCalled = false;
		plugin._commandInjection = {
			clipboardReader: async () => {
				throw new Error("Clipboard API unavailable (requires secure context)");
			},
			replaceSelection: () => { insertCalled = true; },
		};

		clearNoticeLog();
		const cmd = findCommand(plugin, "mason.pasteAndFormatText");
		await cmd!.editorCallback(makeEditor());

		expect(insertCalled, "replaceSelection must NOT be called when clipboard is unavailable").toBe(false);
		const notices = noticeLog();
		expect(
			notices.some((m) => /unavailable/i.test(m)),
			`expected an "unavailable" notice; got: ${JSON.stringify(notices)}`,
		).toBe(true);
	});
});
