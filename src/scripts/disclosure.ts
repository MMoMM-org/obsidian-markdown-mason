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
//   1. ScriptStore.evaluateTrust() — lighter path: skip modal if already "ok"
//   2. ScriptDisclosureModal — shown for needs-consent, drift-blocked, or unknown
//   3. ScriptStore.recordConsent() — called on enable-session ONLY
//      Enable       = approve & remember (persists per checksum/version)
//      Enable once  = run this time only, no persistence → next call re-prompts
//
// DRIFT-BLOCKED CHOICE (documented)
// ────────────────────────────────
// When evaluateTrust returns "drift-blocked" the adapter SHOWS the modal
// (re-prompts) rather than silently blocking.  Rationale: drift is a trust
// violation requiring explicit re-approval; surfacing the modal lets the
// user confirm they trust the updated script.  A user who clicks Disable
// gets "disable"; one who clicks Enable records new consent and proceeds.
//
// "unknown" (script not in manifest) is treated as needs-consent and also
// shows the modal so the user can choose before any execution.
// "disabled" (kill-switch) → "disable" immediately without showing the modal.

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

		// Meta: path + size
		const meta = contentEl.createDiv({ cls: "mason-script-meta" });
		meta.createEl("p", { text: this._info.vaultRelativePath });
		meta.createEl("p", { text: `${this._info.fileSizeBytes} bytes` });

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
 *   app           — Obsidian App (passed to the modal constructor)
 *   store         — ScriptStore (evaluateTrust + recordConsent)
 *   scriptId      — the script's unique identifier
 *   info          — path + size shown in the modal
 *   checksum      — current script checksum (for consent recording)
 *   version       — current script version (for consent recording)
 *
 * Lighter path: if evaluateTrust returns "ok", the callback returns
 * "enable-session" immediately without showing any UI.
 *
 * All other statuses (needs-consent, drift-blocked, unknown) show the modal.
 * "disabled" (explicit kill-switch) returns "disable" without the modal.
 *
 * Consent persistence:
 *   "enable-session" → recordConsent is called (persists approval for this checksum/version)
 *   "enable-once"    → recordConsent is NOT called (run this time only; next call re-prompts)
 */
export function makeAskCallback(
	app: App,
	store: Pick<ScriptStore, "evaluateTrust" | "recordConsent">,
	scriptId: string,
	info: ScriptInfo,
	checksum: string,
	version: number,
): AskCallback {
	return async (): Promise<AskDecision> => {
		const { status } = await store.evaluateTrust(scriptId);

		// Lighter path: already consented for this exact checksum+version
		if (status === "ok") {
			return "enable-session";
		}

		// Kill-switch: user explicitly disabled this script
		if (status === "disabled") {
			return "disable";
		}

		// All other statuses (needs-consent, drift-blocked, unknown) → show modal
		const modal = new ScriptDisclosureModal(app, info);
		const decision = await modal.present();

		// Record consent only for enable-session (persists approval).
		// enable-once is intentionally ephemeral: no consent stored → next invocation re-prompts.
		if (decision === "enable-session") {
			await store.recordConsent(scriptId, checksum, version);
		}

		return decision;
	};
}
