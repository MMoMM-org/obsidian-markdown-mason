import type { PluginManifest } from "obsidian";

// ---------------------------------------------------------------------------
// HeaderSection — manifest-driven plugin identity header for the settings tab
//
// COMMUNITY COMPLIANCE
// - DOM is built exclusively via createEl / createDiv / createSpan / setText —
//   never innerHTML / outerHTML / insertAdjacentHTML.
// - All literal UI text follows SENTENCE CASE.
// - No inline event handlers.
//
// FUNDING LINKS
// - fundingUrl is intentionally NOT rendered here. Obsidian's Community-Plugins
//   listing surfaces manifest.fundingUrl automatically; duplicating it in the
//   settings UI is redundant and may look spammy.
// ---------------------------------------------------------------------------

/** Repo URL for the Documentation anchor. */
const REPO_URL = "https://github.com/MMoMM-org/obsidian-markdown-mason";

/**
 * Punchy tagline shown below the identity line.
 * Kept independent from manifest.description, which is the long listing blurb.
 */
const TAGLINE = "Solid formatting, block by block.";

/** Constructor options for HeaderSection. */
export interface HeaderSectionOptions {
	manifest: PluginManifest & { authorUrl?: string };
}

/**
 * Renders a manifest-driven identity header into a settings containerEl.
 *
 * Identity line: "<name> v<version> · <author> · Documentation"
 * Tagline:       a <p> with a punchy single sentence.
 */
export class HeaderSection {
	private readonly _manifest: PluginManifest & { authorUrl?: string };

	constructor(opts: HeaderSectionOptions) {
		this._manifest = opts.manifest;
	}

	/** Render the header into containerEl. Safe to call on every display(). */
	render(containerEl: HTMLElement): void {
		const header = containerEl.createDiv({ cls: "mason-settings-header" });
		this._renderIdentityLine(header);
		this._renderTagline(header);
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	/** Render: "<name> v<version> · <author> · Documentation" */
	private _renderIdentityLine(parent: HTMLElement): void {
		const line = parent.createDiv({ cls: "mason-settings-identity" });

		// Plugin name
		line.createEl("strong").setText(this._manifest.name);

		// Version
		line.createEl("span").setText(` v${this._manifest.version}`);

		// Separator
		line.createEl("span").setText(" · ");

		// Author — anchor when authorUrl present, plain span otherwise
		const authorName = this._parseAuthorName(this._manifest.author);
		if (this._manifest.authorUrl) {
			const authorEl = line.createEl("a");
			authorEl.setText(authorName);
			authorEl.setAttribute("href", this._manifest.authorUrl);
		} else {
			line.createEl("span").setText(authorName);
		}

		// Separator
		line.createEl("span").setText(" · ");

		// Documentation anchor
		const docsEl = line.createEl("a");
		docsEl.setText("Documentation");
		docsEl.setAttribute("href", REPO_URL);
	}

	/** Render the tagline <p>. */
	private _renderTagline(parent: HTMLElement): void {
		const p = parent.createEl("p", { cls: "mason-settings-tagline" });
		p.setText(TAGLINE);
	}

	/**
	 * Parse Obsidian's "Full Name <email>" convention.
	 * Returns the part before "<", trimmed. Falls back to the whole string.
	 */
	private _parseAuthorName(author: string): string {
		const bracketIdx = author.indexOf("<");
		if (bracketIdx !== -1) {
			return author.slice(0, bracketIdx).trim();
		}
		return author.trim();
	}
}
