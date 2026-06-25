// T6.1  LifecycleResolver — live state resolver (RED → GREEN)
//
// Tests the LifecycleResolver which wires CatalogSource + VaultAdapterPort +
// MaterializedFingerprintStore + ScriptStore into a real EvaluateStateInput
// per script and delegates to evaluateState().
//
// Key transitions asserted:
//   Active           — local matches okayed (version + checksum)
//   UpdateAvailable  — curated, catalogVersion > okayed.version
//   Blocked(drift)   — manifest version === okayed.version but checksum mismatch
//   Blocked(offline) — enabled+okayed, local absent, fetch failed / offline
//   Materializing    — enabled+okayed, local absent, online
//   Disabled         — record.enabled false
//   Available        — curated, okayed null
//
// Key design properties verified:
//   - fetch failure (throws) → online=false → Blocked(offline) for enabled+okayed+absent
//   - drift uses manifest version + recomputed checksum (not a stored checksum)
//   - fingerprint store path is the per-device scripts dir, separate from data.json
//   - index is fetched ONCE per resolve pass and cached across multiple resolveInput calls

import { describe, it, expect, vi } from "vitest";
import type { CatalogSource, CatalogIndex } from "../../src/scripts/catalog/catalogSource";
import type { VaultAdapterPort } from "../../src/scripts/runtime";
import type { ScriptRecord } from "../../src/scripts/store";
import { sha256Bytes } from "../../src/scripts/checksum";

// ---------------------------------------------------------------------------
// Dynamic imports — modules under test (written after RED phase)
// ---------------------------------------------------------------------------

const { LifecycleResolver } = await import("../../src/scripts/lifecycleResolver");
const { MaterializedFingerprintStore } = await import("../../src/scripts/materializedFingerprint");

// ---------------------------------------------------------------------------
// Helper: compute a real checksum from bytes (reuse production code)
// ---------------------------------------------------------------------------

function checksumOf(bytes: Uint8Array): string {
	return sha256Bytes(bytes);
}

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const SCRIPTS_DIR = ".obsidian/plugins/markdown-mason/scripts";
const MANIFEST_PATH = `${SCRIPTS_DIR}/.materialized.json`;

function makeRecord(overrides: Partial<ScriptRecord> = {}): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:aabbcc" },
		source: "curated/scripts/my-script",
		command: false,
		...overrides,
	};
}

/** Build a fake catalog index with one or more script entries. */
function makeCatalogIndex(scripts: Record<string, { version: number; checksum: string }>): CatalogIndex {
	return {
		schemaVersion: 1,
		ref: "abc123",
		scripts: Object.fromEntries(
			Object.entries(scripts).map(([id, s]) => [
				id,
				{
					id,
					version: s.version,
					checksum: s.checksum,
					path: `scripts/${id}.cjs`,
					name: id,
					description: "",
				},
			]),
		),
	};
}

/** Build a fake CatalogSource from a controlled index (or a throw). */
function makeCatalogSource(
	behavior: { throwOnFetch: true } | { index: CatalogIndex },
): CatalogSource {
	return {
		fetchIndex: "throwOnFetch" in behavior
			? vi.fn().mockRejectedValue(new Error("network error"))
			: vi.fn().mockResolvedValue(behavior.index),
		fetchScript: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
	};
}

/** Build a fake VaultAdapterPort backed by an in-memory map. */
function makeFakeVault(files: Map<string, Uint8Array> = new Map()): Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir"> {
	const store = new Map<string, Uint8Array>(files);
	return {
		exists: vi.fn(async (path: string) => store.has(path)),
		readBinary: vi.fn(async (path: string): Promise<ArrayBuffer> => {
			const bytes = store.get(path);
			if (bytes === undefined) throw new Error(`Not found: ${path}`);
			// Slice to get a plain ArrayBuffer (not a subarray view of a larger buffer)
			return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		}),
		writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
			store.set(path, new Uint8Array(data));
		}),
		mkdir: vi.fn(async () => {}),
	};
}

/** Build a LifecycleResolver with all dependencies injected. */
function makeResolver(opts: {
	catalog: CatalogSource;
	scriptFiles?: Map<string, Uint8Array>;
	fingerprintManifest?: Record<string, number>;
	onlineProbe?: () => boolean;
}) {
	// Merge script files with optional fingerprint manifest
	const files = new Map<string, Uint8Array>(opts.scriptFiles ?? []);
	if (opts.fingerprintManifest && Object.keys(opts.fingerprintManifest).length > 0) {
		files.set(MANIFEST_PATH, new TextEncoder().encode(JSON.stringify(opts.fingerprintManifest)));
	}
	const vault = makeFakeVault(files);
	const fingerprintStore = new MaterializedFingerprintStore(vault, MANIFEST_PATH);

	return new LifecycleResolver({
		catalog: opts.catalog,
		vault,
		fingerprints: fingerprintStore,
		scriptsDir: SCRIPTS_DIR,
		destPath: (id: string) => `${SCRIPTS_DIR}/${id}.cjs`,
		onlineProbe: opts.onlineProbe ?? (() => true),
	});
}

