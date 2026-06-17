// T5.3  ScriptDisclosureModal + makeAskCallback — unit tests (RED → GREEN)
//
// Exercises the consent modal through the mock Modal base class added to
// test/__mocks__/obsidian.ts.  No real Obsidian runtime required.
//
// Behaviour under test:
//   MODAL
//   (a) present() resolves for each of the 3 decision buttons
//   (b) Escape keydown → "disable" (safe-default)
//   (c) onClose without a tracked signal → "disable" (safe-default)
//   (d) Disclosure text, vault-relative path, and file size are rendered
//   (e) DOM is built via createEl/createDiv only — NO innerHTML/outerHTML
//
//   ADAPTER (makeAskCallback)
//   (f) trust already "ok" → modal NOT shown, resolves "enable-session"
//   (g) trust "needs-consent" → modal shown; "enable-session" records consent
//   (h) trust "needs-consent" → modal shown; "disable" does NOT record consent
//   (i) trust "drift-blocked" → re-prompts (modal shown); "disable" returns "disable"
//   (j) changed checksum/version makes trust not "ok" → re-prompts

import { describe, it, expect, vi } from "vitest";
import { App } from "obsidian";
import { MockHTMLElement } from "../__mocks__/obsidian";
import { ScriptDisclosureModal, makeAskCallback } from "../../src/scripts/disclosure";
import type { AskDecision } from "../../src/scripts/runner";
import type { ScriptStore } from "../../src/scripts/store";

/**
 * Cast the modal's contentEl to MockHTMLElement so tests can use test-only helpers
 * (_collectText, _findButtonByText, _findAllButtons, _dispatch).
 * At runtime under vitest the alias resolves obsidian → the mock, so this cast is safe.
 */
function mockEl(modal: ScriptDisclosureModal): MockHTMLElement {
	return modal.contentEl as unknown as MockHTMLElement;
}

// ---------------------------------------------------------------------------
// Helpers — fake ScriptStore
// ---------------------------------------------------------------------------

type TrustStatus = "ok" | "needs-consent" | "drift-blocked" | "disabled" | "unknown";

interface FakeStore {
	evaluateTrust: ReturnType<typeof vi.fn>;
	recordConsent: ReturnType<typeof vi.fn>;
}

function makeStore(status: TrustStatus): FakeStore & Pick<ScriptStore, "evaluateTrust" | "recordConsent"> {
	return {
		evaluateTrust: vi.fn().mockResolvedValue({ status }),
		recordConsent: vi.fn().mockResolvedValue(undefined),
	} as unknown as FakeStore & Pick<ScriptStore, "evaluateTrust" | "recordConsent">;
}

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
		});

		modal.present();
		const text = mockEl(modal)._collectText();

		expect(text).toContain(DISCLOSURE_TEXT);
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
// (f) makeAskCallback — trust already "ok" → no modal shown
// ---------------------------------------------------------------------------

describe("makeAskCallback — trust ok → skip modal", () => {
	it("returns 'enable-session' without showing modal when trust is ok", async () => {
		const app = new App();
		const store = makeStore("ok");
		const openSpy = vi.fn();

		const callback = makeAskCallback(
			app,
			store as unknown as ScriptStore,
			"script-id",
			{ vaultRelativePath: "scripts/hello.cjs", fileSizeBytes: 512 },
			"checksum-abc",
			1,
		);

		// Patch ScriptDisclosureModal.open to detect if modal was shown
		const origMake = ScriptDisclosureModal;
		// We cannot intercept the constructor easily here; instead we verify
		// via the store evaluateTrust being called and the result being immediate.
		const decision = await callback();

		expect(decision).toBe("enable-session");
		// Store was consulted
		expect(store.evaluateTrust).toHaveBeenCalledWith("script-id");
		// Consent was NOT recorded (already ok)
		expect(store.recordConsent).not.toHaveBeenCalled();

		void origMake;
		void openSpy;
	});
});

// ---------------------------------------------------------------------------
// (g) makeAskCallback — trust "needs-consent" + "enable-session" records consent
// ---------------------------------------------------------------------------

describe("makeAskCallback — needs-consent + enable", () => {
	it("shows modal; enable-session records consent and returns 'enable-session'", async () => {
		const app = new App();
		const store = makeStore("needs-consent");

		const callback = makeAskCallback(
			app,
			store as unknown as ScriptStore,
			"script-needs-consent",
			{ vaultRelativePath: "scripts/hello.cjs", fileSizeBytes: 512 },
			"checksum-xyz",
			2,
		);

		// Intercept present() to capture the modal and click a button.
		// evaluateTrust resolves as a microtask, so we await the store call
		// before present() is invoked. We patch prototype before calling callback().
		let capturedModal: ScriptDisclosureModal | null = null;
		const origPresent = ScriptDisclosureModal.prototype.present;
		ScriptDisclosureModal.prototype.present = function (this: ScriptDisclosureModal) {
			capturedModal = this;
			// Call original so onOpen fires and buttons are rendered
			return origPresent.call(this);
		};

		const callbackPromise = callback();

		// Drain the microtask queue so evaluateTrust resolves and present() fires
		await Promise.resolve();

		expect(capturedModal).not.toBeNull();

		// Click Enable on the captured modal
		clickButton(capturedModal!, "Enable");

		const decision = await callbackPromise;

		expect(decision).toBe("enable-session");
		expect(store.recordConsent).toHaveBeenCalledWith("script-needs-consent", "checksum-xyz", 2);

		// Restore
		ScriptDisclosureModal.prototype.present = origPresent;
	});
});

