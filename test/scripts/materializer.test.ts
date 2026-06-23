// T2.4  Materializer — cross-device safety core (ADR-11, ADR-14, T7.5 sync-spike)
//
// Tests the match-gate: materialize() NEVER writes to disk unless the fetched/
// copied bytes hash byte-exactly to the identity the user consented to (okayed).
//
// ALL external I/O is injected via fakes — NO network, NO real vault.
// The fake vault records writeBinary calls so every non-ok branch can assert
// fail-closed (writeBinary NOT called).

import { describe, it, expect } from "vitest";
import { materialize } from "../../src/scripts/materializer";
import type { MaterializeDeps, MaterializeResult } from "../../src/scripts/materializer";
import type { ScriptRecord } from "../../src/scripts/store";
import type { CatalogSource, CatalogIndex, CatalogEntry } from "../../src/scripts/catalog/catalogSource";
import { sha256Bytes } from "../../src/scripts/checksum";

// ---------------------------------------------------------------------------
// Fake vault — records writeBinary calls for fail-closed assertions
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
}

function makeFakeVault(opts: {
	existsResult?: boolean;
	readBinaryResult?: Uint8Array | Error;
} = {}): FakeVault {
	// Produce a plain ArrayBuffer by slicing — avoids SharedArrayBuffer type mismatch
	const toArrayBuffer = (u: Uint8Array): ArrayBuffer =>
		u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
	const readBinaryResult: ArrayBuffer | Error =
		opts.readBinaryResult instanceof Error
			? opts.readBinaryResult
			: opts.readBinaryResult instanceof Uint8Array
				? toArrayBuffer(opts.readBinaryResult)
				: toArrayBuffer(new Uint8Array(0));
	const vault: FakeVault = {
		writeCalls: [],
		mkdirCalls: [],
		existsResult: opts.existsResult ?? true,
		readBinaryResult,
		async readBinary(_path: string): Promise<ArrayBuffer> {
			if (readBinaryResult instanceof Error) {
				throw readBinaryResult;
			}
			return readBinaryResult;
		},
		async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
			vault.writeCalls.push({ path, data });
		},
		async exists(_path: string): Promise<boolean> {
			return vault.existsResult;
		},
		async mkdir(path: string): Promise<void> {
			vault.mkdirCalls.push(path);
		},
	};
	return vault;
}

// ---------------------------------------------------------------------------
// Fake CatalogSource factory
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

// ---------------------------------------------------------------------------
// Factory helpers for deps and records
// ---------------------------------------------------------------------------

function makeCuratedRecord(overrides: Partial<ScriptRecord> = {}): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:placeholder" },
		source: "",
		command: false,
		...overrides,
	};
}

function makeImportedRecord(overrides: Partial<ScriptRecord> = {}): ScriptRecord {
	return {
		provenance: "imported",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:placeholder" },
		source: "scripts/my-script.cjs",
		command: false,
		...overrides,
	};
}

function makeCatalogEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
	return {
		id: "test-script",
		version: 1,
		checksum: "sha256:placeholder",
		path: "scripts/test-script.cjs",
		name: "Test Script",
		description: "A test script",
		...overrides,
	};
}

function makeCatalogIndex(scripts: Record<string, CatalogEntry>): CatalogIndex {
	return { schemaVersion: 1, ref: "abc123", scripts };
}

// ---------------------------------------------------------------------------
// CURATED — happy path
// ---------------------------------------------------------------------------