// ---------------------------------------------------------------------------
// State: Disabled
// ---------------------------------------------------------------------------

describe("LifecycleResolver — Disabled", () => {
	it("returns Disabled when record.enabled is false", async () => {
		const record = makeRecord({ enabled: false });
		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum: "sha256:aabbcc" } }) });
		const resolver = makeResolver({ catalog });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Disabled" });
	});
});

// ---------------------------------------------------------------------------
// State: Available (okayed null + curated)
// ---------------------------------------------------------------------------

describe("LifecycleResolver — Available", () => {
	it("returns Available for curated script with okayed null", async () => {
		const record = makeRecord({ okayed: null });
		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum: "sha256:aabbcc" } }) });
		const resolver = makeResolver({ catalog });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Available" });
	});

	it("returns Available when offline but provenance=curated and okayed=null", async () => {
		const record = makeRecord({ okayed: null });
		const catalog = makeCatalogSource({ throwOnFetch: true });
		const resolver = makeResolver({ catalog });
		// When offline + fetch throws, inCatalog falls back to record.provenance==="curated"
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Available" });
	});
});

// ---------------------------------------------------------------------------
// State: Materializing (enabled+okayed, local absent, online)
// ---------------------------------------------------------------------------

describe("LifecycleResolver — Materializing", () => {
	it("returns Materializing when enabled+okayed, local absent, catalog fetched ok", async () => {
		const record = makeRecord();
		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum: "sha256:aabbcc" } }) });
		// No script file in vault → local=null
		const resolver = makeResolver({ catalog });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Materializing" });
	});
});

// ---------------------------------------------------------------------------
// State: Blocked(offline) — fetch failure is authoritative for online
// ---------------------------------------------------------------------------

describe("LifecycleResolver — Blocked(offline)", () => {
	it("returns Blocked(offline) when enabled+okayed, local absent, fetchIndex throws", async () => {
		const record = makeRecord();
		// fetchIndex throws → treat as offline regardless of onlineProbe
		const catalog = makeCatalogSource({ throwOnFetch: true });
		const resolver = makeResolver({ catalog, onlineProbe: () => true });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Blocked", reason: "offline" });
	});

	it("returns Blocked(offline) even when onlineProbe returns true but fetch fails", async () => {
		// fetch failure is the authoritative online signal — navigator.onLine is unreliable
		const record = makeRecord();
		const catalog = makeCatalogSource({ throwOnFetch: true });
		const resolver = makeResolver({ catalog, onlineProbe: () => true });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Blocked", reason: "offline" });
	});

	it("returns Blocked(offline) when onlineProbe returns false (skip fetch)", async () => {
		const record = makeRecord();
		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum: "sha256:aabbcc" } }) });
		// No script file → local=null. onlineProbe=false → skip fetch, offline
		const resolver = makeResolver({ catalog, onlineProbe: () => false });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Blocked", reason: "offline" });
	});
});

// ---------------------------------------------------------------------------
// State: Active — local matches okayed
// ---------------------------------------------------------------------------

describe("LifecycleResolver — Active", () => {
	it("returns Active when local file exists with matching version+checksum", async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const checksum = checksumOf(bytes);
		const record = makeRecord({ okayed: { version: 1, checksum } });

		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		const scriptFiles = new Map([[scriptPath, bytes]]);
		const fingerprintManifest = { "my-script": 1 };

		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum } }) });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Active" });
	});
});

// ---------------------------------------------------------------------------
// State: Blocked(drift) — manifest version matches but checksum differs
// ---------------------------------------------------------------------------

describe("LifecycleResolver — Blocked(drift)", () => {
	it("returns Blocked(drift) when manifest version=okayed.version but recomputed checksum differs", async () => {
		// Script file has different bytes than what was okayed
		const okayedBytes = new Uint8Array([1, 2, 3]);
		const actualBytes = new Uint8Array([99, 98, 97]); // different content
		const okayedChecksum = checksumOf(okayedBytes);
		// actualChecksum !== okayedChecksum → drift

		const record = makeRecord({ okayed: { version: 1, checksum: okayedChecksum } });
		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		const scriptFiles = new Map([[scriptPath, actualBytes]]);
		// Manifest records version=1 (matches okayed.version) but file has wrong bytes
		const fingerprintManifest = { "my-script": 1 };

		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum: okayedChecksum } }) });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Blocked", reason: "drift" });
	});

	it("drift uses recomputed checksum from file bytes, not any stored checksum", async () => {
		// Prove drift detection is byte-level, not based on stored checksum fields
		const recordChecksum = "sha256:aabbcc";
		const actualBytes = new Uint8Array([55, 66, 77]); // arbitrary bytes, not matching recordChecksum
		const record = makeRecord({ okayed: { version: 2, checksum: recordChecksum } });
		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		const scriptFiles = new Map([[scriptPath, actualBytes]]);
		const fingerprintManifest = { "my-script": 2 }; // version matches

		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 2, checksum: recordChecksum } }) });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });
		const state = await resolver.getState("my-script", record);
		// Recomputed hash of actualBytes !== recordChecksum → drift
		expect(state).toEqual({ kind: "Blocked", reason: "drift" });
	});
});

