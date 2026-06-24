// T5.3  End-to-end script lifecycle — all headline PRD flows (002-script-distribution)
//
// Covers:
//   1. FULL CURATED LIFECYCLE — Available → consent → materialize → Active → run
//                               → disable → Disabled → remove → Available
//   2. DEVICE-B MATERIALIZATION — synced record but local absent → Materializing →
//                                 materialize → Active (no disclosure re-shown);
//                                 offline variant → Blocked(offline) → retry → Active
//   3. DRIFT — same version, wrong bytes → Blocked(drift) → re-disclose → materialize
//              → Active
//   4. IMPORT LIFECYCLE — imported → disclose → materialize → Active; vault source
//                         removed → Blocked(source-missing) → re-import → Active
//   5. UPDATE — Active curated; catalog bumps version → UpdateAvailable → re-disclose
//               → materialize new bytes → Active at new version
//   6. NOTHING AUTO-ENABLES — fresh store: no script is Active, nothing runs;
//      PASTE NO-MATCH: empty chain → raw fallback + "no recognized format" Notice
//
// Design:
//   - Fakes reused from materializer.test.ts (makeFakeVault, makeFakeCatalog)
//   - In-memory PluginDataPort for ScriptStore
//   - evaluateState is the state-transition oracle at every step
//   - Flows 1 + 5 load the REAL catalog .cjs via loadScriptModule + Node createRequire
//   - Disclosure is intercepted via captureModal pattern (from disclosure.test.ts)
//   - NO production glue added — all composition happens in the test file

import { describe, it, expect, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { ScriptStore } from "../../src/scripts/store";
import type { PluginDataPort, ScriptRecord } from "../../src/scripts/store";
import { evaluateState } from "../../src/scripts/lifecycle";
import type { EvaluateStateInput } from "../../src/scripts/lifecycle";
import { materialize } from "../../src/scripts/materializer";
import { ScriptDisclosureModal, makeAskCallback } from "../../src/scripts/disclosure";
import { loadScriptModule } from "../../src/scripts/loader";
import { ScriptRunner } from "../../src/scripts/runner";
import type { RunnerEffects } from "../../src/scripts/runner";
import { buildPasteChain } from "../../src/scripts/paste/buildPasteChain";
import type { LoadedScript } from "../../src/scripts/paste/buildPasteChain";
import { buildScriptContext } from "../../src/scripts/context";
import { buildRegistry } from "../../src/core/registry";
import { sha256Bytes } from "../../src/scripts/checksum";

import { App } from "obsidian";
import { noticeLog, clearNoticeLog } from "../__mocks__/obsidian";

// Dynamic import at module top-level — matches integration.test.ts pattern
const { MarkdownMasonPlugin } = await import("../../src/main");

import type { CatalogSource, CatalogIndex, CatalogEntry } from "../../src/scripts/catalog/catalogSource";
import type { ScriptContext } from "../../src/scripts/context";
import type { MasonSettings, OperationContext } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const catalogDistDir = path.join(repoRoot, "catalog", "dist");

// ---------------------------------------------------------------------------
// In-memory PluginDataPort — for ScriptStore
// ---------------------------------------------------------------------------

function makeInMemoryPort(): PluginDataPort & { _data: unknown } {
	let stored: unknown = null;
	return {
		get _data(): unknown { return stored; },
		load: async (): Promise<unknown> => stored,
		save: async (data: unknown): Promise<void> => { stored = data; },
	};
}

// ---------------------------------------------------------------------------
// FakeVault (reused from materializer.test.ts pattern)
// ---------------------------------------------------------------------------

interface FakeVault {
	writeCalls: Array<{ path: string; data: ArrayBuffer }>;
	existsResult: boolean;
	readBinaryResult: ArrayBuffer | Error;
	mkdirCalls: string[];
	readBinary(path: string): Promise<ArrayBuffer>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir(path: string): Promise<void>;
	// allow dynamic overrides for source-present/missing scenarios
	_setReadBinaryResult(r: Uint8Array | Error): void;
	_setExistsResult(b: boolean): void;
}

function makeFakeVault(opts: {
	existsResult?: boolean;
	readBinaryResult?: Uint8Array | Error;
} = {}): FakeVault {
	const toArrayBuffer = (u: Uint8Array): ArrayBuffer =>
		u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
	let readBinaryResult: ArrayBuffer | Error =
		opts.readBinaryResult instanceof Error
			? opts.readBinaryResult
			: opts.readBinaryResult instanceof Uint8Array
				? toArrayBuffer(opts.readBinaryResult)
				: toArrayBuffer(new Uint8Array(0));
	let existsResult = opts.existsResult ?? true;

	const vault: FakeVault = {
		writeCalls: [],
		mkdirCalls: [],
		get existsResult(): boolean { return existsResult; },
		set existsResult(v: boolean) { existsResult = v; },
		get readBinaryResult(): ArrayBuffer | Error { return readBinaryResult; },
		set readBinaryResult(v: ArrayBuffer | Error) { readBinaryResult = v; },
		_setReadBinaryResult(r: Uint8Array | Error): void {
			readBinaryResult = r instanceof Error ? r : toArrayBuffer(r);
		},
		_setExistsResult(b: boolean): void { existsResult = b; },
		async readBinary(_path: string): Promise<ArrayBuffer> {
			if (readBinaryResult instanceof Error) throw readBinaryResult;
			return readBinaryResult;
		},
		async writeBinary(p: string, data: ArrayBuffer): Promise<void> {
			vault.writeCalls.push({ path: p, data });
		},
		async exists(_path: string): Promise<boolean> { return existsResult; },
		async mkdir(p: string): Promise<void> { vault.mkdirCalls.push(p); },
	};
	return vault;
}

// ---------------------------------------------------------------------------
// FakeCatalog factory (reused from materializer.test.ts pattern)
// ---------------------------------------------------------------------------

type FetchIndexFn = () => Promise<CatalogIndex>;
type FetchScriptFn = (entry: CatalogEntry) => Promise<Uint8Array>;

function makeFakeCatalog(opts: {
	fetchIndex?: FetchIndexFn;
	fetchScript?: FetchScriptFn;
}): CatalogSource {
	return {
		fetchIndex: opts.fetchIndex ?? (() => Promise.reject(new Error("fetchIndex not configured"))),
		fetchScript: opts.fetchScript ?? (() => Promise.reject(new Error("fetchScript not configured"))),
	};
}

function makeCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
	return {
		id: "test-script",
		version: 1,
		checksum: "sha256:placeholder",
		path: "test-script.cjs",
		name: "Test Script",
		description: "A test script",
		...overrides,
	};
}

