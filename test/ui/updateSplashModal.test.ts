/**
 * UpdateSplashModal — post-update "what's new" splash.
 *
 * Tests run against the mock obsidian module (test/__mocks__/obsidian.ts):
 *   - Modal.open() calls onOpen() synchronously → contentEl is populated.
 *   - Setting builder records into capturedSettings() (toggle introspection).
 *   - MockHTMLElement exposes _collectText() and _findButtonByText().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App } from "obsidian";
import {
	capturedSettings,
	clearCapturedSettings,
	MockHTMLElement,
} from "../__mocks__/obsidian";
import type { ReleaseNotes } from "../../src/core/releaseNotes";

interface MockToggleControl {
	_value: boolean;
	setValue(v: boolean): MockToggleControl;
	onChange(cb: (v: boolean) => void): MockToggleControl;
}

interface CapturedSetting {
	name: string;
	toggleControls: MockToggleControl[];
}

const { UpdateSplashModal } = await import("../../src/ui/updateSplashModal");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SplashOverrides {
	version?: string;
	updatableCount?: number;
	notes?: ReleaseNotes;
	showSplash?: boolean;
	onToggleSplash?: (v: boolean) => void;
	onOpenScripts?: () => void;
}

function openModal(overrides: SplashOverrides = {}): {
	modal: InstanceType<typeof UpdateSplashModal>;
	content: MockHTMLElement;
	onToggleSplash: ReturnType<typeof vi.fn>;
	onOpenScripts: ReturnType<typeof vi.fn>;
} {
	const onToggleSplash = vi.fn(overrides.onToggleSplash);
	const onOpenScripts = vi.fn(overrides.onOpenScripts);
	const modal = new UpdateSplashModal(new App() as never, {
		version: overrides.version ?? "0.3.0",
		updatableCount: overrides.updatableCount ?? 2,
		notes: overrides.notes ?? { features: [], fixes: [] },
		showSplash: overrides.showSplash ?? true,
		onToggleSplash,
		onOpenScripts,
	});
	modal.open();
	return {
		modal,
		content: modal.contentEl as unknown as MockHTMLElement,
		onToggleSplash,
		onOpenScripts,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UpdateSplashModal", () => {
	beforeEach(() => {
		clearCapturedSettings();
	});

	it("renders the plugin version in the title", () => {
		const { content } = openModal({ version: "1.4.2" });
		expect(content._collectText()).toContain("updated to v1.4.2");
	});

	it("summarises the count (plural) and offers the Scripts route when updates exist", () => {
		const { content } = openModal({ updatableCount: 2 });
		const text = content._collectText();
		expect(text).toContain("2 scripts have updates available");
		expect(content._findButtonByText("Open scripts settings")).toBeDefined();
	});

	it("uses singular phrasing for a single update", () => {
		const { content } = openModal({ updatableCount: 1 });
		expect(content._collectText()).toContain("1 script has updates available");
	});

	it("shows an all-clear summary and NO Scripts button at zero updates", () => {
		const { content } = openModal({ updatableCount: 0 });
		expect(content._collectText()).toContain("No script updates right now");
		expect(content._findButtonByText("Open scripts settings")).toBeUndefined();
	});

	it("Open scripts settings invokes the route callback", () => {
		const { content, onOpenScripts } = openModal({ updatableCount: 3 });
		content._findButtonByText("Open scripts settings")!._click();
		expect(onOpenScripts).toHaveBeenCalledOnce();
	});

	it("always renders a Close button", () => {
		const { content } = openModal({ updatableCount: 0 });
		expect(content._findButtonByText("Close")).toBeDefined();
	});

	it("toggle reflects showSplash and persists changes via onToggleSplash", () => {
		const { onToggleSplash } = openModal({ showSplash: true });
		const settings = capturedSettings() as unknown as CapturedSetting[];
		const toggleRow = settings.find((s) => s.toggleControls.length > 0);
		expect(toggleRow).toBeDefined();
		expect(toggleRow!.toggleControls[0]._value).toBe(true);

		// Flipping the toggle off persists the new preference.
		toggleRow!.toggleControls[0].setValue(false);
		expect(onToggleSplash).toHaveBeenCalledWith(false);
	});

	// spec-009 — release notes
	it("renders a 'What's new' list, one item per note, above the summary", () => {
		const { content } = openModal({
			notes: {
				features: [
					"cleanup: box-drawing table → Markdown table transform",
					"paste: fit paste to list context",
				],
				fixes: [],
			},
		});
		const text = content._collectText();
		expect(text).toContain("What's new");
		expect(text).toContain("cleanup: box-drawing table → Markdown table transform");
		expect(text).toContain("paste: fit paste to list context");
		// The notes must precede the script summary — they are why the user is here.
		expect(text.indexOf("What's new")).toBeLessThan(text.indexOf("updates available"));
	});

	it("renders no notes section when there are none (pre-009 dialog)", () => {
		const withoutNotes = openModal({ notes: { features: [], fixes: [] } }).content._collectText();
		expect(withoutNotes).not.toContain("What's new");
		expect(withoutNotes).not.toContain("Fixed");
	});

	it("renders a 'Fixed' list for a fix-only release", () => {
		// The 0.9.1 case: no features at all, so the splash would otherwise be bare.
		const text = openModal({
			notes: { features: [], fixes: ["reflow: keep list nesting instead of flattening every item"] },
		}).content._collectText();
		expect(text).toContain("Fixed");
		expect(text).toContain("reflow: keep list nesting instead of flattening every item");
		expect(text).not.toContain("What's new");
		expect(text.indexOf("Fixed")).toBeLessThan(text.indexOf("updates available"));
	});

	it("renders both groups with features first", () => {
		const text = openModal({
			notes: { features: ["ui: a new thing"], fixes: ["paste: a repaired thing"] },
		}).content._collectText();
		expect(text.indexOf("What's new")).toBeLessThan(text.indexOf("Fixed"));
		expect(text.indexOf("ui: a new thing")).toBeLessThan(text.indexOf("paste: a repaired thing"));
	});

	it("omits the heading of an empty group rather than showing a bare heading", () => {
		const text = openModal({ notes: { features: ["ui: a new thing"], fixes: [] } })
			.content._collectText();
		expect(text).toContain("What's new");
		expect(text).not.toContain("Fixed");
	});

	it("shows notes even when no script updates are waiting", () => {
		const text = openModal({
			updatableCount: 0,
			notes: { features: ["paste: fit paste to list context"], fixes: [] },
		}).content._collectText();
		expect(text).toContain("What's new");
		expect(text).toContain("paste: fit paste to list context");
		expect(text).toContain("No script updates right now");
	});

	it("onClose empties the content element", () => {
		const { modal, content } = openModal();
		modal.close();
		expect(content._collectText()).toBe("");
	});
});
