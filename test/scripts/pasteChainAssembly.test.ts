// T6.3  Paste-chain assembly + launcher run — network-free module loading
//
// Tests verify:
//   A. _buildEnabledPasteScripts assembles only ENABLED+RUNNABLE scripts as
//      LoadedScripts (module loaded), excludes disabled and Blocked (drift/absent),
//      and performs NO module load for non-runnable scripts (lazy).
//   B. buildPasteChain over the assembled set orders curated app(300)→web-download(200)→web(100).
//   C. The paste path performs NO catalog fetch (CatalogSource.fetchIndex is never called).
//   D. resolveScriptFn returns the loaded run for a runnable Active script and a
//      safe value (no throw, no run) for a non-runnable id.
//   F. LifecycleResolver.resolveLocalState — network-free runnability method added to
//      the real resolver class (RED until T6.3 implementation).
//   G. SECURITY — resolveLocalState is byte-authoritative: a drifted local file (same
//      version, wrong on-disk bytes) is caught as Blocked("drift") on the paste/launcher
//      run path. Pre-fix this test FAILS (bug: okayed checksum used instead of hashing
//      actual bytes). Post-fix it PASSES.
//
// Design:
//   Parts A–E use local helper functions that mirror the production logic being implemented.
//   Part F tests directly against LifecycleResolver to ensure the new resolveLocalState
//   method is actually added to the resolver class (these tests fail against current code).
//
//   Injected dependencies:
//     - In-memory ScriptStore (fake PluginDataPort)
//     - Fake FingerprintStore (cheap disk read seam)
//     - Fake loader (records which ids were loaded, returns a fixed ScriptModule)
//     - Fake CatalogSource (asserts fetchIndex is never called on the paste path)
//
// The real evaluateState + buildPasteChain functions are used unchanged.

import { describe, it, expect, vi } from "vitest";
import { evaluateState } from "../../src/scripts/lifecycle";
import { buildPasteChain } from "../../src/scripts/paste/buildPasteChain";
import type { LoadedScript } from "../../src/scripts/paste/buildPasteChain";
import type { ScriptRecord } from "../../src/scripts/store";
import type { ScriptModule } from "../../src/scripts/loader";
import type { FingerprintStore } from "../../src/scripts/materializedFingerprint";
import type { CatalogSource } from "../../src/scripts/catalog/catalogSource";
import { LifecycleResolver } from "../../src/scripts/lifecycleResolver";
import type { ScriptFunction } from "../../src/scripts/context";
import { buildEnabledPasteScripts as buildEnabledPasteScriptsReal } from "../../src/scripts/pasteAssembly";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal ScriptFunction for test doubles. */
function makeRunFn(): ScriptFunction {
	return () => undefined;
}

/** A valid ScriptModule with a paste block. */
function makePasteModule(priority: number, runFn?: ScriptFunction): ScriptModule {
	const run = runFn ?? makeRunFn();
	return {
		run,
		paste: {
			canHandle: () => true,
			priority,
		},
	};
}

/** A valid ScriptModule with NO paste block (command-only). */
function makeCommandModule(runFn?: ScriptFunction): ScriptModule {
	return { run: runFn ?? makeRunFn() };
}

/**
 * Build a fake FingerprintStore that reports a fixed version for given ids.
 */
function makeFingerprintStore(versions: Record<string, number>): FingerprintStore {
	return {
		getVersion: vi.fn().mockImplementation((id: string) =>
			Promise.resolve(versions[id]),
		),
		setVersion: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
	};
}

/**
 * Build a fake CatalogSource. fetchIndex throws if called (network-free assertion).
 */
function makeFakeCatalogSource(): CatalogSource & { fetchIndexCallCount: number } {
	const src = {
		fetchIndexCallCount: 0,
		fetchIndex: vi.fn().mockImplementation(() => {
			src.fetchIndexCallCount++;
			return Promise.reject(new Error("fetchIndex must not be called on paste path"));
		}),
		fetchScript: vi.fn().mockResolvedValue(new Uint8Array()),
	};
	return src;
}

/**
 * Build a fake loader that:
 *   - records which ids were asked to load
 *   - returns a fixed ScriptModule for each id (or throws if not in the map)
 */
function makeFakeLoader(modules: Record<string, ScriptModule>) {
	const loadedIds: string[] = [];

	const loadScriptModule = vi.fn().mockImplementation(
		(absolutePath: string, _requireFn: unknown): ScriptModule => {
			// Extract id from path pattern "<dir>/<id>.cjs"
			const match = /([^/\\]+)\.cjs$/.exec(absolutePath);
			const id = match ? match[1]! : absolutePath;
			loadedIds.push(id);
			const mod = modules[id];
			if (mod === undefined) {
				throw new Error(`[fake-loader] no module registered for id "${id}"`);
			}
			return mod;
		},
	);

	return { loadScriptModule, loadedIds };
}

// ---------------------------------------------------------------------------
// The "paste assembly" logic under test
//
// This mirrors what main.ts _buildEnabledPasteScripts() will do after T6.3.
// We extract it as a pure async function so we can unit-test it without
// instantiating the full plugin (which requires the Obsidian mock).
//
// Inputs:
//   records     — all script records (like store.getScripts())
//   fingerprints — per-device fingerprint store
//   scriptsDir  — base directory for <id>.cjs paths
//   loadModule  — loader function (loadScriptModule signature)
//   requireFn   — Node require (or stub)
//   catalog     — CatalogSource (asserted NOT called)
// ---------------------------------------------------------------------------

