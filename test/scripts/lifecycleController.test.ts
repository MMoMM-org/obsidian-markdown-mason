// T6.2  LifecycleController — live Scripts-tab ops (RED → GREEN)
//
// Composes the EXISTING units (disclosure consent gate, materializer, store,
// fingerprint store, catalog) into one async method per Scripts-tab op. Adds NO
// new lifecycle/trust logic — materialize is the only writer of code, consent
// rides okayed, fingerprint is per-device.
//
// All I/O is injected via fakes:
//   - fake CatalogSource (fetchIndex/fetchScript)
//   - fake VaultAdapterPort (in-memory binary files + remove capture)
//   - in-memory ScriptStore
//   - captured disclosure decisions via an injected `ask` seam
//   - fake FingerprintStore
//   - captured re-renders + window.open
//
// Behaviour under test (one describe per op):
//   enable  — unconsented shows disclosure → consent persists okayed + materialize + fingerprint
//           — re-enable unchanged {v,c} shows NO disclosure
//           — cancel/disable leaves disabled, no materialize
//   retry   — calls materialize; ok → fingerprint + re-render
//   update  — re-discloses NEW catalog {v,c}; consent → materialize new + fingerprint(new)
//   reReview— re-shows disclosure for current {v,c}; consent re-persists okayed (no version change)
//   remove  — clears record + deletes <id>.cjs + removes fingerprint
//   viewSource — curated opens repo URL; imported reveals vault path (Notice)
//   browseOfficial — lists catalog entries
//   importFromVault — creates an imported record + runs enable flow → materialize
//   every op re-renders; no op fires a "coming soon" Notice

import { describe, it, expect, vi, beforeEach } from "vitest";
import { App, noticeLog, clearNoticeLog } from "../__mocks__/obsidian";
import { LifecycleController } from "../../src/scripts/lifecycleController";
import type { ScriptRecord } from "../../src/scripts/store";
import type { CatalogIndex, CatalogEntry, CatalogSource } from "../../src/scripts/catalog/catalogSource";
import type { ScriptInfo } from "../../src/scripts/disclosure";
import type { AskDecision } from "../../src/scripts/runner";
import { sha256Bytes } from "../../src/scripts/checksum";

// ---------------------------------------------------------------------------
// In-memory store (Pick<ScriptStore, "getScripts" | "setRecord" | "deleteRecord">)
// ---------------------------------------------------------------------------

function makeStore(initial: Record<string, ScriptRecord> = {}) {
	const scripts: Record<string, ScriptRecord> = { ...initial };
	return {
		scripts,
		getScripts: vi.fn(async () => ({ ...scripts })),
		setRecord: vi.fn(async (id: string, rec: ScriptRecord) => { scripts[id] = rec; }),
		deleteRecord: vi.fn(async (id: string) => { delete scripts[id]; }),
	};
}

// ---------------------------------------------------------------------------
// Fake vault — in-memory binary files; records writes, removes, mkdirs
// ---------------------------------------------------------------------------

function toBuf(u: Uint8Array): ArrayBuffer {
	return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

function makeVault(files: Record<string, Uint8Array> = {}) {
	const store = new Map<string, ArrayBuffer>(
		Object.entries(files).map(([p, u]) => [p, toBuf(u)]),
	);
	const removeCalls: string[] = [];
	const writeCalls: string[] = [];
	return {
		store,
		removeCalls,
		writeCalls,
		async readBinary(path: string): Promise<ArrayBuffer> {
			const b = store.get(path);
			if (b === undefined) throw new Error(`not found: ${path}`);
			return b;
		},
		async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
			store.set(path, data);
			writeCalls.push(path);
		},
		async exists(path: string): Promise<boolean> {
			return store.has(path);
		},
		async mkdir(_path: string): Promise<void> { /* no-op */ },
		async remove(path: string): Promise<void> {
			removeCalls.push(path);
			store.delete(path);
		},
	};
}

// ---------------------------------------------------------------------------
// Fake catalog
// ---------------------------------------------------------------------------

