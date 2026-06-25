// T4.4  RunScriptModal — "Mason: Run script…" launcher.
//
// DESIGN
// ──────
// A quick-switcher-style FuzzySuggestModal: a fuzzy-search input on top, and
// below it the runnable scripts rendered as cards (name + description). Fuzzy
// matching covers both the name and the description. Selecting one runs it.
//
// The caller (main.ts) pre-filters to runnable (Active) scripts and supplies the
// run wiring as `onChoose`, so this module stays a pure picker.
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - Sentence case: placeholder + empty-state text.
// - DOM via createEl — never innerHTML. No default hotkeys.

import { FuzzySuggestModal } from "obsidian";
import type { App, FuzzyMatch } from "obsidian";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One runnable script offered by the launcher. */
export interface RunScriptEntry {
	id: string;
	name: string;
	description: string;
}

/** Invoked when the user picks a script to run. */
export type RunScriptChoose = (entry: RunScriptEntry) => void | Promise<void>;

// ---------------------------------------------------------------------------
// RunScriptModal
// ---------------------------------------------------------------------------

/**
 * Launcher modal for "Mason: Run script…". Lists the runnable scripts it is
 * given (the caller filters to Active) with fuzzy search; selecting one calls
 * onChoose, which runs it via CommandManager.runScript.
 */
export class RunScriptModal extends FuzzySuggestModal<RunScriptEntry> {
	private readonly _entries: RunScriptEntry[];
	private readonly _onChoose: RunScriptChoose;

	constructor(app: App, entries: RunScriptEntry[], onChoose: RunScriptChoose) {
		super(app);
		this._entries = entries;
		this._onChoose = onChoose;
		this.setPlaceholder("Search scripts to run…");
		this.emptyStateText = "No active scripts. Enable and consent to a script in the Scripts tab first.";
	}

	getItems(): RunScriptEntry[] {
		return this._entries;
	}

	/** Fuzzy match against both the name and the description. */
	getItemText(entry: RunScriptEntry): string {
		return entry.description ? `${entry.name} ${entry.description}` : entry.name;
	}

	/** Card-style suggestion: name as the header, description beneath. */
	renderSuggestion(match: FuzzyMatch<RunScriptEntry>, el: HTMLElement): void {
		const entry = match.item;
		el.addClass("mason-run-suggestion");
		el.createEl("div", { text: entry.name, cls: "mason-run-suggestion-name" });
		if (entry.description.length > 0) {
			el.createEl("div", { text: entry.description, cls: "mason-run-suggestion-desc" });
		}
	}

	onChooseItem(entry: RunScriptEntry): void {
		void this._onChoose(entry);
	}
}
