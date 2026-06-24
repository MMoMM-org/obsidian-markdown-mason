// T6.2  BrowseOfficialModal — minimal curated-catalog browser.
//
// DESIGN
// ──────
// Lists the curated catalog entries (name + description) with a single "enable"
// action per entry that drives the LifecycleController's enable flow (which shows
// the disclosure consent gate before materializing). Extends Modal (not
// FuzzySuggestModal) to keep the test mock surface minimal, mirroring
// RunScriptModal.
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - Sentence case: title, item labels, empty-state text, button text.
// - DOM via createEl / createDiv / setText / setAttribute — never innerHTML.
// - No default hotkeys.

import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { CatalogEntry } from "../scripts/catalog/catalogSource";

/** Callback invoked when the user chooses to enable a curated entry. */
export type EnableEntry = (id: string) => void;

export class BrowseOfficialModal extends Modal {
	private readonly _entries: CatalogEntry[];
	private readonly _onEnable: EnableEntry;

	constructor(app: App, entries: CatalogEntry[], onEnable: EnableEntry) {
		super(app);
		this._entries = entries;
		this._onEnable = onEnable;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mason-browse-official");

		contentEl.createEl("h2", { text: "Official scripts" });

		if (this._entries.length === 0) {
			contentEl.createEl("p", {
				text: "No official scripts are available right now.",
				cls: "mason-browse-empty",
			});
			return;
		}

		const list = contentEl.createDiv({ cls: "mason-browse-list" });
		for (const entry of this._entries) {
			this._renderEntry(list, entry);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private _renderEntry(parent: HTMLElement, entry: CatalogEntry): void {
		const row = parent.createDiv({ cls: "mason-browse-row" });
		row.createEl("span", { text: entry.name, cls: "mason-browse-name" });
		row.createEl("span", { text: entry.description, cls: "mason-browse-desc" });

		const btn = row.createEl("button", { text: "Enable", cls: "mason-browse-enable" });
		btn.setAttribute("type", "button");
		btn.setAttribute("aria-label", `Enable ${entry.name}`);
		btn.addEventListener("click", () => {
			this._onEnable(entry.id);
			this.close();
		});
	}
}