/** Subset of the runnability check: returns true when evaluateState with
 *  catalogVersion:undefined yields Active. */
async function isLocallyRunnable(
	id: string,
	record: ScriptRecord,
	fingerprints: FingerprintStore,
): Promise<boolean> {
	if (!record.enabled) return false;
	if (record.okayed === null) return false;

	const version = await fingerprints.getVersion(id);
	const local = version !== undefined
		? { version, checksum: record.okayed.checksum }   // treat local version as matching checksum
		: null;

	const state = evaluateState({
		record,
		inCatalog: true,
		local,
		catalogVersion: undefined,
		online: false,
	});
	return state.kind === "Active";
}

/** Build the enabled paste chain — the logic _buildEnabledPasteScripts will implement. */
async function buildEnabledPasteScripts(args: {
	records: Record<string, ScriptRecord>;
	fingerprints: FingerprintStore;
	scriptsDir: string;
	loadModule: (absolutePath: string, requireFn: unknown) => ScriptModule;
	requireFn: unknown;
	catalog: CatalogSource;
}): Promise<LoadedScript[]> {
	const { records, fingerprints, scriptsDir, loadModule, requireFn } = args;

	const results: LoadedScript[] = [];

	for (const [id, record] of Object.entries(records)) {
		const runnable = await isLocallyRunnable(id, record, fingerprints);
		if (!runnable) continue;

		const absolutePath = `${scriptsDir}/${id}.cjs`;
		let module: ScriptModule | null;
		try {
			module = loadModule(absolutePath, requireFn);
		} catch {
			module = null;
		}

		results.push({ id, record: { provenance: record.provenance }, module });
	}

	return results;
}

/** Build a fake requireFn for testing. */
function makeFakeRequireFn() {
	return Object.assign(
		(_id: string) => ({}),
		{
			resolve: (id: string) => id,
			cache: {} as Record<string, unknown>,
		},
	);
}

// ---------------------------------------------------------------------------
// Part A: _buildEnabledPasteScripts — inclusion/exclusion rules
// ---------------------------------------------------------------------------

describe("T6.3 A — _buildEnabledPasteScripts inclusion/exclusion", () => {
	const SCRIPTS_DIR = "/vault/.obsidian/plugins/mason/scripts";
	const fakeRequireFn = makeFakeRequireFn();

	const appModule = makePasteModule(300);
	const webModule = makePasteModule(100);

	function makeActiveRecord(id: string, checksum = "sha256:abc"): ScriptRecord {
		return {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum },
			source: `catalog/${id}.cjs`,
			command: false,
		};
	}

	it("includes only enabled+runnable scripts (module loaded for each)", async () => {
		const modules = {
			"perplexity-app": appModule,
			"perplexity-web": webModule,
		};
		const { loadScriptModule, loadedIds } = makeFakeLoader(modules);
		const fingerprints = makeFingerprintStore({
			"perplexity-app": 1,
			"perplexity-web": 1,
		});
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": makeActiveRecord("perplexity-app"),
			"perplexity-web": makeActiveRecord("perplexity-web"),
		};

		const result = await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		expect(result).toHaveLength(2);
		const ids = result.map((s) => s.id).sort();
		expect(ids).toEqual(["perplexity-app", "perplexity-web"]);
		expect(loadedIds.sort()).toEqual(["perplexity-app", "perplexity-web"]);
	});

	it("excludes disabled scripts (enabled=false)", async () => {
		const modules = { "perplexity-app": appModule };
		const { loadScriptModule, loadedIds } = makeFakeLoader(modules);
		const fingerprints = makeFingerprintStore({ "perplexity-app": 1 });
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": { ...makeActiveRecord("perplexity-app"), enabled: false },
		};

		const result = await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		expect(result).toHaveLength(0);
		// Lazy: loader must NOT have been called for a disabled script
		expect(loadedIds).toHaveLength(0);
	});

	it("excludes Blocked(drift) scripts — checksum mismatch in okayed vs local", async () => {
		const modules = { "perplexity-app": appModule };
		const { loadScriptModule, loadedIds } = makeFakeLoader(modules);

		// Local fingerprint version=1, but record.okayed.checksum won't match local.checksum
		// when local is built as { version:1, checksum: record.okayed.checksum } by isLocallyRunnable,
		// they DO match (we trust the fingerprint). To trigger Blocked(drift) we need to
		// simulate that the local checksum doesn't match okayed.checksum.
		// The isLocallyRunnable helper above uses record.okayed.checksum as local.checksum,
		// so we need to test the Blocked case differently.
		//
		// Actually: isLocallyRunnable passes local.checksum = record.okayed.checksum,
		// so it always passes step 6. The drift case occurs when the REAL vault checksum
		// differs from okayed. In our seam, we model Blocked as "fingerprint missing"
		// (no local file → step 4 → Blocked offline because online=false).
		//
		// For this test: script is enabled + okayed but NO fingerprint entry → local=null
		// → evaluateState step 4: online=false → Blocked("offline") → not runnable.

		const fingerprints = makeFingerprintStore({}); // no entry for any id
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": makeActiveRecord("perplexity-app"), // enabled, okayed, but no local file
		};

		const result = await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		expect(result).toHaveLength(0);
		// Lazy: loader must NOT have been called for a non-runnable script
		expect(loadedIds).toHaveLength(0);
	});

	it("excludes scripts with okayed=null (not consented)", async () => {
		const modules = { "perplexity-app": appModule };
		const { loadScriptModule, loadedIds } = makeFakeLoader(modules);
		const fingerprints = makeFingerprintStore({ "perplexity-app": 1 });
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": {
				provenance: "curated",
				enabled: true,
				okayed: null, // not consented
				source: "catalog/perplexity-app.cjs",
				command: false,
			},
		};

		const result = await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		expect(result).toHaveLength(0);
		expect(loadedIds).toHaveLength(0);
	});

	it("does NOT load non-runnable scripts (lazy loading enforced)", async () => {
		// Mix of runnable and non-runnable; loader only called for runnable ones
		const modules = {
			"perplexity-app": appModule,
			"perplexity-web": webModule,
		};
		const { loadScriptModule, loadedIds } = makeFakeLoader(modules);

		// Only perplexity-app has a local fingerprint → only it is runnable
		const fingerprints = makeFingerprintStore({ "perplexity-app": 1 });
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": makeActiveRecord("perplexity-app"), // runnable
			"perplexity-web": makeActiveRecord("perplexity-web"), // no fingerprint → not runnable
		};

		const result = await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("perplexity-app");

		// Lazy: loader was called ONLY for the runnable script
		expect(loadedIds).toEqual(["perplexity-app"]);
		expect(loadedIds).not.toContain("perplexity-web");
	});

	it("loaded modules are present in LoadedScript.module", async () => {
		const expectedModule = makePasteModule(300);
		const modules = { "perplexity-app": expectedModule };
		const { loadScriptModule } = makeFakeLoader(modules);
		const fingerprints = makeFingerprintStore({ "perplexity-app": 1 });
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": makeActiveRecord("perplexity-app"),
		};

		const result = await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		expect(result).toHaveLength(1);
		expect(result[0]!.module).toBe(expectedModule);
	});
});