// ---------------------------------------------------------------------------
// State: UpdateAvailable — curated, catalogVersion > okayed.version
// ---------------------------------------------------------------------------

describe("LifecycleResolver — UpdateAvailable", () => {
	it("returns UpdateAvailable when curated, catalogVersion > okayed.version, local matches", async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const checksum = checksumOf(bytes);
		const record = makeRecord({ okayed: { version: 1, checksum } });

		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		const scriptFiles = new Map([[scriptPath, bytes]]);
		const fingerprintManifest = { "my-script": 1 };

		// Catalog has version 2 (newer)
		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 2, checksum } }) });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "UpdateAvailable" });
	});
});

// ---------------------------------------------------------------------------
// Missing manifest version fallback
// ---------------------------------------------------------------------------

describe("LifecycleResolver — missing manifest version fallback", () => {
	it("treats file-present-but-no-manifest-entry as okayed.version for version comparison", async () => {
		// File exists but no manifest entry → fallback: version = okayed.version
		// so version matches and only checksum determines Active vs drift
		const bytes = new Uint8Array([10, 20, 30]);
		const checksum = checksumOf(bytes);
		const record = makeRecord({ okayed: { version: 1, checksum } });

		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		const scriptFiles = new Map([[scriptPath, bytes]]);
		// No fingerprint manifest entry

		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum } }) });
		const resolver = makeResolver({ catalog, scriptFiles }); // no fingerprintManifest
		const state = await resolver.getState("my-script", record);
		// version assumed = okayed.version (1), checksum matches → Active
		expect(state).toEqual({ kind: "Active" });
	});

	it("uses manifest version when present, overriding fallback", async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const checksum = checksumOf(bytes);
		const record = makeRecord({ okayed: { version: 2, checksum } });

		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		const scriptFiles = new Map([[scriptPath, bytes]]);
		// Manifest says version 1, but okayed.version is 2 → Materializing (stale)
		const fingerprintManifest = { "my-script": 1 };

		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 2, checksum } }) });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });
		const state = await resolver.getState("my-script", record);
		// local.version(1) !== okayed.version(2) → Materializing
		expect(state).toEqual({ kind: "Materializing" });
	});
});

// ---------------------------------------------------------------------------
// Catalog fetch is cached — fetchIndex called once per resolve pass
// ---------------------------------------------------------------------------

describe("LifecycleResolver — catalog caching", () => {
	it("fetches the catalog index only ONCE even when resolving multiple scripts", async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const checksum = checksumOf(bytes);
		const records: Record<string, ScriptRecord> = {
			"script-a": makeRecord({ okayed: { version: 1, checksum } }),
			"script-b": makeRecord({ okayed: { version: 1, checksum } }),
		};
		const scriptFiles = new Map([
			[`${SCRIPTS_DIR}/script-a.cjs`, bytes],
			[`${SCRIPTS_DIR}/script-b.cjs`, bytes],
		]);
		const fingerprintManifest = { "script-a": 1, "script-b": 1 };
		const index = makeCatalogIndex({
			"script-a": { version: 1, checksum },
			"script-b": { version: 1, checksum },
		});
		const catalog = makeCatalogSource({ index });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });

		await resolver.resolveItems(records);

		// fetchIndex must be called exactly once — the resolver caches it
		expect(catalog.fetchIndex).toHaveBeenCalledOnce();
	});

	it("resolveItems returns a ScriptItem per record with the correct state", async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const checksum = checksumOf(bytes);
		const records: Record<string, ScriptRecord> = {
			"active-script": makeRecord({ okayed: { version: 1, checksum } }),
			"disabled-script": makeRecord({ enabled: false }),
		};
		const scriptFiles = new Map([
			[`${SCRIPTS_DIR}/active-script.cjs`, bytes],
		]);
		const fingerprintManifest = { "active-script": 1 };
		const index = makeCatalogIndex({
			"active-script": { version: 1, checksum },
		});
		const catalog = makeCatalogSource({ index });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });

		const items = await resolver.resolveItems(records);
		expect(items).toHaveLength(2);

		const activeItem = items.find((i) => i.id === "active-script");
		const disabledItem = items.find((i) => i.id === "disabled-script");
		expect(activeItem?.state).toEqual({ kind: "Active" });
		expect(disabledItem?.state).toEqual({ kind: "Disabled" });
	});
});

