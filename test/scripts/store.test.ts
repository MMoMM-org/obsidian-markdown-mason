// T1.2  Store: synced data.json only (ADR-12)
//
// Tests behaviour of ScriptStore through injected PluginDataPort ONLY.
// No device.json, no VaultAdapterPort — all persistence flows through
// plugin.loadData / plugin.saveData (synced).
//
// ScriptRecord schema in data.json:
//   { settings: {...}, scripts: { "<id>": ScriptRecord } }
//
// ScriptRecord fields:
//   provenance: "curated" | "imported"
//   enabled: boolean
//   okayed: { version: number, checksum: string } | null
//   source: string
//   command: boolean
//
// Defensive defaults for partial entries: enabled=false, okayed=null.

import { describe, it, expect } from "vitest";
import { ScriptStore } from "../../src/scripts/store";
import type { PluginDataPort, ScriptRecord } from "../../src/scripts/store";

// ---------------------------------------------------------------------------
// In-memory adapter factory — only PluginDataPort, no VaultAdapterPort
// ---------------------------------------------------------------------------

interface PluginDataSpy extends PluginDataPort {
	saveCount: number;
	loadCount: number;
	_stored: unknown;
}

function makePluginDataPort(initial: unknown = null): PluginDataSpy {
	let stored: unknown = initial;
	const spy: PluginDataSpy = {
		saveCount: 0,
		loadCount: 0,
		get _stored() { return stored; },
		load: async (): Promise<unknown> => {
			spy.loadCount++;
			return stored;
		},
		save: async (data: unknown): Promise<void> => {
			stored = data;
			spy.saveCount++;
		},
	};
	return spy;
}

function makeStore(pluginData: PluginDataPort): ScriptStore {
	return new ScriptStore(pluginData);
}

function makeRecord(overrides: Partial<ScriptRecord> = {}): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "abc123" },
		source: "curated/scripts/test-script",
		command: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// (a) getScripts — absent / missing scripts key
// ---------------------------------------------------------------------------

describe("ScriptStore — getScripts", () => {
	it("returns {} when data.json is null (plugin returns null)", async () => {
		const pluginData = makePluginDataPort(null);
		const store = makeStore(pluginData);

		const result = await store.getScripts();
		expect(result).toEqual({});
	});

	it("returns {} when data.json is an empty object", async () => {
		const pluginData = makePluginDataPort({});
		const store = makeStore(pluginData);

		const result = await store.getScripts();
		expect(result).toEqual({});
	});

	it("returns {} when data.json has settings but no scripts key", async () => {
		const pluginData = makePluginDataPort({ settings: { debugLogging: false } });
		const store = makeStore(pluginData);

		const result = await store.getScripts();
		expect(result).toEqual({});
	});

	it("returns stored scripts when scripts key exists", async () => {
		const rec = makeRecord();
		const pluginData = makePluginDataPort({
			scripts: { "my-script": rec },
		});
		const store = makeStore(pluginData);

		const result = await store.getScripts();
		expect(result["my-script"]).toEqual(rec);
	});
});

// ---------------------------------------------------------------------------
// (b) setRecord — key preservation + full round-trip
// ---------------------------------------------------------------------------

