// T5.3  ScriptDisclosureModal + makeAskCallback
//
// SAFE-DEFAULT DESIGN (WHY: mirrors hashi HookDisclosureModal)
// ─────────────────────────────────────────────────────────────
// Every resolution path that bypasses an explicit user affirmation defaults
// to "disable":
//   - Disable button is FIRST in the DOM + auto-focused → reflexive Enter/Space cancels
//   - Escape keydown → "disable"
//   - onClose without a prior button click → "disable"
//   - resolver fires exactly once (resolveOnce guard)
//
// DOM SAFETY (CON-3)
// ──────────────────
// All DOM construction uses Obsidian's createEl / createDiv / setText /
// setAttribute.  innerHTML, outerHTML, insertAdjacentHTML are never used.
//
// ADAPTER DESIGN (makeAskCallback)
// ─────────────────────────────────
// The adapter bridges the runner's AskCallback contract with:
//   1. ScriptStore.getScripts() + ScriptRecord — lighter paths that bypass the modal
//   2. ScriptDisclosureModal — shown when consent is needed
//   3. ScriptStore.setRecord() — called on enable-session to persist consent
//
// Three decision paths (checked in order):
//   enabled===false  → return "disable" immediately (kill-switch; no modal)
//   okayed.version===version && okayed.checksum===checksum
//                    → return "enable-session" (already consented; no modal)
//   otherwise        → show modal; on "enable-session" call setRecord with
//                      okayed:{version,checksum} and enabled:true
//
// The okayed {version,checksum} match check here implements the same consent-gate
// semantics as evaluateState rules 5–6 (Active vs. drift distinction), but is
// intentionally a lighter path: at first-enable the script code is not yet
// materialized, so full evaluateState inputs (local-checksum, catalog, online)
// are unavailable. Full state evaluation happens in the lifecycle/UI layer.

import { Modal } from "obsidian";
import type { App } from "obsidian";
import type { AskCallback, AskDecision } from "./runner";
import type { ScriptStore } from "./store";

// ---------------------------------------------------------------------------
// Disclosure text (full-privilege warning)
// ---------------------------------------------------------------------------

const DISCLOSURE_TEXT =
	"This script will run with full plugin privileges: vault access, Node filesystem and network, shell execution, and environment variables. Only enable scripts from sources you trust.";

// ---------------------------------------------------------------------------
// ScriptInfo — metadata shown in the modal
// ---------------------------------------------------------------------------

export interface ScriptInfo {
	vaultRelativePath: string;
	fileSizeBytes: number;
	version: number;
	checksum: string;
}

// ---------------------------------------------------------------------------
// ScriptDisclosureModal
// ---------------------------------------------------------------------------

/**
 * Consent modal presented before an untrusted script runs.
 *
 * Use present() — NOT open() — to get the Promise<AskDecision>.
 * Resolves with "disable" for any non-affirmative path (Esc, close, Disable).
 */
export class ScriptDisclosureModal extends Modal {
	private _resolver: ((d: AskDecision) => void) | null = null;
	private readonly _info: ScriptInfo;

	private readonly _escHandler = (evt: { key?: string }): void => {
		if (evt.key === "Escape") {
			this._resolveOnce("disable");
			this.close();
		}
	};

	constructor(app: App, info: ScriptInfo) {
		super(app);
		this._info = info;
	}

