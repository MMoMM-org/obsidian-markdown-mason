// T5.3  ScriptDisclosureModal + makeAskCallback — unit tests
//
// Exercises the consent modal through the mock Modal base class added to
// test/__mocks__/obsidian.ts.  No real Obsidian runtime required.
//
// Behaviour under test:
//   MODAL
//   (a) present() resolves for each of the 3 decision buttons
//   (b) Escape keydown → "disable" (safe-default)
//   (c) onClose without a tracked signal → "disable" (safe-default)
//   (d) Disclosure text, vault-relative path, file size, version, checksum are rendered
//   (e) DOM is built via createEl/createDiv only — NO innerHTML/outerHTML
//
//   ADAPTER (makeAskCallback) — T3.4 finalized
//   (f) already consented (okayed matches {version,checksum}) → no modal, "enable-session"
//   (g) no record → modal shown; "enable-session" records consent
//   (h) no record → modal shown; "disable" does NOT record consent
//   (i) okayed.version matches but checksum differs (drift) → re-prompts (modal shown)
//   (j) okayed.version differs (stale) → re-prompts (modal shown)
//   (k) SEC-001: "enable-once" does NOT call setRecord (ephemeral)
//   (l) kill-switch: enabled===false → "disable" immediately, no modal
//   (m) no record at all → modal shown (unknown → prompt path)

import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { MockHTMLElement } from "../__mocks__/obsidian";
import { ScriptDisclosureModal, makeAskCallback } from "../../src/scripts/disclosure";
import type { AskDecision } from "../../src/scripts/runner";
import type { ScriptRecord } from "../../src/scripts/store";

/**
 * Cast the modal's contentEl to MockHTMLElement so tests can use test-only helpers
 * (_collectText, _findButtonByText, _findAllButtons, _dispatch).
 * At runtime under vitest the alias resolves obsidian → the mock, so this cast is safe.
 */
function mockEl(modal: ScriptDisclosureModal): MockHTMLElement {
	return modal.contentEl as unknown as MockHTMLElement;
}

// ---------------------------------------------------------------------------
// Helpers — fake ScriptStore (Pick<ScriptStore, "getScripts" | "setRecord">)
// ---------------------------------------------------------------------------

type FakeStore = {
	getScripts: ReturnType<typeof vi.fn>;
	setRecord: ReturnType<typeof vi.fn>;
};

/** Build a fake store that returns the given record map (or empty map). */
function makeStore(scripts: Record<string, ScriptRecord> = {}): FakeStore {
	return {
		getScripts: vi.fn().mockResolvedValue(scripts),
		setRecord: vi.fn().mockResolvedValue(undefined),
	};
}

/** Convenience: make a store with a single script record. */
function makeStoreWithRecord(scriptId: string, record: ScriptRecord): FakeStore {
	return makeStore({ [scriptId]: record });
}

const BASE_RECORD: ScriptRecord = {
	provenance: "imported",
	enabled: true,
	okayed: null,
	source: "",
	command: false,
};

// ---------------------------------------------------------------------------
// Helpers — click a button by its visible text
// ---------------------------------------------------------------------------

function clickButton(modal: ScriptDisclosureModal, label: string): void {
	const el = mockEl(modal);
	const btn = el._findButtonByText(label);
	if (!btn) {
		throw new Error(`No button with text matching "${label}" found in modal.`);
	}
	btn._click();
}

// ---------------------------------------------------------------------------
// Helpers — dispatch synthetic keydown
// ---------------------------------------------------------------------------

function pressEscape(modal: ScriptDisclosureModal): void {
	mockEl(modal)._dispatch({ key: "Escape" });
}

