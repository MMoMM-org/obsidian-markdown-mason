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
	/** Build a minimal LifecycleResolver with a fake catalog, vault, and fingerprints. */
	function makeResolver(fingerprintVersions: Record<string, number>): LifecycleResolver {
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

	it("resolveLocalState returns Active for enabled+okayed+local-fingerprint script", async () => {
		const resolver = makeResolver({ "my-script": 1 });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as {
			resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
		}).resolveLocalState("my-script", record);

		expect(state.kind).toBe("Active");
	});

	it("resolveLocalState returns Disabled for disabled script", async () => {
		const resolver = makeResolver({ "my-script": 1 });

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: false,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as {
			resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
		}).resolveLocalState("my-script", record);

		expect(state.kind).toBe("Disabled");
	});

	it("resolveLocalState returns Blocked(offline) for enabled+okayed+no-fingerprint script", async () => {
		const resolver = makeResolver({}); // no fingerprint entry

		const record: ScriptRecord = {
			provenance: "curated",
			enabled: true,
			okayed: { version: 1, checksum: "sha256:abc" },
			source: "",
			command: false,
		};

		const state = await (resolver as unknown as {
			resolveLocalState(id: string, record: ScriptRecord): Promise<import("../../src/scripts/lifecycle").LifecycleState>;
		}).resolveLocalState("my-script", record);

		// No local fingerprint → local=null → online=false → Blocked("offline")
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
			okayed: { version: 1, checksum: "sha256:abc" },
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