// ---------------------------------------------------------------------------
// inCatalog offline fallback
// ---------------------------------------------------------------------------

describe("LifecycleResolver — inCatalog offline fallback", () => {
	it("falls back to record.provenance=curated for inCatalog when offline (fetch fails)", async () => {
		// When offline, inCatalog = record.provenance === "curated" (can't know actual catalog)
		const record = makeRecord({ okayed: null, provenance: "curated" });
		const catalog = makeCatalogSource({ throwOnFetch: true });
		const resolver = makeResolver({ catalog });
		// curated + okayed null → Available (inCatalog fallback to provenance)
		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Available" });
	});

	it("falls back to inCatalog=false for imported provenance when offline", async () => {
		// imported + offline + no record → Absent (not in catalog)
		const catalog = makeCatalogSource({ throwOnFetch: true });
		const resolver = makeResolver({ catalog });
		// No record (undefined) + offline → inCatalog fallback to provenance=imported → false
		const state = await resolver.getState("imported-script", undefined as unknown as ScriptRecord);
		expect(state).toEqual({ kind: "Absent" });
	});
});

// ---------------------------------------------------------------------------
// Binary I/O: ArrayBuffer → Uint8Array normalization
// ---------------------------------------------------------------------------

describe("LifecycleResolver — binary I/O normalization", () => {
	it("hashes ArrayBuffer correctly (not just Uint8Array views)", async () => {
		// vault.readBinary returns ArrayBuffer; resolver must normalize to Uint8Array before hashing
		const bytes = new Uint8Array([1, 2, 3, 4, 5]);
		const checksum = checksumOf(bytes);
		const record = makeRecord({ okayed: { version: 1, checksum } });

		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		// Build vault that returns an ArrayBuffer (not the Uint8Array directly)
		const files = new Map([[scriptPath, bytes]]);
		const vault = makeFakeVault(files);
		const fingerprintStore = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		// Prime the fingerprint manifest
		await fingerprintStore.setVersion("my-script", 1);

		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum } }) });
		const resolver = new LifecycleResolver({
			catalog,
			vault,
			fingerprints: fingerprintStore,
			scriptsDir: SCRIPTS_DIR,
			destPath: (id: string) => `${SCRIPTS_DIR}/${id}.cjs`,
			onlineProbe: () => true,
		});

		const state = await resolver.getState("my-script", record);
		expect(state).toEqual({ kind: "Active" });
	});
});

// ---------------------------------------------------------------------------
// resolveInput — returns a fully populated EvaluateStateInput
// ---------------------------------------------------------------------------

describe("LifecycleResolver — resolveInput", () => {
	it("returns an EvaluateStateInput with online=true when fetch succeeds", async () => {
		const record = makeRecord();
		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum: "sha256:aabbcc" } }) });
		const resolver = makeResolver({ catalog });
		const input = await resolver.resolveInput("my-script", record);
		expect(input.online).toBe(true);
	});

	it("returns an EvaluateStateInput with online=false when fetch throws", async () => {
		const record = makeRecord();
		const catalog = makeCatalogSource({ throwOnFetch: true });
		const resolver = makeResolver({ catalog });
		const input = await resolver.resolveInput("my-script", record);
		expect(input.online).toBe(false);
	});

	it("returns local=null when the script file is absent from vault", async () => {
		const record = makeRecord();
		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum: "sha256:aabbcc" } }) });
		const resolver = makeResolver({ catalog });
		const input = await resolver.resolveInput("my-script", record);
		expect(input.local).toBeNull();
	});

	it("returns local with checksum and version when script file exists", async () => {
		const bytes = new Uint8Array([10, 20, 30]);
		const checksum = checksumOf(bytes);
		const record = makeRecord({ okayed: { version: 1, checksum } });
		const scriptPath = `${SCRIPTS_DIR}/my-script.cjs`;
		const scriptFiles = new Map([[scriptPath, bytes]]);
		const fingerprintManifest = { "my-script": 1 };

		const catalog = makeCatalogSource({ index: makeCatalogIndex({ "my-script": { version: 1, checksum } }) });
		const resolver = makeResolver({ catalog, scriptFiles, fingerprintManifest });
		const input = await resolver.resolveInput("my-script", record);
		expect(input.local).not.toBeNull();
		expect(input.local!.checksum).toBe(checksum);
		expect(input.local!.version).toBe(1);
	});
});