// ---------------------------------------------------------------------------
// (a) present() resolves for each button decision
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — button decisions", () => {
	it("resolves 'disable' when Disable button is clicked", async () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/my-script.cjs",
			fileSizeBytes: 1024,
			version: 1,
			checksum: "sha256:test",
		});

		const promise = modal.present();
		clickButton(modal, "Disable");
		const decision: AskDecision = await promise;

		expect(decision).toBe("disable");
	});

	it("resolves 'enable-once' when Enable once button is clicked", async () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/my-script.cjs",
			fileSizeBytes: 512,
			version: 1,
			checksum: "sha256:test",
		});

		const promise = modal.present();
		clickButton(modal, "Enable once");
		const decision = await promise;

		expect(decision).toBe("enable-once");
	});

	it("resolves 'enable-session' when Enable button is clicked", async () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/my-script.cjs",
			fileSizeBytes: 2048,
			version: 1,
			checksum: "sha256:test",
		});

		const promise = modal.present();
		clickButton(modal, "Enable");
		const decision = await promise;

		expect(decision).toBe("enable-session");
	});

	it("resolver fires exactly once even if close is called after button click", async () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/my-script.cjs",
			fileSizeBytes: 128,
			version: 1,
			checksum: "sha256:test",
		});

		const promise = modal.present();
		clickButton(modal, "Enable");
		modal.close(); // second resolution attempt — must not throw or double-fire

		const decision = await promise;
		expect(decision).toBe("enable-session");
	});
});

// ---------------------------------------------------------------------------
// (b) Escape → "disable"
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — Escape key safe-default", () => {
	it("resolves 'disable' when Escape is pressed", async () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/dangerous.cjs",
			fileSizeBytes: 4096,
			version: 1,
			checksum: "sha256:test",
		});

		const promise = modal.present();
		pressEscape(modal);
		const decision = await promise;

		expect(decision).toBe("disable");
	});
});

// ---------------------------------------------------------------------------
// (c) onClose default → "disable"
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — onClose safe-default", () => {
	it("resolves 'disable' when modal is closed without a button click", async () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/my-script.cjs",
			fileSizeBytes: 999,
			version: 1,
			checksum: "sha256:test",
		});

		const promise = modal.present();
		modal.close(); // close without clicking any button
		const decision = await promise;

		expect(decision).toBe("disable");
	});
});

// ---------------------------------------------------------------------------
// (d) Rendered content — path, size, and disclosure text
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — rendered content", () => {
	const DISCLOSURE_TEXT = "This script will run with full plugin privileges: vault access, Node filesystem and network, shell execution, and environment variables. Only enable scripts from sources you trust.";

	it("renders the vault-relative path in the modal", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "vault/scripts/hello.cjs",
			fileSizeBytes: 256,
			version: 1,
			checksum: "sha256:test",
		});

		modal.present();
		const text = mockEl(modal)._collectText();

		expect(text).toContain("vault/scripts/hello.cjs");
	});

	it("renders the file size in the modal", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/hello.cjs",
			fileSizeBytes: 3072,
			version: 1,
			checksum: "sha256:test",
		});

		modal.present();
		const text = mockEl(modal)._collectText();

		expect(text).toContain("3072");
	});

	it("renders the full privilege disclosure text", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/hello.cjs",
			fileSizeBytes: 512,
			version: 1,
			checksum: "sha256:test",
		});

		modal.present();
		const text = mockEl(modal)._collectText();

		expect(text).toContain(DISCLOSURE_TEXT);
	});

	it("renders the version number in the modal (PRD F2: identity disclosure)", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/hello.cjs",
			fileSizeBytes: 512,
			version: 7,
			checksum: "sha256:abc123",
		});

		modal.present();
		const text = mockEl(modal)._collectText();

		expect(text).toContain("7");
	});

	it("renders the checksum in the modal (PRD F2: identity disclosure)", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/hello.cjs",
			fileSizeBytes: 512,
			version: 1,
			checksum: "sha256:deadbeef",
		});

		modal.present();
		const text = mockEl(modal)._collectText();

		expect(text).toContain("sha256:deadbeef");
	});
});

