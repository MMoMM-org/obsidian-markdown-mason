/**
 * Spec 010 T1.3 — pluginIdentity unit tests.
 *
 * The Documentation action row is the plugin's identity surface in the
 * declarative settings tab (SDD ADR-3): version + author in the desc, and a
 * click that opens the repository.
 *
 * HOUSE STYLE: tabs, double quotes, no default exports.
 */

import { describe, it, expect, vi } from "vitest";
import type { PluginManifest } from "obsidian";
import { buildDocumentationRow, parseAuthorName, REPO_URL } from "../../src/ui/pluginIdentity";

function makeManifest(overrides?: Partial<PluginManifest>): PluginManifest {
	return {
		id: "markdown-mason",
		name: "Markdown Mason",
		version: "1.2.3",
		minAppVersion: "1.13.1",
		description: "Test description.",
		author: "Marcus Breiden",
		isDesktopOnly: true,
		...overrides,
	};
}

const ROW_ELEMENT = {} as HTMLElement;

describe("REPO_URL", () => {
	it("points at the plugin repository over https", () => {
		expect(REPO_URL).toBe("https://github.com/MMoMM-org/obsidian-markdown-mason");
	});
});

describe("parseAuthorName", () => {
	it("returns a plain name unchanged", () => {
		expect(parseAuthorName("Marcus Breiden")).toBe("Marcus Breiden");
	});

	it("strips a trailing <email>", () => {
		expect(parseAuthorName("Marcus Breiden <marcus@example.com>")).toBe("Marcus Breiden");
	});

	it("trims surrounding whitespace", () => {
		expect(parseAuthorName("  Marcus Breiden  ")).toBe("Marcus Breiden");
	});

	it("returns an empty string for a missing author", () => {
		expect(parseAuthorName(undefined)).toBe("");
		expect(parseAuthorName("")).toBe("");
	});

	it("returns an empty string when only an email is given", () => {
		expect(parseAuthorName("<marcus@example.com>")).toBe("");
	});
});

describe("buildDocumentationRow — definition", () => {
	it("is named \"Documentation\"", () => {
		expect(buildDocumentationRow(makeManifest()).name).toBe("Documentation");
	});

	it("describes the plugin as \"<name> v<version> · <author>\"", () => {
		expect(buildDocumentationRow(makeManifest()).desc).toBe("Markdown Mason v1.2.3 · Marcus Breiden");
	});

	it("strips the author email from the desc", () => {
		const row = buildDocumentationRow(makeManifest({ author: "Marcus Breiden <marcus@example.com>" }));
		expect(row.desc).toBe("Markdown Mason v1.2.3 · Marcus Breiden");
	});

	it("omits the author segment and its separator when the author is missing", () => {
		const withoutAuthor = makeManifest() as Partial<PluginManifest>;
		delete withoutAuthor.author;
		expect(buildDocumentationRow(withoutAuthor as PluginManifest).desc).toBe("Markdown Mason v1.2.3");
		expect(buildDocumentationRow(makeManifest({ author: "   " })).desc).toBe("Markdown Mason v1.2.3");
	});

	it("is findable by the aliases \"help\" and \"version\"", () => {
		const aliases = buildDocumentationRow(makeManifest()).aliases ?? [];
		expect(aliases).toContain("help");
		expect(aliases).toContain("version");
	});

	it("is an action row: an action callback and no control", () => {
		const row = buildDocumentationRow(makeManifest());
		expect(typeof row.action).toBe("function");
		expect(row.control).toBeUndefined();
	});

	it("uses sentence case for its literal UI text", () => {
		const row = buildDocumentationRow(makeManifest());
		expect(row.name).toMatch(/^[A-Z][a-z]+$/);
		for (const alias of row.aliases ?? []) {
			expect(alias).toBe(alias.toLowerCase());
		}
	});
});

describe("buildDocumentationRow — action", () => {
	it("opens REPO_URL exactly once per click", () => {
		const openUrl = vi.fn();
		buildDocumentationRow(makeManifest(), openUrl).action(ROW_ELEMENT, 0);
		expect(openUrl).toHaveBeenCalledTimes(1);
		expect(openUrl).toHaveBeenCalledWith(REPO_URL);
	});

	it("does not open anything while the row is only being built", () => {
		const openUrl = vi.fn();
		buildDocumentationRow(makeManifest(), openUrl);
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("never opens a manifest-supplied URL", () => {
		const openUrl = vi.fn();
		const manifest = makeManifest({ authorUrl: "https://evil.example", author: "https://evil.example" });
		buildDocumentationRow(manifest, openUrl).action(ROW_ELEMENT, 0);
		expect(openUrl).toHaveBeenCalledWith(REPO_URL);
	});
});

describe("buildDocumentationRow — hostile manifest strings", () => {
	it("keeps markup in the version and name as plain string text", () => {
		const row = buildDocumentationRow(makeManifest({
			name: "<b>Mason</b>",
			version: "<img src=x onerror=alert(1)>",
			author: "",
		}));
		expect(typeof row.desc).toBe("string");
		expect(row.desc).toBe("<b>Mason</b> v<img src=x onerror=alert(1)>");
	});

	it("keeps a hostile author as plain string text", () => {
		const row = buildDocumentationRow(makeManifest({ author: "\"><script>alert(1)</script>" }));
		expect(typeof row.desc).toBe("string");
		expect(row.desc).toContain("Markdown Mason v1.2.3 · ");
	});

	it("leaves the row name untouched by manifest content", () => {
		const row = buildDocumentationRow(makeManifest({ name: "<script>x</script>" }));
		expect(row.name).toBe("Documentation");
	});
});