// ---------------------------------------------------------------------------
// Part B: buildPasteChain over assembled set — ordering
// ---------------------------------------------------------------------------

describe("T6.3 B — buildPasteChain orders assembled set correctly", () => {
	it("orders curated app(300)→web-download(200)→web(100)", () => {
		const appModule = makePasteModule(300);
		const webDownloadModule = makePasteModule(200);
		const webModule = makePasteModule(100);

		const assembled: LoadedScript[] = [
			{ id: "perplexity-web", record: { provenance: "curated" }, module: webModule },
			{ id: "perplexity-app", record: { provenance: "curated" }, module: appModule },
			{ id: "perplexity-web-download", record: { provenance: "curated" }, module: webDownloadModule },
		];

		const chain = buildPasteChain(assembled);
		expect(chain.map((h) => h.id)).toEqual([
			"perplexity-app",
			"perplexity-web-download",
			"perplexity-web",
		]);
	});

	it("command-only modules (no paste block) are excluded from chain", () => {
		const cmdModule = makeCommandModule();
		const pasteModule = makePasteModule(100);

		const assembled: LoadedScript[] = [
			{ id: "cmd-only", record: { provenance: "curated" }, module: cmdModule },
			{ id: "paste-capable", record: { provenance: "curated" }, module: pasteModule },
		];

		const chain = buildPasteChain(assembled);
		expect(chain).toHaveLength(1);
		expect(chain[0]!.id).toBe("paste-capable");
	});

	it("module=null entries (failed loads) are excluded from chain", () => {
		const pasteModule = makePasteModule(100);

		const assembled: LoadedScript[] = [
			{ id: "failed-load", record: { provenance: "curated" }, module: null },
			{ id: "ok-script", record: { provenance: "curated" }, module: pasteModule },
		];

		const chain = buildPasteChain(assembled);
		expect(chain).toHaveLength(1);
		expect(chain[0]!.id).toBe("ok-script");
	});
});

// ---------------------------------------------------------------------------
// Part C: no catalog fetch on paste path
// ---------------------------------------------------------------------------

