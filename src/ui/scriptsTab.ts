// T4.2  Scripts tab — card rows + ⋯ menu + toolbar (rendering-focused)
//
// SCOPE / SEAM DESIGN
// ───────────────────
// This module is PURE RENDERING and SYNCHRONOUS. It is driven entirely by the
// OUTPUTS of evaluateState (one resolved LifecycleState per script), never by
// live-catalog I/O. The thin controller that resolves record/local/catalogVersion
// /online and calls evaluateState lives elsewhere (see settingsTab wiring); it
// injects the resolved ScriptItem[] and a LifecycleOps action seam.
//
// Keeping I/O out of the render path makes the tab unit-testable: tests inject a
// fake LifecycleOps and a list of items with chosen states, then assert pills /
// badges / actions / inline-Blocked recovery / empty state.
//
// COMMUNITY COMPLIANCE (CON-3)
// ────────────────────────────
// - DOM is built only via createEl / createDiv / setText / addClass / setAttribute —
//   never innerHTML / outerHTML / insertAdjacentHTML.
// - All UI text is SENTENCE CASE (only first word capitalised): pills, menu
//   titles, buttons.
// - Status is conveyed by a text LABEL + icon, never colour alone.
// - Every Blocked card shows a human reason + a single inline recovery action.
// - Provenance badge ("Official" / "Imported") is decorative only — it NEVER
//   affects trust (PRD/F4).

import { Menu } from "obsidian";
import type { LifecycleState, BlockedReason } from "../scripts/lifecycle";
import type { ScriptRecord } from "../scripts/store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single fully-resolved script row. The controller computes `state` via
 * evaluateState BEFORE calling renderScriptsTab; this module never resolves it.
 */
export interface ScriptItem {
	id: string;
	displayName: string;
	description: string;
	record: ScriptRecord;
	state: LifecycleState;
	/** Consented/active version shown in the card corner (e.g. "v1"). */
	version: number;
	provenance: "curated" | "imported";
	/** Latest catalog version — used to label "Update to v{n}" when UpdateAvailable. */
	catalogVersion?: number;
}

/**
 * The action seam the UI triggers. The render path NEVER performs I/O directly —
 * every interactive control calls through one of these. Concrete wiring lives in
 * the controller (settingsTab); see // P5: markers there for the live-catalog
 * actions (browseOfficial, and the network fetch inside update/retry).
 */