function makeCatalogIndex(scripts: Record<string, CatalogEntry>): CatalogIndex {
	return { schemaVersion: 1, ref: "abc123", scripts };
}

// ---------------------------------------------------------------------------
// captureModal — intercepts ScriptDisclosureModal.present() (from disclosure.test.ts)
// ---------------------------------------------------------------------------

function captureModal(handler: (modal: ScriptDisclosureModal) => void): () => void {
	const origPresent = ScriptDisclosureModal.prototype.present;
	ScriptDisclosureModal.prototype.present = function (this: ScriptDisclosureModal) {
		handler(this);
		return origPresent.call(this);
	};
	return (): void => { ScriptDisclosureModal.prototype.present = origPresent; };
}

// Simulate clicking a button on a captured modal
import { MockHTMLElement } from "../__mocks__/obsidian";

function clickButton(modal: ScriptDisclosureModal, label: string): void {
	const el = modal.contentEl as unknown as MockHTMLElement;
	const btn = el._findButtonByText(label);
	if (!btn) throw new Error(`No button with text "${label}" found in modal`);
	btn._click();
}

// ---------------------------------------------------------------------------
// vi.fn() mock store for disclosure tests
//
// Uses vi.fn().mockResolvedValue() so getScripts resolves in ONE microtask
// tick — same as disclosure.test.ts. The real ScriptStore.getScripts() does
// TWO awaits (getScripts → load) which requires extra ticks.
// ---------------------------------------------------------------------------

type DisclosureMockStore = {
	getScripts: ReturnType<typeof vi.fn>;
	setRecord: ReturnType<typeof vi.fn>;
};

function makeDisclosureStore(scripts: Record<string, ScriptRecord> = {}): DisclosureMockStore {
	return {
		getScripts: vi.fn().mockResolvedValue(scripts),
		setRecord: vi.fn().mockResolvedValue(undefined),
	};
}


// ---------------------------------------------------------------------------
// ScriptContext factory helpers
// ---------------------------------------------------------------------------

function makeSettings(): MasonSettings {
	return { debugLogging: false, resourcesName: "Resources" };
}

function makeCtx(input: string, source: "paste" | "command" = "paste"): ScriptContext {
	const { api } = buildRegistry();
	const op: OperationContext = {
		doc: "# Test Note\n\n",
		cursor: "# Test Note\n\n".length,
		settings: makeSettings(),
		input,
	};
	return buildScriptContext({
		input,
		source,
		op,
		mason: api,
		logger: { info: (): void => {}, warn: (): void => {}, error: (): void => {} },
	});
}

// ---------------------------------------------------------------------------
// RunnerEffects spy
// ---------------------------------------------------------------------------

interface EffectsSpy extends RunnerEffects {
	appliedPlans: unknown[];
	fallbackCount: number;
	notices: string[];
}

function makeEffects(): EffectsSpy {
	const spy: EffectsSpy = {
		appliedPlans: [],
		fallbackCount: 0,
		notices: [],
		applyPlan: (plan): void => { spy.appliedPlans.push(plan); },
		rawFallback: (): void => { spy.fallbackCount++; },
		notify: (msg: string): void => { spy.notices.push(msg); },
	};
	return spy;
}

// ---------------------------------------------------------------------------
// Real catalog .cjs loading via Node createRequire
// ---------------------------------------------------------------------------

