/**
 * T4.2 — Scripts tab: card rows + ⋯ menu + toolbar (RED → GREEN).
 *
 * The Scripts tab is rendering-focused and SYNCHRONOUS: it accepts a resolved
 * list of ScriptItems (each carrying its already-computed LifecycleState) plus
 * an injected LifecycleOps action seam. Async state resolution happens upstream
 * (a thin controller) — NOT in this render path — so the UI is unit-testable
 * without live-catalog I/O.
 *
 * Observable behaviour contracts:
 *   1. One card per item: displayName + description rendered as TEXT.
 *   2. Provenance badge: curated→"Official", imported→"Imported" (badge only).
 *   3. Status pill text matches the LifecycleState kind (label, not colour).
 *   4. Active/UpdateAvailable → toggle ON; Disabled/Available → toggle OFF.
 *   5. Toggle ON/OFF drives ops.enable(id) / ops.disable(id).
 *   6. Blocked cards show a human reason + a single inline recovery action that
 *      drives the correct op (source-missing→reViewSource/import; others→retry).
 *   7. ⋯ menu lists ONLY valid actions for the state, and each item invokes the
 *      correct op. update only on UpdateAvailable; retry only on Blocked.
 *   8. Toolbar: "Import from vault" → ops.importFromVault();
 *      "Browse official" → ops.browseOfficial().
 *   9. Empty state: a meaningful invite (NOT "No scripts installed yet") with
 *      working import / browse controls.
 *  10. Sentence case for all pills, menu titles, buttons.
 *  11. No innerHTML/outerHTML/insertAdjacentHTML (text helpers only).
 *
 * HOUSE STYLE: tabs, double quotes, factory test data, no let/beforeEach.
 */

import { describe, it, expect, vi } from "vitest";
import { MockHTMLElement, Menu } from "../__mocks__/obsidian";
import type { ScriptRecord } from "../../src/scripts/store";
import type { LifecycleState } from "../../src/scripts/lifecycle";

const { renderScriptsTab } = await import("../../src/ui/scriptsTab");
import type { ScriptItem, LifecycleOps } from "../../src/ui/scriptsTab";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRecord(overrides?: Partial<ScriptRecord>): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:abc" },
		source: "scripts/perplexity-app.cjs",
		command: false,
		...overrides,
	};
}

function makeItem(overrides?: Partial<ScriptItem>): ScriptItem {
	return {
		id: "perplexity-app",
		displayName: "Perplexity app",
		description: "Formats Perplexity desktop-app copies into footnotes.",
		record: makeRecord(),
		state: { kind: "Active" } as LifecycleState,
		version: 1,
		provenance: "curated",
		catalogVersion: 1,
		...overrides,
	};
}