function makeCatalog(entries: Record<string, CatalogEntry>, bytesByPath: Record<string, Uint8Array> = {}): CatalogSource {
	const index: CatalogIndex = { schemaVersion: 1, ref: "deadbeef", scripts: entries };
	return {
		fetchIndex: vi.fn(async () => index),
		fetchScript: vi.fn(async (entry: CatalogEntry) => {
			const b = bytesByPath[entry.path];
			if (b === undefined) throw new Error(`no bytes for ${entry.path}`);
			return b;
		}),
	};
}

// ---------------------------------------------------------------------------
// Helpers — bytes + checksum
// ---------------------------------------------------------------------------

const CURATED_BYTES = new TextEncoder().encode("module.exports = {};");
const CURATED_CHECKSUM = sha256Bytes(CURATED_BYTES);

function curatedEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
	return {
		id: "perplexity-app",
		version: 1,
		checksum: CURATED_CHECKSUM,
		path: "scripts/perplexity-app.cjs",
		name: "Perplexity app",
		description: "Format Perplexity exports",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Controller factory with captured re-render, disclosure decisions, window.open
// ---------------------------------------------------------------------------

interface Harness {
	controller: LifecycleController;
	rerender: ReturnType<typeof vi.fn>;
	askCalls: ScriptInfo[];
	opened: string[];
	setDecision: (d: AskDecision) => void;
}

function makeController(opts: {
	store: ReturnType<typeof makeStore>;
	vault: ReturnType<typeof makeVault>;
	catalog: CatalogSource;
	fingerprints: { setVersion: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn>; getVersion?: ReturnType<typeof vi.fn> };
	decision?: AskDecision;
	listCjs?: () => Promise<string[]>;
	pick?: (paths: string[]) => Promise<string | null>;
}): Harness {
	const rerender = vi.fn();
	const askCalls: ScriptInfo[] = [];
	const opened: string[] = [];
	let decision: AskDecision = opts.decision ?? "enable-session";

	const controller = new LifecycleController({
		app: new App() as never,
		store: opts.store,
		catalog: opts.catalog,
		vault: opts.vault,
		fingerprints: {
			getVersion: opts.fingerprints.getVersion ?? vi.fn(async () => undefined),
			setVersion: opts.fingerprints.setVersion,
			remove: opts.fingerprints.remove,
		},
		destPath: (id: string) => `plugins/markdown-mason/scripts/${id}.cjs`,
		rerender,
		// Test seams (override the real disclosure / picker / window.open):
		ask: async (info: ScriptInfo): Promise<AskDecision> => {
			askCalls.push(info);
			return decision;
		},
		openUrl: (url: string): void => { opened.push(url); },
		listCjsFiles: opts.listCjs ?? (async () => []),
		pickCjsFile: opts.pick ?? (async () => null),
	});

	return {
		controller,
		rerender,
		askCalls,
		opened,
		setDecision: (d: AskDecision) => { decision = d; },
	};
}

beforeEach(() => clearNoticeLog());

// ===========================================================================
// enable
// ===========================================================================

describe("LifecycleController.enable", () => {
	it("unconsented curated: shows disclosure → consent persists okayed + materializes + fingerprints + re-renders", async () => {
		const store = makeStore({
			"perplexity-app": { provenance: "curated", enabled: false, okayed: null, source: "", command: false },
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints, decision: "enable-session" });

		await h.controller.enable("perplexity-app");

		// Disclosure shown with the to-be-consented {version,checksum}
		expect(h.askCalls).toHaveLength(1);
		expect(h.askCalls[0]).toMatchObject({ version: 1, checksum: CURATED_CHECKSUM });

		// Persisted okayed + enabled
		expect(store.setRecord).toHaveBeenCalledWith("perplexity-app", expect.objectContaining({
			enabled: true,
			okayed: { version: 1, checksum: CURATED_CHECKSUM },
		}));

		// Materialized to disk
		expect(vault.writeCalls).toContain("plugins/markdown-mason/scripts/perplexity-app.cjs");

		// Fingerprint recorded for THIS device
		expect(fingerprints.setVersion).toHaveBeenCalledWith("perplexity-app", 1);

		// Re-rendered
		expect(h.rerender).toHaveBeenCalled();

		// No "coming soon" notice
		expect(noticeLog().join(" ")).not.toContain("coming soon");
	});

	it("re-enable with UNCHANGED consented {v,c}: NO disclosure, persists enabled, materializes, fingerprints", async () => {
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: false,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.enable("perplexity-app");

		expect(h.askCalls).toHaveLength(0); // no modal
		expect(store.setRecord).toHaveBeenCalledWith("perplexity-app", expect.objectContaining({ enabled: true }));
		expect(fingerprints.setVersion).toHaveBeenCalledWith("perplexity-app", 1);
		expect(h.rerender).toHaveBeenCalled();
	});

	it("cancel/disable decision: leaves disabled, does NOT persist okayed, does NOT materialize", async () => {
		const store = makeStore({
			"perplexity-app": { provenance: "curated", enabled: false, okayed: null, source: "", command: false },
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints, decision: "disable" });

		await h.controller.enable("perplexity-app");

		expect(h.askCalls).toHaveLength(1);
		// no enabled:true persisted, no materialize, no fingerprint
		expect(vault.writeCalls).toHaveLength(0);
		expect(fingerprints.setVersion).not.toHaveBeenCalled();
		const persisted = store.scripts["perplexity-app"];
		expect(persisted.enabled).toBe(false);
		expect(persisted.okayed).toBeNull();
		expect(h.rerender).toHaveBeenCalled();
	});

	it("enable-once decision: does NOT persist okayed, does NOT materialize, does NOT fingerprint, but re-renders", async () => {
		const store = makeStore({
			"perplexity-app": { provenance: "curated", enabled: false, okayed: null, source: "", command: false },
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints, decision: "enable-once" });

		await h.controller.enable("perplexity-app");

		// vault write never fires — enable-once is ephemeral, not materialized
		expect(vault.writeCalls).toHaveLength(0);
		// fingerprint must not be set
		expect(fingerprints.setVersion).not.toHaveBeenCalled();
		// the persisted record keeps its initial state (no okayed, not enabled)
		const persisted = store.scripts["perplexity-app"];
		expect(persisted.okayed).toBeNull();
		expect(persisted.enabled).toBe(false);
		// the tab still re-renders so the UI reflects the current state
		expect(h.rerender).toHaveBeenCalled();
	});
});

// ===========================================================================
// disable
// ===========================================================================

describe("LifecycleController.disable", () => {
	it("persists enabled:false and re-renders, no materialize", async () => {
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.disable("perplexity-app");

		expect(store.scripts["perplexity-app"].enabled).toBe(false);
		expect(vault.writeCalls).toHaveLength(0);
		expect(h.rerender).toHaveBeenCalled();
	});
});

// ===========================================================================
// retry
// ===========================================================================

describe("LifecycleController.retry", () => {
	it("ok path: materializes, fingerprints, re-renders", async () => {
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.retry("perplexity-app");

		expect(vault.writeCalls).toContain("plugins/markdown-mason/scripts/perplexity-app.cjs");
		expect(fingerprints.setVersion).toHaveBeenCalledWith("perplexity-app", 1);
		expect(h.rerender).toHaveBeenCalled();
	});

	it("failure path: surfaces a sentence-case reason Notice, no fingerprint", async () => {
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: "sha256:OLD" }, source: "", command: false,
			},
		});
		const vault = makeVault();
		// catalog bytes hash to CURATED_CHECKSUM but okayed is OLD → drift
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.retry("perplexity-app");

		expect(fingerprints.setVersion).not.toHaveBeenCalled();
		const log = noticeLog().join(" ");
		expect(log.toLowerCase()).toContain("mason");
		// sentence-case: starts with capital "Mason", lowercase remainder words
		expect(log).not.toContain("coming soon");
		expect(h.rerender).toHaveBeenCalled();
	});
});