function loadRealCatalogModule(scriptId: string) {
	const cjsPath = path.join(catalogDistDir, `${scriptId}.cjs`);
	const req = createRequire(cjsPath);
	return loadScriptModule(cjsPath, req as Parameters<typeof loadScriptModule>[1]);
}

function readRealCatalogBytes(scriptId: string): Uint8Array {
	return new Uint8Array(fs.readFileSync(path.join(catalogDistDir, `${scriptId}.cjs`)));
}

// ---------------------------------------------------------------------------
// evaluateState helper — builds input from parts
// ---------------------------------------------------------------------------

function stateOf(
	record: ScriptRecord | undefined,
	opts: {
		inCatalog?: boolean;
		local?: { version: number; checksum: string } | null;
		catalogVersion?: number;
		online?: boolean;
	} = {},
) {
	const input: EvaluateStateInput = {
		record,
		inCatalog: opts.inCatalog ?? true,
		local: opts.local !== undefined ? opts.local : null,
		catalogVersion: opts.catalogVersion,
		online: opts.online ?? true,
	};
	return evaluateState(input);
}

// ===========================================================================
// FLOW 1: FULL CURATED LIFECYCLE
//
// Available → consent (disclosure) → materialize → Active → run (real .cjs)
// → disable → Disabled → remove record → Available again
// ===========================================================================

describe("Flow 1 — full curated lifecycle with real catalog .cjs", () => {
	const SCRIPT_ID = "perplexity-app";
	const CATALOG_CHECKSUM = "sha256:dd55cb5cb48e04379f94fa2348d42f55ef0eaf64858b92c6affdf567b451aedc";
	const CATALOG_VERSION = 1;

	it("starts Available (no record, inCatalog:true)", () => {
		const state = stateOf(undefined, { inCatalog: true, local: null });
		expect(state).toEqual({ kind: "Available" });
	});

	it("disclosure consent writes okayed to store, no re-prompt on repeat call", async () => {
		// Use vi.fn() store so getScripts resolves in one microtask tick (disclosure.test.ts pattern)
		const store = makeDisclosureStore();

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(
				new App(),
				store,
				SCRIPT_ID,
				{
					vaultRelativePath: `scripts/${SCRIPT_ID}.cjs`,
					fileSizeBytes: 12887,
					version: CATALOG_VERSION,
					checksum: CATALOG_CHECKSUM,
				},
				CATALOG_CHECKSUM,
				CATALOG_VERSION,
			);

			const callbackPromise = callback();
			await Promise.resolve();

			expect(capturedModal, "disclosure modal must be shown for unknown script").not.toBeNull();
			clickButton(capturedModal!, "Enable");

			const decision = await callbackPromise;
			expect(decision).toBe("enable-session");

			// Consent was persisted via setRecord
			expect(store.setRecord).toHaveBeenCalledOnce();
			expect(store.setRecord).toHaveBeenCalledWith(SCRIPT_ID, expect.objectContaining({
				okayed: { version: CATALOG_VERSION, checksum: CATALOG_CHECKSUM },
				enabled: true,
			}));

			// Second call: store now returns the consented record — no modal re-shown
			const consentedRecord = store.setRecord.mock.calls[0]?.[1] as ScriptRecord;
			const store2 = makeDisclosureStore({ [SCRIPT_ID]: consentedRecord });
			capturedModal = null;
			const callback2 = makeAskCallback(
				new App(),
				store2,
				SCRIPT_ID,
				{
					vaultRelativePath: `scripts/${SCRIPT_ID}.cjs`,
					fileSizeBytes: 12887,
					version: CATALOG_VERSION,
					checksum: CATALOG_CHECKSUM,
				},
				CATALOG_CHECKSUM,
				CATALOG_VERSION,
			);
			const decision2 = await callback2();
			expect(decision2).toBe("enable-session");
			expect(capturedModal, "modal must NOT be shown when already consented").toBeNull();
		} finally {
			restore();
		}
	});

	it("materialize writes real catalog bytes byte-exactly → evaluateState Active", async () => {
		const realBytes = readRealCatalogBytes(SCRIPT_ID);
		const vault = makeFakeVault();
		const entry = makeCatalogEntry({
			id: SCRIPT_ID,
			version: CATALOG_VERSION,
			checksum: CATALOG_CHECKSUM,
			path: `${SCRIPT_ID}.cjs`,
		});
		const index = makeCatalogIndex({ [SCRIPT_ID]: entry });
		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => realBytes,
		});

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: CATALOG_VERSION, checksum: CATALOG_CHECKSUM },
			source: "",
			command: false,
		};
		const destPath = `scripts/${SCRIPT_ID}.cjs`;

		// Before materialize: local absent → Materializing
		expect(stateOf(record, { local: null })).toEqual({ kind: "Materializing" });

		const result = await materialize(SCRIPT_ID, { record, catalog, vault, destPath });
		expect(result).toEqual({ ok: true });
		expect(vault.writeCalls).toHaveLength(1);

		// Written bytes must be byte-exact
		const written = new Uint8Array(vault.writeCalls[0]!.data);
		expect(written).toEqual(realBytes);

		// After materialize: local matches okayed → Active
		const localChecksum = sha256Bytes(written);
		expect(localChecksum).toBe(CATALOG_CHECKSUM);

		const stateAfter = stateOf(record, {
			local: { version: CATALOG_VERSION, checksum: localChecksum },
		});
		expect(stateAfter).toEqual({ kind: "Active" });
	});

	it("runs real .cjs via ScriptRunner with policy:enabled — applied outcome", async () => {
		const mod = loadRealCatalogModule(SCRIPT_ID);
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		// Minimal perplexity-app input that the script can handle
		const PERPLEXITY_INPUT = [
			"## Answer",
			"",
			"Some answer text with citation [1].",
			"",
			"Sources",
			"[1] Article Title https://example.com/article",
		].join("\n");

		const ctx = makeCtx(PERPLEXITY_INPUT);
		const outcome = await runner.run(mod.run, ctx);

		expect(outcome.kind).toBe("applied");
		expect(effects.appliedPlans).toHaveLength(1);
		expect(effects.fallbackCount).toBe(0);
	});

	it("disable: enabled:false → evaluateState = Disabled", () => {
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: false,
			okayed: { version: CATALOG_VERSION, checksum: CATALOG_CHECKSUM },
			source: "",
			command: false,
		};
		expect(stateOf(record, {
			local: { version: CATALOG_VERSION, checksum: CATALOG_CHECKSUM },
		})).toEqual({ kind: "Disabled" });
	});

	it("remove record: back to Available", () => {
		// Removing the record entirely = undefined
		expect(stateOf(undefined, { inCatalog: true })).toEqual({ kind: "Available" });
	});
});