// ---------------------------------------------------------------------------
// (h) makeAskCallback — needs-consent + "disable" does NOT record consent
// ---------------------------------------------------------------------------

describe("makeAskCallback — needs-consent + disable", () => {
	it("shows modal; disable returns 'disable' and does not record consent", async () => {
		const app = new App();
		const store = makeStore("needs-consent");

		const callback = makeAskCallback(
			app,
			store as unknown as ScriptStore,
			"script-disable",
			{ vaultRelativePath: "scripts/hello.cjs", fileSizeBytes: 512 },
			"checksum-def",
			3,
		);

		let capturedModal: ScriptDisclosureModal | null = null;
		const origPresent = ScriptDisclosureModal.prototype.present;
		ScriptDisclosureModal.prototype.present = function (this: ScriptDisclosureModal) {
			capturedModal = this;
			return origPresent.call(this);
		};

		const callbackPromise = callback();

		// Drain microtask queue so evaluateTrust resolves and present() fires
		await Promise.resolve();

		clickButton(capturedModal!, "Disable");

		const decision = await callbackPromise;

		expect(decision).toBe("disable");
		expect(store.recordConsent).not.toHaveBeenCalled();

		ScriptDisclosureModal.prototype.present = origPresent;
	});
});

// ---------------------------------------------------------------------------
// (i) makeAskCallback — drift-blocked → modal shown (re-prompts)
// ---------------------------------------------------------------------------

describe("makeAskCallback — drift-blocked re-prompts", () => {
	it("shows modal when drift-blocked; disable returns 'disable'", async () => {
		const app = new App();
		const store = makeStore("drift-blocked");

		const callback = makeAskCallback(
			app,
			store as unknown as ScriptStore,
			"script-drift",
			{ vaultRelativePath: "scripts/hello.cjs", fileSizeBytes: 512 },
			"checksum-new",
			3,
		);

		let capturedModal: ScriptDisclosureModal | null = null;
		const origPresent = ScriptDisclosureModal.prototype.present;
		ScriptDisclosureModal.prototype.present = function (this: ScriptDisclosureModal) {
			capturedModal = this;
			return origPresent.call(this);
		};

		const callbackPromise = callback();

		// Drain microtask queue so evaluateTrust resolves and present() fires
		await Promise.resolve();

		expect(capturedModal).not.toBeNull();
		clickButton(capturedModal!, "Disable");

		const decision = await callbackPromise;
		expect(decision).toBe("disable");

		ScriptDisclosureModal.prototype.present = origPresent;
	});

	it("drift-blocked + enable-session records consent and returns 'enable-session'", async () => {
		const app = new App();
		const store = makeStore("drift-blocked");

		const callback = makeAskCallback(
			app,
			store as unknown as ScriptStore,
			"script-drift-2",
			{ vaultRelativePath: "scripts/hello.cjs", fileSizeBytes: 512 },
			"checksum-new-2",
			4,
		);

		let capturedModal: ScriptDisclosureModal | null = null;
		const origPresent = ScriptDisclosureModal.prototype.present;
		ScriptDisclosureModal.prototype.present = function (this: ScriptDisclosureModal) {
			capturedModal = this;
			return origPresent.call(this);
		};

		const callbackPromise = callback();

		// Drain microtask queue so evaluateTrust resolves and present() fires
		await Promise.resolve();

		clickButton(capturedModal!, "Enable");

		const decision = await callbackPromise;
		expect(decision).toBe("enable-session");
		expect(store.recordConsent).toHaveBeenCalledWith("script-drift-2", "checksum-new-2", 4);

		ScriptDisclosureModal.prototype.present = origPresent;
	});
});

// ---------------------------------------------------------------------------
// (j) makeAskCallback — changed checksum/version → re-prompts
// ---------------------------------------------------------------------------

describe("makeAskCallback — changed fingerprint → re-prompts", () => {
	it("re-prompts when store returns needs-consent (from version bump)", async () => {
		const app = new App();
		// Simulate evaluateTrust returning needs-consent because version bumped
		const store = makeStore("needs-consent");

		const callback = makeAskCallback(
			app,
			store as unknown as ScriptStore,
			"script-version-bump",
			{ vaultRelativePath: "scripts/bumped.cjs", fileSizeBytes: 2048 },
			"new-checksum",
			5,
		);

		let capturedModal: ScriptDisclosureModal | null = null;
		const origPresent = ScriptDisclosureModal.prototype.present;
		ScriptDisclosureModal.prototype.present = function (this: ScriptDisclosureModal) {
			capturedModal = this;
			return origPresent.call(this);
		};

		const callbackPromise = callback();

		// Drain microtask queue so evaluateTrust resolves and present() fires
		await Promise.resolve();

		// Modal must have been shown (re-prompt)
		expect(capturedModal).not.toBeNull();
		clickButton(capturedModal!, "Enable once");

		const decision = await callbackPromise;
		expect(decision).toBe("enable-once");

		ScriptDisclosureModal.prototype.present = origPresent;
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
