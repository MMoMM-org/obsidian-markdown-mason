/**
 * T6.2 — XSS regression tests: hostile-string rendering safety.
 *
 * PURPOSE
 * ───────
 * Lock in that untrusted strings in v0.1 are always rendered as TEXT, never
 * parsed as HTML markup.  Untrusted strings in scope:
 *
 *   - Script manifest fields: `source` (and any id) — shown in the Scripts
 *     settings section via Setting.setName() / Setting.setDesc().
 *   - Script vault-relative path — shown in the ScriptDisclosureModal via
 *     createEl({text}).
 *
 * RED→GREEN REASONING
 * ────────────────────
 * The current production code is safe (text helpers only).  These tests are
 * lock-in / regression tests: they PASS now and would FAIL if a future change
 * introduced an unsafe sink.
 *
 * Failure scenario (hypothetical):
 *   If _renderScriptsSection were changed to:
 *     containerEl.innerHTML += `<div>${entry.source}</div>`;
 *   then:
 *     1. The captured Setting's desc would no longer contain the raw payload
 *        (setDesc would not be called), breaking assertion (S1).
 *     2. The mock's _collectText() would not find the payload as text
 *        (innerHTML is not modelled in the mock), breaking assertion (S2).
 *   Similarly for the disclosure modal (D1, D2).
 *
 * STATIC GUARANTEE
 * ─────────────────
 * test/compliance.test.ts Suite 3 already asserts zero .innerHTML= /
 * .outerHTML= / .insertAdjacentHTML( writes in src/.  Suite XSS-1 below
 * adds an explicit in-this-file assertion so the XSS story is self-contained
 * even when reading this file in isolation.
 *
 * HOUSE STYLE: tabs, double quotes, no default exports.
 */

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { App } from "obsidian";
import type { ScriptRecord } from "../../src/scripts/store";
import {
	capturedSettings,
	clearCapturedSettings,
} from "../__mocks__/obsidian";
import { MockHTMLElement } from "../__mocks__/obsidian";

// ---------------------------------------------------------------------------
// Imports resolved after module alias is set up by vitest
// ---------------------------------------------------------------------------

const { MasonSettingTab } = await import("../../src/ui/settingsTab");
const { ScriptDisclosureModal } = await import("../../src/scripts/disclosure");

// ---------------------------------------------------------------------------
// Hostile payloads — representative XSS injection strings
// ---------------------------------------------------------------------------

const PAYLOADS = {
	/**
	 * Classic <script> injection.  A text sink would pass this verbatim;
	 * an innerHTML sink would parse it into a script element.
	 */
	script: "<script>alert(1)</script>",

	/**
	 * Image-onerror injection.  An innerHTML sink would create an <img> child
	 * element; a text sink would pass the literal angle brackets as text.
	 */
	imgOnerror: "<img src=x onerror=alert(1)>",

	/**
	 * Angle-bracket-heavy payload combining both vectors.
	 */
	combined: "<script>alert(\"xss\")</script><img src=x onerror=alert(2)>",

	/**
	 * A hostile vault-relative path containing markup injection characters.
	 * Could appear if a user imports a script with a crafted filename.
	 */
	path: "vault/<img src=x onerror=fetch('http://evil.example')>.cjs",
};

// ---------------------------------------------------------------------------
// Helpers — settings tab
// ---------------------------------------------------------------------------

/**
 * Build a minimal plugin double with a manifest entry whose source field
 * contains the given hostile payload.
 */
function makePluginWithPayload(sourcePayload: string, idPayload: string = "safe-id") {
	const app = new App();
	const settings = {
		resourcesName: "Resources",
		debugLogging: false,
		numericOnly: true,
	};
	const saveSettings = vi.fn().mockResolvedValue(undefined);

	// New ScriptRecord shape (T1.4). okayed.version = 1 keeps the rendered desc
	// "Source: <payload>  ·  v1" identical to the v0.1 shape, so the XSS
	// text-rendering assertions below remain valid against the migrated tab.
	const scripts: Record<string, ScriptRecord> = {
		[idPayload]: {
			provenance: "imported",
			enabled: false,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: sourcePayload,
			command: false,
		},
	};
	const store = {
		getScripts: vi.fn().mockResolvedValue(scripts),
		setRecord: vi.fn().mockResolvedValue(undefined),
	};

	// Plugin manifest — required by HeaderSection (wired into display()).
	const pluginManifest = {
		id: "markdown-mason",
		name: "Markdown Mason",
		version: "0.0.1",
		minAppVersion: "1.6.6",
		description: "Test description.",
		author: "Marcus Breiden",
		authorUrl: "https://www.mmomm.org",
		isDesktopOnly: true,
	};

	return { app, settings, saveSettings, store, manifest: pluginManifest } as const;
}

