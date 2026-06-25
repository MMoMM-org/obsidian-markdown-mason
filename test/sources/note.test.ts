import { describe, it, expect } from "vitest";
import type { Editor, EditorPosition, EditorSelection, TFile, Vault } from "obsidian";
import { noteContext } from "../../src/sources/note";
import type { MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// T3.3 noteContext adapter
//
// Behaviour under test:
//   1. Editor branch: when an editor is present, builds OperationContext from
//      the editor text (TOCTOU mitigation — prefers the live editor over vault).
//   2. Vault branch: when no editor is present, reads from vault.read(file).
//   3. cursor convention: 0 for whole-note context (start of document).
//   4. No selection is set (whole-note has no partial selection).
//   5. input = the full document text (whole-note source).
//   6. settings are passed through unchanged.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const EDITOR_DOC = "# Note from editor\n\nEditor content here.";
const VAULT_DOC  = "# Note from vault\n\nVault content here.";

function makeEditor(doc: string): Editor {
	const lines = doc.split("\n");

	function posToOffset(pos: EditorPosition): number {
		let offset = 0;
		for (let i = 0; i < pos.line; i++) {
			offset += lines[i]!.length + 1;
		}
		return offset + pos.ch;
	}

	return {
		getValue: () => doc,
		getSelection: () => "",
		listSelections: (): EditorSelection[] => [
			{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } },
		],
		getCursor: (_side?: "from" | "to" | "head" | "anchor") =>
			({ line: 0, ch: 0 } as EditorPosition),
		posToOffset,
		// Satisfy abstract interface — unused by the adapter
		refresh: () => undefined,
		setValue: () => undefined,
		getLine: (n: number) => lines[n] ?? "",
		lineCount: () => lines.length,
		lastLine: () => lines.length - 1,
		somethingSelected: () => false,
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
				if (remaining < len) return { line: i, ch: remaining };
				remaining -= len;
			}
			return { line: lines.length - 1, ch: lines[lines.length - 1]!.length };
		},
		processLines: () => undefined,
		getDoc: function () { return this as unknown as typeof this; },
		setLine: () => undefined,
	} as unknown as Editor;
}

function makeVault(content: string): Vault {
	return {
		read: (_file: TFile) => Promise.resolve(content),
	} as unknown as Vault;
}

function makeTFile(): TFile {
	return { path: "test-note.md", basename: "test-note", extension: "md" } as unknown as TFile;
}

const SETTINGS: MasonSettings = { debugLogging: false, resourcesName: "Resources" };

// ---------------------------------------------------------------------------
// Editor branch (TOCTOU mitigation: editor present → prefer editor)
// ---------------------------------------------------------------------------

describe("noteContext — editor branch (prefers editor over vault)", () => {
	it("doc comes from the editor, not the vault", async () => {
		const ctx = await noteContext({
			editor: makeEditor(EDITOR_DOC),
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.doc).toBe(EDITOR_DOC);
	});

	it("input equals the full editor document (whole-note scope)", async () => {
		const ctx = await noteContext({
			editor: makeEditor(EDITOR_DOC),
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.input).toBe(EDITOR_DOC);
	});

	it("cursor is 0 (whole-note convention: start of document)", async () => {
		const ctx = await noteContext({
			editor: makeEditor(EDITOR_DOC),
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.cursor).toBe(0);
	});

	it("no selection is set for whole-note context", async () => {
		const ctx = await noteContext({
			editor: makeEditor(EDITOR_DOC),
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.selection).toBeUndefined();
	});

	it("settings are passed through unchanged", async () => {
		const ctx = await noteContext({
			editor: makeEditor(EDITOR_DOC),
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.settings).toBe(SETTINGS);
	});

	it("vault.read is NOT called when editor is present", async () => {
		let vaultReadCalled = false;
		const vault = {
			read: (_file: TFile) => {
				vaultReadCalled = true;
				return Promise.resolve(VAULT_DOC);
			},
		} as unknown as Vault;

		await noteContext({
			editor: makeEditor(EDITOR_DOC),
			vault,
			file: makeTFile(),
			settings: SETTINGS,
		});

		expect(vaultReadCalled).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Vault branch (no editor → fall back to vault.read)
// ---------------------------------------------------------------------------

describe("noteContext — vault branch (no editor, reads from file)", () => {
	it("doc comes from vault.read when no editor is present", async () => {
		const ctx = await noteContext({
			editor: undefined,
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.doc).toBe(VAULT_DOC);
	});

	it("input equals the full vault document (whole-note scope)", async () => {
		const ctx = await noteContext({
			editor: undefined,
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.input).toBe(VAULT_DOC);
	});

	it("cursor is 0 (whole-note convention: start of document)", async () => {
		const ctx = await noteContext({
			editor: undefined,
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.cursor).toBe(0);
	});

	it("no selection is set for whole-note context", async () => {
		const ctx = await noteContext({
			editor: undefined,
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		expect(ctx.selection).toBeUndefined();
	});

	it("vault.read is called with the provided TFile", async () => {
		const file = makeTFile();
		let capturedFile: TFile | undefined;
		const vault = {
			read: (f: TFile) => {
				capturedFile = f;
				return Promise.resolve(VAULT_DOC);
			},
		} as unknown as Vault;

		await noteContext({ editor: undefined, vault, file, settings: SETTINGS });
		expect(capturedFile).toBe(file);
	});
});

// ---------------------------------------------------------------------------
// Editor branch is taken even when vault would produce different content
// (the TOCTOU mitigation assertion)
// ---------------------------------------------------------------------------

describe("noteContext — editor-vs-vault branch selection", () => {
	it("returns editor content when both editor and vault are present (TOCTOU mitigation)", async () => {
		const ctx = await noteContext({
			editor: makeEditor(EDITOR_DOC),
			vault: makeVault(VAULT_DOC),
			file: makeTFile(),
			settings: SETTINGS,
		});
		// If TOCTOU mitigation is correct, doc must be the EDITOR content, not vault content
		expect(ctx.doc).toBe(EDITOR_DOC);
		expect(ctx.doc).not.toBe(VAULT_DOC);
	});
});