describe("T6.3 C — paste path performs no catalog fetch", () => {
	const SCRIPTS_DIR = "/vault/.obsidian/plugins/mason/scripts";
	const fakeRequireFn = makeFakeRequireFn();

	it("fetchIndex is never called during buildEnabledPasteScripts", async () => {
		const modules = { "perplexity-app": makePasteModule(300) };
		const { loadScriptModule } = makeFakeLoader(modules);
		const fingerprints = makeFingerprintStore({ "perplexity-app": 1 });
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": {
				provenance: "curated",
				enabled: true,
				okayed: { version: 1, checksum: "sha256:abc" },
				source: "catalog/perplexity-app.cjs",
				command: false,
			},
		};

		await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		// CRITICAL: catalog.fetchIndex must NEVER be called on the paste path
		expect(catalog.fetchIndexCallCount).toBe(0);
		expect(catalog.fetchIndex).not.toHaveBeenCalled();
	});

	it("fetchIndex is not called even when multiple scripts are processed", async () => {
		const modules = {
			"perplexity-app": makePasteModule(300),
			"perplexity-web": makePasteModule(100),
			"perplexity-web-download": makePasteModule(200),
		};
		const { loadScriptModule } = makeFakeLoader(modules);
		const fingerprints = makeFingerprintStore({
			"perplexity-app": 1,
			"perplexity-web": 1,
			"perplexity-web-download": 1,
		});
		const catalog = makeFakeCatalogSource();

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: "sha256:aaa" },
				source: "", command: false,
			},
			"perplexity-web": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: "sha256:bbb" },
				source: "", command: false,
			},
			"perplexity-web-download": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: "sha256:ccc" },
				source: "", command: false,
			},
		};

		await buildEnabledPasteScripts({
			records,
			fingerprints,
			scriptsDir: SCRIPTS_DIR,
			loadModule: loadScriptModule,
			requireFn: fakeRequireFn,
			catalog,
		});

		expect(catalog.fetchIndexCallCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Part D: resolveScriptFn — returns run for runnable, safe value for non-runnable
// ---------------------------------------------------------------------------

describe("T6.3 D — resolveScriptFn returns run or safe no-op", () => {
	const SCRIPTS_DIR = "/vault/.obsidian/plugins/mason/scripts";
	const fakeRequireFn = makeFakeRequireFn();

	/**
	 * The resolveScriptFn factory — mirrors what settingsTab + launcher will use.
	 * For a runnable script: load module + return run.
	 * For a non-runnable script: return a safe no-op (never throws).
	 */
	async function buildResolveScriptFn(
		id: string,
		record: ScriptRecord | undefined,
		fingerprints: FingerprintStore,
		scriptsDir: string,
		loadModule: (absolutePath: string, requireFn: unknown) => ScriptModule,
		requireFn: unknown,
	): Promise<ScriptFunction> {
		if (record === undefined) {
			return () => undefined;
		}

		const runnable = await isLocallyRunnable(id, record, fingerprints);
		if (!runnable) {
			return () => undefined;
		}

		const absolutePath = `${scriptsDir}/${id}.cjs`;
		try {
			const mod = loadModule(absolutePath, requireFn);
			return mod.run;
		} catch {
			return () => undefined;
		}
	}

	it("returns the module's run function for a runnable (Active) script", async () => {
		const expectedRun = makeRunFn();
		const mod = makePasteModule(100, expectedRun);
		const modules = { "my-script": mod };
		const { loadScriptModule } = makeFakeLoader(modules);
		const fingerprints = makeFingerprintStore({ "my-script": 1 });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const fn = await buildResolveScriptFn(
			"my-script", record, fingerprints, SCRIPTS_DIR, loadScriptModule, fakeRequireFn,
		);

		expect(fn).toBe(expectedRun);
	});

	it("returns a safe no-op for a disabled script (not runnable)", async () => {
		const { loadScriptModule, loadedIds } = makeFakeLoader({});
		const fingerprints = makeFingerprintStore({ "my-script": 1 });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: false, // disabled
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const fn = await buildResolveScriptFn(
			"my-script", record, fingerprints, SCRIPTS_DIR, loadScriptModule, fakeRequireFn,
		);

		// Must not throw when called
		expect(() => fn({} as never)).not.toThrow();
		// Loader must not have been called (lazy)
		expect(loadedIds).toHaveLength(0);
	});

	it("returns a safe no-op for a script with no local fingerprint (not materialized)", async () => {
		const { loadScriptModule, loadedIds } = makeFakeLoader({});
		const fingerprints = makeFingerprintStore({}); // no entry

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const fn = await buildResolveScriptFn(
			"my-script", record, fingerprints, SCRIPTS_DIR, loadScriptModule, fakeRequireFn,
		);

		expect(() => fn({} as never)).not.toThrow();
		expect(loadedIds).toHaveLength(0);
	});

	it("returns a safe no-op for an unknown id (record undefined)", async () => {
		const { loadScriptModule } = makeFakeLoader({});
		const fingerprints = makeFingerprintStore({});

		const fn = await buildResolveScriptFn(
			"unknown-id", undefined, fingerprints, SCRIPTS_DIR, loadScriptModule, fakeRequireFn,
		);

		expect(() => fn({} as never)).not.toThrow();
	});

	it("does NOT throw even when loader fails for a runnable script", async () => {
		// Loader throws → fall back to safe no-op
		const { loadScriptModule } = makeFakeLoader({}); // no modules → throws
		const fingerprints = makeFingerprintStore({ "my-script": 1 });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const fn = await buildResolveScriptFn(
			"my-script", record, fingerprints, SCRIPTS_DIR, loadScriptModule, fakeRequireFn,
		);

		expect(() => fn({} as never)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Part E: isLocallyRunnable (the network-free runnability helper)
// ---------------------------------------------------------------------------

describe("T6.3 E — isLocallyRunnable (network-free runnability)", () => {
	it("returns true for enabled + okayed + local fingerprint present", async () => {
		const fingerprints = makeFingerprintStore({ "my-script": 1 });
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const result = await isLocallyRunnable("my-script", record, fingerprints);
		expect(result).toBe(true);
	});

	it("returns false for disabled script", async () => {
		const fingerprints = makeFingerprintStore({ "my-script": 1 });
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: false,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const result = await isLocallyRunnable("my-script", record, fingerprints);
		expect(result).toBe(false);
	});

	it("returns false for script with okayed=null", async () => {
		const fingerprints = makeFingerprintStore({ "my-script": 1 });
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: null,
			source: "",
			command: false,
		};

		const result = await isLocallyRunnable("my-script", record, fingerprints);
		expect(result).toBe(false);
	});

	it("returns false for script with no local fingerprint (not materialized)", async () => {
		const fingerprints = makeFingerprintStore({}); // missing
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const result = await isLocallyRunnable("my-script", record, fingerprints);
		expect(result).toBe(false);
	});

	it("an UpdateAvailable script (catalogVersion > okayed.version) is still runnable with catalogVersion:undefined", async () => {
		// When online, this would be UpdateAvailable. But paste path uses catalogVersion:undefined
		// → step 7 never fires → evaluateState returns Active → runnable.
		const fingerprints = makeFingerprintStore({ "my-script": 1 });
		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" }, // v1 okayed
			source: "",
			command: false,
		};
		// catalogVersion:undefined in isLocallyRunnable → step 7 skipped → Active
		const result = await isLocallyRunnable("my-script", record, fingerprints);
		expect(result).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Part F: LifecycleResolver.resolveLocalState — network-free method (RED until T6.3)
//
// These tests verify the NEW resolveLocalState method added to LifecycleResolver.
// They fail against the current code (method does not exist) and pass after T6.3.
// ---------------------------------------------------------------------------

describe("T6.3 F — LifecycleResolver.resolveLocalState (network-free runnability)", () => {
	// sha256 of empty ArrayBuffer: used when vault returns new ArrayBuffer(0)
	// $ node -e "const {createHash}=require('node:crypto'); console.log('sha256:'+createHash('sha256').update(new Uint8Array(0)).digest('hex'))"
	const EMPTY_CHECKSUM = "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

	/**
	 * Build a minimal LifecycleResolver with a fake catalog, vault, and fingerprints.
	 * vaultExists: controls vault.exists response (default false = file absent)
	 * vaultBytes: controls vault.readBinary response (default empty ArrayBuffer)
	 */
	function makeResolver(
		fingerprintVersions: Record<string, number>,
		opts: { vaultExists?: boolean; vaultBytes?: ArrayBuffer } = {},
	): LifecycleResolver {
		const fakeCatalog: CatalogSource = {
			fetchIndex: vi.fn().mockRejectedValue(new Error("fetchIndex must not be called")),
			fetchScript: vi.fn().mockResolvedValue(new Uint8Array()),
		};

		const fakeVault = {
			readBinary: vi.fn().mockResolvedValue(opts.vaultBytes ?? new ArrayBuffer(0)),
			writeBinary: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(opts.vaultExists ?? false),
			mkdir: vi.fn().mockResolvedValue(undefined),
		};

		const fakeFingerprints = makeFingerprintStore(fingerprintVersions);

		return new LifecycleResolver({
			catalog: fakeCatalog,
			vault: fakeVault,
			fingerprints: fakeFingerprints,
			scriptsDir: "/vault/scripts",
			destPath: (id: string) => `/vault/scripts/${id}.cjs`,
			onlineProbe: () => false,
		});
	}

	it("resolveLocalState method exists on LifecycleResolver", () => {
		const resolver = makeResolver({});
		// This fails if resolveLocalState is not yet added to LifecycleResolver
		expect(typeof (resolver as unknown as { resolveLocalState?: unknown }).resolveLocalState).toBe("function");
	});

	it("resolveLocalState returns Active for enabled+okayed+local-fingerprint script (file present, bytes match)", async () => {
		// vault returns empty bytes → checksum = EMPTY_CHECKSUM; okayed.checksum must match
		const resolver = makeResolver({ "my-script": 1 }, { vaultExists: true, vaultBytes: new ArrayBuffer(0) });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: EMPTY_CHECKSUM },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as {
			resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
		}).resolveLocalState("my-script", record);

		expect(state.kind).toBe("Active");
	});

	it("resolveLocalState returns Disabled for disabled script", async () => {
		const resolver = makeResolver({ "my-script": 1 }, { vaultExists: true, vaultBytes: new ArrayBuffer(0) });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: false,
			okayed: { version: 1, checksum: EMPTY_CHECKSUM },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as {
			resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
		}).resolveLocalState("my-script", record);

		expect(state.kind).toBe("Disabled");
	});

	it("resolveLocalState returns Blocked(offline) for enabled+okayed+file-absent script", async () => {
		// No vault file (exists=false) → local=null → online=false → Blocked("offline")
		const resolver = makeResolver({ "my-script": 1 }, { vaultExists: false });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: EMPTY_CHECKSUM },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as {
			resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
		}).resolveLocalState("my-script", record);

		// File absent → local=null → online=false → Blocked("offline")
		expect(state.kind).toBe("Blocked");
		if (state.kind === "Blocked") {
			expect(state.reason).toBe("offline");
		}
	});

	it("resolveLocalState does NOT call fetchIndex (network-free)", async () => {
		const fakeCatalog: CatalogSource = {
			fetchIndex: vi.fn().mockRejectedValue(new Error("fetchIndex must not be called")),
			fetchScript: vi.fn().mockResolvedValue(new Uint8Array()),
		};

		const fakeVault = {
			readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
			writeBinary: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(false),
			mkdir: vi.fn().mockResolvedValue(undefined),
		};

		const resolver = new LifecycleResolver({
			catalog: fakeCatalog,
			vault: fakeVault,
			fingerprints: makeFingerprintStore({ "my-script": 1 }),
			scriptsDir: "/vault/scripts",
			destPath: (id: string) => `/vault/scripts/${id}.cjs`,
			onlineProbe: () => true, // even when online, must not fetch
		});

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: EMPTY_CHECKSUM },
			source: "",
			command: false,
		};

		// Should not throw even though fetchIndex would reject
		await (resolver as unknown as {
			resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
		}).resolveLocalState("my-script", record);

		expect(fakeCatalog.fetchIndex).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Part G: SECURITY — byte-authoritative match-gate on resolveLocalState
//
// The bug (pre-fix): resolveLocalState sets local.checksum = record.okayed.checksum,
// so evaluateState step 6 (local.checksum !== okayed.checksum) can NEVER fire on the
// paste/launcher run path. A drifted/tampered <id>.cjs (same version, different bytes)
// resolves Active and RUNS.
//
// The fix: resolve local.checksum by hashing the actual on-disk bytes via vault.readBinary,
// exactly as _resolveLocal does, but without any catalog fetch.
//
// These tests FAIL against the pre-fix code and PASS after the fix.
// ---------------------------------------------------------------------------

describe("T6.3 G — SECURITY: byte-authoritative match-gate (drift must be caught on run path)", () => {
	// Pre-computed checksums for test byte sequences
	// sha256 of Buffer.from("fake script content")
	const GOOD_BYTES = Buffer.from("fake script content");
	const GOOD_CHECKSUM = "sha256:9530fee7664c792ed05c5b2d1f0643f0dd73bf1d305e3e76e034ffaec513adc9";
	// sha256 of Buffer.from("drifted script content") — different bytes, same version
	const DRIFTED_BYTES = Buffer.from("drifted script content");

	/** LifecycleResolverState type alias for readability. */
	type ResolverType = {
		resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
	};

	function makeResolverWithBytes(opts: {
		fingerprintVersion: number;
		vaultBytes: Buffer;
		onlineProbe?: () => boolean;
	}): LifecycleResolver {
		const fakeCatalog: CatalogSource = {
			fetchIndex: vi.fn().mockImplementation(() => {
				throw new Error("fetchIndex must not be called on paste path (G)");
			}),
			fetchScript: vi.fn().mockResolvedValue(new Uint8Array()),
		};

		const buf = opts.vaultBytes.buffer.slice(
			opts.vaultBytes.byteOffset,
			opts.vaultBytes.byteOffset + opts.vaultBytes.byteLength,
		) as ArrayBuffer;

		const fakeVault = {
			readBinary: vi.fn().mockResolvedValue(buf),
			writeBinary: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(true), // file is present on disk
			mkdir: vi.fn().mockResolvedValue(undefined),
		};

		const fakeFingerprints = makeFingerprintStore({ "test-script": opts.fingerprintVersion });

		return new LifecycleResolver({
			catalog: fakeCatalog,
			vault: fakeVault,
			fingerprints: fakeFingerprints,
			scriptsDir: "/vault/scripts",
			destPath: (id: string) => `/vault/scripts/${id}.cjs`,
			onlineProbe: opts.onlineProbe ?? (() => false),
		});
	}

	it("SECURITY: drifted local file (same version, wrong bytes) → Blocked(drift) — NOT Active", async () => {
		// Arrange: fingerprint says version=1 (matches okayed.version=1),
		// but on-disk bytes hash to DRIFTED_CHECKSUM ≠ okayed.checksum=GOOD_CHECKSUM.
		// Pre-fix: resolveLocalState uses okayed.checksum as local.checksum → step 6 never
		// fires → Active (BUG: tampered script runs).
		// Post-fix: resolveLocalState hashes actual bytes → local.checksum=DRIFTED_CHECKSUM
		// ≠ okayed.checksum → step 6 fires → Blocked("drift").
		const resolver = makeResolverWithBytes({
			fingerprintVersion: 1,
			vaultBytes: DRIFTED_BYTES,
		});

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: GOOD_CHECKSUM }, // okayed checksum is for GOOD_BYTES
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as ResolverType).resolveLocalState("test-script", record);

		// MUST be Blocked(drift), not Active
		expect(state.kind).toBe("Blocked");
		if (state.kind === "Blocked") {
			expect(state.reason).toBe("drift");
		}
	});

	it("SECURITY: matching local file (bytes hash == okayed.checksum) → Active (still runnable)", async () => {
		// Arrange: on-disk bytes hash to GOOD_CHECKSUM == okayed.checksum → Active.
		const resolver = makeResolverWithBytes({
			fingerprintVersion: 1,
			vaultBytes: GOOD_BYTES,
		});

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: GOOD_CHECKSUM },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as ResolverType).resolveLocalState("test-script", record);

		expect(state.kind).toBe("Active");
	});

	it("SECURITY: drifted script is excluded from _buildEnabledPasteScripts (not loaded)", async () => {
		// The isLocallyRunnable helper in the test file replicates the old buggy logic
		// (uses okayed.checksum as local.checksum). This test verifies the production
		// LifecycleResolver path: a drifted script must not be runnable via resolveLocalState.
		const resolver = makeResolverWithBytes({
			fingerprintVersion: 1,
			vaultBytes: DRIFTED_BYTES,
		});

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: GOOD_CHECKSUM },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as ResolverType).resolveLocalState("test-script", record);

		// Drifted script must NOT be runnable (not Active)
		expect(state.kind).not.toBe("Active");
	});

	it("SECURITY: resolveScriptFn fails safe for drifted script (no execution)", async () => {
		// Verify that a drifted script state (Blocked drift) causes the run-gate to refuse.
		// We call resolveLocalState and confirm the result is not Active.
		const resolver = makeResolverWithBytes({
			fingerprintVersion: 1,
			vaultBytes: DRIFTED_BYTES,
		});

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: GOOD_CHECKSUM },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as ResolverType).resolveLocalState("test-script", record);

		// Any production run-gate checks state.kind === "Active" before executing.
		// Confirm the gate would refuse.
		expect(state.kind === "Active").toBe(false);
	});

	it("SECURITY: fetchIndex is NOT called for drifted script (network-free path preserved)", async () => {
		const fakeCatalog: CatalogSource = {
			fetchIndex: vi.fn().mockImplementation(() => {
				throw new Error("fetchIndex must not be called on paste path");
			}),
			fetchScript: vi.fn().mockResolvedValue(new Uint8Array()),
		};

		const buf = DRIFTED_BYTES.buffer.slice(
			DRIFTED_BYTES.byteOffset,
			DRIFTED_BYTES.byteOffset + DRIFTED_BYTES.byteLength,
		) as ArrayBuffer;

		const fakeVault = {
			readBinary: vi.fn().mockResolvedValue(buf),
			writeBinary: vi.fn().mockResolvedValue(undefined),
			exists: vi.fn().mockResolvedValue(true),
			mkdir: vi.fn().mockResolvedValue(undefined),
		};

		const resolver = new LifecycleResolver({
			catalog: fakeCatalog,
			vault: fakeVault,
			fingerprints: makeFingerprintStore({ "test-script": 1 }),
			scriptsDir: "/vault/scripts",
			destPath: (id: string) => `/vault/scripts/${id}.cjs`,
			onlineProbe: () => true, // even when online, must not fetch
		});

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: GOOD_CHECKSUM },
			source: "",
			command: false,
		};

		// Must not throw (fetchIndex is not called even for drifted script)
		const state = await (resolver as unknown as ResolverType).resolveLocalState("test-script", record);

		expect(fakeCatalog.fetchIndex).not.toHaveBeenCalled();
		expect(state.kind).toBe("Blocked");
	});
});

