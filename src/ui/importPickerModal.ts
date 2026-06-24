// T6.2  ImportPickerModal — minimal vault .cjs picker for import-from-vault.
//
// DESIGN
// ──────
// Lists candidate vault-relative .cjs paths; selecting one resolves pick() with
// that path. Closing without a selection resolves with null (cancelled). Extends
// Modal (not FuzzySuggestModal) to keep the test mock surface minimal, mirroring
// RunScriptModal and BrowseOfficialModal.
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - Sentence case: title, empty-state text.
// - DOM via createEl / createDiv / setText / setAttribute — never innerHTML.
// - No default hotkeys.

import { Modal } from "obsidian";
import type { App } from "obsidian";

export class ImportPickerModal extends Modal {
	private readonly _paths: string[];
	private _resolver: ((p: string | null) => void) | null = null;
	private _picked: boolean = false;

	constructor(app: App, paths: string[]) {
		super(app);
		this._paths = paths;
	}

	/** Open the picker and resolve with the chosen path, or null when cancelled. */
	pick(): Promise<string | null> {
		const promise = new Promise<string | null>((resolve) => {
			this._resolver = resolve;
		});
		this.open();
		return promise;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mason-import-picker");

		contentEl.createEl("h2", { text: "Import a script from your vault" });

		if (this._paths.length === 0) {
			contentEl.createEl("p", {
				text: "No .cjs files were found in your vault.",
				cls: "mason-import-empty",
			});
			return;
		}

		const list = contentEl.createDiv({ cls: "mason-import-list" });
		for (const path of this._paths) {
			const btn = list.createEl("button", { text: path, cls: "mason-import-row" });
			btn.setAttribute("type", "button");
			btn.addEventListener("click", () => {
				this._picked = true;
				this._resolveOnce(path);
				this.close();
			});
		}
	}

	onClose(): void {
		// Cancelled close (no selection) resolves null.
		if (!this._picked) {
			this._resolveOnce(null);
		}
		this.contentEl.empty();
	}

	private _resolveOnce(value: string | null): void {
		if (this._resolver === null) return;
		const r = this._resolver;
		this._resolver = null;
		r(value);
	}
}