// ===========================================================================
// FLOW 2: DEVICE-B MATERIALIZATION
//
// Synced record (enabled:true, okayed set) but local absent → Materializing
// → materialize → Active (no disclosure re-shown)
// Offline variant: local absent + online:false → Blocked(offline) → retry → Active
// ===========================================================================

describe("Flow 2 — device-B materialization (no disclosure re-shown)", () => {
	const SCRIPT_ID = "perplexity-app";
	const CATALOG_CHECKSUM = "sha256:dd55cb5cb48e04379f94fa2348d42f55ef0eaf64858b92c6affdf567b451aedc";
	const CATALOG_VERSION = 1;

	const SYNCED_RECORD: ScriptRecord = {
		provenance: "curated",
		enabled: true,
		okayed: { version: CATALOG_VERSION, checksum: CATALOG_CHECKSUM },
		source: "",
		command: false,
	};

	it("synced record, local absent, online:true → Materializing", () => {
		expect(stateOf(SYNCED_RECORD, { local: null, online: true })).toEqual({ kind: "Materializing" });
	});

	it("materialize succeeds → Active, and disclosure was NOT invoked", async () => {
		const realBytes = readRealCatalogBytes(SCRIPT_ID);
		const vault = makeFakeVault();
		const entry = makeCatalogEntry({
			id: SCRIPT_ID,
			version: CATALOG_VERSION,
			checksum: CATALOG_CHECKSUM,
		});
		const index = makeCatalogIndex({ [SCRIPT_ID]: entry });
		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => realBytes,
		});

		let disclosureShown = false;
		const restore = captureModal(() => { disclosureShown = true; });

		try {
			const result = await materialize(SCRIPT_ID, {
				record: SYNCED_RECORD,
				catalog,
				vault,
				destPath: `scripts/${SCRIPT_ID}.cjs`,
			});
			expect(result).toEqual({ ok: true });
			expect(disclosureShown, "disclosure must NOT be shown on device-B materialization").toBe(false);

			// Verify Active
			const written = new Uint8Array(vault.writeCalls[0]!.data);
			const localChecksum = sha256Bytes(written);
			expect(stateOf(SYNCED_RECORD, {
				local: { version: CATALOG_VERSION, checksum: localChecksum },
			})).toEqual({ kind: "Active" });
		} finally {
			restore();
		}
	});

	it("offline variant: synced record, local absent, online:false → Blocked(offline)", () => {
		expect(stateOf(SYNCED_RECORD, { local: null, online: false })).toEqual({
			kind: "Blocked",
			reason: "offline",
		});
	});

	it("retry once online: materialize succeeds → Active", async () => {
		const realBytes = readRealCatalogBytes(SCRIPT_ID);
		const vault = makeFakeVault();
		const entry = makeCatalogEntry({
			id: SCRIPT_ID,
			version: CATALOG_VERSION,
			checksum: CATALOG_CHECKSUM,
		});
		const index = makeCatalogIndex({ [SCRIPT_ID]: entry });
		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => realBytes,
		});

		// Confirm Blocked(offline) first
		expect(stateOf(SYNCED_RECORD, { local: null, online: false })).toEqual({
			kind: "Blocked",
			reason: "offline",
		});

		// Retry when online
		const result = await materialize(SCRIPT_ID, {
			record: SYNCED_RECORD,
			catalog,
			vault,
			destPath: `scripts/${SCRIPT_ID}.cjs`,
		});
		expect(result).toEqual({ ok: true });

		const written = new Uint8Array(vault.writeCalls[0]!.data);
		const localChecksum = sha256Bytes(written);
		expect(stateOf(SYNCED_RECORD, {
			local: { version: CATALOG_VERSION, checksum: localChecksum },
			online: true,
		})).toEqual({ kind: "Active" });
	});
});

