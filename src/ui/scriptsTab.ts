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
import {
	blockedReasonText,
	blockedRecovery,
	menuActions,
	pillIcon,
	pillLabel,
	provenanceBadge,
	showsToggle,
	toggleValue,
} from "./scriptsPage";
import type { ScriptItem, LifecycleOps } from "./scriptsPage";

// The row types and state helpers live in scriptsPage.ts (spec 010); this
// renderer keeps using them until the declarative tab replaces it.
export type { ScriptItem, LifecycleOps };

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

	header.createSpan({ text: item.displayName, cls: "mason-script-name" });
	header.createSpan({ text: provenanceBadge(item.provenance), cls: "mason-script-badge" });

	renderPill(header, item.state);
	header.createSpan({ text: `v${item.version}`, cls: "mason-script-version" });

	// Enable toggle — shown for states where a toggle is meaningful.
	if (showsToggle(item.state)) {
		renderToggle(header, item, ops);
	}

	renderMenuButton(header, item, ops);
}

/** Second line: description, plus inline reason + recovery when Blocked. */
function renderCardBody(card: HTMLElement, item: ScriptItem, ops: LifecycleOps): void {
	const body = card.createDiv({ cls: "mason-script-card-body" });
	body.createSpan({ text: item.description, cls: "mason-script-desc" });

	if (item.state.kind === "Blocked") {
		renderBlockedRecovery(body, item, item.state.reason, ops);
	}
}

// ---------------------------------------------------------------------------
// Status pill — text LABEL + icon (never colour alone)
// ---------------------------------------------------------------------------

function renderPill(parent: HTMLElement, state: LifecycleState): void {
	const pill = parent.createDiv({ cls: "mason-script-pill" });
	// Icon carries status non-colour-wise; label is the authoritative text.
	pill.createSpan({ text: pillIcon(state), cls: "mason-script-pill-icon" });
	pill.createSpan({ text: pillLabel(state), cls: "mason-script-pill-label" });
	pill.addClass(`mason-pill-${state.kind.toLowerCase()}`);
}

// ---------------------------------------------------------------------------
// Toggle — rendered as a native checkbox input (no Setting wrapper here)
// ---------------------------------------------------------------------------

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
	row.createSpan({ text: blockedReasonText(item, reason), cls: "mason-script-blocked-reason" });

	const { label, action } = blockedRecovery(reason);
	const btn = row.createEl("button", { text: label, cls: "mason-script-recovery" });
	btn.setAttribute("type", "button");
	btn.addEventListener("click", () => {
		void action(item.id, ops);
	});
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

function openMenu(item: ScriptItem, ops: LifecycleOps, evt: Event): void {
	const menu = new Menu();
	for (const action of menuActions(item, ops)) {
		menu.addItem((mi) => {
			mi.setTitle(action.title).setIcon(action.icon).onClick(() => action.run());
		});
	}
	menu.showAtMouseEvent(evt as MouseEvent);
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
