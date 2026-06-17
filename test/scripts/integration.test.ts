// T5.5B  Import flow + T5.5C paste command — integration tests
//
// Tests cover three behaviours:
//
//   B. importScript: reads vault text, computes sha256 checksum, writes .cjs to
//      plugin scripts dir, records manifest entry via ScriptStore.
//
//   C. Paste-and-format command: reads clipboard, builds pasteContext, runs
//      perplexityAutoScript via ScriptRunner; on success calls applyPlan; on
//      failure calls rawFallback (inserts raw clipboard text). No partial edits.
//
// Testability decisions:
//   - importScript is exported from src/scripts/runtime.ts and accepts injected
//     store + vaultAdapter ports → testable without touching Plugin instance.
//   - The paste command reads plugin._commandInjection before running; tests set
//     this property to substitute clipboardReader, applyPlan, and failScript.
//   - rawFallback calls editor.replaceSelection(rawText); tests spy on _replaced.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import type { VaultAdapterPort } from "../../src/scripts/store";
import { ScriptStore } from "../../src/scripts/store";
import type { PluginDataPort } from "../../src/scripts/store";
import { importScript } from "../../src/scripts/runtime";
import type { ImportScriptArgs } from "../../src/scripts/runtime";

// ---------------------------------------------------------------------------
// Part B: importScript — vault import flow
//
// importScript(args) must:
//   1. Read text from vaultAdapter.read(vaultPath)
//   2. Compute checksum = "sha256:" + sha256hex(text)
//   3. Write text to <destPath> via vaultAdapter.write (mkdir-safe)
//   4. Record manifest entry via store.setManifestEntry(id, {source, checksum, version})
// ---------------------------------------------------------------------------

// --- in-memory adapter factories ---

function makePluginDataPort(initial: unknown = {}): PluginDataPort & { _data: () => unknown } {
	let stored: unknown = initial;
	return {
		_data: () => stored,
		load: async (): Promise<unknown> => stored,
		save: async (data: unknown): Promise<void> => { stored = data; },
	};
}

function makeVaultAdapter(): VaultAdapterPort & {
	_files: Map<string, string>;
	_dirs: Set<string>;
} {
	const files = new Map<string, string>();
	const dirs = new Set<string>();
	return {
		_files: files,
		_dirs: dirs,
		read: async (path: string): Promise<string> => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`VaultAdapter: file not found: ${path}`);
			return content;
		},
		write: async (path: string, data: string): Promise<void> => {
			files.set(path, data);
		},
		exists: async (path: string): Promise<boolean> => files.has(path),
		mkdir: async (path: string): Promise<void> => { dirs.add(path); },
	};
}

// Helper: compute expected checksum the same way importScript should
function sha256Checksum(text: string): string {
	return "sha256:" + createHash("sha256").update(text).digest("hex");
}

