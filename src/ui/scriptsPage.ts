// scriptsPage — the declarative Scripts settings page (spec 010).
//
// buildScriptsPage turns the cached, already-resolved script state into a
// definition tree: the page entry with its update indicator, a list with one
// row per script, and two search-only action rows. configureScriptRow fills
// one of those rows. Both are SYNCHRONOUS and free of I/O: script state is
// resolved upstream (ScriptsCache) and every interactive control calls through
// the LifecycleOps action seam.
//
// - No `id` on the page or its rows: Obsidian keys them by name, so names must
//   stay stable and unique among siblings (spec 010, deviation D-1). Changing
//   text such as the update count goes into `displayValue`, never into a name.
// - The list's header buttons are wired once, when Obsidian creates the group.
//   Their callbacks therefore look the op up on `ops` when clicked.
//
// COMMUNITY COMPLIANCE (CON-3)
// - Script data reaches the DOM only as text (definition `name`/`desc`,
//   createSpan, createDiv, setTooltip) — never innerHTML / outerHTML /
//   insertAdjacentHTML.
// - All UI text is SENTENCE CASE: pills, menu titles, buttons, row names.
// - Status is conveyed by a text LABEL + icon, never colour alone.
// - Every Blocked row shows a human reason + a single recovery action.
// - The provenance badge ("Official" / "Imported") is decorative only — it
//   NEVER affects trust (PRD/F4).

import { Menu } from "obsidian";
import type {
	ExtraButtonComponent,
	Setting,
	SettingDefinitionAction,
	SettingDefinitionGroup,
	SettingDefinitionList,
	SettingDefinitionPage,
	SettingDefinitionRender,
} from "obsidian";
import type { LifecycleState, BlockedReason } from "../scripts/lifecycle";
import type { ScriptRecord } from "../scripts/store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single fully-resolved script row. `state` is computed upstream (the live
 * resolver, or evaluateState offline) before the page is built; this module
 * never resolves it.
 */
export interface ScriptItem {
	id: string;
	displayName: string;
	description: string;
	record: ScriptRecord;
	state: LifecycleState;
	/** Consented/active version shown on the row's name line (e.g. "v1"). */
	version: number;
	provenance: "curated" | "imported";
	/** Latest catalog version — used to label "Update to v{n}" when UpdateAvailable. */
	catalogVersion?: number;
}