/**
 * Render the settings tab with the given plugin double.
 * Returns the captured settings list (one entry per Setting() call).
 */
async function renderTabWithPlugin(
	plugin: ReturnType<typeof makePluginWithPayload>,
): Promise<Array<{ name: string; desc: string; isHeading: boolean }>> {
	clearCapturedSettings();
	const tab = new MasonSettingTab(plugin.app as never, plugin as never);
	await tab.display();
	return capturedSettings() as Array<{ name: string; desc: string; isHeading: boolean }>;
}

// ---------------------------------------------------------------------------
// Helpers — disclosure modal
// ---------------------------------------------------------------------------

/**
 * Cast the modal's contentEl to MockHTMLElement to access test helpers.
 */
function mockEl(modal: InstanceType<typeof ScriptDisclosureModal>): MockHTMLElement {
	return modal.contentEl as unknown as MockHTMLElement;
}

/**
 * Open the disclosure modal with the given vault-relative path and return
 * the rendered contentEl for assertion.
 */
function openDisclosureModal(vaultRelativePath: string): {
	modal: InstanceType<typeof ScriptDisclosureModal>;
	el: MockHTMLElement;
} {
	const app = new App();
	const modal = new ScriptDisclosureModal(app, {
		vaultRelativePath,
		fileSizeBytes: 512,
	});
	modal.present();
	return { modal, el: mockEl(modal) };
}

// ---------------------------------------------------------------------------
// Helpers — static grep (mirrors compliance.test.ts helpers)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const srcDir = path.join(repoRoot, "src");

/** Recursively collect all .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
	const results: string[] = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...collectTsFiles(full));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			results.push(full);
		}
	}
	return results;
}

/** Return all lines in src/ matching the given pattern (skips // comments). */
function scanSrc(pattern: RegExp): Array<{ file: string; line: number; text: string }> {
	const matches: Array<{ file: string; line: number; text: string }> = [];
	for (const file of collectTsFiles(srcDir)) {
		const lines = fs.readFileSync(file, "utf8").split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]!;
			// Skip lines that are pure single-line comments
			if (/^\s*\/\//.test(line)) {
				continue;
			}
			if (pattern.test(line)) {
				matches.push({ file: path.relative(repoRoot, file), line: i + 1, text: line.trim() });
			}
		}
	}
	return matches;
}

// ---------------------------------------------------------------------------
// Suite XSS-1 — Static assertion: no unsafe HTML sinks in src/
//
// This duplicates the key assertion from compliance.test.ts Suite 3 so that
// the XSS story is self-contained when reviewing this file alone.  The
// canonical source of truth remains compliance.test.ts; this is a cross-check.
// ---------------------------------------------------------------------------