// ---------------------------------------------------------------------------
// (e) DOM built via createEl/createDiv — no innerHTML/outerHTML
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — XSS-safe DOM construction", () => {
	it("does not use innerHTML anywhere in the rendered modal", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/xss-test.cjs",
			fileSizeBytes: 100,
			version: 1,
			checksum: "sha256:test",
		});

		// Spy on the content element to verify innerHTML is never set.
		// Cast via unknown → object so Object.defineProperty accepts the mock.
		const el = modal.contentEl as unknown as Record<string, unknown>;
		const innerHTMLSpy = vi.fn();
		Object.defineProperty(el, "innerHTML", {
			set: innerHTMLSpy,
			get: () => "",
			configurable: true,
		});
		const outerHTMLSpy = vi.fn();
		Object.defineProperty(el, "outerHTML", {
			set: outerHTMLSpy,
			get: () => "",
			configurable: true,
		});

		modal.present();

		expect(innerHTMLSpy).not.toHaveBeenCalled();
		expect(outerHTMLSpy).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// makeAskCallback — consent gate (T3.4 finalized)
//
// Tests all three decision paths against Pick<ScriptStore,"getScripts"|"setRecord">.
// ---------------------------------------------------------------------------

const CONSENT_VERSION = 3;
const CONSENT_CHECKSUM = "sha256:abc123";
const CONSENT_SCRIPT_ID = "test-script";
const CONSENT_INFO = {
	vaultRelativePath: "scripts/test-script.cjs",
	fileSizeBytes: 512,
	version: CONSENT_VERSION,
	checksum: CONSENT_CHECKSUM,
};

/** Intercept present() to capture the modal without changing behavior. */
function captureModal(handler: (modal: ScriptDisclosureModal) => void): () => void {
	const origPresent = ScriptDisclosureModal.prototype.present;
	ScriptDisclosureModal.prototype.present = function (this: ScriptDisclosureModal) {
		handler(this);
		return origPresent.call(this);
	};
	return () => { ScriptDisclosureModal.prototype.present = origPresent; };
}

// ---------------------------------------------------------------------------
// (f) already consented (okayed matches {version,checksum}) → no modal, "enable-session"
// ---------------------------------------------------------------------------