	/** Open the modal and return a promise that resolves with the user's decision. */
	present(): Promise<AskDecision> {
		const promise = new Promise<AskDecision>((resolve) => {
			this._resolver = resolve;
		});
		this.open();
		return promise;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mason-script-disclosure");

		// Register Escape handler before rendering so it is live immediately.
		contentEl.addEventListener("keydown", this._escHandler);

		// Unique id for aria-describedby linkage (per-instance, not module-level)
		const disclosureId = `mason-disclosure-${crypto.randomUUID()}`;

		// Title
		contentEl.createEl("h2", { text: "Run script?" });

		// Meta: path, size, version, checksum
		const meta = contentEl.createDiv({ cls: "mason-script-meta" });
		meta.createEl("p", { text: this._info.vaultRelativePath });
		meta.createEl("p", { text: `${this._info.fileSizeBytes} bytes` });
		meta.createEl("p", { text: `Version: ${this._info.version}` });
		meta.createEl("p", { text: `Checksum: ${this._info.checksum}` });

		// Disclosure paragraph
		const disclosure = contentEl.createEl("p", {
			text: DISCLOSURE_TEXT,
			cls: "mason-script-disclosure-text",
		});
		disclosure.setAttribute("id", disclosureId);

		// Button row — Disable is FIRST + focused (safe default)
		const buttons = contentEl.createDiv({ cls: "mason-script-buttons" });
		buttons.setAttribute("aria-describedby", disclosureId);

		const disableBtn = this._makeButton(buttons, "Disable", "mod-cta", "disable");
		disableBtn.focus();
		this._makeButton(buttons, "Enable once", "", "enable-once");
		this._makeButton(buttons, "Enable", "", "enable-session");
	}

	onClose(): void {
		this.contentEl.removeEventListener("keydown", this._escHandler);
		this._resolveOnce("disable");
		this.contentEl.empty();
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private _makeButton(
		parent: HTMLElement,
		label: string,
		cls: string,
		decision: AskDecision,
	): HTMLElement {
		const btn = parent.createEl("button", { text: label });
		if (cls) {
			btn.addClass(cls);
		}
		btn.setAttribute("type", "button");
		btn.addEventListener("click", () => {
			this._resolveOnce(decision);
			this.close();
		});
		return btn;
	}

	/** Resolve the promise exactly once; subsequent calls are no-ops. */
	private _resolveOnce(decision: AskDecision): void {
		if (this._resolver === null) {
			return;
		}
		const r = this._resolver;
		this._resolver = null;
		r(decision);
	}
}

// ---------------------------------------------------------------------------
// makeAskCallback
// ---------------------------------------------------------------------------

/**
 * Builds an AskCallback for the runner's "ask" policy.
 *
 * Parameters:
 *   app       — Obsidian App (passed to the modal constructor)
 *   store     — Pick<ScriptStore, "getScripts" | "setRecord">
 *   scriptId  — the script's unique identifier
 *   info      — path + size shown in the modal
 *   checksum  — current script checksum (for consent matching and recording)
 *   version   — current script version (for consent matching and recording)
 *
 * Decision paths (checked in order):
 *   1. record.enabled===false  → returns "disable" immediately (no modal).
 *   2. record.okayed matches {version, checksum}
 *                              → returns "enable-session" (no modal).
 *   3. otherwise               → shows the modal; on "enable-session" calls
 *      setRecord to persist consent (okayed:{version,checksum}, enabled:true).
 *
 * Consent persistence:
 *   "enable-session" → setRecord called (persists approval for this checksum+version)
 *   "enable-once"    → setRecord NOT called (ephemeral; next call re-prompts)
 *
 */
export function makeAskCallback(
	app: App,
	store: Pick<ScriptStore, "getScripts" | "setRecord">,
	scriptId: string,
	info: ScriptInfo,
	checksum: string,
	version: number,
): AskCallback {
	return async (): Promise<AskDecision> => {
		const rec = (await store.getScripts())[scriptId];

		// Kill-switch: user explicitly disabled this script
		if (rec?.enabled === false) {
			return "disable";
		}

		// Lighter path: already consented for this exact {version,checksum}.
		// Uses the same match semantics as evaluateState's Active-vs-drift distinction
		// (rules 5–6). Full evaluateState evaluation happens in the lifecycle/UI layer.
		if (rec?.okayed?.version === version && rec?.okayed?.checksum === checksum) {
			return "enable-session";
		}

		// Otherwise (no record, or fingerprint changed) → show modal
		const modal = new ScriptDisclosureModal(app, info);
		const decision = await modal.present();

		// Record consent only for enable-session (persists approval).
		// enable-once is intentionally ephemeral: no consent stored → next invocation re-prompts.
		if (decision === "enable-session") {
			await store.setRecord(scriptId, {
				provenance: rec?.provenance ?? "imported",
				enabled: true,
				okayed: { version, checksum },
				source: rec?.source ?? "",
				command: rec?.command ?? false,
			});
		}

		return decision;
	};
}
