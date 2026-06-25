// T5.1  DevDirAdapter unit tests (ADR-15)
//
// DESIGN
// ------
// DevDirAdapter implements CatalogSource using local Node fs reads instead of
// network calls. The adapter is gated behind __MASON_DEV__ so it is tree-shaken
// out of the production bundle (ADR-15). These tests are hermetic: they inject
// a temp directory containing index.json + a .cjs file so no real network call
// or reliance on repo layout is required.
//
// COVERAGE
// --------
// 1. fetchIndex() parses a well-formed index.json from the injected dir.
// 2. fetchScript(entry) returns byte-exact Uint8Array for the .cjs file.
// 3. Missing dir → throws (soft-fail path).
// 4. Missing index.json → throws.
// 5. Missing .cjs → throws.
// 6. Override dir comes from constructor arg (or env-var fallback) — NEVER from
//    data.json / ScriptRecord (there is no read path for those).

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CatalogEntry, CatalogIndex } from "../../../src/scripts/catalog/catalogSource";

// Import the adapter — this will FAIL (RED) until src/scripts/catalog/devDirAdapter.ts exists.
import { DevDirAdapter } from "../../../src/scripts/catalog/devDirAdapter";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeEntry = (overrides?: Partial<CatalogEntry>): CatalogEntry => ({
	id: "perplexity-app",
	version: 3,
	checksum: "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
	path: "scripts/perplexity-app.cjs",
	name: "Perplexity App",
	description: "Search via Perplexity from Obsidian.",
	...overrides,
});

const SCRIPT_BYTES = new Uint8Array([0x0a, 0x0b, 0x0c, 0xd, 0xe, 0xf, 0x42]);

// ---------------------------------------------------------------------------
// Temp directory setup / teardown
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(() => {
	// Create: <tmpDir>/index.json + <tmpDir>/scripts/perplexity-app.cjs
	tmpDir = mkdtempSync(join(tmpdir(), "mason-dev-dir-adapter-test-"));
	mkdirSync(join(tmpDir, "scripts"), { recursive: true });

	const index: CatalogIndex = {
		schemaVersion: 1,
		ref: "test-sha-abc123",
		scripts: {
			"perplexity-app": makeEntry(),
		},
	};
	writeFileSync(join(tmpDir, "index.json"), JSON.stringify(index, null, 2), "utf-8");
	writeFileSync(join(tmpDir, "scripts", "perplexity-app.cjs"), Buffer.from(SCRIPT_BYTES));
});

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Suite: construction contract — dir from constructor arg
// ---------------------------------------------------------------------------