/** Fully-stubbed LifecycleOps — every method is a vi.fn so calls are observable. */
function makeOps(overrides?: Partial<LifecycleOps>): LifecycleOps {
	return {
		enable: vi.fn().mockResolvedValue(undefined),
		disable: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		retry: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		reReview: vi.fn().mockResolvedValue(undefined),
		viewSource: vi.fn().mockResolvedValue(undefined),
		importFromVault: vi.fn().mockResolvedValue(undefined),
		browseOfficial: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

/** Render into a fresh container and return it. */
function render(items: ScriptItem[], ops: LifecycleOps): MockHTMLElement {
	const container = new MockHTMLElement("div");
	renderScriptsTab(container as unknown as HTMLElement, items, ops);
	return container;
}

// The render path constructs `new Menu()` on ⋯ click then calls
// showAtMouseEvent. We capture each shown instance so the test can read the
// items it received. Patch the prototype once at module load.
const _lastMenus: Menu[] = [];
const _origShow = Menu.prototype.showAtMouseEvent;
Menu.prototype.showAtMouseEvent = function (this: Menu, evt: unknown): void {
	_lastMenus.push(this);
	_origShow.call(this, evt);
};

/** Open the ⋯ menu for the only card and return the Menu the click produced. */
function openCardMenu(container: MockHTMLElement): Menu {
	const menuBtn = container._findButtonByText("⋯");
	expect(menuBtn).toBeDefined();
	menuBtn!._click();
	return _lastMenus[_lastMenus.length - 1];
}

// ---------------------------------------------------------------------------
// CARD CONTENT
// ---------------------------------------------------------------------------

describe("Scripts tab — card content", () => {
	it("renders displayName and description as text", () => {
		const container = render([makeItem()], makeOps());
		const text = container._collectText();
		expect(text).toContain("Perplexity app");
		expect(text).toContain("Formats Perplexity desktop-app copies into footnotes.");
	});

	it("renders the curated provenance badge as 'Official'", () => {
		const container = render([makeItem({ provenance: "curated" })], makeOps());
		expect(container._collectText()).toContain("Official");
	});

	it("renders the imported provenance badge as 'Imported'", () => {
		const container = render(
			[makeItem({ provenance: "imported", record: makeRecord({ provenance: "imported" }) })],
			makeOps(),
		);
		expect(container._collectText()).toContain("Imported");
	});

	it("renders one card per item", () => {
		const items = [
			makeItem({ id: "a", displayName: "Script a" }),
			makeItem({ id: "b", displayName: "Script b" }),
		];
		const container = render(items, makeOps());
		const text = container._collectText();
		expect(text).toContain("Script a");
		expect(text).toContain("Script b");
	});
});

// ---------------------------------------------------------------------------
// STATUS PILLS (label, not colour)
// ---------------------------------------------------------------------------

describe("Scripts tab — status pills", () => {
	const cases: Array<{ state: LifecycleState; pill: string }> = [
		{ state: { kind: "Active" }, pill: "Active" },
		{ state: { kind: "Disabled" }, pill: "Disabled" },
		{ state: { kind: "UpdateAvailable" }, pill: "Update available" },
		{ state: { kind: "Available" }, pill: "Available" },
		{ state: { kind: "Materializing" }, pill: "Materializing" },
		{ state: { kind: "Blocked", reason: "drift" }, pill: "Blocked" },
		{ state: { kind: "Absent" }, pill: "Not installed" },
	];

	for (const { state, pill } of cases) {
		it(`shows "${pill}" pill for ${state.kind}`, () => {
			const container = render([makeItem({ state })], makeOps());
			expect(container._collectText()).toContain(pill);
		});
	}
});

// ---------------------------------------------------------------------------
// TOGGLE wiring
// ---------------------------------------------------------------------------

describe("Scripts tab — enable/disable toggle", () => {
	it("Active item: toggle reflects ON and turning OFF calls ops.disable", () => {
		const ops = makeOps();
		const container = render([makeItem({ id: "x", state: { kind: "Active" } })], ops);
		const toggle = container._findToggle();
		expect(toggle).toBeDefined();
		expect(toggle!._value).toBe(true);
		toggle!.setValue(false);
		expect(ops.disable).toHaveBeenCalledWith("x");
	});

	it("Disabled item: toggle reflects OFF and turning ON calls ops.enable", () => {
		const ops = makeOps();
		const container = render(
			[makeItem({ id: "y", state: { kind: "Disabled" }, record: makeRecord({ enabled: false }) })],
			ops,
		);
		const toggle = container._findToggle();
		expect(toggle!._value).toBe(false);
		toggle!.setValue(true);
		expect(ops.enable).toHaveBeenCalledWith("y");
	});

	it("Available item: toggle reflects OFF (offered, not yet enabled)", () => {
		const ops = makeOps();
		const container = render([makeItem({ state: { kind: "Available" } })], ops);
		expect(container._findToggle()!._value).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// BLOCKED cards — human reason + single inline recovery
// ---------------------------------------------------------------------------

describe("Scripts tab — Blocked cards", () => {
	it("source-missing shows a human reason and a re-import recovery that drives importFromVault", () => {
		const ops = makeOps();
		const container = render(
			[
				makeItem({
					id: "old",
					provenance: "imported",
					record: makeRecord({ provenance: "imported", source: "scripts/old.cjs" }),
					state: { kind: "Blocked", reason: "source-missing" },
				}),
			],
			ops,
		);
		const text = container._collectText();
		// Human reason mentions the missing source path.
		expect(text).toContain("scripts/old.cjs");
		// A single inline recovery button labelled "Re-import".
		const recovery = container._findButtonByText("Re-import");
		expect(recovery).toBeDefined();
		recovery!._click();
		expect(ops.importFromVault).toHaveBeenCalled();
	});

	it("drift shows a reason and a Retry fetch recovery that drives ops.retry", () => {
		const ops = makeOps();
		const container = render(
			[makeItem({ id: "d", state: { kind: "Blocked", reason: "drift" } })],
			ops,
		);
		const recovery = container._findButtonByText("Retry fetch");
		expect(recovery).toBeDefined();
		recovery!._click();
		expect(ops.retry).toHaveBeenCalledWith("d");
	});

	it("offline shows a Retry fetch recovery that drives ops.retry", () => {
		const ops = makeOps();
		const container = render(
			[makeItem({ id: "o", state: { kind: "Blocked", reason: "offline" } })],
			ops,
		);
		container._findButtonByText("Retry fetch")!._click();
		expect(ops.retry).toHaveBeenCalledWith("o");
	});

	it("checksum-mismatch shows a Retry fetch recovery that drives ops.retry", () => {
		const ops = makeOps();
		const container = render(
			[makeItem({ id: "cs", state: { kind: "Blocked", reason: "checksum-mismatch" } })],
			ops,
		);
		const recovery = container._findButtonByText("Retry fetch");
		expect(recovery).toBeDefined();
		recovery!._click();
		expect(ops.retry).toHaveBeenCalledWith("cs");
	});
});

// ---------------------------------------------------------------------------
// ⋯ MENU — only valid actions per state
// ---------------------------------------------------------------------------

describe("Scripts tab — ⋯ menu actions", () => {
	function menuTitlesFor(state: LifecycleState, item?: Partial<ScriptItem>): { titles: string[]; menu: Menu; ops: LifecycleOps } {
		const ops = makeOps();
		const container = render([makeItem({ state, ...item })], ops);
		const menu = openCardMenu(container);
		return { titles: menu._titles(), menu, ops };
	}

	it("Active: View source, Re-review consent, Remove — no Update, no Retry", () => {
		const { titles } = menuTitlesFor({ kind: "Active" });
		expect(titles).toContain("View source");
		expect(titles).toContain("Re-review consent");
		expect(titles).toContain("Remove");
		expect(titles).not.toContain("Retry fetch");
		expect(titles.some((t) => t.startsWith("Update to"))).toBe(false);
	});

	it("UpdateAvailable: includes 'Update to v{catalogVersion}' and drives ops.update", async () => {
		const ops = makeOps();
		const container = render(
			[makeItem({ id: "u", state: { kind: "UpdateAvailable" }, catalogVersion: 3 })],
			ops,
		);
		const menu = openCardMenu(container);
		expect(menu._titles()).toContain("Update to v3");
		await menu._click("Update to v3");
		expect(ops.update).toHaveBeenCalledWith("u");
	});

	it("Blocked: View source, Retry fetch, Remove — no Update, no Re-review", () => {
		const { titles } = menuTitlesFor({ kind: "Blocked", reason: "drift" });
		expect(titles).toContain("View source");
		expect(titles).toContain("Retry fetch");
		expect(titles).toContain("Remove");
		expect(titles.some((t) => t.startsWith("Update to"))).toBe(false);
		expect(titles).not.toContain("Re-review consent");
	});

	it("Disabled with consent: Re-review consent present; without consent: absent", () => {
		const withConsent = menuTitlesFor(
			{ kind: "Disabled" },
			{ record: makeRecord({ enabled: false, okayed: { version: 1, checksum: "x" } }) },
		);
		expect(withConsent.titles).toContain("Re-review consent");

		const noConsent = menuTitlesFor(
			{ kind: "Disabled" },
			{ record: makeRecord({ enabled: false, okayed: null }) },
		);
		expect(noConsent.titles).not.toContain("Re-review consent");
	});

	it("menu 'View source' invokes ops.viewSource; 'Remove' invokes ops.remove", async () => {
		const ops = makeOps();
		const container = render([makeItem({ id: "m", state: { kind: "Active" } })], ops);
		const menu = openCardMenu(container);
		await menu._click("View source");
		expect(ops.viewSource).toHaveBeenCalledWith("m");
		await menu._click("Remove");
		expect(ops.remove).toHaveBeenCalledWith("m");
	});

	it("menu 'Re-review consent' invokes ops.reReview", async () => {
		const ops = makeOps();
		const container = render([makeItem({ id: "r", state: { kind: "Active" } })], ops);
		const menu = openCardMenu(container);
		await menu._click("Re-review consent");
		expect(ops.reReview).toHaveBeenCalledWith("r");
	});

	it("opening the menu actually shows it (showAtMouseEvent fired)", () => {
		const container = render([makeItem()], makeOps());
		const menu = openCardMenu(container);
		expect(menu._shown).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// TOOLBAR
// ---------------------------------------------------------------------------

describe("Scripts tab — toolbar", () => {
	it("Import from vault button drives ops.importFromVault", () => {
		const ops = makeOps();
		const container = render([makeItem()], ops);
		const btn = container._findButtonByText("Import from vault");
		expect(btn).toBeDefined();
		btn!._click();
		expect(ops.importFromVault).toHaveBeenCalledTimes(1);
	});

	it("Browse official button drives ops.browseOfficial", () => {
		const ops = makeOps();
		const container = render([makeItem()], ops);
		const btn = container._findButtonByText("Browse official");
		expect(btn).toBeDefined();
		btn!._click();
		expect(ops.browseOfficial).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// EMPTY STATE
// ---------------------------------------------------------------------------

describe("Scripts tab — empty state", () => {
	it("shows a meaningful invite, not the misleading 'No scripts installed yet'", () => {
		const container = render([], makeOps());
		const text = container._collectText();
		expect(text).not.toContain("No scripts installed yet");
		// Inviting copy mentions importing or browsing.
		expect(text.toLowerCase()).toMatch(/import|browse/);
	});

	it("empty state still offers working import + browse controls", () => {
		const ops = makeOps();
		const container = render([], ops);
		container._findButtonByText("Import from vault")!._click();
		container._findButtonByText("Browse official")!._click();
		expect(ops.importFromVault).toHaveBeenCalledTimes(1);
		expect(ops.browseOfficial).toHaveBeenCalledTimes(1);
	});
});

// ---------------------------------------------------------------------------
// COMPLIANCE — sentence case + safe DOM
// ---------------------------------------------------------------------------

describe("Scripts tab — compliance", () => {
	it("menu titles are sentence case (only first word capitalised)", () => {
		const container = render([makeItem({ state: { kind: "UpdateAvailable" }, catalogVersion: 2 })], makeOps());
		const menu = openCardMenu(container);
		const titleCasePattern = /^.+\s+[A-Z][a-z]/;
		for (const title of menu._titles()) {
			expect(title, `menu title "${title}" looks like Title Case`).not.toMatch(titleCasePattern);
		}
	});

	it("pill labels are sentence case", () => {
		const container = render([makeItem({ state: { kind: "UpdateAvailable" } })], makeOps());
		// "Update available" — second word lowercase.
		expect(container._collectText()).toContain("Update available");
		expect(container._collectText()).not.toContain("Update Available");
	});
});
