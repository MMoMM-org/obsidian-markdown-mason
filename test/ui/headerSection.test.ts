/**
 * T7.1 — HeaderSection unit tests (RED → GREEN).
 *
 * Exercises HeaderSection.render() via the repo's MockHTMLElement DOM stub.
 * All assertions target OBSERVABLE BEHAVIOUR: DOM text content, element
 * presence, href attributes — never implementation internals.
 *
 * RED phase: these tests were written before HeaderSection.ts existed and
 * failed with "Cannot find module '../../src/ui/HeaderSection'".
 *
 * HOUSE STYLE: tabs, double quotes, no default exports.
 */

import { describe, it, expect } from "vitest";
import type { PluginManifest } from "obsidian";
import { MockHTMLElement } from "../__mocks__/obsidian";

// ---------------------------------------------------------------------------
// Dynamic import — resolves after vitest alias maps obsidian → mock
// ---------------------------------------------------------------------------

const { HeaderSection } = await import("../../src/ui/HeaderSection");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal PluginManifest-shaped object for injection.
 * authorUrl is present on PluginManifest but typed optional.
 */
function makeManifest(overrides?: Partial<PluginManifest & { authorUrl?: string }>): PluginManifest & { authorUrl?: string } {
	return {
		id: "markdown-mason",
		name: overrides?.name ?? "Markdown Mason",
		version: overrides?.version ?? "1.2.3",
		minAppVersion: "1.6.6",
		description: "Test description.",
		author: overrides?.author ?? "Marcus Breiden",
		authorUrl: overrides?.authorUrl ?? "https://www.mmomm.org",
		isDesktopOnly: true,
		...overrides,
	};
}

/**
 * Render HeaderSection into a fresh MockHTMLElement and return it.
 */
function renderHeader(manifest: PluginManifest & { authorUrl?: string }): MockHTMLElement {
	const container = new MockHTMLElement("div");
	const section = new HeaderSection({ manifest });
	section.render(container as unknown as HTMLElement);
	return container;
}

/**
 * Walk a MockHTMLElement tree depth-first and collect all anchor-like
 * elements (tagName === "a").
 */
function findAnchors(el: MockHTMLElement): MockHTMLElement[] {
	const results: MockHTMLElement[] = [];
	const children = (el as unknown as { _children: MockHTMLElement[] })._children;
	for (const child of children) {
		if (child.tagName === "a") {
			results.push(child);
		}
		results.push(...findAnchors(child));
	}
	return results;
}

/**
 * Walk tree and collect all elements matching a predicate (depth-first).
 */
function findAll(el: MockHTMLElement, predicate: (node: MockHTMLElement) => boolean): MockHTMLElement[] {
	const results: MockHTMLElement[] = [];
	if (predicate(el)) {
		results.push(el);
	}
	const children = (el as unknown as { _children: MockHTMLElement[] })._children;
	for (const child of children) {
		results.push(...findAll(child, predicate));
	}
	return results;
}

// ---------------------------------------------------------------------------
// Suite H1 — plugin name and version
// ---------------------------------------------------------------------------

describe("HeaderSection — plugin name and version", () => {
	it("renders the plugin name as text content somewhere in the container", () => {
		const container = renderHeader(makeManifest());
		const text = container._collectText();
		expect(text).toContain("Markdown Mason");
	});

	it("renders a v{version} string somewhere in the container", () => {
		const container = renderHeader(makeManifest({ version: "1.2.3" }));
		const text = container._collectText();
		expect(text).toContain("v1.2.3");
	});

	it("uses the manifest version, not a hardcoded string", () => {
		const container = renderHeader(makeManifest({ version: "0.9.9" }));
		const text = container._collectText();
		expect(text).toContain("v0.9.9");
	});
});

// ---------------------------------------------------------------------------
// Suite H2 — author rendering
// ---------------------------------------------------------------------------

