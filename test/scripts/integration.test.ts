// T5.5B  Import flow + T5.5C paste command — integration tests
//
// Tests cover three behaviours:
//
//   B. importScript (T2.3): reads vault bytes via readBinary, computes byte-exact
//      sha256 checksum, writes via writeBinary VERBATIM (CRLF bytes survive),
//      records ScriptRecord with okayed:null; returns { version, checksum }.
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
import { ScriptStore } from "../../src/scripts/store";
import { importScript } from "../../src/scripts/runtime";
import type { VaultAdapterPort } from "../../src/scripts/runtime";
import { sha256Bytes } from "../../src/scripts/checksum";

// ---------------------------------------------------------------------------
// Part B: importScript — vault import flow (T2.3 binary contract)
//
// importScript(args) must:
//   1. Read bytes from vaultAdapter.readBinary(vaultPath) → ArrayBuffer
//   2. Compute checksum = sha256Bytes(bytes) (byte-exact; CRLF ≠ LF)
//   3. Mkdir-safe: call vaultAdapter.mkdir(destDir) if available
//   4. Write VERBATIM via vaultAdapter.writeBinary(destPath, buf)
//   5. Record ScriptRecord: { provenance:"imported", enabled:false, okayed:null,
//      source:vaultPath, command:false }
//   6. Return { version, checksum }
// ---------------------------------------------------------------------------

// --- in-memory adapter factories ---

/** Binary-capable vault adapter for T2.3 import-flow tests. */
function makeBinaryVaultAdapter(): VaultAdapterPort & {
	_binaryFiles: Map<string, ArrayBuffer>;
	_dirs: Set<string>;
	readBinaryCalls: string[];
	writeBinaryCalls: Array<{ path: string; data: ArrayBuffer }>;
	writeCalls: string[];
} {
	const binaryFiles = new Map<string, ArrayBuffer>();
	const dirs = new Set<string>();
	const readBinaryCalls: string[] = [];
	const writeBinaryCalls: Array<{ path: string; data: ArrayBuffer }> = [];
	const writeCalls: string[] = [];
	return {
		_binaryFiles: binaryFiles,
		_dirs: dirs,
		readBinaryCalls,
		writeBinaryCalls,
		writeCalls,
		read: async (path: string): Promise<string> => {
			throw new Error(`read() must not be called on the import path; called with: ${path}`);
		},
		write: async (path: string, _data: string): Promise<void> => {
			writeCalls.push(path);
		},
		readBinary: async (path: string): Promise<ArrayBuffer> => {
			readBinaryCalls.push(path);
			const buf = binaryFiles.get(path);
			if (buf === undefined) throw new Error(`VaultAdapter: file not found: ${path}`);
			return buf;
		},
		writeBinary: async (path: string, data: ArrayBuffer): Promise<void> => {
			writeBinaryCalls.push({ path, data });
			binaryFiles.set(path, data);
		},
		exists: async (path: string): Promise<boolean> => binaryFiles.has(path),
		mkdir: async (path: string): Promise<void> => { dirs.add(path); },
	};
}

/** String-only vault adapter kept for the path-guard tests (guards fire before I/O). */
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
		readBinary: async (_path: string): Promise<ArrayBuffer> => {
			return new ArrayBuffer(0);
		},
		writeBinary: async (_path: string, _data: ArrayBuffer): Promise<void> => { /* no-op */ },
		exists: async (path: string): Promise<boolean> => files.has(path),
		mkdir: async (path: string): Promise<void> => { dirs.add(path); },
	};
}

// ---------------------------------------------------------------------------
// importScript — path guards (active; guards throw before store is touched)
//
// These four cases assert security invariants in importScript that are
// independent of the v0.1/v0.2 store shape: the guards throw before any
// store call is made, so they work against any setRecord-compatible stub.
// ---------------------------------------------------------------------------