describe("makeAskCallback — trust ok → skip modal", () => {
	it("returns 'enable-session' without showing modal when okayed matches version+checksum", async () => {
		const store = makeStoreWithRecord(CONSENT_SCRIPT_ID, {
			...BASE_RECORD,
			okayed: { version: CONSENT_VERSION, checksum: CONSENT_CHECKSUM },
		});

		let modalOpened = false;
		const restore = captureModal(() => { modalOpened = true; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const decision = await callback();

			expect(decision).toBe("enable-session");
			expect(modalOpened).toBe(false);
			expect(store.setRecord).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// (g) no record → modal shown; "enable-session" records consent
// ---------------------------------------------------------------------------

describe("makeAskCallback — needs-consent + enable", () => {
	it("shows modal; enable-session calls setRecord with okayed+enabled:true", async () => {
		const store = makeStore();

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const callbackPromise = callback();

			// Drain microtask queue so getScripts resolves and present() fires
			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Enable");

			const decision = await callbackPromise;

			expect(decision).toBe("enable-session");
			expect(store.setRecord).toHaveBeenCalledOnce();
			expect(store.setRecord).toHaveBeenCalledWith(CONSENT_SCRIPT_ID, expect.objectContaining({
				okayed: { version: CONSENT_VERSION, checksum: CONSENT_CHECKSUM },
				enabled: true,
			}));
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// (h) no record → modal shown; "disable" does NOT record consent
// ---------------------------------------------------------------------------

describe("makeAskCallback — needs-consent + disable", () => {
	it("shows modal; disable returns 'disable' and does not call setRecord", async () => {
		const store = makeStore();

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const callbackPromise = callback();

			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Disable");

			const decision = await callbackPromise;

			expect(decision).toBe("disable");
			expect(store.setRecord).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// (i) drift: okayed.version matches but checksum differs → re-prompts (modal shown)
// ---------------------------------------------------------------------------

describe("makeAskCallback — drift-blocked re-prompts", () => {
	it("shows modal when same version but different checksum (drift); disable returns 'disable'", async () => {
		// okayed version matches but checksum is stale → drift → re-prompt
		const store = makeStoreWithRecord(CONSENT_SCRIPT_ID, {
			...BASE_RECORD,
			okayed: { version: CONSENT_VERSION, checksum: "sha256:OLD" },
		});

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const callbackPromise = callback();

			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Disable");

			const decision = await callbackPromise;
			expect(decision).toBe("disable");
			expect(store.setRecord).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});

	it("drift + enable-session calls setRecord with new okayed and returns 'enable-session'", async () => {
		const store = makeStoreWithRecord(CONSENT_SCRIPT_ID, {
			...BASE_RECORD,
			okayed: { version: CONSENT_VERSION, checksum: "sha256:OLD" },
		});

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const callbackPromise = callback();

			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Enable");

			const decision = await callbackPromise;
			expect(decision).toBe("enable-session");
			expect(store.setRecord).toHaveBeenCalledOnce();
			expect(store.setRecord).toHaveBeenCalledWith(CONSENT_SCRIPT_ID, expect.objectContaining({
				okayed: { version: CONSENT_VERSION, checksum: CONSENT_CHECKSUM },
				enabled: true,
			}));
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// (j) changed fingerprint: version differs → re-prompts (modal shown)
// ---------------------------------------------------------------------------

describe("makeAskCallback — changed fingerprint → re-prompts", () => {
	it("re-prompts when okayed.version differs (version bump); enable-once does not call setRecord", async () => {
		// okayed version is lower than current → fingerprint changed → re-prompt
		const store = makeStoreWithRecord(CONSENT_SCRIPT_ID, {
			...BASE_RECORD,
			okayed: { version: CONSENT_VERSION - 1, checksum: CONSENT_CHECKSUM },
		});

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const callbackPromise = callback();

			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Enable once");

			const decision = await callbackPromise;
			expect(decision).toBe("enable-once");
			// SEC-001: enable-once is ephemeral — no consent stored; next call re-prompts
			expect(store.setRecord).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// (k) SEC-001 — enable-once does not persist consent
// ---------------------------------------------------------------------------

describe("makeAskCallback — SEC-001: enable-once does not persist consent", () => {
	it("enable-once does NOT call setRecord (so next invocation re-prompts)", async () => {
		const store = makeStore();

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const callbackPromise = callback();
			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Enable once");

			const decision = await callbackPromise;
			expect(decision).toBe("enable-once");
			// setRecord must NOT be called — enable-once is ephemeral
			expect(store.setRecord).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});

	it("enable-session DOES call setRecord (persists for this checksum/version)", async () => {
		const store = makeStore();

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(new App(), store, CONSENT_SCRIPT_ID, CONSENT_INFO, CONSENT_CHECKSUM, CONSENT_VERSION);
			const callbackPromise = callback();
			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Enable");

			const decision = await callbackPromise;
			expect(decision).toBe("enable-session");
			expect(store.setRecord).toHaveBeenCalledOnce();
			expect(store.setRecord).toHaveBeenCalledWith(CONSENT_SCRIPT_ID, expect.objectContaining({
				okayed: { version: CONSENT_VERSION, checksum: CONSENT_CHECKSUM },
			}));
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// Disable button is FIRST in DOM order (safe default — reflexive Enter hits it)
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — Disable is first button (safe default)", () => {
	it("Disable button appears before Enable once and Enable in the DOM", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/order-test.cjs",
			fileSizeBytes: 100,
			version: 1,
			checksum: "sha256:test",
		});

		modal.present();

		const buttons = mockEl(modal)._findAllButtons();
		expect(buttons.length).toBeGreaterThanOrEqual(3);

		const labels = buttons.map((b: MockHTMLElement) => b._text);
		const disableIdx = labels.findIndex((l: string) => l === "Disable");
		const enableOnceIdx = labels.findIndex((l: string) => l === "Enable once");
		const enableIdx = labels.findIndex((l: string) => l === "Enable");

		expect(disableIdx).toBeLessThan(enableOnceIdx);
		expect(disableIdx).toBeLessThan(enableIdx);
	});
});

// ---------------------------------------------------------------------------
// M1 — Disable button is auto-focused (safe default: reflexive Enter/Space cancels)
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — Disable button is auto-focused", () => {
	it("focuses the Disable button after present() is called", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/focus-test.cjs",
			fileSizeBytes: 256,
			version: 1,
			checksum: "sha256:test",
		});

		modal.present();

		const el = mockEl(modal);
		const focused = el._findFocusedElement();

		expect(focused).toBeDefined();
		expect(focused!._text).toBe("Disable");
	});
});

// ---------------------------------------------------------------------------
// (l) makeAskCallback — kill-switch: enabled===false → "disable" immediately, no modal
// ---------------------------------------------------------------------------

describe("makeAskCallback — disabled kill-switch", () => {
	it("returns 'disable' without showing modal or calling setRecord when enabled===false", async () => {
		const store = makeStoreWithRecord(CONSENT_SCRIPT_ID, {
			...BASE_RECORD,
			enabled: false,
			okayed: null,
		});

		let modalOpened = false;
		const restore = captureModal(() => { modalOpened = true; });

		try {
			const callback = makeAskCallback(
				new App(),
				store,
				CONSENT_SCRIPT_ID,
				CONSENT_INFO,
				CONSENT_CHECKSUM,
				CONSENT_VERSION,
			);

			const decision = await callback();

			expect(decision).toBe("disable");
			expect(modalOpened).toBe(false);
			expect(store.setRecord).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// (m) makeAskCallback — no record at all → modal IS shown
// ---------------------------------------------------------------------------

describe("makeAskCallback — unknown trust → modal shown", () => {
	it("shows modal when no record exists; Disable resolves 'disable' without calling setRecord", async () => {
		// Empty store: no record for this script at all
		const store = makeStore();

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(
				new App(),
				store,
				CONSENT_SCRIPT_ID,
				CONSENT_INFO,
				CONSENT_CHECKSUM,
				CONSENT_VERSION,
			);

			const callbackPromise = callback();

			await Promise.resolve();

			expect(capturedModal).not.toBeNull();
			clickButton(capturedModal!, "Disable");

			const decision = await callbackPromise;

			expect(decision).toBe("disable");
			expect(store.setRecord).not.toHaveBeenCalled();
		} finally {
			restore();
		}
	});
});

// ---------------------------------------------------------------------------
// (W2) Disable button carries mod-cta class; Enable / Enable once do NOT
// ---------------------------------------------------------------------------

describe("ScriptDisclosureModal — Disable button has mod-cta class", () => {
	it("Disable button has mod-cta; Enable and Enable once do not", () => {
		const app = new App();
		const modal = new ScriptDisclosureModal(app, {
			vaultRelativePath: "scripts/class-test.cjs",
			fileSizeBytes: 100,
			version: 1,
			checksum: "sha256:test",
		});

		modal.present();

		const el = mockEl(modal);
		const disableBtn = el._findButtonByText("Disable");
		const enableOnceBtn = el._findButtonByText("Enable once");
		const enableBtn = el._findButtonByText("Enable");

		expect(disableBtn).toBeDefined();
		expect(enableOnceBtn).toBeDefined();
		expect(enableBtn).toBeDefined();

		expect(disableBtn!._hasClass("mod-cta")).toBe(true);
		expect(enableOnceBtn!._hasClass("mod-cta")).toBe(false);
		expect(enableBtn!._hasClass("mod-cta")).toBe(false);
	});
});
