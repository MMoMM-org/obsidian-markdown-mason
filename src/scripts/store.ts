// T5.4  Store: data.json manifest + per-device sidecar (ADR-6)
//
// STORAGE SPLIT (ADR-6)
// ─────────────────────
// Two intentionally separate stores:
//
// data.json  — Obsidian plugin data (loadData/saveData), BYTE-FOR-BYTE SYNCED.
//              Holds METADATA ONLY: the script manifest.
//              Schema: { settings: {...}, scripts: { "<id>": { source, checksum, version } } }
//
// device.json — PER-DEVICE sidecar at the plugin dir, written via vault.adapter.
//               MUST NOT go through plugin saveData (so it is never synced).
//               Enables/consent are per-device trust decisions — syncing would
//               silently grant execution rights on a device the user never approved.
//               Schema: { enabled: { "<id>": true }, consent: { "<id>": { checksum, version } } }
//
// DRIFT HARD-BLOCK (PRD F10)
// ──────────────────────────
// Drift = manifest says script <id> is at a given version AND consent was recorded
// for the SAME version but a DIFFERENT checksum. The code changed under a stale
// version number — this is a trust violation and must hard-block execution until
// the user resolves it. It is NOT a dismissable warning.
//
// evaluateTrust PRECEDENCE (authoritative; T5.5 and T5.3 depend on this):
//   1. id not in manifest                         → "unknown"
//   2. enabled flag is explicitly false           → "disabled"
//   3. no consent recorded for id                 → "needs-consent"
//   4. consent.version < manifest.version         → "needs-consent"  (re-prompt; NOT drift)
//   5. same version, checksum mismatch            → "drift-blocked"  (hard-block)
//   6. same version, same checksum                → "ok"
//
// T5.5 (vault import + command binding) reads the evaluateTrust result to gate
// execution. T5.3 (consent modal) calls recordConsent to move a script from
// "needs-consent" to "ok" (or "drift-blocked" → "ok" after the user re-approves).

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

/**
 * Subset of Obsidian's DataAdapter used for per-device I/O.
 * Concrete adapter wraps vault.adapter in main.ts.
 */