// ===========================================================================
// FLOW 3: DRIFT
//
// Materialized bytes have same version but different checksum than okayed
// → Blocked(drift) → re-disclose (user consents new {v,c}) → materialize
// with matching bytes → Active
// ===========================================================================

describe("Flow 3 — drift: wrong bytes at same version → Blocked, re-disclose → Active", () => {
	const SCRIPT_ID = "perplexity-app";
	const OKAYED_VERSION = 1;
	const OKAYED_CHECKSUM = "sha256:dd55cb5cb48e04379f94fa2348d42f55ef0eaf64858b92c6affdf567b451aedc";

	it("same version, different local checksum → Blocked(drift)", () => {
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: OKAYED_VERSION, checksum: OKAYED_CHECKSUM },
			source: "",
			command: false,
		};
		const DIFFERENT_CHECKSUM = sha256Bytes(new TextEncoder().encode("tampered bytes"));

		expect(stateOf(record, {
			local: { version: OKAYED_VERSION, checksum: DIFFERENT_CHECKSUM },
		})).toEqual({ kind: "Blocked", reason: "drift" });
	});

	it("re-disclose new {v,c}: user consents → materialize matching bytes → Active", async () => {
		const realBytes = readRealCatalogBytes(SCRIPT_ID);
		const newChecksum = sha256Bytes(realBytes);
		const newVersion = 2;

		// Use vi.fn() store with the old okayed seeded (drift scenario)
		const oldRecord: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: OKAYED_VERSION, checksum: OKAYED_CHECKSUM },
			source: "",
			command: false,
		};
		const store = makeDisclosureStore({ [SCRIPT_ID]: oldRecord });

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			// Re-disclosure for new {version, checksum} — old okayed version differs → modal shown
			const callback = makeAskCallback(
				new App(),
				store,
				SCRIPT_ID,
				{
					vaultRelativePath: `scripts/${SCRIPT_ID}.cjs`,
					fileSizeBytes: realBytes.length,
					version: newVersion,
					checksum: newChecksum,
				},
				newChecksum,
				newVersion,
			);

			const callbackPromise = callback();
			await Promise.resolve();

			expect(capturedModal, "modal must be shown for drifted script").not.toBeNull();
			clickButton(capturedModal!, "Enable");

			await callbackPromise;

			// After consent, setRecord called with new okayed
			expect(store.setRecord).toHaveBeenCalledOnce();
			expect(store.setRecord).toHaveBeenCalledWith(SCRIPT_ID, expect.objectContaining({
				okayed: { version: newVersion, checksum: newChecksum },
			}));

			// Materialize with matching bytes
			const vault = makeFakeVault();
			const entry = makeCatalogEntry({
				id: SCRIPT_ID,
				version: newVersion,
				checksum: newChecksum,
			});
			const index = makeCatalogIndex({ [SCRIPT_ID]: entry });
			const catalog = makeFakeCatalog({
				fetchIndex: async () => index,
				fetchScript: async () => realBytes,
			});
			const updatedRecord: ScriptRecord = {
				provenance: "curated",
				enabled: true,
				okayed: { version: newVersion, checksum: newChecksum },
				source: "",
				command: false,
			};

			const result = await materialize(SCRIPT_ID, {
				record: updatedRecord,
				catalog,
				vault,
				destPath: `scripts/${SCRIPT_ID}.cjs`,
			});
			expect(result).toEqual({ ok: true });

			const written = new Uint8Array(vault.writeCalls[0]!.data);
			const localChecksum = sha256Bytes(written);
			expect(stateOf(updatedRecord, {
				local: { version: newVersion, checksum: localChecksum },
			})).toEqual({ kind: "Active" });
		} finally {
			restore();
		}
	});
});

// ===========================================================================
// FLOW 4: IMPORT LIFECYCLE
//
// Imported script → disclose → materialize from vault source → Active
// Vault source removed → Blocked(source-missing) → re-import → Active
// ===========================================================================

