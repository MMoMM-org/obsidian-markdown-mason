// T5.4  Store: data.json manifest + per-device sidecar (ADR-6)
//
// Tests behaviour of ScriptStore through injected adapter interfaces.
// No Obsidian import — adapters are in-memory stubs.
//
// STORAGE SPLIT (ADR-6):
//   data.json  — plugin data (loadData/saveData), SYNCED. Holds manifest only.
//   device.json — vault adapter, PER-DEVICE sidecar, NOT synced. Holds enabled/consent.
//
// DRIFT HARD-BLOCK (PRD F10):
//   same version, different checksum → "drift-blocked" until user resolves.
//   This is NOT a warning — the script is treated as disabled.
//
// evaluateTrust precedence (see store.ts for authoritative comment):
//   1. unknown id (not in manifest)        → "unknown"
//   2. enabled=false                        → "disabled"
//   3. no consent recorded                  → "needs-consent"
//   4. consent.version < manifest.version  → "needs-consent"
//   5. same version, checksum mismatch     → "drift-blocked"
//   6. same version, same checksum         → "ok"

import { describe, it, expect } from "vitest";
import { ScriptStore } from "../../src/scripts/store";
import type { PluginDataPort, VaultAdapterPort } from "../../src/scripts/store";

// ---------------------------------------------------------------------------
// In-memory adapter factories
// ---------------------------------------------------------------------------

interface PluginDataSpy extends PluginDataPort {
	saveCount: number;
}

function makePluginDataPort(initial: unknown = {}): PluginDataSpy {
	let stored: unknown = initial;
	const spy: PluginDataSpy = {
		saveCount: 0,
		load: async (): Promise<unknown> => stored,
		save: async (data: unknown): Promise<void> => {
			stored = data;
			spy.saveCount++;
		},
	};
	return spy;
}

function makeVaultAdapterPort(): VaultAdapterPort & { _files: Map<string, string> } {
	const files = new Map<string, string>();
	return {
		_files: files,
		exists: async (path: string): Promise<boolean> => files.has(path),
		read: async (path: string): Promise<string> => {
			const content = files.get(path);
			if (content === undefined) throw new Error(`File not found: ${path}`);
			return content;
		},
		write: async (path: string, data: string): Promise<void> => {
			files.set(path, data);
		},
		mkdir: async (_path: string): Promise<void> => {
			// no-op for in-memory adapter
		},
	};
}

const DEVICE_PATH = ".obsidian/plugins/markdown-mason/device.json";

function makeStore(
	pluginData: PluginDataPort,
	vaultAdapter: VaultAdapterPort,
): ScriptStore {
	return new ScriptStore(pluginData, vaultAdapter, DEVICE_PATH);
}

// ---------------------------------------------------------------------------
// (a) Manifest entry round-trips to data.json and PRESERVES existing settings
// ---------------------------------------------------------------------------

describe("ScriptStore — manifest (data.json)", () => {
	it("setManifestEntry persists an entry and getManifest retrieves it", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.setManifestEntry("my-script", {
			source: "vault/scripts/my-script.cjs",
			checksum: "abc123",
			version: 1,
		});

		const manifest = await store.getManifest();
		expect(manifest["my-script"]).toEqual({
			source: "vault/scripts/my-script.cjs",
			checksum: "abc123",
			version: 1,
		});
	});

	it("setManifestEntry PRESERVES existing settings in data.json", async () => {
		const existing = {
			settings: { debugLogging: true, resourcesName: "References" },
			scripts: {},
		};
		const pluginData = makePluginDataPort(existing);
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.setManifestEntry("script-a", {
			source: "vault/scripts/script-a.cjs",
			checksum: "def456",
			version: 2,
		});

		// Inspect what was saved to plugin data
		const saved = await pluginData.load() as {
			settings: { debugLogging: boolean; resourcesName: string };
			scripts: Record<string, unknown>;
		};
		expect(saved.settings).toEqual({ debugLogging: true, resourcesName: "References" });
		expect(saved.scripts["script-a"]).toBeDefined();
	});

	it("getManifest returns empty record when data.json has no scripts", async () => {
		const pluginData = makePluginDataPort({ settings: { debugLogging: false } });
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		const manifest = await store.getManifest();
		expect(manifest).toEqual({});
	});

	it("getManifest returns empty record when data.json is empty", async () => {
		const pluginData = makePluginDataPort({});
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		const manifest = await store.getManifest();
		expect(manifest).toEqual({});
	});

	it("multiple setManifestEntry calls accumulate entries", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.setManifestEntry("script-a", { source: "a.cjs", checksum: "aa", version: 1 });
		await store.setManifestEntry("script-b", { source: "b.cjs", checksum: "bb", version: 2 });

		const manifest = await store.getManifest();
		expect(Object.keys(manifest)).toHaveLength(2);
		expect(manifest["script-a"]?.checksum).toBe("aa");
		expect(manifest["script-b"]?.checksum).toBe("bb");
	});
});

