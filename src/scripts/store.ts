// T1.2  Store: synced data.json only (ADR-12)
//
// SINGLE-STORE MODEL
// ──────────────────
// All script decisions persist in data.json via Obsidian plugin.loadData /
// plugin.saveData (synced across devices).
//
// Schema:
//   {
//     settings: { ...MasonSettings... },
//     scripts: {
//       "<id>": {
//         provenance: "curated" | "imported",
//         enabled: boolean,
//         okayed: { version: number, checksum: string } | null,
//         source: string,
//         command: boolean
//       }
//     }
//   }
//
// ADR-12: device.json sidecar (DeviceState.enabled / DeviceState.consent)
// removed. enable + consent fold into ScriptRecord in synced data.json.
// No migration — loadData() returning a v0.1 blob is impossible in the field;
// defensive defaults (enabled:false, okayed:null) handle any partial entry.
//
// Derived lifecycle state (LifecycleState) is computed by evaluateState()
// in lifecycle.ts — it is never persisted here.

// ---------------------------------------------------------------------------
// Port interfaces — injected, no Obsidian import at the top level
// ---------------------------------------------------------------------------

/**
 * Wraps plugin.loadData / plugin.saveData.
 * Concrete adapter is provided by main.ts, which holds the Plugin instance.
 */
export interface PluginDataPort {
	load(): Promise<unknown>;
	save(data: unknown): Promise<void>;
}

// ---------------------------------------------------------------------------
// ScriptRecord — persisted per-script entry in data.json
// ---------------------------------------------------------------------------

export interface ScriptRecord {
	provenance: "curated" | "imported";
	enabled: boolean;
	okayed: { version: number; checksum: string } | null;
	source: string;
	command: boolean;
}

// ---------------------------------------------------------------------------
// Internal raw plugin-data shape
// ---------------------------------------------------------------------------

interface PluginData {
	settings?: unknown;
	scripts?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// ScriptStore
// ---------------------------------------------------------------------------

/**
 * Manages script decisions in synced data.json (ADR-12).
 *
 * Constructor parameters:
 *   pluginData — wraps plugin.loadData/saveData (synced; all script decisions)
 *
 * No VaultAdapterPort, no devicePath — device.json is deleted.
 */
export class ScriptStore {
	private readonly _plugin: PluginDataPort;

	constructor(pluginData: PluginDataPort) {
		this._plugin = pluginData;
	}

	/**
	 * Returns all ScriptRecords from data.json.
	 * Returns {} when data.json has no scripts key.
	 * Applies defensive defaults (enabled:false, okayed:null) to partial entries.
	 */
	async getScripts(): Promise<Record<string, ScriptRecord>> {
		const data = await this._loadPluginData();
		const raw = data.scripts ?? {};
		return Object.fromEntries(
			Object.entries(raw).map(([id, entry]) => [id, applyDefaults(entry)]),
		);
	}

	/**
	 * Persists a single ScriptRecord to data.json at scripts[id].
	 * Preserves all other top-level keys (esp. settings) and other script entries.
	 */
	async setRecord(id: string, rec: ScriptRecord): Promise<void> {
		const data = await this._loadPluginData();
		const scripts = data.scripts ?? {};
		const next: PluginData = {
			...data,
			scripts: { ...scripts, [id]: rec },
		};
		await this._plugin.save(next);
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async _loadPluginData(): Promise<PluginData> {
		const raw = await this._plugin.load();
		if (raw === null || typeof raw !== "object") {
			return {};
		}
		return raw as PluginData;
	}
}

// ---------------------------------------------------------------------------
// Module-private helpers — apply defensive defaults to a raw entry
// ---------------------------------------------------------------------------

// Fail-closed: malformed okayed (wrong type, missing fields, partial object)
// → null, meaning "not consented". Only a structurally valid object passes.
function parseOkayed(raw: unknown): ScriptRecord["okayed"] {
	if (raw !== null && typeof raw === "object"
		&& typeof (raw as { version?: unknown }).version === "number"
		&& typeof (raw as { checksum?: unknown }).checksum === "string") {
		return raw as { version: number; checksum: string };
	}
	return null;
}

function applyDefaults(raw: unknown): ScriptRecord {
	const entry = (raw !== null && typeof raw === "object" ? raw : {}) as Partial<ScriptRecord>;
	return {
		provenance: entry.provenance ?? "curated",
		enabled: entry.enabled ?? false,
		okayed: parseOkayed(entry.okayed),
		source: entry.source ?? "",
		command: entry.command ?? false,
	};
}
