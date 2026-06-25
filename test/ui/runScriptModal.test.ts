/**
 * RunScriptModal — quick-switcher-style fuzzy launcher.
 *
 * The modal is a FuzzySuggestModal over the runnable scripts it is GIVEN (the
 * caller filters to Active and supplies the run wiring as onChoose). These tests
 * exercise the modal contract directly: items, fuzzy text, card rendering,
 * selection, and the empty/placeholder copy.
 */

import { describe, it, expect, vi } from "vitest";
import { App, MockHTMLElement } from "../__mocks__/obsidian";
import type { FuzzyMatch } from "obsidian";

const { RunScriptModal } = await import("../../src/ui/runScriptModal");
import type { RunScriptEntry } from "../../src/ui/runScriptModal";

function entry(overrides: Partial<RunScriptEntry> = {}): RunScriptEntry {
	return {
		id: "perplexity-app",
		name: "perplexity-app",
		description: "Format Perplexity exports.",
		...overrides,
	};
}

/** Wrap an entry as the FuzzyMatch the renderSuggestion override receives. */
function match(e: RunScriptEntry): FuzzyMatch<RunScriptEntry> {
	return { item: e, match: { score: 0, matches: [] } };
}

describe("RunScriptModal — items + fuzzy text", () => {
	it("offers exactly the entries it is given", () => {
		const entries = [entry({ id: "a", name: "Alpha" }), entry({ id: "b", name: "Beta" })];
		const modal = new RunScriptModal(new App() as never, entries, vi.fn());
		expect(modal.getItems().map((e) => e.id)).toEqual(["a", "b"]);
	});

	it("fuzzy text covers both name and description", () => {
		const modal = new RunScriptModal(new App() as never, [], vi.fn());
		const text = modal.getItemText(entry({ name: "Tidy headings", description: "Prefix with =>." }));
		expect(text).toContain("Tidy headings");
		expect(text).toContain("Prefix with =>.");
	});

	it("falls back to just the name when there is no description", () => {
		const modal = new RunScriptModal(new App() as never, [], vi.fn());
		expect(modal.getItemText(entry({ name: "Solo", description: "" }))).toBe("Solo");
	});
});

describe("RunScriptModal — card rendering", () => {
	it("renders the name and description as card text (no innerHTML)", () => {
		const modal = new RunScriptModal(new App() as never, [], vi.fn());
		const el = new MockHTMLElement("div");
		modal.renderSuggestion(match(entry({ name: "Tidy headings", description: "Prefix with =>." })), el as never);
		const text = el._collectText();
		expect(text).toContain("Tidy headings");
		expect(text).toContain("Prefix with =>.");
	});

	it("omits the description line when the entry has none", () => {
		const modal = new RunScriptModal(new App() as never, [], vi.fn());
		const el = new MockHTMLElement("div");
		modal.renderSuggestion(match(entry({ name: "Solo", description: "" })), el as never);
		expect(el._collectText().trim()).toBe("Solo");
	});
});

describe("RunScriptModal — selection", () => {
	it("running a script calls onChoose with the chosen entry", () => {
		const onChoose = vi.fn();
		const e = entry({ id: "perplexity-app", name: "perplexity-app" });
		const modal = new RunScriptModal(new App() as never, [e], onChoose);
		modal.onChooseItem(e);
		expect(onChoose).toHaveBeenCalledWith(e);
	});
});

describe("RunScriptModal — copy", () => {
	it("uses a sentence-case search placeholder", () => {
		const modal = new RunScriptModal(new App() as never, [], vi.fn());
		// placeholder is captured by the mock FuzzySuggestModal (not on the real type).
		expect((modal as unknown as { placeholder: string }).placeholder).toBe("Search scripts to run…");
	});

	it("sets a helpful empty-state message", () => {
		const modal = new RunScriptModal(new App() as never, [], vi.fn());
		expect(modal.emptyStateText.toLowerCase()).toContain("no active scripts");
	});
});