// ---------------------------------------------------------------------------
// (b) enabled/consent round-trip to device.json; plugin save NOT called
// ---------------------------------------------------------------------------

describe("ScriptStore — device state (device.json)", () => {
	it("setEnabled writes to device.json, NOT to plugin data", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.setEnabled("script-x", true);

		// device.json should have been written
		const deviceRaw = await vault.read(DEVICE_PATH);
		const device = JSON.parse(deviceRaw) as { enabled: Record<string, boolean> };
		expect(device.enabled["script-x"]).toBe(true);

		// plugin save must NOT have been called for device state
		expect(pluginData.saveCount).toBe(0);
	});

	it("setEnabled false stores false in device.json", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.setEnabled("script-x", false);

		const deviceRaw = await vault.read(DEVICE_PATH);
		const device = JSON.parse(deviceRaw) as { enabled: Record<string, boolean> };
		expect(device.enabled["script-x"]).toBe(false);
	});

	it("getDevice returns empty enabled/consent when device.json is absent", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		const device = await store.getDevice();
		expect(device).toEqual({ enabled: {}, consent: {} });
	});

	it("getDevice parses existing device.json", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({ enabled: { "s1": true }, consent: {} }),
		);
		const store = makeStore(pluginData, vault);

		const device = await store.getDevice();
		expect(device.enabled["s1"]).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// (c) recordConsent stores per (id, checksum, version)
// ---------------------------------------------------------------------------

describe("ScriptStore — recordConsent", () => {
	it("recordConsent persists per (id, checksum, version) in device.json", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.recordConsent("script-a", "checksum-X", 3);

		const deviceRaw = await vault.read(DEVICE_PATH);
		const device = JSON.parse(deviceRaw) as {
			consent: Record<string, { checksum: string; version: number }>;
		};
		expect(device.consent["script-a"]).toEqual({ checksum: "checksum-X", version: 3 });
	});

	it("recordConsent does NOT call plugin.save", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.recordConsent("script-a", "checksum-X", 3);

		expect(pluginData.saveCount).toBe(0);
	});

	it("subsequent recordConsent for same id overwrites previous consent", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.recordConsent("script-a", "old-checksum", 1);
		await store.recordConsent("script-a", "new-checksum", 2);

		const device = await store.getDevice();
		expect(device.consent["script-a"]).toEqual({ checksum: "new-checksum", version: 2 });
	});

	it("recordConsent for multiple scripts stores each independently", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.recordConsent("script-a", "aaaa", 1);
		await store.recordConsent("script-b", "bbbb", 2);

		const device = await store.getDevice();
		expect(device.consent["script-a"]).toEqual({ checksum: "aaaa", version: 1 });
		expect(device.consent["script-b"]).toEqual({ checksum: "bbbb", version: 2 });
	});
});

// ---------------------------------------------------------------------------
// SEC-003 — symmetric version check: rollback also triggers needs-consent
// ---------------------------------------------------------------------------

describe("ScriptStore — evaluateTrust: SEC-003 rollback → needs-consent", () => {
	it("rollback: consent.version 5, manifest.version 3, matching checksum → needs-consent (not ok)", async () => {
		// A downgrade/rollback is equally suspect as an upgrade — fail-closed on both.
		// Even though the checksum matches at the rollback version, we require exact version match.
		const pluginData = makePluginDataPort({
			scripts: {
				"script-rollback": { source: "rollback.cjs", checksum: "same-checksum", version: 3 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({
				enabled: { "script-rollback": true },
				consent: { "script-rollback": { checksum: "same-checksum", version: 5 } },
			}),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-rollback");
		expect(result.status).toBe("needs-consent");
	});

	it("version bump (3 vs 4) → needs-consent (existing behaviour preserved)", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-bump": { source: "bump.cjs", checksum: "current-hash", version: 4 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({
				enabled: { "script-bump": true },
				consent: { "script-bump": { checksum: "old-hash", version: 3 } },
			}),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-bump");
		expect(result.status).toBe("needs-consent");
	});

	it("drift (same version, different checksum) → drift-blocked (existing behaviour preserved)", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-drift-sec003": { source: "drift.cjs", checksum: "new-checksum", version: 7 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({
				enabled: { "script-drift-sec003": true },
				consent: { "script-drift-sec003": { checksum: "old-checksum", version: 7 } },
			}),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-drift-sec003");
		expect(result.status).toBe("drift-blocked");
	});
});

// ---------------------------------------------------------------------------
// (d) Drift: same version, different checksum → "drift-blocked"
// ---------------------------------------------------------------------------

describe("ScriptStore — evaluateTrust: drift hard-block", () => {
	it("drift: manifest {version:3, checksum:'B'} + consent {version:3, checksum:'A'} → drift-blocked", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-d": { source: "d.cjs", checksum: "B", version: 3 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({
				enabled: { "script-d": true },
				consent: { "script-d": { checksum: "A", version: 3 } },
			}),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-d");
		expect(result.status).toBe("drift-blocked");
	});
});