export interface LifecycleOps {
	enable(id: string): void | Promise<void>;
	disable(id: string): void | Promise<void>;
	remove(id: string): void | Promise<void>;
	retry(id: string): void | Promise<void>;
	update(id: string): void | Promise<void>;
	reReview(id: string): void | Promise<void>;
	viewSource(id: string): void | Promise<void>;
	importFromVault(): void | Promise<void>;
	browseOfficial(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Render the Scripts tab into `containerEl`.
 *
 * Synchronous and idempotent over its inputs: re-rendering with the same
 * resolved items produces the same DOM. Renders a card per item, a toolbar, and
 * a meaningful empty state when there are no items.
 */
export function renderScriptsTab(
	containerEl: HTMLElement,
	items: ScriptItem[],
	ops: LifecycleOps,
): void {
	if (items.length === 0) {
		renderEmptyState(containerEl, ops);
		return;
	}

	// Toolbar first, then the list beneath it (the action buttons sit above the
	// scripts they create).
	renderToolbar(containerEl, ops);

	const list = containerEl.createDiv({ cls: "mason-scripts-list" });
	for (const item of items) {
		renderCard(list, item, ops);
	}
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function renderCard(parent: HTMLElement, item: ScriptItem, ops: LifecycleOps): void {
	const card = parent.createDiv({ cls: "mason-script-card" });

	renderCardHeader(card, item, ops);
	renderCardBody(card, item, ops);
}

/** Top line: name · provenance badge · status pill · version, plus toggle + ⋯. */
function renderCardHeader(card: HTMLElement, item: ScriptItem, ops: LifecycleOps): void {
	const header = card.createDiv({ cls: "mason-script-card-header" });

	header.createEl("span", { text: item.displayName, cls: "mason-script-name" });
	header.createEl("span", { text: provenanceBadge(item.provenance), cls: "mason-script-badge" });

	renderPill(header, item.state);
	header.createEl("span", { text: `v${item.version}`, cls: "mason-script-version" });

	// Enable toggle — shown for states where a toggle is meaningful.
	if (showsToggle(item.state)) {
		renderToggle(header, item, ops);
	}

	renderMenuButton(header, item, ops);
}

/** Second line: description, plus inline reason + recovery when Blocked. */
function renderCardBody(card: HTMLElement, item: ScriptItem, ops: LifecycleOps): void {
	const body = card.createDiv({ cls: "mason-script-card-body" });
	body.createEl("span", { text: item.description, cls: "mason-script-desc" });

	if (item.state.kind === "Blocked") {
		renderBlockedRecovery(body, item, item.state.reason, ops);
	}
}

// ---------------------------------------------------------------------------
// Status pill — text LABEL + icon (never colour alone)
// ---------------------------------------------------------------------------

/** Maps a LifecycleState to its sentence-case pill label. */
function pillLabel(state: LifecycleState): string {
	switch (state.kind) {
		case "Active":
			return "Active";
		case "Disabled":
			return "Disabled";
		case "UpdateAvailable":
			return "Update available";
		case "Available":
			return "Available";
		case "Materializing":
			return "Materializing";
		case "Blocked":
			return "Blocked";
		case "Absent":
			return "Not installed";
	}
}

/** Maps a state to a leading status glyph so status is not colour-only. */
function pillIcon(state: LifecycleState): string {
	switch (state.kind) {
		case "Active":
			return "●";
		case "Blocked":
			return "■";
		case "UpdateAvailable":
			return "▲";
		case "Materializing":
			return "◌";
		case "Disabled":
		case "Available":
		case "Absent":
			return "○";
	}
}

function renderPill(parent: HTMLElement, state: LifecycleState): void {
	const pill = parent.createDiv({ cls: "mason-script-pill" });
	// Icon carries status non-colour-wise; label is the authoritative text.
	pill.createEl("span", { text: pillIcon(state), cls: "mason-script-pill-icon" });
	pill.createEl("span", { text: pillLabel(state), cls: "mason-script-pill-label" });
	pill.addClass(`mason-pill-${state.kind.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Toggle — rendered as a native checkbox input (no Setting wrapper here)
// ---------------------------------------------------------------------------

/** Active + UpdateAvailable are ON; Disabled + Available are OFF. */
function toggleValue(state: LifecycleState): boolean {
	return state.kind === "Active" || state.kind === "UpdateAvailable";
}

/** A toggle is meaningful only for enable/disable-able states. */
function showsToggle(state: LifecycleState): boolean {
	return (
		state.kind === "Active" ||
		state.kind === "UpdateAvailable" ||
		state.kind === "Disabled" ||
		state.kind === "Available"
	);
}

function renderToggle(parent: HTMLElement, item: ScriptItem, ops: LifecycleOps): void {
	const on = toggleValue(item.state);
	const toggle = parent.createEl("input", {
		cls: "mason-script-toggle",
		attr: { type: "checkbox", "aria-label": `Enable ${item.displayName}` },
	});
	toggle.checked = on;
	toggle.addEventListener("change", () => {
		if (toggle.checked) {
			void ops.enable(item.id);
		} else {
			void ops.disable(item.id);
		}
	});
}

// ---------------------------------------------------------------------------
// Blocked recovery — single inline action; reason→recovery mapping
// ---------------------------------------------------------------------------

function renderBlockedRecovery(
	body: HTMLElement,
	item: ScriptItem,
	reason: BlockedReason,
	ops: LifecycleOps,
): void {
	const row = body.createDiv({ cls: "mason-script-blocked" });
	row.createEl("span", { text: blockedReasonText(item, reason), cls: "mason-script-blocked-reason" });

	const { label, action } = blockedRecovery(reason);
	const btn = row.createEl("button", { text: label, cls: "mason-script-recovery" });
	btn.setAttribute("type", "button");
	btn.addEventListener("click", () => {
		void action(item.id, ops);
	});
}

/** Human, sentence-case reason. source-missing names the missing path. */
function blockedReasonText(item: ScriptItem, reason: BlockedReason): string {
	switch (reason) {
		case "source-missing":
			return `Vault source not found: ${item.record.source}`;
		case "drift":
			return "Script bytes changed since you approved them";
		case "offline":
			return "Could not reach the catalog (offline)";
		case "checksum-mismatch":
			return "Fetched bytes did not match the expected checksum";
	}
}

/** Exactly one recovery per reason: source-missing→reveal source; rest→retry. */
function blockedRecovery(
	reason: BlockedReason,
): { label: string; action: (id: string, ops: LifecycleOps) => void | Promise<void> } {
	if (reason === "source-missing") {
		// "Re-import" re-supplies the missing vault source via the import flow.
		return { label: "Re-import", action: (_id, ops) => ops.importFromVault() };
	}
	// drift / offline / checksum-mismatch → re-fetch from the catalog.
	return { label: "Retry fetch", action: (id, ops) => ops.retry(id) };
}

// ---------------------------------------------------------------------------
// ⋯ menu — only the valid actions for the current state
// ---------------------------------------------------------------------------

function renderMenuButton(parent: HTMLElement, item: ScriptItem, ops: LifecycleOps): void {
	const btn = parent.createEl("button", { text: "⋯", cls: "mason-script-menu-button" });
	btn.setAttribute("type", "button");
	btn.setAttribute("aria-label", `More actions for ${item.displayName}`);
	btn.addEventListener("click", (evt) => {
		openMenu(item, ops, evt);
	});
}

/** A menu action descriptor: title (sentence case) + the op it triggers. */
interface MenuAction {
	title: string;
	icon: string;
	run: () => void | Promise<void>;
}

function openMenu(item: ScriptItem, ops: LifecycleOps, evt: Event): void {
	const menu = new Menu();
	for (const action of menuActions(item, ops)) {
		menu.addItem((mi) => {
			mi.setTitle(action.title).setIcon(action.icon).onClick(() => action.run());
		});
	}
	menu.showAtMouseEvent(evt as MouseEvent);
}

/**
 * Build the valid menu actions for a state. "Update only when UpdateAvailable,
 * retry only when Blocked" (PRD). Re-review consent only when the script has a
 * stored consent (okayed non-null).
 */
function menuActions(item: ScriptItem, ops: LifecycleOps): MenuAction[] {
	const actions: MenuAction[] = [];
	const { id } = item;

	// View source is universal.
	actions.push({ title: "View source", icon: "file-search", run: () => ops.viewSource(id) });

	switch (item.state.kind) {
		case "Active":
			// Re-review is always safe here: Active guarantees okayed !== null (evaluateState invariant).
			actions.push(reReviewAction(item, ops));
			break;
		case "UpdateAvailable":
			actions.push({
				title: `Update to v${item.catalogVersion ?? item.version}`,
				icon: "download",
				run: () => ops.update(id),
			});
			actions.push(reReviewAction(item, ops));
			break;
		case "Disabled":
			// Re-review only offered when there is consent to re-review.
			if (item.record.okayed !== null) {
				actions.push(reReviewAction(item, ops));
			}
			break;
		case "Blocked":
			actions.push({ title: "Retry fetch", icon: "refresh-cw", run: () => ops.retry(id) });
			break;
		case "Available":
		case "Materializing":
		case "Absent":
			// Minimal: View source + Remove (when a record exists).
			break;
	}

	// Remove is offered whenever the script has a persisted record to clear.
	actions.push({ title: "Remove", icon: "trash", run: () => ops.remove(id) });
	return actions;
}

function reReviewAction(item: ScriptItem, ops: LifecycleOps): MenuAction {
	return { title: "Re-review consent", icon: "shield", run: () => ops.reReview(item.id) };
}

// ---------------------------------------------------------------------------
// Toolbar + empty state
// ---------------------------------------------------------------------------

function renderToolbar(containerEl: HTMLElement, ops: LifecycleOps): void {
	const toolbar = containerEl.createDiv({ cls: "mason-scripts-toolbar" });

	const importBtn = toolbar.createEl("button", { text: "Import from vault", cls: "mason-toolbar-button" });
	importBtn.setAttribute("type", "button");
	importBtn.addEventListener("click", () => {
		void ops.importFromVault();
	});

	const browseBtn = toolbar.createEl("button", { text: "Browse official", cls: "mason-toolbar-button" });
	browseBtn.setAttribute("type", "button");
	browseBtn.addEventListener("click", () => {
		void ops.browseOfficial();
	});
}

/**
 * Meaningful empty state — an inviting row, NOT the misleading
 * "No scripts installed yet". Offers the same import / browse controls.
 */
function renderEmptyState(containerEl: HTMLElement, ops: LifecycleOps): void {
	const empty = containerEl.createDiv({ cls: "mason-scripts-empty" });
	empty.createEl("p", {
		text: "No scripts yet. Import one from your vault, or browse the official catalog to get started.",
		cls: "mason-scripts-empty-text",
	});
	renderToolbar(containerEl, ops);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Decorative badge only — provenance NEVER affects trust (PRD/F4). */
function provenanceBadge(provenance: "curated" | "imported"): string {
	return provenance === "curated" ? "Official" : "Imported";
}
