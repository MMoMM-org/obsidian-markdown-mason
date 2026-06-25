// T6.2  ImportPickerModal — fuzzy vault .cjs picker for import-from-vault.
//
// DESIGN
// ──────
// A FuzzySuggestModal over the candidate vault-relative `.cjs` paths: the user
// types to fuzzy-search, and selecting a suggestion resolves pick() with that
// path. Closing without a selection resolves with null (cancelled).
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - Sentence case: placeholder + empty-state text.
// - No innerHTML; FuzzySuggestModal builds the DOM. No default hotkeys.

import { FuzzySuggestModal } from "obsidian";
import type { App } from "obsidian";
import { debug } from "../core/debug";

export class ImportPickerModal extends FuzzySuggestModal<string> {
	private readonly _paths: string[];
	private _resolver: ((p: string | null) => void) | null = null;
	private _picked: boolean = false;

	constructor(app: App, paths: string[]) {
		super(app);
		this._paths = paths;
		this.setPlaceholder("Search for a .cjs script to import…");
		this.emptyStateText = "No .cjs files were found in your vault.";
	}

	/** Open the picker and resolve with the chosen path, or null when cancelled. */
	pick(): Promise<string | null> {
		const promise = new Promise<string | null>((resolve) => {
			this._resolver = resolve;
		});
		this.open();
		return promise;
	}

	getItems(): string[] {
		return this._paths;
	}

	getItemText(path: string): string {
		return path;
	}

	onChooseItem(path: string): void {
		// FuzzySuggestModal closes itself after this returns; mark picked so the
		// onClose hook does not also resolve null.
		this._picked = true;
		debug("[MarkdownMason] import picker: chose", path);
		this._resolveOnce(path);
	}

	onClose(): void {
		// A dismissed picker (Esc / click-away, no selection) resolves null.
		// Some Obsidian builds fire onClose() BEFORE onChooseItem() when a row is
		// selected — if we resolved null synchronously here, a real choice would be
		// lost. Defer the cancel by a tick so a selection in the same turn wins.
		if (this._picked) return;
		window.setTimeout(() => {
			if (this._picked) return;
			debug("[MarkdownMason] import picker: cancelled (no selection)");
			this._resolveOnce(null);
		}, 0);
	}

	private _resolveOnce(value: string | null): void {
		if (this._resolver === null) return;
		const r = this._resolver;
		this._resolver = null;
		r(value);
	}
}