describe("materialize — curated happy path", () => {
	it("writes fetched bytes verbatim and returns {ok:true}", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = () => 42;");
		const checksum = sha256Bytes(scriptBytes);
		const entry = makeCatalogEntry({ checksum, version: 1 });
		const index = makeCatalogIndex({ "test-script": entry });
		const record = makeCuratedRecord({ okayed: { version: 1, checksum } });

		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => scriptBytes,
		});
		const vault = makeFakeVault();

		const result = await materialize("test-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/test-script.cjs",
		});

		expect(result).toEqual({ ok: true });
		expect(vault.writeCalls).toHaveLength(1);
		expect(vault.writeCalls[0].path).toBe("scripts/test-script.cjs");

		// Byte-equality: assert the written ArrayBuffer contains the exact same bytes
		const written = new Uint8Array(vault.writeCalls[0].data);
		expect(written).toEqual(scriptBytes);
	});

	it("calls mkdir before writeBinary when vault.mkdir is defined", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = () => 99;");
		const checksum = sha256Bytes(scriptBytes);
		const entry = makeCatalogEntry({ checksum, version: 1 });
		const index = makeCatalogIndex({ "test-script": entry });
		const record = makeCuratedRecord({ okayed: { version: 1, checksum } });

		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => scriptBytes,
		});
		const vault = makeFakeVault();

		await materialize("test-script", {
			record,
			catalog,
			vault,
			destPath: ".obsidian/plugins/mason/scripts/test-script.cjs",
		});

		expect(vault.mkdirCalls).toContain(".obsidian/plugins/mason/scripts");
	});
});

// ---------------------------------------------------------------------------
// CURATED — checksum-mismatch (repo integrity: fetched bytes don't match catalog)
// ---------------------------------------------------------------------------