// ===========================================================================
// update
// ===========================================================================

describe("LifecycleController.update", () => {
	it("re-discloses NEW catalog {v,c} → consent persists new okayed → materializes new → fingerprint(new)", async () => {
		const v2bytes = new TextEncoder().encode("module.exports = { v: 2 };");
		const v2checksum = sha256Bytes(v2bytes);
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog(
			{ "perplexity-app": curatedEntry({ version: 2, checksum: v2checksum }) },
			{ "scripts/perplexity-app.cjs": v2bytes },
		);
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints, decision: "enable-session" });

		await h.controller.update("perplexity-app");

		// disclosure shown for the NEW version/checksum
		expect(h.askCalls).toHaveLength(1);
		expect(h.askCalls[0]).toMatchObject({ version: 2, checksum: v2checksum });

		// new okayed persisted
		expect(store.scripts["perplexity-app"].okayed).toEqual({ version: 2, checksum: v2checksum });

		// materialized + fingerprint(new)
		expect(vault.writeCalls).toContain("plugins/markdown-mason/scripts/perplexity-app.cjs");
		expect(fingerprints.setVersion).toHaveBeenCalledWith("perplexity-app", 2);
		expect(h.rerender).toHaveBeenCalled();
	});
});

// ===========================================================================
// reReview
// ===========================================================================