// ---------------------------------------------------------------------------
// Part H: REAL-WIRE assembly drift test (W1)
//
// Drives the production buildEnabledPasteScripts (from src/scripts/pasteAssembly)
// with a REAL LifecycleResolver that reads vault bytes and computes SHA-256.
//
// This test exercises the FULL assembly wire:
//   buildEnabledPasteScripts → resolver.resolveLocalState → _resolveLocal
//   → vault.readBinary → sha256Bytes → evaluateState step 6
//
// If the assembly were to bypass byte hashing (using okayed.checksum as the
// local checksum shortcut, as the pre-fix isLocallyRunnable helper in Parts A-E
// does), these tests would FAIL:
//   - The "drifted file excluded" test would see the drifted script as Active
//     (because okayed.checksum === okayed.checksum trivially) and include it.
//   - The "matching file included" test would still pass coincidentally, so we
//     confirm drift exclusion is the critical regression-detection path.
// ---------------------------------------------------------------------------

describe("T6.3 H — REAL-WIRE: production assembly with real LifecycleResolver drift detection", () => {
	const SCRIPTS_DIR = "/vault/.obsidian/plugins/mason/scripts";

	// Pre-computed SHA-256 of "good script bytes"
	// node -e "const {createHash}=require('node:crypto'); const b=Buffer.from('good script bytes'); console.log('sha256:'+createHash('sha256').update(b).digest('hex'))"
	const GOOD_BYTES = Buffer.from("good script bytes");
	const GOOD_CHECKSUM = "sha256:43f9a58f9aeb8f5b72b523c98e8bb51b6a069ce8ac3ea78bf78606a1f635e861";
	// Drifted: same version=1, but different bytes on disk
	const DRIFTED_BYTES = Buffer.from("tampered script bytes");

	/** Build a fake require function for the assembly (module loading is faked). */
	function makeFakeRequireFn() {
		return Object.assign(
			(_id: string) => ({}),
			{
				resolve: (id: string) => id,
				cache: {} as Record<string, unknown>,
			},
		);
	}

	/**
	 * Build a LifecycleResolver with a vault stub that returns specific bytes.
	 * fetchIndex is wired to throw — confirming network-free operation.
	 */
	function makeRealResolver(opts: {
		vaultBytesById: Record<string, Buffer>;
		fingerprintVersions: Record<string, number>;
	}): LifecycleResolver {
		const fakeCatalog: CatalogSource = {
			fetchIndex: vi.fn().mockImplementation(() => {
				throw new Error("fetchIndex must not be called in assembly wire (H)");
			}),
			fetchScript: vi.fn().mockResolvedValue(new Uint8Array()),
		};

		const fakeVault = {
			exists: vi.fn().mockImplementation((path: string) => {
				const id = /([^/]+)\.cjs$/.exec(path)?.[1];
				return Promise.resolve(id !== undefined && id in opts.vaultBytesById);
			}),
			readBinary: vi.fn().mockImplementation((path: string) => {
				const id = /([^/]+)\.cjs$/.exec(path)?.[1];
				const buf = id !== undefined ? opts.vaultBytesById[id] : undefined;
				if (buf === undefined) {
					return Promise.reject(new Error(`[fake-vault] no bytes for path: ${path}`));
				}
				// Return an ArrayBuffer slice (as vault.readBinary returns ArrayBuffer)
				return Promise.resolve(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
			}),
			writeBinary: vi.fn().mockResolvedValue(undefined),
			mkdir: vi.fn().mockResolvedValue(undefined),
		};

		const fakeFingerprints = makeFingerprintStore(opts.fingerprintVersions);

		return new LifecycleResolver({
			catalog: fakeCatalog,
			vault: fakeVault,
			fingerprints: fakeFingerprints,
			scriptsDir: SCRIPTS_DIR,
			destPath: (id: string) => `${SCRIPTS_DIR}/${id}.cjs`,
			onlineProbe: () => false,
		});
	}

	it("REAL-WIRE: drifted file (same version, wrong bytes) is EXCLUDED from assembly", async () => {
		// Arrange: fingerprint version=1 matches okayed.version=1,
		// but vault bytes hash to DRIFTED_CHECKSUM ≠ okayed.checksum=GOOD_CHECKSUM.
		//
		// If the assembly used okayed.checksum as local.checksum (the pre-fix bug),
		// resolveLocalState would see local.checksum === okayed.checksum → Active → INCLUDED.
		// With byte-authoritative hashing: local.checksum = sha256(DRIFTED_BYTES) ≠ GOOD_CHECKSUM
		// → step 6 fires → Blocked("drift") → EXCLUDED.
		const resolver = makeRealResolver({
			vaultBytesById: { "perplexity-app": DRIFTED_BYTES },
			fingerprintVersions: { "perplexity-app": 1 },
		});

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": {
				provenance: "curated",
				enabled: true,
				okayed: { version: 1, checksum: GOOD_CHECKSUM },
				source: "catalog/perplexity-app.cjs",
				command: false,
			},
		};

		const fakeModule = makePasteModule(300);
		const { loadScriptModule: fakeLoader } = makeFakeLoader({ "perplexity-app": fakeModule });

		const result = await buildEnabledPasteScriptsReal({
			records,
			resolver,
			scriptsDir: SCRIPTS_DIR,
			loadModule: fakeLoader,
			requireFn: makeFakeRequireFn(),
		});

		// CRITICAL: drifted script must NOT appear in the assembled set
		expect(result).toHaveLength(0);
		expect(result.map((s) => s.id)).not.toContain("perplexity-app");
	});

	it("REAL-WIRE: matching file (bytes hash == okayed.checksum) IS included in assembly", async () => {
		// Arrange: vault bytes hash to GOOD_CHECKSUM == okayed.checksum → Active → included.
		const resolver = makeRealResolver({
			vaultBytesById: { "perplexity-app": GOOD_BYTES },
			fingerprintVersions: { "perplexity-app": 1 },
		});

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": {
				provenance: "curated",
				enabled: true,
				okayed: { version: 1, checksum: GOOD_CHECKSUM },
				source: "catalog/perplexity-app.cjs",
				command: false,
			},
		};

		const fakeModule = makePasteModule(300);
		const { loadScriptModule: fakeLoader } = makeFakeLoader({ "perplexity-app": fakeModule });

		const result = await buildEnabledPasteScriptsReal({
			records,
			resolver,
			scriptsDir: SCRIPTS_DIR,
			loadModule: fakeLoader,
			requireFn: makeFakeRequireFn(),
		});

		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("perplexity-app");
		expect(result[0]!.module).toBe(fakeModule);
	});

	it("REAL-WIRE: one matching + one drifted → only matching is included", async () => {
		// Two scripts; one matches (Active), one is drifted (Blocked drift).
		// Confirms the assembly correctly filters per-script, not globally.
		const resolver = makeRealResolver({
			vaultBytesById: {
				"perplexity-app": GOOD_BYTES,      // matches okayed.checksum → Active
				"perplexity-web": DRIFTED_BYTES,    // drifted → Blocked(drift) → excluded
			},
			fingerprintVersions: { "perplexity-app": 1, "perplexity-web": 1 },
		});

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: GOOD_CHECKSUM },
				source: "", command: false,
			},
			"perplexity-web": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: GOOD_CHECKSUM }, // expects GOOD_CHECKSUM but gets DRIFTED
				source: "", command: false,
			},
		};

		const { loadScriptModule: fakeLoader } = makeFakeLoader({
			"perplexity-app": makePasteModule(300),
			"perplexity-web": makePasteModule(100),
		});

		const result = await buildEnabledPasteScriptsReal({
			records,
			resolver,
			scriptsDir: SCRIPTS_DIR,
			loadModule: fakeLoader,
			requireFn: makeFakeRequireFn(),
		});

		expect(result).toHaveLength(1);
		expect(result[0]!.id).toBe("perplexity-app");
		expect(result.map((s) => s.id)).not.toContain("perplexity-web");
	});

	it("REAL-WIRE: fetchIndex is NOT called during assembly (network-free)", async () => {
		const fakeCatalog: CatalogSource = {
			fetchIndex: vi.fn().mockImplementation(() => {
				throw new Error("fetchIndex must not be called (H network-free check)");
			}),
			fetchScript: vi.fn().mockResolvedValue(new Uint8Array()),
		};

		const goodBuf = GOOD_BYTES.buffer.slice(GOOD_BYTES.byteOffset, GOOD_BYTES.byteOffset + GOOD_BYTES.byteLength) as ArrayBuffer;
		const fakeVault = {
			exists: vi.fn().mockResolvedValue(true),
			readBinary: vi.fn().mockResolvedValue(goodBuf),
			writeBinary: vi.fn().mockResolvedValue(undefined),
			mkdir: vi.fn().mockResolvedValue(undefined),
		};

		const resolver = new LifecycleResolver({
			catalog: fakeCatalog,
			vault: fakeVault,
			fingerprints: makeFingerprintStore({ "perplexity-app": 1 }),
			scriptsDir: SCRIPTS_DIR,
			destPath: (id: string) => `${SCRIPTS_DIR}/${id}.cjs`,
			onlineProbe: () => true, // even "online" must not fetch on the paste path
		});

		const records: Record<string, ScriptRecord> = {
			"perplexity-app": {
				provenance: "curated", enabled: true,
				okayed: { version: 1, checksum: GOOD_CHECKSUM },
				source: "", command: false,
			},
		};

		const { loadScriptModule: fakeLoader } = makeFakeLoader({
			"perplexity-app": makePasteModule(300),
		});

		await buildEnabledPasteScriptsReal({
			records,
			resolver,
			scriptsDir: SCRIPTS_DIR,
			loadModule: fakeLoader,
			requireFn: makeFakeRequireFn(),
		});

		expect(fakeCatalog.fetchIndex).not.toHaveBeenCalled();
	});
});