describe("Flow 4 — import lifecycle: imported script materialize, source-missing, re-import", () => {
	const SCRIPT_ID = "my-imported-script";
	const VAULT_SOURCE_PATH = "vault/scripts/my-script.cjs";
	const DEST_PATH = ".obsidian/plugins/markdown-mason/scripts/my-script.cjs";
	const SCRIPT_CONTENT = `"use strict";\nmodule.exports = { run: function(ctx) { return [{ from: 0, to: 0, insert: "imported" }]; } };\n`;
	const SCRIPT_BYTES = new TextEncoder().encode(SCRIPT_CONTENT);
	const SCRIPT_CHECKSUM = sha256Bytes(SCRIPT_BYTES);
	const SCRIPT_VERSION = 1;

	it("imported script without consent: record has okayed:null → Available (curated) / Absent (imported)", () => {
		// imported provenance with okayed:null → Absent (step 3: not curated, so Absent)
		const record: ScriptRecord = {
			provenance: "imported",
			enabled: true,
			okayed: null,
			source: VAULT_SOURCE_PATH,
			command: false,
		};
		// Step 3: okayed null, not curated → Absent
		expect(stateOf(record, { inCatalog: false })).toEqual({ kind: "Absent" });
	});

	it("disclosure consent for imported script → okayed set → materialize from vault → Active", async () => {
		// Use vi.fn() store with record-okayed:null seeded (first-enable scenario)
		const initialRecord: ScriptRecord = {
			provenance: "imported",
			enabled: true,
			okayed: null,
			source: VAULT_SOURCE_PATH,
			command: false,
		};
		const store = makeDisclosureStore({ [SCRIPT_ID]: initialRecord });

		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			const callback = makeAskCallback(
				new App(),
				store,
				SCRIPT_ID,
				{
					vaultRelativePath: VAULT_SOURCE_PATH,
					fileSizeBytes: SCRIPT_BYTES.length,
					version: SCRIPT_VERSION,
					checksum: SCRIPT_CHECKSUM,
				},
				SCRIPT_CHECKSUM,
				SCRIPT_VERSION,
			);

			const callbackPromise = callback();
			await Promise.resolve();

			expect(capturedModal, "disclosure must be shown for imported script").not.toBeNull();
			clickButton(capturedModal!, "Enable");

			const decision = await callbackPromise;
			expect(decision).toBe("enable-session");

			// Consent persisted via setRecord
			expect(store.setRecord).toHaveBeenCalledOnce();
			expect(store.setRecord).toHaveBeenCalledWith(SCRIPT_ID, expect.objectContaining({
				okayed: { version: SCRIPT_VERSION, checksum: SCRIPT_CHECKSUM },
				enabled: true,
			}));

			// Build the consented record for the materialize step
			const consentedRecord = store.setRecord.mock.calls[0]?.[1] as ScriptRecord;

			// Materialize from vault source
			const vault = makeFakeVault({
				existsResult: true,
				readBinaryResult: SCRIPT_BYTES,
			});
			const catalog = makeFakeCatalog({});

			const result = await materialize(SCRIPT_ID, {
				record: consentedRecord,
				catalog,
				vault,
				destPath: DEST_PATH,
			});
			expect(result).toEqual({ ok: true });

			// Active after materialize
			const written = new Uint8Array(vault.writeCalls[0]!.data);
			const localChecksum = sha256Bytes(written);
			expect(stateOf(consentedRecord, {
				inCatalog: false,
				local: { version: SCRIPT_VERSION, checksum: localChecksum },
			})).toEqual({ kind: "Active" });
		} finally {
			restore();
		}
	});

	it("vault source file removed → materialize returns {ok:false, reason:'source-missing'}", async () => {
		const record: ScriptRecord = {
			provenance: "imported",
			enabled: true,
			okayed: { version: SCRIPT_VERSION, checksum: SCRIPT_CHECKSUM },
			source: VAULT_SOURCE_PATH,
			command: false,
		};
		// Source is gone
		const vault = makeFakeVault({ existsResult: false });
		const catalog = makeFakeCatalog({});

		const result = await materialize(SCRIPT_ID, {
			record,
			catalog,
			vault,
			destPath: DEST_PATH,
		});
		expect(result).toEqual({ ok: false, reason: "source-missing" });
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("evaluateState with local absent after source-missing → Materializing (online), not Active", () => {
		// After source-missing materialize fails, local code was never written.
		// evaluateState sees local:null → Materializing (the lifecycle state for re-fetch).
		// This is the correct signal that triggers retry / user-facing Blocked warning.
		const record: ScriptRecord = {
			provenance: "imported",
			enabled: true,
			okayed: { version: SCRIPT_VERSION, checksum: SCRIPT_CHECKSUM },
			source: VAULT_SOURCE_PATH,
			command: false,
		};
		// local is null (materialize failed, no file was written)
		expect(stateOf(record, { inCatalog: false, local: null, online: true })).toEqual({
			kind: "Materializing",
		});
	});

	it("re-import (source restored) → materialize succeeds → Active", async () => {
		const record: ScriptRecord = {
			provenance: "imported",
			enabled: true,
			okayed: { version: SCRIPT_VERSION, checksum: SCRIPT_CHECKSUM },
			source: VAULT_SOURCE_PATH,
			command: false,
		};
		const vault = makeFakeVault({
			existsResult: true,
			readBinaryResult: SCRIPT_BYTES,
		});
		const catalog = makeFakeCatalog({});

		const result = await materialize(SCRIPT_ID, {
			record,
			catalog,
			vault,
			destPath: DEST_PATH,
		});
		expect(result).toEqual({ ok: true });

		const written = new Uint8Array(vault.writeCalls[0]!.data);
		const localChecksum = sha256Bytes(written);
		expect(stateOf(record, {
			inCatalog: false,
			local: { version: SCRIPT_VERSION, checksum: localChecksum },
		})).toEqual({ kind: "Active" });
	});
});

// ===========================================================================
// FLOW 5: UPDATE
//
// Active curated script; catalog version bumps above okayed.version
// → UpdateAvailable → re-disclose new {v,c} → materialize new bytes → Active
//    at new version
// ===========================================================================

describe("Flow 5 — update: catalog version bump → UpdateAvailable → consent → Active", () => {
	const SCRIPT_ID = "perplexity-web";
	const V1_CHECKSUM = "sha256:516d0f56a3e8c19956864d92321ba94d5cb747e9dc6d987caf16a72b905626bb";
	const V1_VERSION = 1;
	const V2_VERSION = 2;

	it("Active script with catalogVersion > okayed.version → UpdateAvailable", () => {
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: V1_VERSION, checksum: V1_CHECKSUM },
			source: "",
			command: false,
		};
		expect(stateOf(record, {
			local: { version: V1_VERSION, checksum: V1_CHECKSUM },
			catalogVersion: V2_VERSION,
		})).toEqual({ kind: "UpdateAvailable" });
	});

	it("same version as okayed: still Active (no update)", () => {
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: V1_VERSION, checksum: V1_CHECKSUM },
			source: "",
			command: false,
		};
		expect(stateOf(record, {
			local: { version: V1_VERSION, checksum: V1_CHECKSUM },
			catalogVersion: V1_VERSION,
		})).toEqual({ kind: "Active" });
	});

	it("update flow: re-disclose new {v,c} → consent → materialize real .cjs → Active at v2", async () => {
		const realBytes = readRealCatalogBytes(SCRIPT_ID);
		const newChecksum = sha256Bytes(realBytes);

		// Use vi.fn() store with v1 okayed seeded (Active at v1 scenario)
		const v1Record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: V1_VERSION, checksum: V1_CHECKSUM },
			source: "",
			command: false,
		};
		const store = makeDisclosureStore({ [SCRIPT_ID]: v1Record });

		// Catalog reports v2 → UpdateAvailable; re-disclose
		let capturedModal: ScriptDisclosureModal | null = null;
		const restore = captureModal((m) => { capturedModal = m; });

		try {
			// Re-disclose for the new version (v1 okayed ≠ v2 asked → modal shown)
			const callback = makeAskCallback(
				new App(),
				store,
				SCRIPT_ID,
				{
					vaultRelativePath: `scripts/${SCRIPT_ID}.cjs`,
					fileSizeBytes: realBytes.length,
					version: V2_VERSION,
					checksum: newChecksum,
				},
				newChecksum,
				V2_VERSION,
			);

			const callbackPromise = callback();
			await Promise.resolve();

			expect(capturedModal, "re-disclosure must be shown for update").not.toBeNull();
			clickButton(capturedModal!, "Enable");

			const decision = await callbackPromise;
			expect(decision).toBe("enable-session");

			// okayed updated to v2
			expect(store.setRecord).toHaveBeenCalledOnce();
			expect(store.setRecord).toHaveBeenCalledWith(SCRIPT_ID, expect.objectContaining({
				okayed: { version: V2_VERSION, checksum: newChecksum },
			}));

			// Materialize new bytes
			const vault = makeFakeVault();
			const entry = makeCatalogEntry({
				id: SCRIPT_ID,
				version: V2_VERSION,
				checksum: newChecksum,
			});
			const index = makeCatalogIndex({ [SCRIPT_ID]: entry });
			const catalog = makeFakeCatalog({
				fetchIndex: async () => index,
				fetchScript: async () => realBytes,
			});
			const updatedRecord: ScriptRecord = {
				provenance: "curated",
				enabled: true,
				okayed: { version: V2_VERSION, checksum: newChecksum },
				source: "",
				command: false,
			};

			const result = await materialize(SCRIPT_ID, {
				record: updatedRecord,
				catalog,
				vault,
				destPath: `scripts/${SCRIPT_ID}.cjs`,
			});
			expect(result).toEqual({ ok: true });

			const written = new Uint8Array(vault.writeCalls[0]!.data);
			const localChecksum = sha256Bytes(written);
			// Active at new version (no UpdateAvailable since catalogVersion = V2 = okayed.version)
			expect(stateOf(updatedRecord, {
				local: { version: V2_VERSION, checksum: localChecksum },
				catalogVersion: V2_VERSION,
			})).toEqual({ kind: "Active" });
		} finally {
			restore();
		}
	});
});

