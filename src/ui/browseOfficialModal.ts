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

/**
 * Install state of a catalog entry, used to label its action button:
 *   available → not in the vault yet   (button: "Enable")
 *   installed → present but disabled    (button: "Enable")
 *   enabled   → already active          (button: "Enabled", disabled)
 */
export type BrowseEntryStatus = "available" | "installed" | "enabled";

export class BrowseOfficialModal extends Modal {
	private readonly _entries: CatalogEntry[];
	private readonly _onEnable: EnableEntry;
	private readonly _statusOf: (id: string) => BrowseEntryStatus;

	constructor(
		app: App,
		entries: CatalogEntry[],
		onEnable: EnableEntry,
		statusOf: (id: string) => BrowseEntryStatus = () => "available",
	) {
		super(app);
		this._entries = entries;
		this._onEnable = onEnable;
		this._statusOf = statusOf;
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
		// Card layout: a header row with the script name and a right-aligned action
		// button, then the description beneath.
		const card = parent.createDiv({ cls: "mason-browse-card" });

		const header = card.createDiv({ cls: "mason-browse-card-header" });
		header.createSpan({ text: entry.name, cls: "mason-browse-name" });

		const status = this._statusOf(entry.id);
		if (status === "enabled") {
			// Already enabled — show a non-actionable "Enabled" state, not a redundant
			// "Enable" button.
			const badge = header.createEl("button", { text: "Enabled", cls: "mason-browse-enable" });
			badge.addClass("mason-browse-enabled");
			badge.setAttribute("type", "button");
			badge.setAttribute("disabled", "true");
			badge.setAttribute("aria-label", `${entry.name} is already enabled`);
		} else {
			const btn = header.createEl("button", { text: "Enable", cls: "mason-browse-enable" });
			btn.setAttribute("type", "button");
			btn.setAttribute("aria-label", `Enable ${entry.name}`);
			btn.addEventListener("click", () => {
				this._onEnable(entry.id);
				this.close();
			});
		}

		card.createSpan({ text: entry.description, cls: "mason-browse-desc" });
	}
}