describe("DevDirAdapter construction contract (T5.1, ADR-15)", () => {
	it("constructor accepts a string dir without throwing", () => {
		const adapter = new DevDirAdapter(tmpDir);
		// Confirm the adapter is constructed from a plain string (not ScriptRecord / data.json).
		expect(adapter).toBeDefined();
		// The adapter instance has no property that is a ScriptRecord.
		expect((adapter as unknown as Record<string, unknown>)["okayed"]).toBeUndefined();
		expect((adapter as unknown as Record<string, unknown>)["record"]).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// Suite: fetchIndex
// ---------------------------------------------------------------------------

describe("DevDirAdapter.fetchIndex (T5.1, ADR-15)", () => {
	it("returns a CatalogIndex parsed from index.json in the injected dir", async () => {
		const adapter = new DevDirAdapter(tmpDir);
		const index = await adapter.fetchIndex();

		expect(index.schemaVersion).toBe(1);
		expect(index.ref).toBe("test-sha-abc123");
		expect(Object.keys(index.scripts)).toContain("perplexity-app");
	});

	it("returns the script entries from the index.json", async () => {
		const adapter = new DevDirAdapter(tmpDir);
		const index = await adapter.fetchIndex();

		const entry = index.scripts["perplexity-app"];
		expect(entry).toBeDefined();
		expect(entry!.id).toBe("perplexity-app");
		expect(entry!.version).toBe(3);
		expect(entry!.path).toBe("scripts/perplexity-app.cjs");
	});

	it("throws when the dir does not exist", async () => {
		const adapter = new DevDirAdapter("/absolutely/nonexistent/dir/xyz");
		await expect(adapter.fetchIndex()).rejects.toThrow();
	});

	it("throws when index.json is absent from the dir", async () => {
		// Create a dir without an index.json
		const emptyDir = mkdtempSync(join(tmpdir(), "mason-dev-empty-"));
		try {
			const adapter = new DevDirAdapter(emptyDir);
			await expect(adapter.fetchIndex()).rejects.toThrow();
		} finally {
			rmSync(emptyDir, { recursive: true, force: true });
		}
	});
});

// ---------------------------------------------------------------------------
// Suite: fetchScript
// ---------------------------------------------------------------------------

describe("DevDirAdapter.fetchScript (T5.1, ADR-14, ADR-15)", () => {
	it("returns a Uint8Array for the .cjs file described by entry", async () => {
		const adapter = new DevDirAdapter(tmpDir);
		const result = await adapter.fetchScript(makeEntry());

		expect(result).toBeInstanceOf(Uint8Array);
	});

	it("returns byte-exact content matching what was written to the temp dir", async () => {
		const adapter = new DevDirAdapter(tmpDir);
		const result = await adapter.fetchScript(makeEntry());

		expect(Array.from(result)).toEqual(Array.from(SCRIPT_BYTES));
	});

	it("throws when the .cjs file is absent from the dir", async () => {
		const adapter = new DevDirAdapter(tmpDir);
		const missingEntry = makeEntry({ path: "scripts/no-such-script.cjs" });
		await expect(adapter.fetchScript(missingEntry)).rejects.toThrow();
	});

	it("throws when the dir does not exist", async () => {
		const adapter = new DevDirAdapter("/nonexistent-dir-xyz");
		await expect(adapter.fetchScript(makeEntry())).rejects.toThrow();
	});
});

// ---------------------------------------------------------------------------
// Suite: env-var fallback construction
// ---------------------------------------------------------------------------

describe("DevDirAdapter env-var fallback (T5.1, ADR-15)", () => {
	it("accepts MASON_DEV_DIR env var as the dir when constructor arg is omitted", async () => {
		// DevDirAdapterFromEnv (or the default constructor) should read MASON_DEV_DIR.
		// We test by importing the env-var factory / calling the no-arg form.
		// Import the factory that reads from env.
		const { createDevDirAdapter } = await import(
			"../../../src/scripts/catalog/devDirAdapter"
		);

		const originalEnv = process.env["MASON_DEV_DIR"];
		process.env["MASON_DEV_DIR"] = tmpDir;
		try {
			const adapter = createDevDirAdapter();
			const index = await adapter.fetchIndex();
			expect(index.schemaVersion).toBe(1);
		} finally {
			if (originalEnv === undefined) {
				delete process.env["MASON_DEV_DIR"];
			} else {
				process.env["MASON_DEV_DIR"] = originalEnv;
			}
		}
	});

	it("createDevDirAdapter throws when MASON_DEV_DIR env var is not set", async () => {
		const { createDevDirAdapter } = await import(
			"../../../src/scripts/catalog/devDirAdapter"
		);

		const originalEnv = process.env["MASON_DEV_DIR"];
		delete process.env["MASON_DEV_DIR"];
		try {
			expect(() => createDevDirAdapter()).toThrow();
		} finally {
			if (originalEnv !== undefined) {
				process.env["MASON_DEV_DIR"] = originalEnv;
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Suite: config-file fallback (ADR-15 amendment — .mason-dev.json)
// ---------------------------------------------------------------------------

describe("createDevDirAdapter config-file fallback (ADR-15)", () => {
	// Each test manages its own pluginDir temp dir and env state to stay hermetic.

	function withNoEnv(fn: () => void | Promise<void>): () => Promise<void> {
		return async () => {
			const original = process.env["MASON_DEV_DIR"];
			delete process.env["MASON_DEV_DIR"];
			try {
				await fn();
			} finally {
				if (original !== undefined) {
					process.env["MASON_DEV_DIR"] = original;
				}
			}
		};
	}

	it(
		"env wins even when a config file is also present",
		withNoEnv(async () => {
			const { createDevDirAdapter } = await import(
				"../../../src/scripts/catalog/devDirAdapter"
			);

			// pluginDir has a .mason-dev.json pointing at a different (nonexistent) dir
			const pluginDir = mkdtempSync(join(tmpdir(), "mason-dev-plugindir-envwins-"));
			try {
				const decoyDir = "/decoy/catalog/dir";
				writeFileSync(
					join(pluginDir, ".mason-dev.json"),
					JSON.stringify({ catalogDir: decoyDir }),
					"utf-8",
				);

				// env is set to the real tmpDir (has index.json), decoy does not exist
				process.env["MASON_DEV_DIR"] = tmpDir;
				const adapter = createDevDirAdapter(pluginDir);
				const index = await adapter.fetchIndex();
				// Should have used env dir (tmpDir), not the decoy
				expect(index.schemaVersion).toBe(1);
			} finally {
				delete process.env["MASON_DEV_DIR"];
				rmSync(pluginDir, { recursive: true, force: true });
			}
		}),
	);

	it(
		"uses .mason-dev.json catalogDir when env is unset and config file is present",
		withNoEnv(async () => {
			const { createDevDirAdapter } = await import(
				"../../../src/scripts/catalog/devDirAdapter"
			);

			const pluginDir = mkdtempSync(join(tmpdir(), "mason-dev-plugindir-cfgfile-"));
			try {
				writeFileSync(
					join(pluginDir, ".mason-dev.json"),
					JSON.stringify({ catalogDir: tmpDir }),
					"utf-8",
				);

				const adapter = createDevDirAdapter(pluginDir);
				const index = await adapter.fetchIndex();
				expect(index.schemaVersion).toBe(1);
				expect(index.ref).toBe("test-sha-abc123");
			} finally {
				rmSync(pluginDir, { recursive: true, force: true });
			}
		}),
	);

	it(
		"throws with message naming MASON_DEV_DIR AND the config path when env unset and no config file",
		withNoEnv(async () => {
			const { createDevDirAdapter } = await import(
				"../../../src/scripts/catalog/devDirAdapter"
			);

			const pluginDir = mkdtempSync(join(tmpdir(), "mason-dev-plugindir-nofile-"));
			try {
				// No .mason-dev.json written here
				expect(() => createDevDirAdapter(pluginDir)).toThrow(/MASON_DEV_DIR/);
				expect(() => createDevDirAdapter(pluginDir)).toThrow(/\.mason-dev\.json/);
			} finally {
				rmSync(pluginDir, { recursive: true, force: true });
			}
		}),
	);

	it(
		"throws a clear error when .mason-dev.json contains malformed JSON",
		withNoEnv(async () => {
			const { createDevDirAdapter } = await import(
				"../../../src/scripts/catalog/devDirAdapter"
			);

			const pluginDir = mkdtempSync(join(tmpdir(), "mason-dev-plugindir-badjson-"));
			try {
				writeFileSync(
					join(pluginDir, ".mason-dev.json"),
					"{ this is not valid json !!!",
					"utf-8",
				);

				expect(() => createDevDirAdapter(pluginDir)).toThrow(/\.mason-dev\.json/);
			} finally {
				rmSync(pluginDir, { recursive: true, force: true });
			}
		}),
	);

	it(
		"throws a clear error when .mason-dev.json has missing catalogDir field",
		withNoEnv(async () => {
			const { createDevDirAdapter } = await import(
				"../../../src/scripts/catalog/devDirAdapter"
			);

			const pluginDir = mkdtempSync(join(tmpdir(), "mason-dev-plugindir-nocatalogdir-"));
			try {
				writeFileSync(
					join(pluginDir, ".mason-dev.json"),
					JSON.stringify({ someOtherField: "/some/path" }),
					"utf-8",
				);

				expect(() => createDevDirAdapter(pluginDir)).toThrow(/catalogDir/);
			} finally {
				rmSync(pluginDir, { recursive: true, force: true });
			}
		}),
	);

	it(
		"throws a clear error when .mason-dev.json has empty catalogDir string",
		withNoEnv(async () => {
			const { createDevDirAdapter } = await import(
				"../../../src/scripts/catalog/devDirAdapter"
			);

			const pluginDir = mkdtempSync(join(tmpdir(), "mason-dev-plugindir-emptycatalogdir-"));
			try {
				writeFileSync(
					join(pluginDir, ".mason-dev.json"),
					JSON.stringify({ catalogDir: "" }),
					"utf-8",
				);

				expect(() => createDevDirAdapter(pluginDir)).toThrow(/catalogDir/);
			} finally {
				rmSync(pluginDir, { recursive: true, force: true });
			}
		}),
	);

	it(
		"throws (env-or-throw) when no pluginDir is passed and env is unset",
		withNoEnv(async () => {
			const { createDevDirAdapter } = await import(
				"../../../src/scripts/catalog/devDirAdapter"
			);

			// No pluginDir → config file step is skipped → throw like before
			expect(() => createDevDirAdapter()).toThrow(/MASON_DEV_DIR/);
		}),
	);
});