describe("importScript — path guards", () => {
	// Minimal stub: setRecord must never be reached by the guard cases.
	const stubStore: Pick<typeof ScriptStore.prototype, "setRecord"> = {
		setRecord: async () => {},
	};

	it("rejects a destPath containing a '..' traversal segment", async () => {
		const vaultAdapter = makeVaultAdapter();
		vaultAdapter._files.set("scripts/safe.cjs", "// safe");

		await expect(
			importScript({
				id: "evil",
				vaultPath: "scripts/safe.cjs",
				destPath: ".obsidian/plugins/markdown-mason/scripts/../../../evil.cjs",
				version: 1,
				store: stubStore,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: path traversal rejected:");
	});

	// SEC-004: Windows-style backslash traversal in destPath
	it("SEC-004: rejects a destPath with Windows backslash traversal (..\\..\\evil.cjs)", async () => {
		const vaultAdapter = makeVaultAdapter();
		vaultAdapter._files.set("scripts/safe.cjs", "// safe");

		await expect(
			importScript({
				id: "evil-win",
				vaultPath: "scripts/safe.cjs",
				destPath: "..\\..\\evil.cjs",
				version: 1,
				store: stubStore,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: path traversal rejected:");
	});

	// SEC-005: absolute destPath is rejected
	it("SEC-005: rejects an absolute destPath (/etc/evil.cjs)", async () => {
		const vaultAdapter = makeVaultAdapter();
		vaultAdapter._files.set("scripts/safe.cjs", "// safe");

		await expect(
			importScript({
				id: "evil-abs-dest",
				vaultPath: "scripts/safe.cjs",
				destPath: "/etc/evil.cjs",
				version: 1,
				store: stubStore,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: absolute path rejected:");
	});

	// SEC-005: absolute vaultPath is rejected
	it("SEC-005: rejects an absolute vaultPath (/etc/passwd)", async () => {
		const vaultAdapter = makeVaultAdapter();

		await expect(
			importScript({
				id: "evil-abs-vault",
				vaultPath: "/etc/passwd",
				destPath: ".obsidian/plugins/markdown-mason/scripts/safe.cjs",
				version: 1,
				store: stubStore,
				vaultAdapter,
			}),
		).rejects.toThrow("importScript: absolute path rejected:");
	});
});

// ---------------------------------------------------------------------------
// T5.5B importScript — vault import flow (T2.3: binary contract)
//
// Asserts the new binary I/O contract (ADR-14):
//   - reads via readBinary (not string read)
//   - writes via writeBinary VERBATIM (no string round-trip)
//   - CRLF bytes survive the round-trip; checksum differs from LF variant
//   - ScriptRecord recorded with okayed:null (consent belongs to disclosure, PRD F2)
//   - returns { version, checksum } for the disclosure flow (T3.4)
//   - mkdir-safe behavior preserved
// ---------------------------------------------------------------------------

describe("T5.5B importScript — vault import flow", () => {
	const vaultPath = "vault/scripts/my-script.cjs";
	const destPath = ".obsidian/plugins/markdown-mason/scripts/my-script.cjs";
	const scriptId = "my-script";
	const scriptVersion = 1;

	function makeStore(): {
		setRecord: ReturnType<typeof vi.fn>;
	} {
		return { setRecord: vi.fn().mockResolvedValue(undefined) };
	}

	it("reads source via readBinary (not string read) and write is NOT called", async () => {
		const vaultAdapter = makeBinaryVaultAdapter();
		const bytes = new TextEncoder().encode("module.exports = () => {};\n");
		vaultAdapter._binaryFiles.set(vaultPath, bytes.buffer);
		const store = makeStore();

		await importScript({ id: scriptId, vaultPath, destPath, version: scriptVersion, store, vaultAdapter });

		expect(vaultAdapter.readBinaryCalls).toContain(vaultPath);
		// string write() must NOT be called on the import path (ADR-14)
		expect(vaultAdapter.writeCalls).toHaveLength(0);
	});

	it("writes via writeBinary VERBATIM — same ArrayBuffer read from source", async () => {
		const vaultAdapter = makeBinaryVaultAdapter();
		const bytes = new TextEncoder().encode("// script content\n");
		const sourceBuf = bytes.buffer;
		vaultAdapter._binaryFiles.set(vaultPath, sourceBuf);
		const store = makeStore();

		await importScript({ id: scriptId, vaultPath, destPath, version: scriptVersion, store, vaultAdapter });

		expect(vaultAdapter.writeBinaryCalls).toHaveLength(1);
		const writeCall = vaultAdapter.writeBinaryCalls[0]!;
		expect(writeCall.path).toBe(destPath);
		// Written bytes must equal the source bytes byte-for-byte
		const writtenBytes = new Uint8Array(writeCall.data);
		expect(writtenBytes).toEqual(bytes);
	});

	it("BYTE-EXACTNESS: CRLF bytes survive round-trip; checksum differs from LF variant", async () => {
		const crlfBytes = new TextEncoder().encode("line1\r\nline2");
		const lfBytes = new TextEncoder().encode("line1\nline2");

		const vaultAdapter = makeBinaryVaultAdapter();
		vaultAdapter._binaryFiles.set(vaultPath, crlfBytes.buffer);
		const store = makeStore();

		const result = await importScript({ id: scriptId, vaultPath, destPath, version: scriptVersion, store, vaultAdapter });

		// Written bytes must be CRLF — not normalized to LF
		const writeCall = vaultAdapter.writeBinaryCalls[0]!;
		expect(new Uint8Array(writeCall.data)).toEqual(crlfBytes);

		// Checksum over CRLF bytes must equal sha256Bytes of those exact bytes
		const expectedCrlfChecksum = sha256Bytes(crlfBytes);
		expect(result.checksum).toBe(expectedCrlfChecksum);

		// Checksum must differ from the LF variant (ADR-14: CRLF ≠ LF)
		const lfChecksum = sha256Bytes(lfBytes);
		expect(result.checksum).not.toBe(lfChecksum);
	});

	it("records ScriptRecord with okayed:null, provenance:'imported', source:vaultPath, enabled:false, command:false", async () => {
		const vaultAdapter = makeBinaryVaultAdapter();
		const bytes = new TextEncoder().encode("// script");
		vaultAdapter._binaryFiles.set(vaultPath, bytes.buffer);
		const store = makeStore();

		await importScript({ id: scriptId, vaultPath, destPath, version: scriptVersion, store, vaultAdapter });

		expect(store.setRecord).toHaveBeenCalledOnce();
		expect(store.setRecord).toHaveBeenCalledWith(scriptId, {
			provenance: "imported",
			enabled: false,
			okayed: null,
			source: vaultPath,
			command: false,
		});
	});

	it("does NOT set okayed on the ScriptRecord (consent is recorded by disclosure, PRD F2)", async () => {
		const vaultAdapter = makeBinaryVaultAdapter();
		const bytes = new TextEncoder().encode("// script");
		vaultAdapter._binaryFiles.set(vaultPath, bytes.buffer);
		const store = makeStore();

		await importScript({ id: scriptId, vaultPath, destPath, version: 3, store, vaultAdapter });

		const recordArg = store.setRecord.mock.calls[0]?.[1] as Record<string, unknown>;
		expect(recordArg).toBeDefined();
		expect(recordArg["okayed"]).toBeNull();
	});

	it("returns { version, checksum } matching sha256Bytes of the imported bytes", async () => {
		const vaultAdapter = makeBinaryVaultAdapter();
		const bytes = new TextEncoder().encode("module.exports = () => 'hello';\n");
		vaultAdapter._binaryFiles.set(vaultPath, bytes.buffer);
		const store = makeStore();

		const result = await importScript({ id: scriptId, vaultPath, destPath, version: 7, store, vaultAdapter });

		expect(result.checksum).toBe(sha256Bytes(bytes));
		expect(result.version).toBe(7);
	});

	it("mkdir called for nested destDir before writing (mkdir-safe)", async () => {
		const vaultAdapter = makeBinaryVaultAdapter();
		const bytes = new TextEncoder().encode("// deep script");
		vaultAdapter._binaryFiles.set(vaultPath, bytes.buffer);
		const store = makeStore();

		await importScript({ id: scriptId, vaultPath, destPath, version: scriptVersion, store, vaultAdapter });

		expect(vaultAdapter._dirs.has(".obsidian/plugins/markdown-mason/scripts")).toBe(true);
	});

	it("two scripts with different content produce different checksums", async () => {
		const vaultAdapter = makeBinaryVaultAdapter();
		const bytes1 = new TextEncoder().encode("// script one");
		const bytes2 = new TextEncoder().encode("// script two");
		vaultAdapter._binaryFiles.set("scripts/one.cjs", bytes1.buffer);
		vaultAdapter._binaryFiles.set("scripts/two.cjs", bytes2.buffer);
		const store = makeStore();

		const result1 = await importScript({
			id: "script-one",
			vaultPath: "scripts/one.cjs",
			destPath: ".obsidian/plugins/markdown-mason/scripts/one.cjs",
			version: 1,
			store,
			vaultAdapter,
		});
		const result2 = await importScript({
			id: "script-two",
			vaultPath: "scripts/two.cjs",
			destPath: ".obsidian/plugins/markdown-mason/scripts/two.cjs",
			version: 1,
			store,
			vaultAdapter,
		});

		expect(result1.checksum).not.toBe(result2.checksum);
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

	it("'mason.pasteAndFormat' command name does not start with 'Mason:' (Obsidian prepends plugin name)", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd?.name).toBe("Paste and format");
	});
});

// ---------------------------------------------------------------------------
// C2: on success, no rawFallback (replaceSelection) called
//
// When perplexityAutoScript returns a real EditPlan (recognized Perplexity text),
// the runner produces {kind:"applied"} → applyPlan is called and rawFallback is NOT.
//
// We use recognized Perplexity-app input so the script always returns an EditPlan.
// ---------------------------------------------------------------------------

// Minimal Perplexity-app format text: ## Answer header + Sources marker + one cited source.
// perplexityAutoScript will detect this as perplexityApp format and produce
// a non-empty EditPlan (Resources section with the footnote definition).
//
// The perplexityApp parser requires a "## Answer" block header for prose
// and source extraction. ctx.op.doc is the same as the selection text.
// Shared by the paste count-Notice test and the selection command tests below.
const PERPLEXITY_APP_INPUT = [
	"## Answer",
	"",
	"Some answer text with citation [1].",
	"",
	"Sources",
	"[1] Example Article https://example.com/article",
].join("\n");

describe("T5.5C — paste command success path", () => {
	beforeEach(() => clearNoticeLog());

	it("applyPlan spy is called and rawFallback is NOT called when script produces a plan", async () => {
		const plugin = await makePluginAndFireLayout();
		// Use a note with an existing H1 so cascade can find a context heading.
		const editor = makePasteEditorStub("# My Note\n\n");

		const applyPlanSpy = vi.fn();

		// Inject test doubles via plugin._commandInjection.
		// Use recognized Perplexity-app input so the script produces a real EditPlan.
		plugin._commandInjection = {
			clipboardReader: async () => PERPLEXITY_APP_INPUT,
			applyPlan: applyPlanSpy,
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd).toBeDefined();

		// editorCallback is async (fire-and-forget in production); await it in tests
		await cmd.editorCallback(editor);

		// Script produced a non-empty EditPlan → applyPlan called, rawFallback NOT called
		expect(applyPlanSpy, "applyPlan must be called on success path").toHaveBeenCalledOnce();
		expect(
			editor._replaced,
			"rawFallback (replaceSelection) must NOT be called on success path",
		).toHaveLength(0);
	});

	// PRD F8-AC2 / F7-AC3: a success Notice fires reporting footnotes filed.
	// For Perplexity-app input the script files footnote defs into Resources.
	it("paste command shows footnote-count Notice ('Mason: N footnote(s) filed') when script produces footnote defs (PRD F8-AC2/F7-AC3)", async () => {
		const plugin = await makePluginAndFireLayout();
		// Editor that already has a H1 heading so cascade can find a context heading above cursor.
		const editor = makePasteEditorStub("# Notes\n\n");

		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			// Clipboard contains Perplexity-app text → produces a real, non-empty EditPlan with footnote defs
			clipboardReader: async () => PERPLEXITY_APP_INPUT,
			applyPlan: applyPlanSpy,
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd).toBeDefined();

		clearNoticeLog();
		await cmd.editorCallback(editor);

		// Script produced a non-empty EditPlan → applyPlan called (pre-condition for Notice)
		expect(applyPlanSpy, "applyPlan must be called before we check the Notice").toHaveBeenCalledOnce();

		// Exactly ONE count Notice must fire (PRD F8-AC2)
		const notices = noticeLog();
		expect(notices, "exactly one count Notice must fire on apply success").toHaveLength(1);

		// The Notice message must report footnotes filed (feature b)
		expect(
			notices[0],
			"count Notice message must match 'Mason: N footnote' or 'Mason: N footnotes filed'",
		).toMatch(/^Mason: \d+ footnotes? filed$/);
	});
	// W1: fallback branch — paste command with a plan that has NO footnote defs.
	// When countFootnoteDefs returns 0 the Notice must match /^Mason: \d+ changes?$/.
	// This test deliberately fails if the else-branch in runPasteCommand is removed.
	it("paste command shows change-count Notice ('Mason: N change(s)') when plan has no footnote defs (W1 fallback branch)", async () => {
		const plugin = await makePluginAndFireLayout();
		const editor = makePasteEditorStub("# Note\n\n");

		const applyPlanSpy = vi.fn();

		// A script that returns a non-empty EditPlan with a plain-text insert — no [^n]: defs.
		// countFootnoteDefs will return 0, so the fallback Notice branch fires.
		plugin._commandInjection = {
			clipboardReader: async () => "some text",
			applyPlan: applyPlanSpy,
			scriptOverride: () => [{ from: 0, to: 0, insert: "plain text insert" }],
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd).toBeDefined();

		clearNoticeLog();
		await cmd.editorCallback(editor);

		// Script produced a non-empty EditPlan → applyPlan called (pre-condition for Notice)
		expect(applyPlanSpy, "applyPlan must be called before we check the Notice").toHaveBeenCalledOnce();

		// The fallback Notice must report edit count, not footnotes
		const notices = noticeLog();
		expect(notices, "exactly one count Notice must fire on apply success").toHaveLength(1);
		expect(
			notices[0],
			"fallback Notice must match 'Mason: N change(s)' when plan has no footnote defs",
		).toMatch(/^Mason: \d+ changes?$/);
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
// C5: noop path — script returns undefined → rawFallback fires + "pasted as-is" Notice
//
// When perplexityAutoScript returns undefined (no recognized format), the
// runner returns {kind:"noop"}.  runPasteCommand must:
//   1. Call rawFallback (replaceSelection with raw clipboard text)
//   2. Show a Notice matching /pasted as-is/
//   3. NOT call applyPlan
// ---------------------------------------------------------------------------

describe("T5.5C — paste command noop path: raw fallback fires when no format matches", () => {
	beforeEach(() => clearNoticeLog());

	it("replaceSelection called with raw text and 'pasted as-is' Notice shown when script returns undefined (noop)", async () => {
		const plugin = await makePluginAndFireLayout();
		const editor = makePasteEditorStub("# Note\n\n");

		const rawClipboardText = "plain text that no Perplexity parser recognizes";
		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			clipboardReader: async () => rawClipboardText,
			applyPlan: applyPlanSpy,
			// scriptOverride returns undefined → runner produces {kind:"noop"}
			scriptOverride: () => undefined,
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd).toBeDefined();

		clearNoticeLog();
		await cmd.editorCallback(editor);

		// rawFallback must insert the raw clipboard text at cursor
		expect(
			editor._replaced,
			"rawFallback must call replaceSelection with raw text on noop",
		).toContain(rawClipboardText);

		// applyPlan must NOT be called (noop = no structured plan)
		expect(
			applyPlanSpy,
			"applyPlan must NOT be called on noop",
		).not.toHaveBeenCalled();

		// A "pasted as-is" Notice must fire
		const notices = noticeLog();
		expect(notices.length, "expected exactly one Notice on noop").toBe(1);
		expect(
			notices[0],
			"Notice must match /pasted as-is/",
		).toMatch(/pasted as-is/);
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

describe("D — selection script commands: bound script runs on selection, applyPlan called", () => {
	beforeEach(() => clearNoticeLog());

	it("mason.script.perplexity-auto is registered after onLayoutReady", async () => {
		const plugin = await makePluginAndFireLayout();
		const cmd = findCommand(plugin, "mason.script.perplexity-auto");
		expect(cmd, "mason.script.perplexity-auto must be registered").toBeDefined();
		expect(cmd?.name).toBe("Perplexity auto");
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

	// PRD F8-AC2 / F7-AC3: success path — selection command shows footnote-count Notice.
	it("selection command shows footnote-count Notice ('Mason: N footnote(s) filed') when script produces footnote defs (PRD F8-AC2/F7-AC3)", async () => {
		const plugin = await makePluginAndFireLayout();
		const editor = makeSelectionEditorStub(PERPLEXITY_APP_INPUT);

		const applyPlanSpy = vi.fn();

		plugin._commandInjection = {
			applyPlan: applyPlanSpy,
		};

		const cmd = findCommand(plugin, "mason.script.perplexity-auto");
		expect(cmd).toBeDefined();

		clearNoticeLog();
		await cmd.editorCallback(editor);

		// Script produced a non-empty EditPlan → applyPlan called (pre-condition for Notice)
		expect(applyPlanSpy, "applyPlan must be called before we check the Notice").toHaveBeenCalledOnce();

		// Exactly ONE count Notice must fire (PRD F8-AC2)
		const notices = noticeLog();
		expect(notices, "exactly one count Notice must fire on apply success").toHaveLength(1);

		// The Notice message must report footnotes filed (feature b)
		expect(
			notices[0],
			"count Notice message must match 'Mason: N footnote' or 'Mason: N footnotes filed'",
		).toMatch(/^Mason: \d+ footnotes? filed$/);
	});

	// W1: fallback branch — selection command with a plan that has NO footnote defs.
	// When countFootnoteDefs returns 0 the Notice must match /^Mason: \d+ changes?$/.
	// This test deliberately fails if the else-branch in _runScriptOnSelection is removed.
	it("selection command shows change-count Notice ('Mason: N change(s)') when plan has no footnote defs (W1 fallback branch)", async () => {
		const plugin = await makePluginAndFireLayout();
		const doc = "# My Note\n\nSelected text.";
		const editor = makeSelectionEditorStub(doc);

		const applyPlanSpy = vi.fn();

		// A script that returns a non-empty EditPlan with a plain-text insert — no [^n]: defs.
		// countFootnoteDefs will return 0, so the fallback Notice branch fires.
		plugin._commandInjection = {
			applyPlan: applyPlanSpy,
			scriptOverride: () => [{ from: 0, to: 0, insert: "plain text insert" }],
		};

		const cmd = findCommand(plugin, "mason.script.perplexity-auto");
		expect(cmd).toBeDefined();

		clearNoticeLog();
		await cmd.editorCallback(editor);

		// Script produced a non-empty EditPlan → applyPlan called (pre-condition for Notice)
		expect(applyPlanSpy, "applyPlan must be called before we check the Notice").toHaveBeenCalledOnce();

		// The fallback Notice must report edit count, not footnotes
		const notices = noticeLog();
		expect(notices, "exactly one count Notice must fire on apply success").toHaveLength(1);
		expect(
			notices[0],
			"fallback Notice must match 'Mason: N change(s)' when plan has no footnote defs",
		).toMatch(/^Mason: \d+ changes?$/);
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