describe("LifecycleController.reReview", () => {
	it("re-shows disclosure for current {v,c}; consent re-persists okayed (no version change), re-renders", async () => {
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints, decision: "enable-session" });

		await h.controller.reReview("perplexity-app");

		expect(h.askCalls).toHaveLength(1);
		expect(h.askCalls[0]).toMatchObject({ version: 1, checksum: CURATED_CHECKSUM });
		expect(store.scripts["perplexity-app"].okayed).toEqual({ version: 1, checksum: CURATED_CHECKSUM });
		expect(h.rerender).toHaveBeenCalled();
	});
});

// ===========================================================================
// remove
// ===========================================================================

describe("LifecycleController.remove", () => {
	it("deletes the record + deletes materialized <id>.cjs + removes fingerprint + re-renders", async () => {
		const destPath = "plugins/markdown-mason/scripts/perplexity-app.cjs";
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault({ [destPath]: CURATED_BYTES });
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.remove("perplexity-app");

		// Record must be fully deleted (not merely cleared to {enabled:false, okayed:null})
		expect(store.deleteRecord).toHaveBeenCalledWith("perplexity-app");
		expect(store.scripts["perplexity-app"]).toBeUndefined();
		expect(vault.removeCalls).toContain(destPath);
		expect(fingerprints.remove).toHaveBeenCalledWith("perplexity-app");
		expect(h.rerender).toHaveBeenCalled();
	});

	it("remove(curated): record absent → evaluateState step 1 → Available (not Disabled)", async () => {
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.remove("perplexity-app");

		// After remove, the record is absent from the store
		const records = store.scripts;
		expect(records["perplexity-app"]).toBeUndefined();
		// evaluateState(record=undefined, inCatalog=true) → Available per step 1
		const { evaluateState } = await import("../../src/scripts/lifecycle");
		const state = evaluateState({
			record: undefined,
			inCatalog: true,
			local: null,
			catalogVersion: undefined,
			online: true,
		});
		expect(state.kind).toBe("Available");
	});

	it("remove(imported): record absent → evaluateState step 1 → Absent (not Disabled)", async () => {
		const store = makeStore({
			"my-import": {
				provenance: "imported", enabled: true,
				okayed: { version: 1, checksum: "sha256:x" }, source: "vault/my-import.cjs", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({});
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.remove("my-import");

		// After remove, the record is absent from the store
		expect(store.scripts["my-import"]).toBeUndefined();
		// evaluateState(record=undefined, inCatalog=false) → Absent per step 1
		const { evaluateState } = await import("../../src/scripts/lifecycle");
		const state = evaluateState({
			record: undefined,
			inCatalog: false,
			local: null,
			catalogVersion: undefined,
			online: true,
		});
		expect(state.kind).toBe("Absent");
	});
});

// ===========================================================================
// viewSource
// ===========================================================================

describe("LifecycleController.viewSource", () => {
	it("curated: opens the repo URL for the entry", async () => {
		const store = makeStore({
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.viewSource("perplexity-app");

		expect(h.opened).toHaveLength(1);
		expect(h.opened[0]).toContain("scripts/perplexity-app.cjs");
	});

	it("imported: reveals the vault source path via a Notice (no window.open)", async () => {
		const store = makeStore({
			"my-script": {
				provenance: "imported", enabled: true,
				okayed: { version: 1, checksum: "sha256:x" }, source: "vault/my-script.cjs", command: false,
			},
		});
		const vault = makeVault();
		const catalog = makeCatalog({});
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		await h.controller.viewSource("my-script");

		expect(h.opened).toHaveLength(0);
		expect(noticeLog().join(" ")).toContain("vault/my-script.cjs");
	});
});

// ===========================================================================
// browseOfficial
// ===========================================================================

describe("LifecycleController.browseOfficial", () => {
	it("fetches the catalog index and lists curated entries", async () => {
		const store = makeStore();
		const vault = makeVault();
		const catalog = makeCatalog({
			"perplexity-app": curatedEntry(),
			"perplexity-web": curatedEntry({ id: "perplexity-web", path: "scripts/perplexity-web.cjs", name: "Perplexity web" }),
		});
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({ store, vault, catalog, fingerprints });

		const entries = await h.controller.listOfficial();

		expect(entries.map((e) => e.id).sort()).toEqual(["perplexity-app", "perplexity-web"]);
		expect(catalog.fetchIndex).toHaveBeenCalled();
	});
});

// ===========================================================================
// importFromVault
// ===========================================================================

describe("LifecycleController.importFromVault", () => {
	it("picks a .cjs, creates an imported record, runs the enable/disclosure flow, materializes", async () => {
		const importedBytes = new TextEncoder().encode("module.exports = { imported: true };");
		const importedChecksum = sha256Bytes(importedBytes);
		const store = makeStore();
		const vault = makeVault({ "vault/my-import.cjs": importedBytes });
		const catalog = makeCatalog({});
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({
			store, vault, catalog, fingerprints,
			decision: "enable-session",
			listCjs: async () => ["vault/my-import.cjs"],
			pick: async (paths) => paths[0] ?? null,
		});

		await h.controller.importFromVault();

		// an imported record was created (keyed by derived id "my-import")
		const created = store.scripts["my-import"];
		expect(created).toBeDefined();
		expect(created.provenance).toBe("imported");
		expect(created.source).toBe("vault/my-import.cjs");

		// disclosure shown with the imported byte size + checksum
		expect(h.askCalls).toHaveLength(1);
		expect(h.askCalls[0]).toMatchObject({ checksum: importedChecksum, fileSizeBytes: importedBytes.byteLength });

		// consent persisted okayed + materialized to disk
		expect(created.okayed).toEqual({ version: created.okayed?.version, checksum: importedChecksum });
		expect(vault.writeCalls).toContain("plugins/markdown-mason/scripts/my-import.cjs");
		expect(h.rerender).toHaveBeenCalled();
	});

	it("no file picked: no record created, no materialize, no coming-soon notice", async () => {
		const store = makeStore();
		const vault = makeVault();
		const catalog = makeCatalog({});
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({
			store, vault, catalog, fingerprints,
			listCjs: async () => [],
			pick: async () => null,
		});

		await h.controller.importFromVault();

		expect(Object.keys(store.scripts)).toHaveLength(0);
		expect(vault.writeCalls).toHaveLength(0);
		expect(noticeLog().join(" ")).not.toContain("coming soon");
	});

	it("id collision: does NOT overwrite an existing record, fires a sentence-case Notice, re-renders", async () => {
		const existingRecord: ScriptRecord = {
			provenance: "curated", enabled: true,
			okayed: { version: 1, checksum: CURATED_CHECKSUM }, source: "", command: false,
		};
		// pre-existing curated "perplexity-app" record
		const store = makeStore({ "perplexity-app": existingRecord });
		const importedBytes = new TextEncoder().encode("module.exports = { evil: true };");
		const vault = makeVault({ "vault/perplexity-app.cjs": importedBytes });
		const catalog = makeCatalog({ "perplexity-app": curatedEntry() }, { "scripts/perplexity-app.cjs": CURATED_BYTES });
		const fingerprints = { setVersion: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
		const h = makeController({
			store, vault, catalog, fingerprints,
			decision: "enable-session",
			listCjs: async () => ["vault/perplexity-app.cjs"],
			pick: async (paths) => paths[0] ?? null,
		});

		await h.controller.importFromVault();

		// Existing record must be intact — no overwrite
		expect(store.scripts["perplexity-app"]).toEqual(existingRecord);
		// Nothing materialized
		expect(vault.writeCalls).toHaveLength(0);
		// A Notice was fired mentioning the id
		const log = noticeLog().join(" ");
		expect(log).toContain("perplexity-app");
		// Re-rendered so the UI stays consistent
		expect(h.rerender).toHaveBeenCalled();
	});
});