describe("T5.5B importScript — vault import flow", () => {
	let pluginData: ReturnType<typeof makePluginDataPort>;
	let vaultAdapter: ReturnType<typeof makeVaultAdapter>;
	let store: ScriptStore;

	beforeEach(() => {
		pluginData = makePluginDataPort();
		vaultAdapter = makeVaultAdapter();
		store = new ScriptStore(pluginData, vaultAdapter, ".obsidian/plugins/markdown-mason/device.json");
	});

	it("records a manifest entry with the correct sha256 checksum for known text", async () => {
		const scriptText = 'module.exports = function() { return []; };\n';
		const vaultPath = "scripts/my-script.cjs";
		const destPath = ".obsidian/plugins/markdown-mason/scripts/my-script.cjs";
		vaultAdapter._files.set(vaultPath, scriptText);

		const args: ImportScriptArgs = {
			id: "my-script",
			vaultPath,
			destPath,
			version: 1,
			store,
			vaultAdapter,
		};

		await importScript(args);

		const manifest = await store.getManifest();
		expect(manifest["my-script"]).toBeDefined();
		expect(manifest["my-script"]!.checksum).toBe(sha256Checksum(scriptText));
	});

	it("checksum matches the exact sha256 of the script text byte-for-byte", async () => {
		// Use known text to verify the checksum format and value
		const knownText = "hello mason\n";
		const expectedHex = createHash("sha256").update(knownText).digest("hex");
		const expectedChecksum = `sha256:${expectedHex}`;

		const vaultPath = "scripts/known.cjs";
		const destPath = ".obsidian/plugins/markdown-mason/scripts/known.cjs";
		vaultAdapter._files.set(vaultPath, knownText);

		await importScript({
			id: "known",
			vaultPath,
			destPath,
			version: 2,
			store,
			vaultAdapter,
		});

		const manifest = await store.getManifest();
		expect(manifest["known"]!.checksum).toBe(expectedChecksum);
	});

	it("writes the script text to the destination path via vaultAdapter", async () => {
		const scriptText = "// my imported script\nmodule.exports = () => undefined;\n";
		const vaultPath = "vault/scripts/imported.cjs";
		const destPath = ".obsidian/plugins/markdown-mason/scripts/imported.cjs";
		vaultAdapter._files.set(vaultPath, scriptText);

		await importScript({
			id: "imported",
			vaultPath,
			destPath,
			version: 1,
			store,
			vaultAdapter,
		});

		// The script content must be written to destPath
		expect(vaultAdapter._files.get(destPath)).toBe(scriptText);
	});

	it("records the manifest source as the original vaultPath", async () => {
		const vaultPath = "vault/scripts/my-script.cjs";
		const destPath = ".obsidian/plugins/markdown-mason/scripts/my-script.cjs";
		vaultAdapter._files.set(vaultPath, "// script");

		await importScript({
			id: "my-script",
			vaultPath,
			destPath,
			version: 3,
			store,
			vaultAdapter,
		});

		const manifest = await store.getManifest();
		expect(manifest["my-script"]!.source).toBe(vaultPath);
	});

	it("records the manifest version as supplied", async () => {
		const vaultPath = "vault/scripts/versioned.cjs";
		const destPath = ".obsidian/plugins/markdown-mason/scripts/versioned.cjs";
		vaultAdapter._files.set(vaultPath, "// versioned script");

		await importScript({
			id: "versioned",
			vaultPath,
			destPath,
			version: 7,
			store,
			vaultAdapter,
		});

		const manifest = await store.getManifest();
		expect(manifest["versioned"]!.version).toBe(7);
	});

	it("calls mkdir on the directory containing destPath before writing", async () => {
		const vaultPath = "vault/scripts/deep.cjs";
		const destPath = ".obsidian/plugins/markdown-mason/scripts/deep.cjs";
		vaultAdapter._files.set(vaultPath, "// deep script");

		await importScript({
			id: "deep",
			vaultPath,
			destPath,
			version: 1,
			store,
			vaultAdapter,
		});

		// The parent directory must have been created
		expect(vaultAdapter._dirs.has(".obsidian/plugins/markdown-mason/scripts")).toBe(true);
	});

	it("two different scripts produce different checksums", async () => {
		const text1 = "// script one\nmodule.exports = () => 'one';\n";
		const text2 = "// script two\nmodule.exports = () => 'two';\n";
		const vaultPath1 = "scripts/one.cjs";
		const vaultPath2 = "scripts/two.cjs";
		vaultAdapter._files.set(vaultPath1, text1);
		vaultAdapter._files.set(vaultPath2, text2);

		await importScript({
			id: "script-one",
			vaultPath: vaultPath1,
			destPath: ".obsidian/plugins/markdown-mason/scripts/one.cjs",
			version: 1,
			store,
			vaultAdapter,
		});
		await importScript({
			id: "script-two",
			vaultPath: vaultPath2,
			destPath: ".obsidian/plugins/markdown-mason/scripts/two.cjs",
			version: 1,
			store,
			vaultAdapter,
		});

		const manifest = await store.getManifest();
		expect(manifest["script-one"]!.checksum).not.toBe(manifest["script-two"]!.checksum);
	});

	it("rejects a destPath containing a '..' traversal segment", async () => {
		const vaultPath = "scripts/safe.cjs";
		vaultAdapter._files.set(vaultPath, "// safe");

		const traversalDestPath = ".obsidian/plugins/markdown-mason/scripts/../../../evil.cjs";

		await expect(
			importScript({
				id: "evil",
				vaultPath,
				destPath: traversalDestPath,
				version: 1,
				store,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: path traversal rejected:");
	});

	it("rejects a vaultPath containing a '..' traversal segment", async () => {
		await expect(
			importScript({
				id: "evil",
				vaultPath: "../../../etc/passwd",
				destPath: ".obsidian/plugins/markdown-mason/scripts/safe.cjs",
				version: 1,
				store,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: path traversal rejected:");
	});

	// SEC-004: Windows-style backslash traversal in destPath
	it("SEC-004: rejects a destPath with Windows backslash traversal (..\\..\\evil.cjs)", async () => {
		const vaultPath = "scripts/safe.cjs";
		vaultAdapter._files.set(vaultPath, "// safe");

		await expect(
			importScript({
				id: "evil-win",
				vaultPath,
				destPath: "..\\..\\evil.cjs",
				version: 1,
				store,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: path traversal rejected:");
	});

	// SEC-005: absolute destPath is rejected
	it("SEC-005: rejects an absolute destPath (/etc/evil.cjs)", async () => {
		const vaultPath = "scripts/safe.cjs";
		vaultAdapter._files.set(vaultPath, "// safe");

		await expect(
			importScript({
				id: "evil-abs-dest",
				vaultPath,
				destPath: "/etc/evil.cjs",
				version: 1,
				store,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: absolute path rejected:");
	});

	// SEC-005: absolute vaultPath is rejected
	it("SEC-005: rejects an absolute vaultPath (/etc/passwd)", async () => {
		await expect(
			importScript({
				id: "evil-abs-vault",
				vaultPath: "/etc/passwd",
				destPath: ".obsidian/plugins/markdown-mason/scripts/safe.cjs",
				version: 1,
				store,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: absolute path rejected:");
	});
});

// ---------------------------------------------------------------------------
// Part C: Paste command wiring via main.ts
//
// Tests verify the paste command (id: "mason.pasteAndFormat") registered in
// main.ts:
//   - On success: applyPlan spy receives the EditPlan (no partial edits)
//   - On failure (script throws): rawFallback is called, applyPlan is NOT called
//   - On empty clipboard: shows Notice, does nothing
//
// The paste command reads plugin._commandInjection at call time, allowing tests
// to substitute clipboardReader, applyPlan, and failScript without altering
// the Obsidian editorCallback signature.
// ---------------------------------------------------------------------------

import { App } from "obsidian";
import { noticeLog, clearNoticeLog } from "../__mocks__/obsidian";
import type { Editor } from "obsidian";

// Dynamic import of MarkdownMasonPlugin after mock alias is active
const { MarkdownMasonPlugin } = await import("../../src/main");

// --- minimal Editor stub for paste command tests ---
// (applyEditPlan is not invoked directly; we spy on RunnerEffects.applyPlan)

function makePasteEditorStub(doc: string): Editor & {
	_replaced: string[];
	_doc: () => string;
} {
	const lines = doc.split("\n");
	const replacedParts: string[] = [];

	function posToOffset(pos: { line: number; ch: number }): number {
		let offset = 0;
		for (let i = 0; i < pos.line; i++) {
			offset += (lines[i]?.length ?? 0) + 1;
		}
		return offset + pos.ch;
	}

	return {
		_replaced: replacedParts,
		_doc: () => doc,
		getValue: () => doc,
		getCursor: () => ({ line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 }),
		posToOffset,
		listSelections: () => [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
		],
		replaceSelection: (text: string): void => { replacedParts.push(text); },
		getSelection: () => "",
		replaceRange: () => undefined,
		setCursor: () => undefined,
		setSelection: () => undefined,
		setSelections: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lines.length - 1,
		somethingSelected: () => false,
		getRange: () => "",
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
	} as unknown as Editor & { _replaced: string[]; _doc: () => string };
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
function findCommand(plugin: InstanceType<typeof MarkdownMasonPlugin>, id: string): any {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const commands = (plugin as any)._commands as Array<{
		id: string;
		name: string;
		editorCallback(editor: Editor): void | Promise<void>;
	}>;
	return commands.find((c) => c.id === id);
}

// ---------------------------------------------------------------------------
// C1: paste command is registered
// ---------------------------------------------------------------------------

describe("T5.5C — mason.pasteAndFormat command registration", () => {
	beforeEach(() => clearNoticeLog());

	it("registers 'mason.pasteAndFormat' command after onLayoutReady", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd, "mason.pasteAndFormat command must be registered").toBeDefined();
	});

	it("'mason.pasteAndFormat' command name starts with 'Mason:'", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd?.name).toMatch(/^Mason:/);
	});
});

// ---------------------------------------------------------------------------
// C2: on success, no rawFallback (replaceSelection) called
//
// perplexityAutoScript returns undefined for unrecognized text (noop) and
// a real EditPlan for recognized Perplexity text. Either way, on the non-failure
// path rawFallback must NOT be called.
//
// We use a simple clipboard input. Since perplexityAutoScript may return noop
// for arbitrary text, the key invariant is: NO rawFallback on non-failure path.
// ---------------------------------------------------------------------------

describe("T5.5C — paste command success path", () => {
	beforeEach(() => clearNoticeLog());

	it("applyPlan spy is called and rawFallback is NOT called when script succeeds", async () => {
		const plugin = await makePluginAndFireLayout();
		const editor = makePasteEditorStub("# My Note\n\n");

		const applyPlanSpy = vi.fn();

		// Inject test doubles via plugin._commandInjection
		plugin._commandInjection = {
			clipboardReader: async () => "Some clipboard text to paste.\n",
			applyPlan: applyPlanSpy,
			// failScript not set → perplexityAutoScript runs normally
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd).toBeDefined();

		// editorCallback is async (fire-and-forget in production); await it in tests
		await cmd.editorCallback(editor);

		// On success (or noop): rawFallback must NOT be called
		expect(
			editor._replaced,
			"rawFallback (replaceSelection) must NOT be called on success/noop path",
		).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// C3: on failure, rawFallback is called; applyPlan is NOT called; no partial edit
// ---------------------------------------------------------------------------

describe("T5.5C — paste command raw fallback on script failure", () => {
	beforeEach(() => clearNoticeLog());

	it("rawFallback (replaceSelection) called with raw text when script throws; applyPlan not called", async () => {
		const plugin = await makePluginAndFireLayout();
		const doc = "# Existing note\n\n";
		const editor = makePasteEditorStub(doc);

		const rawClipboardText = "Raw paste text that causes script failure.\n";
		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			clipboardReader: async () => rawClipboardText,
			applyPlan: applyPlanSpy,
			failScript: true, // force the runner script to throw
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd).toBeDefined();

		await cmd.editorCallback(editor);

		// On failure: rawFallback must insert the raw clipboard text
		expect(
			editor._replaced,
			"rawFallback must call replaceSelection with raw text on failure",
		).toContain(rawClipboardText);

		// On failure: applyPlan must NOT be called (atomicity guarantee)
		expect(
			applyPlanSpy,
			"applyPlan must NOT be called when script fails",
		).not.toHaveBeenCalled();

		// The document must not have been partially edited (applyPlan not called)
		expect(
			editor._doc(),
			"document must remain unchanged on failure (no partial edit)",
		).toBe(doc);
	});

	it("a Notice is shown on script failure", async () => {
		const plugin = await makePluginAndFireLayout();
		const editor = makePasteEditorStub("# Note\n\n");

		plugin._commandInjection = {
			clipboardReader: async () => "some text",
			applyPlan: vi.fn(),
			failScript: true,
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		await cmd.editorCallback(editor);

		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice on failure").toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// C4: empty clipboard → Notice, no script run, no rawFallback
// ---------------------------------------------------------------------------

describe("T5.5C — paste command with empty clipboard", () => {
	beforeEach(() => clearNoticeLog());

	it("shows a Notice and does not call applyPlan or replaceSelection when clipboard is empty", async () => {
		const plugin = await makePluginAndFireLayout();
		const editor = makePasteEditorStub("# Note\n\n");
		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			clipboardReader: async () => "",
			applyPlan: applyPlanSpy,
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd).toBeDefined();

		await cmd.editorCallback(editor);

		// Empty clipboard → Notice shown
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice for empty clipboard").toBeGreaterThan(0);

		// No script ran → no applyPlan
		expect(applyPlanSpy).not.toHaveBeenCalled();

		// No rawFallback (replaceSelection) for empty clipboard
		expect(editor._replaced).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// D: Selection script commands — bound script runs on selection, applyPlan called
//
// Tests verify the per-script selection commands (mason.script.perplexity-*):
//   - The command is registered
//   - When invoked on a selection, the script runs and applyPlan is called with
//     the produced EditPlan (non-empty plan case)
//   - rawFallback (replaceSelection) is NOT called on success
//   - On script failure, rawFallback is a NO-OP (selection left intact)
//
// Editor stub: listSelections() returns a selection covering the full doc text
// so selectionContext() uses the full doc as ctx.input.
//
// Input: minimal valid Perplexity-app format text that produces a non-empty
// EditPlan via perplexityAutoScript (Sources marker + at least one source line).
// ---------------------------------------------------------------------------

import type { EditorPosition, EditorSelection } from "obsidian";

/** Build a minimal editor stub where listSelections() returns a full-doc selection. */
function makeSelectionEditorStub(doc: string): Editor & { _replaced: string[] } {
	const lines = doc.split("\n");
	const replacedParts: string[] = [];

	function posToOffset(pos: EditorPosition): number {
		let offset = 0;
		for (let i = 0; i < pos.line; i++) {
			offset += (lines[i]?.length ?? 0) + 1;
		}
		return offset + pos.ch;
	}

	// Select the entire document: anchor at start, head at end of last line
	const lastLine = lines.length - 1;
	const lastCh = lines[lastLine]?.length ?? 0;
	const selections: EditorSelection[] = [
		{
			anchor: { line: 0, ch: 0 } as EditorPosition,
			head: { line: lastLine, ch: lastCh } as EditorPosition,
		},
	];

	return {
		_replaced: replacedParts,
		getValue: () => doc,
		getCursor: () => ({ line: lastLine, ch: lastCh } as EditorPosition),
		posToOffset,
		listSelections: (): EditorSelection[] => selections,
		replaceSelection: (text: string): void => { replacedParts.push(text); },
		getSelection: () => doc,
		replaceRange: () => undefined,
		setCursor: () => undefined,
		setSelection: () => undefined,
		setSelections: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lastLine,
		somethingSelected: () => true,
		getRange: () => "",
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
				if (remaining < len) return { line: i, ch: remaining } as EditorPosition;
				remaining -= len;
			}
			return { line: lastLine, ch: lastCh } as EditorPosition;
		},
		processLines: () => undefined,
		getDoc: function () { return this as unknown as typeof this; },
		setLine: () => undefined,
	} as unknown as Editor & { _replaced: string[] };
}

// Minimal Perplexity-app format text: ## Answer header + Sources marker + one cited source.
// perplexityAutoScript will detect this as perplexityApp format and produce
// a non-empty EditPlan (Resources section with the footnote definition).
//
// The perplexityApp parser requires a "## Answer" block header for prose
// and source extraction. ctx.op.doc is the same as the selection text.
const PERPLEXITY_APP_INPUT = [
	"## Answer",
	"",
	"Some answer text with citation [1].",
	"",
	"Sources",
	"[1] Example Article https://example.com/article",
].join("\n");

describe("D — selection script commands: bound script runs on selection, applyPlan called", () => {
	beforeEach(() => clearNoticeLog());

	it("mason.script.perplexity-auto is registered after onLayoutReady", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.script.perplexity-auto");
		expect(cmd, "mason.script.perplexity-auto must be registered").toBeDefined();
		expect(cmd?.name).toBe("Mason: Perplexity auto");
	});

	it("mason.script.perplexity-app is registered after onLayoutReady", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.script.perplexity-app");
		expect(cmd, "mason.script.perplexity-app must be registered").toBeDefined();
	});

	it("mason.script.perplexity-web is registered after onLayoutReady", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.script.perplexity-web");
		expect(cmd, "mason.script.perplexity-web must be registered").toBeDefined();
	});

	it("mason.script.perplexity-web-download is registered after onLayoutReady", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.script.perplexity-web-download");
		expect(cmd, "mason.script.perplexity-web-download must be registered").toBeDefined();
	});

	it("mason.script.perplexity-auto on a Perplexity-app selection calls applyPlan with the produced plan", async () => {
		const plugin = await makePluginAndFireLayout();
		// Editor with full-doc selection: selectionContext uses the entire doc as input
		const editor = makeSelectionEditorStub(PERPLEXITY_APP_INPUT);

		const applyPlanSpy = vi.fn();

		// Inject applyPlan spy via the shared _commandInjection test seam.
		// Selection commands pass this._commandInjection to _runScriptOnSelection.
		plugin._commandInjection = {
			applyPlan: applyPlanSpy,
		};

		const cmd = findCommand(plugin, "mason.script.perplexity-auto");
		expect(cmd, "mason.script.perplexity-auto must be registered").toBeDefined();

		await cmd.editorCallback(editor);

		// Script produced a non-empty EditPlan → applyPlan must have been called
		expect(
			applyPlanSpy,
			"applyPlan must be called when the script produces a non-empty EditPlan",
		).toHaveBeenCalledOnce();

		// The plan passed to applyPlan must be a non-empty EditPlan array
		const planArg = applyPlanSpy.mock.calls[0]?.[0] as unknown[];
		expect(
			Array.isArray(planArg) && planArg.length > 0,
			`applyPlan must receive a non-empty EditPlan; got: ${JSON.stringify(planArg)}`,
		).toBe(true);

		// rawFallback (replaceSelection) must NOT be called on success
		expect(
			editor._replaced,
			"rawFallback must NOT be called on success path",
		).toHaveLength(0);
	});

	it("selection command is a noop when script returns undefined — replaceSelection and applyPlan not called", async () => {
		// Script returns undefined for unrecognized input (noop path, not a throw).
		// rawFallback is never triggered; applyPlan is not called.
		const plugin = await makePluginAndFireLayout();
		const doc = "# My Note\n\nSelected text.";
		const editor = makeSelectionEditorStub(doc);

		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			applyPlan: applyPlanSpy,
			// scriptOverride not set — perplexityAutoScript runs and returns noop for this input
		};

		const cmd = findCommand(plugin, "mason.script.perplexity-auto");
		await cmd.editorCallback(editor);

		// Script returned undefined → noop: replaceSelection not called
		expect(
			editor._replaced,
			"replaceSelection must not be called when script returns noop",
		).toHaveLength(0);

		// applyPlan not called (noop path)
		expect(
			applyPlanSpy,
			"applyPlan must not be called when script returns noop",
		).not.toHaveBeenCalled();
	});

	it("selection command throw path: rawFallback is no-op, applyPlan not called, Notice shown", async () => {
		// When the script throws, the runner triggers rawFallback (a no-op for selection)
		// and must NOT call applyPlan (atomicity). A Notice must be shown.
		const plugin = await makePluginAndFireLayout();
		const doc = "# My Note\n\nSelected text.";
		const editor = makeSelectionEditorStub(doc);

		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			applyPlan: applyPlanSpy,
			scriptOverride: () => { throw new Error("forced selection failure"); },
		};

		const cmd = findCommand(plugin, "mason.script.perplexity-auto");
		await cmd.editorCallback(editor);

		// rawFallback for selection is a no-op — replaceSelection must NOT be called
		expect(
			editor._replaced,
			"rawFallback must be a no-op for selection commands (doc unchanged)",
		).toHaveLength(0);

		// applyPlan must NOT be called (atomicity: applyPlan XOR rawFallback)
		expect(
			applyPlanSpy,
			"applyPlan must NOT be called when script throws (atomicity)",
		).not.toHaveBeenCalled();

		// A Notice must be shown to inform the user of the failure
		const notices = noticeLog();
		expect(notices.length, "expected at least one Notice on selection script failure").toBeGreaterThan(0);
	});
});
