// UpdateSplashModal — one-shot "what's new" splash shown after a plugin update.
//
// WHY THIS EXISTS
// ───────────────
// Curated scripts ride pinned plugin releases (the catalog is fetched at a
// build-time-pinned commit SHA — ADR-13). A script version can therefore only
// change when the plugin itself updates, and the only place a user sees that
// today is by manually opening Settings → Scripts. This splash closes that gap:
// it fires once per version bump and tells the user, up front, how many scripts
// now have updates waiting — with a one-click route to review and re-consent.
//
// Content is a DYNAMIC SUMMARY only (no maintained changelog): the updatable
// count plus a route into the Scripts tab. Detection + version persistence live
// in main.ts (_maybeShowUpdateSplash); this modal is presentation only.
//
// COMMUNITY COMPLIANCE
// ────────────────────
// - All UI text follows SENTENCE CASE.
// - DOM is built exclusively via createEl / createDiv / setText / setAttribute —
//   never innerHTML / outerHTML / insertAdjacentHTML.
// - The toggle uses Obsidian's Setting helper.

import { Modal, Setting } from "obsidian";
import type { App } from "obsidian";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface UpdateSplashOptions {
	/** Current plugin version (manifest.version), shown in the title. */
	version: string;
	/** Number of curated scripts whose catalog version now exceeds the consented one. */
	updatableCount: number;
	/** Current value of settings.showUpdateSplash — reflected by the in-splash toggle. */
	showSplash: boolean;
	/** Persist a change to the "show update notes" preference. */
	onToggleSplash: (value: boolean) => void | Promise<void>;
	/** Open Settings → Scripts so the user can review and re-consent. */
	onOpenScripts: () => void;
}

// ---------------------------------------------------------------------------
// UpdateSplashModal
// ---------------------------------------------------------------------------

/**
 * One-shot post-update splash.
 *
 * Title:   "Markdown Mason — updated to v{version}"
 * Summary: "{N} script(s) have updates available…" (or an all-clear line at 0).
 * Toggle:  "Show update notes on new versions" (mirrors settings.showUpdateSplash).
 * Actions: "Open scripts settings" (only when there are updates) + "Close".
 */
export class UpdateSplashModal extends Modal {
	private readonly _opts: UpdateSplashOptions;

	constructor(app: App, opts: UpdateSplashOptions) {
		super(app);
		this._opts = opts;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mason-update-splash");

		contentEl.createEl("h2", {
			text: `Markdown Mason — updated to v${this._opts.version}`,
		});

		const count = this._opts.updatableCount;
		contentEl.createEl("p", {
			text:
				count > 0
					? `${count} script${count === 1 ? "" : "s"} ${count === 1 ? "has" : "have"} updates available. ` +
						"Review and re-consent in Settings → Scripts."
					: "No script updates right now — you're all set.",
			cls: "mason-update-splash-summary",
		});

		// Preference toggle — mirrors settings.showUpdateSplash. onChange persists
		// via the injected callback; the General settings tab carries the same gate.
		new Setting(contentEl)
			.setName("Show update notes on new versions")
			.addToggle((toggle) => {
				toggle.setValue(this._opts.showSplash).onChange((value) => {
					void this._opts.onToggleSplash(value);
				});
			});

		const buttons = contentEl.createDiv({ cls: "mason-update-splash-buttons" });

		// Primary action only when there is something to review.
		if (count > 0) {
			const open = buttons.createEl("button", { text: "Open scripts settings" });
			open.addClass("mod-cta");
			open.setAttribute("type", "button");
			open.addEventListener("click", () => {
				this.close();
				this._opts.onOpenScripts();
			});
		}

		const close = buttons.createEl("button", { text: "Close" });
		close.setAttribute("type", "button");
		close.addEventListener("click", () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