/**
 * The action seam the UI triggers. The render path NEVER performs I/O directly —
 * every interactive control calls through one of these. buildLifecycleOps
 * (scriptLifecycleOps.ts) provides the concrete ops.
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

/** The slice of ScriptsCache the page is built from. */
export interface ScriptsPageState {
	/** Resolved script rows; null while they are not loaded yet. */
	items: ScriptItem[] | null;
	/** How many scripts have an update waiting. */
	updatableCount: number;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Page name and key: the splash deep link opens the page by this name. */
export const SCRIPTS_PAGE_NAME = "Scripts";

const IMPORT_FROM_VAULT = "Import from vault";
const BROWSE_OFFICIAL = "Browse official";
/** Shown wherever script rows belong while the scripts are not loaded yet. */
export const SCRIPTS_LOADING_TEXT = "Loading scripts…";
const NO_SCRIPTS_TEXT = "No scripts yet. Import one from your vault, or browse the official catalog to get started.";

/**
 * Build the Scripts page from the cached script state.
 *
 * The update indicator reads `cache.updatableCount` each time Obsidian
 * evaluates it; the rows are a snapshot of `cache.items`, so the tab rebuilds
 * the page (via `update()`) whenever the cache announces new state.
 */
export function buildScriptsPage(cache: ScriptsPageState, ops: LifecycleOps): SettingDefinitionPage {
	return {
		type: "page",
		name: SCRIPTS_PAGE_NAME,
		displayValue: () => updatesAvailableText(cache.updatableCount),
		status: () => (cache.updatableCount > 0 ? "warning" : null),
		items: [buildScriptList(cache.items, ops), buildActionRowGroup(ops)],
	};
}

function updatesAvailableText(count: number): string {
	if (count <= 0) return "";
	return `${count} update${count === 1 ? "" : "s"} available`;
}

function buildScriptList(items: ScriptItem[] | null, ops: LifecycleOps): SettingDefinitionList {
	return {
		type: "list",
		emptyState: items === null ? SCRIPTS_LOADING_TEXT : NO_SCRIPTS_TEXT,
		addItem: { name: IMPORT_FROM_VAULT, action: () => void ops.importFromVault() },
		extraButtons: [
			(button: ExtraButtonComponent) =>
				button
					.setIcon("store")
					.setTooltip(BROWSE_OFFICIAL)
					.onClick(() => void ops.browseOfficial()),
		],
		items: buildScriptRows(items ?? [], ops),
	};
}

function buildScriptRows(items: ScriptItem[], ops: LifecycleOps): SettingDefinitionRender[] {
	const rowNameOf = scriptRowNamer(items);
	return items.map((item) => {
		const rowName = rowNameOf(item);
		return {
			name: rowName,
			desc: item.description,
			aliases: [item.id],
			render: (setting: Setting) => configureScriptRow(setting, item, ops, rowName),
		};
	});
}

/**
 * Returns the function that names the row of each of `items`; call it once per
 * item. The name is the row's key, so two scripts must never share one.
 *
 * A display name only one script carries is used as it is. Scripts that share
 * a display name get " (id)" appended, repeated until the name is free of every
 * other row name.
 */
function scriptRowNamer(items: ScriptItem[]): (item: ScriptItem) => string {
	const sharedNames = sharedDisplayNames(items);
	const taken = new Set(items.map((item) => item.displayName));
	return (item) => {
		if (!sharedNames.has(item.displayName)) return item.displayName;
		const suffix = ` (${item.id})`;
		let name = item.displayName + suffix;
		while (taken.has(name)) {
			name += suffix;
		}
		taken.add(name);
		return name;
	};
}

/** The display names that more than one script carries. */
function sharedDisplayNames(items: ScriptItem[]): Set<string> {
	const seen = new Set<string>();
	const shared = new Set<string>();
	for (const { displayName } of items) {
		(seen.has(displayName) ? shared : seen).add(displayName);
	}
	return shared;
}

/**
 * Search-only twins of the list's header buttons: Obsidian's settings search
 * indexes rows, not header buttons, so these make both actions findable.
 */
function buildActionRowGroup(ops: LifecycleOps): SettingDefinitionGroup {
	const importRow: SettingDefinitionAction = {
		name: IMPORT_FROM_VAULT,
		aliases: ["import"],
		action: () => void ops.importFromVault(),
	};
	const browseRow: SettingDefinitionAction = {
		name: BROWSE_OFFICIAL,
		aliases: ["catalog", "official scripts"],
		action: () => void ops.browseOfficial(),
	};
	return { type: "group", items: [importRow, browseRow] };
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

/**
 * Fill one script row. Obsidian has already set the row's name and
 * description from its definition; this adds the provenance badge, status pill
 * and version to the name line, the reason below the description of a Blocked
 * script, then the controls valid for the script's state.
 *
 * `rowName` is the name the row is listed under; it differs from the display
 * name when several scripts share one, and labels the toggle and the ⋯ button
 * so those rows stay distinguishable for assistive technology.
 */
export function configureScriptRow(
	setting: Setting,
	item: ScriptItem,
	ops: LifecycleOps,
	rowName: string = item.displayName,
): void {
	addNameLineDetails(setting.nameEl, item);

	if (item.state.kind === "Blocked") {
		addBlockedRecovery(setting, item, item.state.reason, ops);
	}
	if (showsToggle(item.state)) {
		addEnableToggle(setting, item, ops, rowName);
	}
	addMenuButton(setting, item, ops, rowName);
}

/** Name line: name · provenance badge · status pill · version. */
function addNameLineDetails(nameEl: HTMLElement, item: ScriptItem): void {
	nameEl.createSpan({ text: provenanceBadge(item.provenance), cls: "mason-script-badge" });

	const pill = nameEl.createSpan({ cls: "mason-script-pill" });
	// Icon carries status non-colour-wise; label is the authoritative text.
	pill.createSpan({ text: pillIcon(item.state), cls: "mason-script-pill-icon" });
	pill.createSpan({ text: pillLabel(item.state), cls: "mason-script-pill-label" });
	pill.addClass(`mason-pill-${item.state.kind.toLowerCase()}`);

	nameEl.createSpan({ text: `v${item.version}`, cls: "mason-script-version" });
}

function addEnableToggle(setting: Setting, item: ScriptItem, ops: LifecycleOps, rowName: string): void {
	setting.addToggle((toggle) =>
		toggle
			// The tooltip doubles as the toggle's accessible name.
			.setTooltip(`Enable ${rowName}`)
			.setValue(toggleValue(item.state))
			.onChange((enabled) => {
				if (enabled) {
					void ops.enable(item.id);
				} else {
					void ops.disable(item.id);
				}
			}),
	);
}

/** The reason follows the description; one button offers the recovery. */
function addBlockedRecovery(setting: Setting, item: ScriptItem, reason: BlockedReason, ops: LifecycleOps): void {
	setting.descEl.createDiv({ text: blockedReasonText(item, reason), cls: "mason-script-blocked-reason" });

	const { label, action } = blockedRecovery(reason);
	setting.addButton((button) => button.setButtonText(label).onClick(() => void action(item.id, ops)));
}

function addMenuButton(setting: Setting, item: ScriptItem, ops: LifecycleOps, rowName: string): void {
	setting.addExtraButton((button) =>
		button
			.setIcon("more-horizontal")
			.setTooltip(`More actions for ${rowName}`)
			// onClick provides no mouse event, so the menu is placed below the button.
			.onClick(() => openMenu(item, ops, button.extraSettingsEl)),
	);
}

function openMenu(item: ScriptItem, ops: LifecycleOps, anchorEl: HTMLElement): void {
	const menu = new Menu();
	for (const action of menuActions(item, ops)) {
		menu.addItem((mi) => {
			mi.setTitle(action.title).setIcon(action.icon).onClick(() => action.run());
		});
	}
	const anchor = anchorEl.getBoundingClientRect();
	menu.showAtPosition({ x: anchor.left, y: anchor.bottom });
}

// ---------------------------------------------------------------------------
// Status pill — text LABEL + icon (never colour alone)
// ---------------------------------------------------------------------------

/** Maps a LifecycleState to its sentence-case pill label. */
export function pillLabel(state: LifecycleState): string {
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
export function pillIcon(state: LifecycleState): string {
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

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

/** Active + UpdateAvailable are ON; Disabled + Available are OFF. */
export function toggleValue(state: LifecycleState): boolean {
	return state.kind === "Active" || state.kind === "UpdateAvailable";
}

/** A toggle is meaningful only for enable/disable-able states. */
export function showsToggle(state: LifecycleState): boolean {
	return (
		state.kind === "Active" ||
		state.kind === "UpdateAvailable" ||
		state.kind === "Disabled" ||
		state.kind === "Available"
	);
}

// ---------------------------------------------------------------------------
// Blocked recovery — single action; reason→recovery mapping
// ---------------------------------------------------------------------------

/** Human, sentence-case reason. source-missing names the missing path. */
export function blockedReasonText(item: ScriptItem, reason: BlockedReason): string {
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
export function blockedRecovery(
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

/** A menu action descriptor: title (sentence case) + the op it triggers. */
interface MenuAction {
	title: string;
	icon: string;
	run: () => void | Promise<void>;
}

/**
 * Build the valid menu actions for a state. "Update only when UpdateAvailable,
 * retry only when Blocked" (PRD). Re-review consent only when the script has a
 * stored consent (okayed non-null).
 */
export function menuActions(item: ScriptItem, ops: LifecycleOps): MenuAction[] {
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
			// Nothing state-specific: only View source and Remove.
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
// Provenance
// ---------------------------------------------------------------------------

/** Decorative badge only — provenance NEVER affects trust (PRD/F4). */
export function provenanceBadge(provenance: "curated" | "imported"): string {
	return provenance === "curated" ? "Official" : "Imported";
}