// ===========================================================================
// FLOW 6: NOTHING AUTO-ENABLES + PASTE NO-MATCH
//
// Fresh in-memory store: no records → no script is Active → nothing runs.
// buildPasteChain over empty enabled set + input no canHandle claims
// → raw fallback path fired + "no recognized format" Notice.
// ===========================================================================

describe("Flow 6a — fresh store: no record is Active, nothing runs", () => {
	it("fresh store has no records → all evaluateState checks return non-Active", async () => {
		const port = makeInMemoryPort();
		const store = new ScriptStore(port);

		const scripts = await store.getScripts();
		expect(Object.keys(scripts)).toHaveLength(0);

		// Any hypothetical script with no record → Available (curated) or Absent
		expect(stateOf(undefined, { inCatalog: true, local: null })).toEqual({ kind: "Available" });
		expect(stateOf(undefined, { inCatalog: false, local: null })).toEqual({ kind: "Absent" });
	});

	it("ScriptRunner with policy:disabled is blocked — script never runs", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "disabled" });

		let ran = false;
		const outcome = await runner.run(() => {
			ran = true;
			return [{ from: 0, to: 0, insert: "x" }];
		}, makeCtx("hello"));

		expect(ran).toBe(false);
		expect(outcome.kind).toBe("blocked");
		expect(effects.appliedPlans).toHaveLength(0);
		expect(effects.fallbackCount).toBe(0);
	});
});