describe("materialize — curated checksum-mismatch", () => {
	it("returns {ok:false, reason:'checksum-mismatch'} and does NOT write", async () => {
		// catalog declares a specific checksum
		const expectedBytes = new TextEncoder().encode("legitimate bytes");
		const checksum = sha256Bytes(expectedBytes);
		const entry = makeCatalogEntry({ checksum, version: 1 });
		const index = makeCatalogIndex({ "test-script": entry });
		const record = makeCuratedRecord({ okayed: { version: 1, checksum } });

		// BUT fetchScript returns DIFFERENT (tampered) bytes
		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => new TextEncoder().encode("tampered bytes"),
		});
		const vault = makeFakeVault();

		const result = await materialize("test-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/test-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "checksum-mismatch" });
		// FAIL-CLOSED: no write
		expect(vault.writeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// CURATED — drift (bytes match catalog but version/checksum ≠ okayed consent)
// ---------------------------------------------------------------------------

describe("materialize — curated drift", () => {
	it("(a) version differs: entry.version=2, okayed.version=1 → {ok:false, reason:'drift'} no write", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = {};");
		const checksum = sha256Bytes(scriptBytes);
		// entry says version 2, but user okayed version 1
		const entry = makeCatalogEntry({ checksum, version: 2 });
		const index = makeCatalogIndex({ "test-script": entry });
		const record = makeCuratedRecord({ okayed: { version: 1, checksum } });

		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => scriptBytes,
		});
		const vault = makeFakeVault();

		const result = await materialize("test-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/test-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "drift" });
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("(b) same version, different checksum: entry.checksum ≠ okayed.checksum → drift, no write", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = {};");
		const catalogChecksum = sha256Bytes(scriptBytes);
		// okayed checksum is DIFFERENT from what the catalog has (user consented to an older revision)
		const okayedChecksum = sha256Bytes(new TextEncoder().encode("old version of script"));
		const entry = makeCatalogEntry({ checksum: catalogChecksum, version: 1 });
		const index = makeCatalogIndex({ "test-script": entry });
		// entry.version === okayed.version, but checksums differ → drift
		const record = makeCuratedRecord({ okayed: { version: 1, checksum: okayedChecksum } });

		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => scriptBytes,
		});
		const vault = makeFakeVault();

		const result = await materialize("test-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/test-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "drift" });
		expect(vault.writeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// CURATED — offline (fetchIndex or fetchScript throws)
// ---------------------------------------------------------------------------

describe("materialize — curated offline", () => {
	it("fetchIndex throws → {ok:false, reason:'offline'} no write", async () => {
		const catalog = makeFakeCatalog({
			fetchIndex: async () => { throw new Error("Network error"); },
			fetchScript: async () => new Uint8Array(0),
		});
		const vault = makeFakeVault();
		const record = makeCuratedRecord({
			okayed: { version: 1, checksum: "sha256:abc" },
		});

		const result = await materialize("test-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/test-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "offline" });
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("fetchScript throws → {ok:false, reason:'offline'} no write", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = {};");
		const checksum = sha256Bytes(scriptBytes);
		const entry = makeCatalogEntry({ checksum, version: 1 });
		const index = makeCatalogIndex({ "test-script": entry });
		const record = makeCuratedRecord({ okayed: { version: 1, checksum } });

		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => { throw new Error("Network error"); },
		});
		const vault = makeFakeVault();

		const result = await materialize("test-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/test-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "offline" });
		expect(vault.writeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// CURATED — source-missing (id not in catalog index)
// ---------------------------------------------------------------------------

describe("materialize — curated source-missing", () => {
	it("id absent from index.scripts → {ok:false, reason:'source-missing'} no write", async () => {
		const index = makeCatalogIndex({}); // empty scripts
		const record = makeCuratedRecord({
			okayed: { version: 1, checksum: "sha256:abc" },
		});
		const catalog = makeFakeCatalog({
			fetchIndex: async () => index,
			fetchScript: async () => new Uint8Array(0),
		});
		const vault = makeFakeVault();

		const result = await materialize("unknown-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/unknown-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "source-missing" });
		expect(vault.writeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// IMPORTED — happy path
// ---------------------------------------------------------------------------

describe("materialize — imported happy path", () => {
	it("reads vault source, verifies hash, writes verbatim, returns {ok:true}", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = () => 'hello';");
		const checksum = sha256Bytes(scriptBytes);
		const record = makeImportedRecord({
			source: "vault-scripts/my-script.cjs",
			okayed: { version: 1, checksum },
		});

		const vault = makeFakeVault({
			existsResult: true,
			readBinaryResult: scriptBytes,
		});
		// catalog is never used for imported — provide a no-op
		const catalog = makeFakeCatalog({});

		const result = await materialize("my-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/my-script.cjs",
		});

		expect(result).toEqual({ ok: true });
		expect(vault.writeCalls).toHaveLength(1);
		expect(vault.writeCalls[0].path).toBe("scripts/my-script.cjs");

		// Byte-equality: verbatim copy of the source ArrayBuffer
		const written = new Uint8Array(vault.writeCalls[0].data);
		expect(written).toEqual(scriptBytes);
	});
});

// ---------------------------------------------------------------------------
// IMPORTED — source-missing
// ---------------------------------------------------------------------------

describe("materialize — imported source-missing", () => {
	it("vault.exists returns false → {ok:false, reason:'source-missing'} no write", async () => {
		const record = makeImportedRecord({
			source: "vault-scripts/missing.cjs",
			okayed: { version: 1, checksum: "sha256:abc" },
		});
		const vault = makeFakeVault({ existsResult: false });
		const catalog = makeFakeCatalog({});

		const result = await materialize("my-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/my-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "source-missing" });
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("readBinary throws → {ok:false, reason:'source-missing'} no write", async () => {
		const record = makeImportedRecord({
			source: "vault-scripts/erroring.cjs",
			okayed: { version: 1, checksum: "sha256:abc" },
		});
		const vault = makeFakeVault({
			existsResult: true,
			readBinaryResult: new Error("read error"),
		});
		const catalog = makeFakeCatalog({});

		const result = await materialize("my-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/my-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "source-missing" });
		expect(vault.writeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// IMPORTED — drift
// ---------------------------------------------------------------------------

describe("materialize — imported drift", () => {
	it("readBinary bytes hash ≠ okayed.checksum → {ok:false, reason:'drift'} no write", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = {};");
		// okayed a DIFFERENT checksum
		const okayedChecksum = sha256Bytes(new TextEncoder().encode("old content"));
		const record = makeImportedRecord({
			source: "vault-scripts/my-script.cjs",
			okayed: { version: 1, checksum: okayedChecksum },
		});

		const vault = makeFakeVault({
			existsResult: true,
			readBinaryResult: scriptBytes,
		});
		const catalog = makeFakeCatalog({});

		const result = await materialize("my-script", {
			record,
			catalog,
			vault,
			destPath: "scripts/my-script.cjs",
		});

		expect(result).toEqual({ ok: false, reason: "drift" });
		expect(vault.writeCalls).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED SWEEP — every non-ok branch must NOT call writeBinary
// ---------------------------------------------------------------------------

describe("fail-closed invariant sweep", () => {
	const destPath = "scripts/test.cjs";

	async function assertNoWrite(deps: MaterializeDeps): Promise<MaterializeResult> {
		const result = await materialize("test-script", deps);
		expect(result.ok).toBe(false);
		return result;
	}

	it("curated checksum-mismatch: no write", async () => {
		const entry = makeCatalogEntry({
			checksum: sha256Bytes(new TextEncoder().encode("real bytes")),
			version: 1,
		});
		const index = makeCatalogIndex({ "test-script": entry });
		const record = makeCuratedRecord({
			okayed: { version: 1, checksum: entry.checksum },
		});
		const vault = makeFakeVault();
		await assertNoWrite({
			record,
			catalog: makeFakeCatalog({
				fetchIndex: async () => index,
				fetchScript: async () => new TextEncoder().encode("tampered"),
			}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("curated drift: no write", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = {};");
		const checksum = sha256Bytes(scriptBytes);
		const entry = makeCatalogEntry({ checksum, version: 2 }); // version 2
		const index = makeCatalogIndex({ "test-script": entry });
		const record = makeCuratedRecord({
			okayed: { version: 1, checksum }, // consented to version 1
		});
		const vault = makeFakeVault();
		await assertNoWrite({
			record,
			catalog: makeFakeCatalog({
				fetchIndex: async () => index,
				fetchScript: async () => scriptBytes,
			}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("curated offline (fetchIndex): no write", async () => {
		const vault = makeFakeVault();
		await assertNoWrite({
			record: makeCuratedRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			catalog: makeFakeCatalog({
				fetchIndex: async () => { throw new Error("offline"); },
			}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("curated offline (fetchScript): no write", async () => {
		const scriptBytes = new TextEncoder().encode("x");
		const checksum = sha256Bytes(scriptBytes);
		const entry = makeCatalogEntry({ checksum, version: 1 });
		const index = makeCatalogIndex({ "test-script": entry });
		const vault = makeFakeVault();
		await assertNoWrite({
			record: makeCuratedRecord({ okayed: { version: 1, checksum } }),
			catalog: makeFakeCatalog({
				fetchIndex: async () => index,
				fetchScript: async () => { throw new Error("offline"); },
			}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("curated source-missing: no write", async () => {
		const vault = makeFakeVault();
		await assertNoWrite({
			record: makeCuratedRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			catalog: makeFakeCatalog({
				fetchIndex: async () => makeCatalogIndex({}),
			}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("imported source-missing (exists false): no write", async () => {
		const vault = makeFakeVault({ existsResult: false });
		await assertNoWrite({
			record: makeImportedRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			catalog: makeFakeCatalog({}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("imported source-missing (readBinary throws): no write", async () => {
		const vault = makeFakeVault({
			existsResult: true,
			readBinaryResult: new Error("read error"),
		});
		await assertNoWrite({
			record: makeImportedRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			catalog: makeFakeCatalog({}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});

	it("imported drift: no write", async () => {
		const scriptBytes = new TextEncoder().encode("module.exports = {};");
		const okayedChecksum = sha256Bytes(new TextEncoder().encode("old content"));
		const vault = makeFakeVault({
			existsResult: true,
			readBinaryResult: scriptBytes,
		});
		await assertNoWrite({
			record: makeImportedRecord({
				okayed: { version: 1, checksum: okayedChecksum },
			}),
			catalog: makeFakeCatalog({}),
			vault,
			destPath,
		});
		expect(vault.writeCalls).toHaveLength(0);
	});
});