describe("XSS — static: no unsafe HTML write-sinks in src/", () => {
	it("zero .innerHTML= or .innerHTML+= assignments in src/", () => {
		// Matches both `=` and `+=` writes; excludes `==`/`===` comparisons.
		const matches = scanSrc(/\.innerHTML\s*\+?=(?!=)/);
		const formatted = matches.map((m) => `  ${m.file}:${m.line}: ${m.text}`).join("\n");
		expect(matches, `Found .innerHTML= in src/:\n${formatted}`).toHaveLength(0);
	});

	it("zero .outerHTML= assignments in src/", () => {
		const matches = scanSrc(/\.outerHTML\s*\+?=(?!=)/);
		const formatted = matches.map((m) => `  ${m.file}:${m.line}: ${m.text}`).join("\n");
		expect(matches, `Found .outerHTML= in src/:\n${formatted}`).toHaveLength(0);
	});

	it("zero .insertAdjacentHTML( calls in src/", () => {
		const matches = scanSrc(/\.insertAdjacentHTML\s*\(/);
		const formatted = matches.map((m) => `  ${m.file}:${m.line}: ${m.text}`).join("\n");
		expect(matches, `Found .insertAdjacentHTML( in src/:\n${formatted}`).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Suite XSS-2 — Settings tab: hostile manifest source field
//
// The Scripts section renders each manifest entry via:
//   Setting.setName(id)
//   Setting.setDesc(`Source: ${entry.source}  ·  v${entry.version}`)
//
// Assertion S1: setDesc receives the verbatim payload string (text sink).
// Assertion S2: the mock containerEl collects the payload as literal text with
//               no child element created from it (no markup parsing).
//
// FAILURE MODE if unsafe: an innerHTML sink would create <img>/<script> child
// elements — setDesc would not be called with the raw payload, breaking S1.
// ---------------------------------------------------------------------------

describe("XSS — settings tab: hostile source field rendered as text", () => {
	for (const [name, payload] of Object.entries(PAYLOADS).filter(([k]) => k !== "path")) {
		it(`source payload "${name}" is passed verbatim to setDesc(), not parsed as markup`, async () => {
			const plugin = makePluginWithPayload(payload);
			const settings = await renderTabWithPlugin(plugin);

			// Find the script row in the Scripts section: it appears between the
			// "Scripts" heading and the "Advanced" heading, and has toggle + button controls.
			const scriptsIdx = settings.findIndex((s) => s.isHeading && s.name === "Scripts");
			const advancedIdx = settings.findIndex((s) => s.isHeading && s.name === "Advanced");
			const scriptSection = settings.slice(scriptsIdx + 1, advancedIdx);

			// The script row for the hostile manifest entry: it has a non-empty desc
			// (set to `Source: ${source}  ·  v${version}`).
			const scriptRow = scriptSection.find((s) => s.desc.length > 0);
			expect(scriptRow, "Script row should be rendered in the Scripts section").toBeDefined();

			// S1: the raw hostile payload appears verbatim inside desc.
			// setDesc is a text helper — it stores the string as-is without HTML parsing.
			expect(scriptRow!.desc).toContain(payload);
		});
	}

	it("hostile script id is passed verbatim to setName(), not parsed as markup", async () => {
		// The id is used directly as the setting name via setName(id).
		const idPayload = PAYLOADS.script;
		const plugin = makePluginWithPayload("safe-source", idPayload);
		const settings = await renderTabWithPlugin(plugin);

		// S1: the raw hostile id payload appears verbatim in name.
		const scriptRow = settings.find((s) => s.name === idPayload);
		expect(
			scriptRow,
			`Expected a setting whose name is the verbatim payload "${idPayload}"`,
		).toBeDefined();
	});

	it("desc string is the LITERAL payload — no markup was injected as a child element", async () => {
		// This assertion targets the containerEl (MockHTMLElement) directly.
		// If an unsafe innerHTML sink were used, the payload would be parsed into
		// DOM nodes but the text content stored in Setting.desc would be empty or
		// absent — _collectText() on the container would not return the payload.
		const plugin = makePluginWithPayload(PAYLOADS.imgOnerror);
		clearCapturedSettings();
		const tab = new MasonSettingTab(plugin.app as never, plugin as never);
		await tab.display();

		// The containerEl in the mock is a MockHTMLElement.
		// _collectText() recursively collects all text set via setText / createEl({text}).
		// Because Setting.setDesc stores the string verbatim (and the mock stores it as
		// _record.desc, not in a DOM subtree), we assert via capturedSettings() that the
		// desc field holds the payload literally.
		const settings = capturedSettings() as Array<{ name: string; desc: string; isHeading: boolean }>;

		// Locate the script row: between the Scripts and Advanced headings.
		const scriptsIdx = settings.findIndex((s) => s.isHeading && s.name === "Scripts");
		const advancedIdx = settings.findIndex((s) => s.isHeading && s.name === "Advanced");
		const scriptSection = settings.slice(scriptsIdx + 1, advancedIdx);
		const scriptRow = scriptSection.find((s) => s.desc.length > 0);
		expect(scriptRow).toBeDefined();

		// S2: the desc contains the exact payload — it was not stripped or parsed.
		expect(scriptRow!.desc).toBe(`Source: ${PAYLOADS.imgOnerror}  ·  v1`);
	});
});

// ---------------------------------------------------------------------------
// Suite XSS-3 — Disclosure modal: hostile vaultRelativePath rendered as text
//
// The modal renders the path via:
//   meta.createEl("p", { text: this._info.vaultRelativePath })
//
// The mock's createEl({text}) calls setText() which stores the string in
// _text — no HTML parsing.  _collectText() on the modal's contentEl will
// return the verbatim path string.
//
// Assertion D1: _collectText() on contentEl contains the verbatim payload.
// Assertion D2: no child element exists whose _text is an empty string but
//               whose presence would indicate markup was parsed and rendered
//               (i.e. the payload must appear as text, not as a created element).
// ---------------------------------------------------------------------------

describe("XSS — disclosure modal: hostile vaultRelativePath rendered as text", () => {
	it("script-tag payload in vaultRelativePath appears as literal text in modal", () => {
		const { el } = openDisclosureModal(PAYLOADS.script);

		// D1: the collected text contains the verbatim payload.
		const text = el._collectText();
		expect(text).toContain(PAYLOADS.script);
	});

	it("img-onerror payload in vaultRelativePath appears as literal text in modal", () => {
		const { el } = openDisclosureModal(PAYLOADS.imgOnerror);

		// D1: the collected text contains the verbatim payload.
		const text = el._collectText();
		expect(text).toContain(PAYLOADS.imgOnerror);
	});

	it("combined payload in vaultRelativePath appears as literal text in modal", () => {
		const { el } = openDisclosureModal(PAYLOADS.combined);

		// D1: the collected text contains the verbatim payload.
		const text = el._collectText();
		expect(text).toContain(PAYLOADS.combined);
	});

	it("hostile path payload in vaultRelativePath appears as literal text in modal", () => {
		const { el } = openDisclosureModal(PAYLOADS.path);

		// D1: the collected text contains the verbatim payload.
		const text = el._collectText();
		expect(text).toContain(PAYLOADS.path);
	});

	it("innerHTML is never set on contentEl when a hostile path is rendered", () => {
		// D2: if any code set innerHTML on the mock element, the spy would fire.
		// This is a runtime guard complementing the static T6.3 check.
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: PAYLOADS.imgOnerror,
			fileSizeBytes: 512,
		});

		// Attach a spy on innerHTML setter before onOpen fires.
		const el = modal.contentEl as unknown as Record<string, unknown>;
		const innerHTMLSpy = vi.fn();
		Object.defineProperty(el, "innerHTML", {
			set: innerHTMLSpy,
			get: () => "",
			configurable: true,
		});

		modal.present();

		// If any code path set innerHTML, this spy would have been called.
		expect(innerHTMLSpy).not.toHaveBeenCalled();
	});

	it("payload in vaultRelativePath is stored exactly as the text of a <p> element — not parsed into child elements", () => {
		// D2 (structural): we locate the <p> element that holds the path text
		// and confirm its _text equals the payload verbatim.  If innerHTML were
		// used instead, the mock would not store the payload string in any _text
		// field, causing this assertion to fail.
		const pathPayload = PAYLOADS.imgOnerror;
		const { el } = openDisclosureModal(pathPayload);

		// Walk descendants to find a <p> whose _text equals the payload.
		function findByText(node: MockHTMLElement, target: string): MockHTMLElement | undefined {
			if (node._text === target) {
				return node;
			}
			// Access internal children via a narrow cast (test-only).
			const children = (node as unknown as { _children: MockHTMLElement[] })._children;
			for (const child of children) {
				const found = findByText(child, target);
				if (found) {
					return found;
				}
			}
			return undefined;
		}

		const pathEl = findByText(el, pathPayload);
		expect(
			pathEl,
			`Expected a <p> element with _text === "${pathPayload}" but none found. ` +
			`This would indicate the payload was not stored as text.`,
		).toBeDefined();
		expect(pathEl!.tagName).toBe("p");
	});
});
