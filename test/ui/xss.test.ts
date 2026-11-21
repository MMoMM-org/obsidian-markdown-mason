/**
 * T6.2 — XSS regression tests: hostile-string rendering safety.
 *
 * PURPOSE
 * ───────
 * Lock in that untrusted strings in v0.1 are always rendered as TEXT, never
 * parsed as HTML markup.  Untrusted strings in scope:
 *
 *   - Script record fields: `source` (and any id) — shown in a row of the
 *     Scripts settings page, filled by configureScriptRow.
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
 *   If configureScriptRow were changed to:
 *     setting.descEl.innerHTML += `<div>${item.record.source}</div>`;
 *   then the mock's _collectText() would not find the payload as text
 *   (innerHTML is not modelled in the mock), breaking assertions S1 and S2.
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
import type { Setting as ObsidianSetting } from "obsidian";
import { buildOfflineScriptItems } from "../../src/ui/scriptsCache";
import type { LifecycleOps } from "../../src/ui/scriptsPage";
import {
	MockHTMLElement,
	Setting,
} from "../__mocks__/obsidian";

// ---------------------------------------------------------------------------
// Imports resolved after module alias is set up by vitest
// ---------------------------------------------------------------------------

const { configureScriptRow } = await import("../../src/ui/scriptsPage");
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
// Helpers — Scripts page row
// ---------------------------------------------------------------------------

/** No test here triggers an action; the row only needs something to close over. */
const UNUSED_OPS: LifecycleOps = {
	enable: vi.fn(),
	disable: vi.fn(),
	remove: vi.fn(),
	retry: vi.fn(),
	update: vi.fn(),
	reReview: vi.fn(),
	viewSource: vi.fn(),
	importFromVault: vi.fn(),
	browseOfficial: vi.fn(),
};

/**
 * Render the Scripts page row of an imported script whose `source` (and
 * optionally id) is hostile, and return the row element so tests can assert
 * that the strings appear as TEXT via _collectText().
 *
 * The item is resolved the way the plugin resolves a stored record, so the
 * hostile id becomes the row name and the hostile source its description
 * ("Source: <payload>"). Obsidian sets name and description from the row's
 * definition before configureScriptRow runs; the mock Setting does the same.
 */
function renderScriptRow(sourcePayload: string, idPayload: string = "safe-id"): MockHTMLElement {
	const [item] = buildOfflineScriptItems({
		[idPayload]: {
			provenance: "imported",
			enabled: false,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: sourcePayload,
			command: false,
		},
	});
	const setting = new Setting(null).setName(item!.displayName).setDesc(item!.description);
	configureScriptRow(setting as unknown as ObsidianSetting, item!, UNUSED_OPS);
	return setting.settingEl;
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
		version: 1,
		checksum: "sha256:test",
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
// Suite XSS-2 — Scripts page: hostile script source/id in a row
//
// A script row (configureScriptRow, scriptsPage.ts) shows its text through
// the definition's name/desc and createSpan/createDiv({ text }) — text sinks,
// never innerHTML. The hostile `source` appears in the row description
// ("Source: <payload>") and the hostile `id` appears as the row name.
//
// Assertion S1: the verbatim payload appears in the row's collected TEXT.
// Assertion S2: it is stored as text content, never parsed into markup child
//               elements (an innerHTML sink would not surface via _collectText).
//
// FAILURE MODE if unsafe: an innerHTML sink would create <img>/<script> child
// elements; the angle-bracketed payload would NOT appear verbatim as text,
// breaking S1.
// ---------------------------------------------------------------------------

describe("XSS — Scripts page row: hostile source field rendered as text", () => {
	for (const [name, payload] of Object.entries(PAYLOADS).filter(([k]) => k !== "path")) {
		it(`source payload "${name}" is rendered as verbatim row text, not parsed as markup`, () => {
			const row = renderScriptRow(payload);

			// S1: the raw hostile payload appears verbatim in the row's text.
			expect(row._collectText()).toContain(payload);
		});
	}

	it("hostile script id is rendered as verbatim row text, not parsed as markup", () => {
		// The id is the row name and labels the row's controls.
		const idPayload = PAYLOADS.script;
		const row = renderScriptRow("safe-source", idPayload);

		// S1: the raw hostile id payload appears verbatim in the row text.
		expect(row._collectText()).toContain(idPayload);
	});

	it("row text is the LITERAL payload — no markup was injected as a child element", () => {
		// _collectText() recursively collects all text set via setText / createEl({text}).
		// If an unsafe innerHTML sink were used, the payload would be parsed into DOM
		// nodes (not modelled by the mock) and would NOT surface as collected text.
		const row = renderScriptRow(PAYLOADS.imgOnerror);

		// S2: the exact payload appears as text — it was not stripped or parsed.
		expect(row._collectText()).toContain(`Source: ${PAYLOADS.imgOnerror}`);
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
			version: 1,
			checksum: "sha256:test",
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

	// -------------------------------------------------------------------------
	// W2 — Hostile checksum rendered as text (not injected as markup)
	//
	// The modal renders the checksum field via:
	//   meta.createEl("p", { text: `Checksum: ${this._info.checksum}` })
	//
	// Assertion C1: _collectText() on contentEl contains the verbatim payload.
	// Assertion C2: innerHTML is never set on contentEl (runtime sink guard).
	// -------------------------------------------------------------------------

	it("W2: hostile checksum payload appears as verbatim text in modal (C1)", () => {
		// Build the modal inline with a hostile checksum; openDisclosureModal
		// hardcodes a benign checksum so we construct directly here.
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/safe.cjs",
			fileSizeBytes: 512,
			version: 1,
			checksum: PAYLOADS.imgOnerror,
		});
		modal.present();

		const el = modal.contentEl as unknown as MockHTMLElement;
		const text = el._collectText();

		// C1: the full "Checksum: <payload>" label must appear verbatim in the DOM text.
		expect(text).toContain(`Checksum: ${PAYLOADS.imgOnerror}`);
	});

	it("W2: hostile checksum payload does not trigger an innerHTML write on contentEl (C2)", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/safe.cjs",
			fileSizeBytes: 512,
			version: 1,
			checksum: PAYLOADS.imgOnerror,
		});

		// Attach spy before onOpen fires.
		const el = modal.contentEl as unknown as Record<string, unknown>;
		const innerHTMLSpy = vi.fn();
		Object.defineProperty(el, "innerHTML", {
			set: innerHTMLSpy,
			get: () => "",
			configurable: true,
		});

		modal.present();

		// C2: runtime guard — no innerHTML write triggered by hostile checksum.
		expect(innerHTMLSpy).not.toHaveBeenCalled();
	});
});