describe("HeaderSection — author rendering", () => {
	it("renders author as an anchor with href === authorUrl when authorUrl is present", () => {
		const manifest = makeManifest({ author: "Marcus Breiden", authorUrl: "https://www.mmomm.org" });
		const container = renderHeader(manifest);
		const anchors = findAnchors(container);
		const authorAnchor = anchors.find((a) => {
			const attrs = (a as unknown as { _attrs: Map<string, string> })._attrs;
			return attrs.get("href") === "https://www.mmomm.org";
		});
		expect(authorAnchor, "Expected an <a> with href === authorUrl").toBeDefined();
		expect(authorAnchor!._text).toBe("Marcus Breiden");
	});

	it("renders author as a plain span (not an anchor) when authorUrl is absent", () => {
		const manifest = makeManifest({ authorUrl: undefined });
		const container = renderHeader(manifest);
		const anchors = findAnchors(container);
		// No anchor should have text "Marcus Breiden"
		const authorAnchor = anchors.find((a) => a._text === "Marcus Breiden");
		expect(authorAnchor, "Author should NOT be an anchor when authorUrl is absent").toBeUndefined();
		// Author name must still appear as text
		expect(container._collectText()).toContain("Marcus Breiden");
	});

	it("parses 'Full Name <email>' convention and displays only the name part", () => {
		const manifest = makeManifest({ author: "Jane Doe <jane@example.com>", authorUrl: "https://example.com" });
		const container = renderHeader(manifest);
		const anchors = findAnchors(container);
		const authorAnchor = anchors.find((a) => {
			const attrs = (a as unknown as { _attrs: Map<string, string> })._attrs;
			return attrs.get("href") === "https://example.com";
		});
		expect(authorAnchor).toBeDefined();
		expect(authorAnchor!._text).toBe("Jane Doe");
		// The raw email string must NOT appear in the rendered output
		expect(container._collectText()).not.toContain("jane@example.com");
	});

	it("falls back to the full author string when no angle-bracket email is present", () => {
		const manifest = makeManifest({ author: "NoEmail Author", authorUrl: "https://example.com" });
		const container = renderHeader(manifest);
		const anchors = findAnchors(container);
		const authorAnchor = anchors.find((a) => {
			const attrs = (a as unknown as { _attrs: Map<string, string> })._attrs;
			return attrs.get("href") === "https://example.com";
		});
		expect(authorAnchor!._text).toBe("NoEmail Author");
	});
});

// ---------------------------------------------------------------------------
// Suite H3 — Documentation anchor
// ---------------------------------------------------------------------------

describe("HeaderSection — Documentation anchor", () => {
	it("renders a Documentation anchor pointing to the repo URL", () => {
		const container = renderHeader(makeManifest());
		const anchors = findAnchors(container);
		const docsAnchor = anchors.find((a) => {
			const attrs = (a as unknown as { _attrs: Map<string, string> })._attrs;
			return attrs.get("href") === "https://github.com/MMoMM-org/obsidian-markdown-mason";
		});
		expect(docsAnchor, "Expected a Documentation anchor with the repo href").toBeDefined();
		expect(docsAnchor!._text).toBe("Documentation");
	});
});

// ---------------------------------------------------------------------------
// Suite H4 — tagline
// ---------------------------------------------------------------------------

describe("HeaderSection — tagline", () => {
	it("renders a tagline <p> element", () => {
		const container = renderHeader(makeManifest());
		const paragraphs = findAll(container, (n) => n.tagName === "p");
		expect(paragraphs.length, "Expected at least one <p> element for the tagline").toBeGreaterThanOrEqual(1);
	});

	it("tagline text is non-empty", () => {
		const container = renderHeader(makeManifest());
		const paragraphs = findAll(container, (n) => n.tagName === "p");
		const taglineParagraph = paragraphs.find((p) => p._text.length > 0);
		expect(taglineParagraph, "Expected a <p> with non-empty text content").toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Suite H5 — XSS regression: hostile manifest name rendered as text
// ---------------------------------------------------------------------------

describe("HeaderSection — XSS regression: hostile manifest name rendered as text", () => {
	it("hostile name with <img onerror> is present as text, not parsed into a child <img> element", () => {
		const hostileName = "<img src=x onerror=alert(1)>";
		const manifest = makeManifest({ name: hostileName });
		const container = renderHeader(manifest);

		// The hostile string must appear as text content (the tree-text collector
		// joins all _text fields — a text sink stores the raw string here).
		expect(container._collectText()).toContain(hostileName);

		// No <img> descendant should exist.  If innerHTML were used the mock would
		// not create a real element, but we can still assert no child has tagName "img"
		// to lock in that the code never tried to inject markup.
		const imgs = findAll(container, (n) => n.tagName === "img");
		expect(imgs, "No <img> elements should be created from hostile text content").toHaveLength(0);
	});

	it("hostile name with <script> tag appears as verbatim text, not as a script element", () => {
		const hostileName = "<script>alert(1)</script>";
		const manifest = makeManifest({ name: hostileName });
		const container = renderHeader(manifest);

		expect(container._collectText()).toContain(hostileName);

		const scripts = findAll(container, (n) => n.tagName === "script");
		expect(scripts, "No <script> elements should be created from hostile text content").toHaveLength(0);
	});
});