describe("ScriptStore — setRecord", () => {
	it("round-trips a full ScriptRecord {provenance, enabled, okayed, source, command}", async () => {
		const pluginData = makePluginDataPort();
		const store = makeStore(pluginData);
		const rec = makeRecord({
			provenance: "imported",
			enabled: true,
			okayed: { version: 3, checksum: "def456" },
			source: "vault/scripts/my-script.js",
			command: true,
		});

		await store.setRecord("my-script", rec);

		const scripts = await store.getScripts();
		expect(scripts["my-script"]).toEqual(rec);
	});

	it("preserves the settings key when setting a record", async () => {
		const existing = {
			settings: { debugLogging: true, resourcesName: "References" },
			scripts: {},
		};
		const pluginData = makePluginDataPort(existing);
		const store = makeStore(pluginData);

		await store.setRecord("script-a", makeRecord());

		const saved = pluginData._stored as {
			settings: { debugLogging: boolean; resourcesName: string };
			scripts: Record<string, unknown>;
		};
		expect(saved.settings).toEqual({ debugLogging: true, resourcesName: "References" });
	});

	it("preserves other scripts entries when adding a new one", async () => {
		const existing = {
			scripts: {
				"pre-existing": makeRecord({ source: "vault/pre-existing.js" }),
			},
		};
		const pluginData = makePluginDataPort(existing);
		const store = makeStore(pluginData);

		await store.setRecord("new-script", makeRecord({ source: "vault/new-script.js" }));

		const scripts = await store.getScripts();
		expect(scripts["pre-existing"]).toBeDefined();
		expect(scripts["new-script"]).toBeDefined();
	});

	it("overwrites an existing record entry", async () => {
		const pluginData = makePluginDataPort();
		const store = makeStore(pluginData);

		await store.setRecord("s", makeRecord({ enabled: true }));
		await store.setRecord("s", makeRecord({ enabled: false }));

		const scripts = await store.getScripts();
		expect(scripts["s"]?.enabled).toBe(false);
	});

	it("calls plugin.save exactly once per setRecord call", async () => {
		const pluginData = makePluginDataPort();
		const store = makeStore(pluginData);

		await store.setRecord("s", makeRecord());
		expect(pluginData.saveCount).toBe(1);

		await store.setRecord("s", makeRecord({ enabled: false }));
		expect(pluginData.saveCount).toBe(2);
	});

	it("multiple setRecord calls accumulate entries without overwriting others", async () => {
		const pluginData = makePluginDataPort();
		const store = makeStore(pluginData);

		await store.setRecord("script-a", makeRecord({ source: "vault/a.js", enabled: true }));
		await store.setRecord("script-b", makeRecord({ source: "vault/b.js", enabled: false }));

		const scripts = await store.getScripts();
		expect(Object.keys(scripts)).toHaveLength(2);
		expect(scripts["script-a"]?.source).toBe("vault/a.js");
		expect(scripts["script-b"]?.source).toBe("vault/b.js");
	});
});

// ---------------------------------------------------------------------------
// (c) Defensive defaults for partial / unknown entries
// ---------------------------------------------------------------------------

describe("ScriptStore — defensive defaults for partial entries", () => {
	it("applies enabled:false default when entry has no enabled field", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"partial": {
					provenance: "curated",
					source: "vault/partial.js",
					command: false,
					// No enabled, no okayed
				},
			},
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["partial"]?.enabled).toBe(false);
	});

	it("applies okayed:null default when entry has no okayed field", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"partial": {
					provenance: "curated",
					source: "vault/partial.js",
					command: false,
				},
			},
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["partial"]?.okayed).toBeNull();
	});

	it("preserves provenance when present in a partial entry", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"partial": { provenance: "imported", source: "vault/partial.js" },
			},
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["partial"]?.provenance).toBe("imported");
	});

	it("preserves source when present in a partial entry", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"partial": { source: "vault/my-path.js" },
			},
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["partial"]?.source).toBe("vault/my-path.js");
	});

	it("preserves command when present in a partial entry", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"partial": { command: true },
			},
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["partial"]?.command).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// (d) NO device.json / VaultAdapterPort — only PluginDataPort is used
// ---------------------------------------------------------------------------

describe("ScriptStore — no device.json I/O", () => {
	it("constructor accepts only PluginDataPort (one argument)", () => {
		// If this compiles and does not throw, it proves no VaultAdapterPort is required
		const pluginData = makePluginDataPort();
		expect(() => new ScriptStore(pluginData)).not.toThrow();
	});

	it("getScripts only calls PluginDataPort.load — no other port", async () => {
		const pluginData = makePluginDataPort({ scripts: { "s": makeRecord() } });
		const store = makeStore(pluginData);

		// track load calls; if any other I/O port were used it would throw because
		// no VaultAdapterPort is injected
		const prevLoadCount = pluginData.loadCount;
		await store.getScripts();
		expect(pluginData.loadCount).toBeGreaterThan(prevLoadCount);
	});

	it("setRecord only calls PluginDataPort.save — no other port", async () => {
		const pluginData = makePluginDataPort();
		const store = makeStore(pluginData);

		// If any other I/O port were needed, construction would have failed or
		// this would throw a runtime error. The fact it saves to pluginData proves
		// the only port in play is PluginDataPort.
		await store.setRecord("s", makeRecord());
		expect(pluginData.saveCount).toBe(1);
	});

	it("getScripts + setRecord complete a full lifecycle with only PluginDataPort", async () => {
		// No VaultAdapterPort constructed or injected anywhere in this test suite.
		// Any device.json I/O would cause a runtime failure because there is no
		// such port to call.
		const pluginData = makePluginDataPort();
		const store = makeStore(pluginData);

		const rec = makeRecord({ enabled: true, okayed: { version: 2, checksum: "xyz" } });
		await store.setRecord("lifecycle-test", rec);

		const scripts = await store.getScripts();
		expect(scripts["lifecycle-test"]?.enabled).toBe(true);
		expect(scripts["lifecycle-test"]?.okayed).toEqual({ version: 2, checksum: "xyz" });
	});
});