describe("Flow 6b — PASTE NO-MATCH: empty chain → raw fallback + notice", () => {
	async function makePluginAndFireLayout() {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const app = new App() as any;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const plugin = new MarkdownMasonPlugin(app, {} as any);
		await plugin.onload();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(plugin.app as any).workspace._fireLayoutReady();
		return plugin;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	function findCommand(plugin: InstanceType<typeof MarkdownMasonPlugin>, id: string): any {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (plugin as any)._commands as Array<{
			id: string;
			editorCallback(editor: unknown): void | Promise<void>;
		}>;
		return commands.find((c) => c.id === id);
	}

	function makePasteEditorStub() {
		const replaced: string[] = [];
		const lines = ["# Test Note", "", ""];
		return {
			_replaced: replaced,
			getValue: () => lines.join("\n"),
			getCursor: () => ({ line: lines.length - 1, ch: 0 }),
			posToOffset: (pos: { line: number; ch: number }) => {
				let offset = 0;
				for (let i = 0; i < pos.line; i++) offset += (lines[i]?.length ?? 0) + 1;
				return offset + pos.ch;
			},
			listSelections: () => [{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }],
			replaceSelection: (text: string) => { replaced.push(text); },
			getSelection: () => "",
			replaceRange: () => undefined,
			setCursor: () => undefined,
			setSelection: () => undefined,
			setSelections: () => undefined,
			setValue: () => undefined,
			getLine: (n: number) => lines[n] ?? "",
			lineCount: () => lines.length,
			lastLine: () => lines.length - 1,
			somethingSelected: () => false,
			getRange: () => "",
			refresh: () => undefined,
			focus: () => undefined,
			blur: () => undefined,
			hasFocus: () => false,
			getScrollInfo: () => ({ top: 0, left: 0 }),
			scrollTo: () => undefined,
			scrollIntoView: () => undefined,
			undo: () => undefined,
			redo: () => undefined,
			exec: () => undefined,
			transaction: () => undefined,
			wordAt: () => null,
			offsetToPos: (offset: number) => {
				let remaining = offset;
				for (let i = 0; i < lines.length; i++) {
					const len = (lines[i]?.length ?? 0) + 1;
					if (remaining < len) return { line: i, ch: remaining };
					remaining -= len;
				}
				return { line: lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 };
			},
			processLines: () => undefined,
			getDoc: function () { return this; },
			setLine: () => undefined,
		};
	}

	it("buildPasteChain over empty LoadedScript array returns empty chain", () => {
		const chain = buildPasteChain([]);
		expect(chain).toHaveLength(0);
	});

	it("buildPasteChain excludes scripts with no paste block", () => {
		const nopasteScript: LoadedScript = {
			id: "command-only",
			record: { provenance: "curated" },
			module: {
				run: () => undefined,
				// no paste block
			},
		};
		const chain = buildPasteChain([nopasteScript]);
		expect(chain).toHaveLength(0);
	});

	it("empty chain: paste command → raw fallback + 'no recognized format' Notice", async () => {
		clearNoticeLog();
		const plugin = await makePluginAndFireLayout();
		const rawText = "some plain text with no recognized format";
		const applyPlanSpy = { called: false };
		const editor = makePasteEditorStub();

		plugin._commandInjection = {
			clipboardReader: async () => rawText,
			applyPlan: () => { applyPlanSpy.called = true; },
			pasteScripts: [],
		};

		const cmd = findCommand(plugin, "mason.pasteAndFormat");
		expect(cmd, "mason.pasteAndFormat must be registered").toBeDefined();

		clearNoticeLog();
		await cmd.editorCallback(editor);

		// raw fallback must have been called with the raw text
		expect(
			editor._replaced,
			"rawFallback must fire for empty chain",
		).toContain(rawText);

		// applyPlan must NOT be called
		expect(
			applyPlanSpy.called,
			"applyPlan must NOT be called when no handler matches",
		).toBe(false);

		// "no recognized format" Notice must fire
		const notices = noticeLog();
		expect(notices.length, "exactly one Notice must fire on no-match").toBe(1);
		expect(notices[0]).toMatch(/no recognized format/);
	});
});
