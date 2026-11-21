import type { PluginManifest, SettingDefinitionAction } from "obsidian";

// ---------------------------------------------------------------------------
// pluginIdentity — who the plugin is, as shown in the settings tab
//
// The declarative settings tab has no heading above the first group, so the
// plugin's identity lives in a "Documentation" action row (spec 010, ADR-3).
//
// COMMUNITY COMPLIANCE
// - Manifest strings are only ever concatenated into a plain-string desc —
//   never parsed as HTML or turned into a fragment.
// - All literal UI text follows SENTENCE CASE.
// ---------------------------------------------------------------------------

/** Repository URL the Documentation link opens. */
export const REPO_URL = "https://github.com/MMoMM-org/obsidian-markdown-mason";

const DESC_SEPARATOR = " · ";

/**
 * Parse Obsidian's "Full Name <email>" convention.
 * Returns the part before "<", trimmed; empty when there is no author.
 */
export function parseAuthorName(author: string | undefined): string {
	if (author === undefined) return "";
	const bracketIdx = author.indexOf("<");
	const name = bracketIdx === -1 ? author : author.slice(0, bracketIdx);
	return name.trim();
}

function openInBrowser(url: string): void {
	window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Build the "Documentation" action row: desc "<name> v<version> · <author>",
 * clicking it opens the repository.
 *
 * @param openUrl test seam; defaults to opening the URL in the browser.
 */
export function buildDocumentationRow(
	manifest: PluginManifest,
	openUrl: (url: string) => void = openInBrowser,
): SettingDefinitionAction {
	const identity = [`${manifest.name} v${manifest.version}`, parseAuthorName(manifest.author)];
	return {
		name: "Documentation",
		desc: identity.filter((part) => part !== "").join(DESC_SEPARATOR),
		aliases: ["help", "version"],
		action: () => openUrl(REPO_URL),
	};
}