// ---------------------------------------------------------------------------
// (e) Defensive defaults — enabled:true is preserved (W2)
// ---------------------------------------------------------------------------

describe("ScriptStore — enabled:true is preserved by ?? false (W2)", () => {
	it("preserves enabled:true when the stored entry has enabled:true", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"partial": { enabled: true },
			},
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["partial"]?.enabled).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// (f) Fail-closed okayed guard — malformed values coerce to null (W3)
// ---------------------------------------------------------------------------

describe("ScriptStore — malformed okayed coerced to null (W3)", () => {
	it("returns okayed:null when stored okayed is a number", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "s": { okayed: 42 } },
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["s"]?.okayed).toBeNull();
	});

	it("returns okayed:null when stored okayed is a string", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "s": { okayed: "x" } },
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["s"]?.okayed).toBeNull();
	});

	it("returns okayed:null when stored okayed is an empty object (missing both fields)", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "s": { okayed: {} } },
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["s"]?.okayed).toBeNull();
	});

	it("returns okayed:null when stored okayed has version but is missing checksum", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "s": { okayed: { version: 1 } } },
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["s"]?.okayed).toBeNull();
	});

	it("round-trips a well-formed okayed value unchanged", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "s": { okayed: { version: 2, checksum: "sha256:ab" } } },
		});
		const store = makeStore(pluginData);

		const scripts = await store.getScripts();
		expect(scripts["s"]?.okayed).toEqual({ version: 2, checksum: "sha256:ab" });
	});
});

// ---------------------------------------------------------------------------
// (g) deleteRecord — removes scripts[id]; preserves settings + other entries
// ---------------------------------------------------------------------------

describe("ScriptStore — deleteRecord", () => {
	it("removes the specified id from scripts", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "script-a": makeRecord() },
		});
		const store = makeStore(pluginData);

		await store.deleteRecord("script-a");

		const scripts = await store.getScripts();
		expect(scripts["script-a"]).toBeUndefined();
	});

	it("preserves settings when deleting a record", async () => {
		const pluginData = makePluginDataPort({
			settings: { debugLogging: true, resourcesName: "Refs" },
			scripts: { "script-a": makeRecord() },
		});
		const store = makeStore(pluginData);

		await store.deleteRecord("script-a");

		const saved = pluginData._stored as { settings: unknown; scripts: unknown };
		expect(saved.settings).toEqual({ debugLogging: true, resourcesName: "Refs" });
	});

	it("preserves other script entries when deleting one", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-a": makeRecord({ source: "vault/a.js" }),
				"script-b": makeRecord({ source: "vault/b.js" }),
			},
		});
		const store = makeStore(pluginData);

		await store.deleteRecord("script-a");

		const scripts = await store.getScripts();
		expect(scripts["script-a"]).toBeUndefined();
		expect(scripts["script-b"]).toBeDefined();
	});

	it("is a no-op for an absent id (does not throw)", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "script-a": makeRecord() },
		});
		const store = makeStore(pluginData);

		await expect(store.deleteRecord("nonexistent")).resolves.toBeUndefined();

		const scripts = await store.getScripts();
		expect(scripts["script-a"]).toBeDefined();
	});

	it("calls plugin.save exactly once per deleteRecord call", async () => {
		const pluginData = makePluginDataPort({
			scripts: { "script-a": makeRecord() },
		});
		const store = makeStore(pluginData);

		await store.deleteRecord("script-a");
		expect(pluginData.saveCount).toBe(1);
	});
});