export interface VaultAdapterPort {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir?(path: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Manifest entry shape
// ---------------------------------------------------------------------------

export interface ManifestEntry {
	source: string;
	checksum: string;
	version: number;
}

// ---------------------------------------------------------------------------
// Device state shapes
// ---------------------------------------------------------------------------

export interface ConsentRecord {
	checksum: string;
	version: number;
}

export interface DeviceState {
	enabled: Record<string, boolean>;
	consent: Record<string, ConsentRecord>;
}

// ---------------------------------------------------------------------------
// evaluateTrust result
// ---------------------------------------------------------------------------

export type TrustStatus =
	| "ok"
	| "needs-consent"
	| "drift-blocked"
	| "disabled"
	| "unknown";

export interface TrustResult {
	status: TrustStatus;
}

// ---------------------------------------------------------------------------
// Raw plugin-data shape (what lives in data.json)
// ---------------------------------------------------------------------------

interface PluginData {
	settings?: unknown;
	scripts?: Record<string, ManifestEntry>;
}

// ---------------------------------------------------------------------------
// ScriptStore
// ---------------------------------------------------------------------------

/**
 * Manages the two persistence stores defined in ADR-6.
 *
 * Constructor parameters:
 *   pluginData  — wraps plugin.loadData/saveData (synced; manifest only)
 *   vaultAdapter — wraps vault.adapter (per-device; enabled + consent)
 *   devicePath   — absolute-ish path to device.json within the plugin dir
 *                  e.g. ".obsidian/plugins/markdown-mason/device.json"
 */
export class ScriptStore {
	private readonly _plugin: PluginDataPort;
	private readonly _vault: VaultAdapterPort;
	private readonly _devicePath: string;

	constructor(
		pluginData: PluginDataPort,
		vaultAdapter: VaultAdapterPort,
		devicePath: string,
	) {
		this._plugin = pluginData;
		this._vault = vaultAdapter;
		this._devicePath = devicePath;
	}

	// -------------------------------------------------------------------------
	// Manifest (data.json)
	// -------------------------------------------------------------------------

	/** Returns the full script manifest from data.json (never null). */
	async getManifest(): Promise<Record<string, ManifestEntry>> {
		const data = await this._loadPluginData();
		return data.scripts ?? {};
	}

	/**
	 * Persists a single manifest entry to data.json.
	 * Preserves all other keys in the plugin data blob (esp. `settings`).
	 */
	async setManifestEntry(id: string, entry: ManifestEntry): Promise<void> {
		const data = await this._loadPluginData();
		const scripts = data.scripts ?? {};
		const next: PluginData = {
			...data,
			scripts: { ...scripts, [id]: entry },
		};
		await this._plugin.save(next);
	}

	// -------------------------------------------------------------------------
	// Device state (device.json)
	// -------------------------------------------------------------------------

	/**
	 * Returns the current device state.
	 * Returns {enabled:{},consent:{}} when device.json is absent or empty.
	 */
	async getDevice(): Promise<DeviceState> {
		return this._readDeviceState();
	}

	/**
	 * Sets the enabled flag for a script in device.json.
	 * MUST NOT call plugin.save — device state is per-device only.
	 */
	async setEnabled(id: string, enabled: boolean): Promise<void> {
		const state = await this._readDeviceState();
		const next: DeviceState = {
			...state,
			enabled: { ...state.enabled, [id]: enabled },
		};
		await this._writeDeviceState(next);
	}

	/**
	 * Records consent for a (id, checksum, version) triple in device.json.
	 * MUST NOT call plugin.save — consent is a per-device trust decision.
	 */
	async recordConsent(id: string, checksum: string, version: number): Promise<void> {
		const state = await this._readDeviceState();
		const next: DeviceState = {
			...state,
			consent: { ...state.consent, [id]: { checksum, version } },
		};
		await this._writeDeviceState(next);
	}

	// -------------------------------------------------------------------------
	// Trust evaluation
	// -------------------------------------------------------------------------

	/**
	 * Combines manifest + device state to determine whether a script may run.
	 *
	 * Precedence (first match wins — see module header for rationale):
	 *   1. unknown   — id not in manifest
	 *   2. disabled  — enabled flag is explicitly false
	 *   3. needs-consent — no consent recorded
	 *   4. needs-consent — consent.version < manifest.version (version bump → re-prompt)
	 *   5. drift-blocked — same version, different checksum (trust violation; hard-block)
	 *   6. ok        — same version, same checksum
	 */
	async evaluateTrust(id: string): Promise<TrustResult> {
		const [manifest, device] = await Promise.all([
			this.getManifest(),
			this.getDevice(),
		]);

		const entry = manifest[id];
		if (entry === undefined) {
			return { status: "unknown" };
		}

		const isEnabled = device.enabled[id];
		if (isEnabled === false) {
			return { status: "disabled" };
		}

		const consent = device.consent[id];
		if (consent === undefined) {
			return { status: "needs-consent" };
		}

		if (consent.version < entry.version) {
			return { status: "needs-consent" };
		}

		if (consent.checksum !== entry.checksum) {
			return { status: "drift-blocked" };
		}

		return { status: "ok" };
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

	private async _readDeviceState(): Promise<DeviceState> {
		const absent = await this._vault.exists(this._devicePath);
		if (!absent) {
			return { enabled: {}, consent: {} };
		}
		try {
			const raw = await this._vault.read(this._devicePath);
			const parsed = JSON.parse(raw) as Partial<DeviceState>;
			return {
				enabled: parsed.enabled ?? {},
				consent: parsed.consent ?? {},
			};
		} catch {
			return { enabled: {}, consent: {} };
		}
	}

	private async _writeDeviceState(state: DeviceState): Promise<void> {
		if (this._vault.mkdir !== undefined) {
			const dir = this._devicePath.slice(0, this._devicePath.lastIndexOf("/"));
			if (dir.length > 0) {
				await this._vault.mkdir(dir);
			}
		}
		await this._vault.write(this._devicePath, JSON.stringify(state));
	}
}