// ---------------------------------------------------------------------------
// (e) Matching checksum+version → "ok"
// ---------------------------------------------------------------------------

describe("ScriptStore — evaluateTrust: ok", () => {
	it("matching checksum and version → ok", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-e": { source: "e.cjs", checksum: "match", version: 5 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({
				enabled: { "script-e": true },
				consent: { "script-e": { checksum: "match", version: 5 } },
			}),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-e");
		expect(result.status).toBe("ok");
	});
});

// ---------------------------------------------------------------------------
// (f) Manifest version higher than consent version → "needs-consent" (not drift)
// ---------------------------------------------------------------------------

describe("ScriptStore — evaluateTrust: needs-consent (version bump)", () => {
	it("manifest version 4 vs consent version 3 → needs-consent (not drift-blocked)", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-f": { source: "f.cjs", checksum: "current-hash", version: 4 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({
				enabled: { "script-f": true },
				consent: { "script-f": { checksum: "old-hash", version: 3 } },
			}),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-f");
		expect(result.status).toBe("needs-consent");
	});

	it("enabled script with no consent at all → needs-consent", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-g": { source: "g.cjs", checksum: "hash-g", version: 1 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({ enabled: { "script-g": true }, consent: {} }),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-g");
		expect(result.status).toBe("needs-consent");
	});
});

// ---------------------------------------------------------------------------
// (g) enabled=false → "disabled"
// ---------------------------------------------------------------------------

describe("ScriptStore — evaluateTrust: disabled", () => {
	it("enabled=false → disabled (even if consent is recorded)", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-h": { source: "h.cjs", checksum: "hash-h", version: 1 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({
				enabled: { "script-h": false },
				consent: { "script-h": { checksum: "hash-h", version: 1 } },
			}),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-h");
		expect(result.status).toBe("disabled");
	});

	it("enabled explicitly false → disabled even without consent", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-i": { source: "i.cjs", checksum: "hash-i", version: 1 },
			},
		});
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({ enabled: { "script-i": false }, consent: {} }),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-i");
		expect(result.status).toBe("disabled");
	});
});

// ---------------------------------------------------------------------------
// (h) Unknown id → "unknown"
// ---------------------------------------------------------------------------

describe("ScriptStore — evaluateTrust: unknown", () => {
	it("id not in manifest → unknown", async () => {
		const pluginData = makePluginDataPort({ scripts: {} });
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("nonexistent-script");
		expect(result.status).toBe("unknown");
	});

	it("unknown id → unknown even if device has enabled flag somehow", async () => {
		const pluginData = makePluginDataPort({ scripts: {} });
		const vault = makeVaultAdapterPort();
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({ enabled: { "ghost": true }, consent: {} }),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("ghost");
		expect(result.status).toBe("unknown");
	});
});

// ---------------------------------------------------------------------------
// Additional edge cases
// ---------------------------------------------------------------------------

describe("ScriptStore — robustness", () => {
	it("device.json absent is treated as {enabled:{},consent:{}}", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		// Should not throw
		const device = await store.getDevice();
		expect(device).toEqual({ enabled: {}, consent: {} });
	});

	it("setEnabled and recordConsent can both write and both accumulate in device.json", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.setEnabled("script-z", true);
		await store.recordConsent("script-z", "zzz", 1);

		const device = await store.getDevice();
		expect(device.enabled["script-z"]).toBe(true);
		expect(device.consent["script-z"]).toEqual({ checksum: "zzz", version: 1 });
	});

	it("setManifestEntry still uses plugin.save (manifest goes through plugin data)", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		const store = makeStore(pluginData, vault);

		await store.setManifestEntry("s", { source: "s.cjs", checksum: "cc", version: 1 });

		expect(pluginData.saveCount).toBe(1);
	});

	it("[W1] corrupt device.json resolves to empty state without throwing", async () => {
		const pluginData = makePluginDataPort();
		const vault = makeVaultAdapterPort();
		// Seed a non-JSON string so exists() returns true but JSON.parse throws
		vault._files.set(DEVICE_PATH, "this is not valid json {{{");
		const store = makeStore(pluginData, vault);

		const device = await store.getDevice();
		expect(device).toEqual({ enabled: {}, consent: {} });
	});
});

// ---------------------------------------------------------------------------
// (j) enabled key absent → needs-consent, not disabled
// ---------------------------------------------------------------------------

describe("ScriptStore — evaluateTrust: enabled key absent", () => {
	it("[W2] script in manifest but no enabled entry → needs-consent (not disabled)", async () => {
		const pluginData = makePluginDataPort({
			scripts: {
				"script-j": { source: "j.cjs", checksum: "hash-j", version: 1 },
			},
		});
		const vault = makeVaultAdapterPort();
		// device.json exists but enabled:{} has no entry for script-j
		vault._files.set(
			DEVICE_PATH,
			JSON.stringify({ enabled: {}, consent: {} }),
		);
		const store = makeStore(pluginData, vault);

		const result = await store.evaluateTrust("script-j");
		expect(result.status).toBe("needs-consent");
	});
});
