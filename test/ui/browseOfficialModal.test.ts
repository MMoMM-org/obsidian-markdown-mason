/**
 * BrowseOfficialModal — state-aware curated-catalog browser.
 *
 * Observable behaviour contracts:
 *   1. Each entry renders as a card with name + description (verbatim text).
 *   2. An "available" / "installed" entry shows an actionable "Enable" button
 *      that drives onEnable(id) and closes the modal.
 *   3. An "enabled" entry shows a non-actionable "Enabled" badge (no onEnable).
 */

import { describe, it, expect, vi } from "vitest";
import { App, MockHTMLElement } from "../__mocks__/obsidian";
import type { CatalogEntry } from "../../src/scripts/catalog/catalogSource";
import type { BrowseEntryStatus } from "../../src/ui/browseOfficialModal";

const { BrowseOfficialModal } = await import("../../src/ui/browseOfficialModal");

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
	return {
		id: "perplexity-app",
		version: 1,
		checksum: "sha256:abc",
		path: "scripts/perplexity-app.cjs",
		name: "Perplexity app",
		description: "Format Perplexity exports.",
		...overrides,
	};
}

describe("BrowseOfficialModal", () => {
	it("renders each entry's name and description as verbatim text", () => {
		const modal = new BrowseOfficialModal(new App() as never, [entry()], vi.fn());
		modal.open();
		const content = modal.contentEl as unknown as MockHTMLElement;
		const text = content._collectText();
		expect(text).toContain("Perplexity app");
		expect(text).toContain("Format Perplexity exports.");
	});

	it("an available entry offers Enable, which drives onEnable(id) and closes", () => {
		const onEnable = vi.fn();
		const modal = new BrowseOfficialModal(new App() as never, [entry()], onEnable, () => "available");
		modal.open();
		const content = modal.contentEl as unknown as MockHTMLElement;

		const btn = content._findButtonByText("Enable");
		expect(btn).toBeDefined();
		btn!._click();
		expect(onEnable).toHaveBeenCalledWith("perplexity-app");
	});

	it("an enabled entry shows a non-actionable 'Enabled' badge instead of 'Enable'", () => {
		const onEnable = vi.fn();
		const modal = new BrowseOfficialModal(new App() as never, [entry()], onEnable, () => "enabled");
		modal.open();
		const content = modal.contentEl as unknown as MockHTMLElement;

		expect(content._findButtonByText("Enabled")).toBeDefined();
		expect(content._findButtonByText("Enable")).toBeUndefined();

		// Clicking the badge does nothing (no enable wired).
		content._findButtonByText("Enabled")!._click();
		expect(onEnable).not.toHaveBeenCalled();
	});

	it("mixes states across entries: enabled one is a badge, the other is actionable", () => {
		const onEnable = vi.fn();
		const entries = [
			entry({ id: "perplexity-app", name: "Perplexity app" }),
			entry({ id: "perplexity-web", name: "Perplexity web", path: "scripts/perplexity-web.cjs" }),
		];
		const statusOf = (id: string): BrowseEntryStatus => (id === "perplexity-app" ? "enabled" : "available");
		const modal = new BrowseOfficialModal(new App() as never, entries, onEnable, statusOf);
		modal.open();
		const content = modal.contentEl as unknown as MockHTMLElement;

		expect(content._findButtonByText("Enabled")).toBeDefined();
		content._findButtonByText("Enable")!._click();
		expect(onEnable).toHaveBeenCalledWith("perplexity-web");
	});
});
