// T6.1  LifecycleResolver — live state assembly (ADR-11)
//
// DESIGN
// ------
// LifecycleResolver wires the four live inputs that evaluateState needs but that
// were previously stubbed in settingsTab._buildScriptItems:
//
//   online         — fetch-authoritative: true iff fetchIndex() succeeds this pass
//                    (onlineProbe/navigator.onLine is a pre-flight guard only)
//   inCatalog      — id present in fetched index.scripts; offline fallback: provenance==="curated"
//   local          — vault file exists → { version: manifest.getVersion(id) ?? okayed.version,
//                    checksum: sha256Bytes(bytes) }; absent → null
//   catalogVersion — index.scripts[id]?.version when online; undefined when offline
//
// The catalog index is fetched ONCE per resolve pass and cached (fetchIndex is
// called once even when resolving many scripts in resolveItems).
//
// OFFLINE DETERMINATION
// ---------------------
// online is fetch-authoritative: if onlineProbe() returns false, we skip the
// fetch and treat as offline immediately. If onlineProbe() returns true BUT
// fetchIndex() throws, we also treat as offline. This way navigator.onLine
// inconsistencies don't produce false Active states.
//
// MISSING MANIFEST VERSION FALLBACK
// ----------------------------------
// If a script file exists but has no manifest entry (e.g. manual install or
// pre-fingerprint-store era), local.version falls back to record.okayed.version
// so that version === okayed.version is satisfied (step 5 passes) and only the
// checksum check (step 6) determines Active vs Blocked(drift).
// Document: "If manifest has no entry but file exists, version = okayed.version"
//
// INREFERENCE TO inCatalog WHEN OFFLINE
// ---------------------------------------
// We cannot know the true catalog contents when offline. As a display fallback,
// inCatalog = (record.provenance === "curated"). This means:
//   - curated scripts will continue to appear as "Available" or stay at their
//     current state (not silently become Absent)
//   - imported scripts are assumed not in the official catalog (correct default)
// This is conservative and documented in the SDD.

import { evaluateState } from "./lifecycle";
import type { EvaluateStateInput, LifecycleState } from "./lifecycle";
import { sha256Bytes } from "./checksum";
import type { CatalogIndex } from "./catalog/catalogSource";
import type { CatalogSource } from "./catalog/catalogSource";
import type { VaultAdapterPort } from "./runtime";
import type { ScriptRecord } from "./store";
import type { FingerprintStore } from "./materializedFingerprint";
import type { ScriptItem } from "../ui/scriptsTab";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** All injected dependencies for LifecycleResolver. */
export interface LifecycleResolverDeps {
	/** Catalog source for fetching the index. */
	catalog: CatalogSource;
	/** Vault adapter for reading script files. */
	vault: Pick<VaultAdapterPort, "readBinary" | "exists">;
	/** Per-device fingerprint store. */
	fingerprints: FingerprintStore;
	/** Directory where script .cjs files live. */
	scriptsDir: string;
	/** Build the full vault path for a script id (e.g. "<scriptsDir>/<id>.cjs"). */
	destPath: (id: string) => string;
	/** Returns true if network appears available (pre-flight guard). */
	onlineProbe: () => boolean;
}

// ---------------------------------------------------------------------------
// LifecycleResolver
// ---------------------------------------------------------------------------

/**
 * Resolves live EvaluateStateInput for each script and derives LifecycleState.
 *
 * The catalog index is fetched ONCE per resolve pass and cached for the lifetime
 * of that pass. To start a new pass (e.g. after a re-render), create a fresh
 * LifecycleResolver or call clearCache().
 */
export class LifecycleResolver {
	private readonly _deps: LifecycleResolverDeps;
	/** Cached catalog index for this resolve pass. undefined = not yet fetched. */
	private _cachedIndex: { ok: true; index: CatalogIndex } | { ok: false } | undefined = undefined;

	constructor(deps: LifecycleResolverDeps) {
		this._deps = deps;
	}

	/** Clear the cached catalog index so the next call re-fetches. */
	clearCache(): void {
		this._cachedIndex = undefined;
	}

	/**
	 * Resolve the full EvaluateStateInput for one script.
	 *
	 * Fetches the catalog index once (cached) and reads the script file from vault.
	 */
	async resolveInput(id: string, record: ScriptRecord | undefined): Promise<EvaluateStateInput> {
		// Step 1 — fetch (or use cached) catalog index
		const catalogResult = await this._fetchIndexCached();
		const online = catalogResult.ok;

		// Step 2 — derive inCatalog and catalogVersion
		let inCatalog: boolean;
		let catalogVersion: number | undefined;

		if (online) {
			inCatalog = id in catalogResult.index.scripts;
			catalogVersion = catalogResult.index.scripts[id]?.version;
		} else {
			// Offline fallback: inCatalog from provenance (conservative display default)
			// If record is undefined, we don't know provenance → false (not in catalog)
			inCatalog = record?.provenance === "curated";
			catalogVersion = undefined;
		}

		// Step 3 — resolve local file
		const local = await this._resolveLocal(id, record);

		return { record, inCatalog, local, catalogVersion, online };
	}

	/**
	 * Derive the LifecycleState for one script by resolving inputs and calling evaluateState.
	 */
	async getState(id: string, record: ScriptRecord | undefined): Promise<LifecycleState> {
		const input = await this.resolveInput(id, record);
		return evaluateState(input);
	}

	/**
	 * Resolve all scripts in `records` in a single pass.
	 * The catalog index is fetched exactly once (cached across all scripts).
	 *
	 * Returns one ScriptItem per entry in records.
	 */
	async resolveItems(records: Record<string, ScriptRecord>): Promise<ScriptItem[]> {
		// Pre-fetch catalog once
		const catalogResult = await this._fetchIndexCached();
		const online = catalogResult.ok;

		const items: ScriptItem[] = [];

		for (const [id, record] of Object.entries(records)) {
			// Derive inCatalog and catalogVersion from already-cached result
			let inCatalog: boolean;
			let catalogVersion: number | undefined;

			if (online) {
				inCatalog = id in catalogResult.index.scripts;
				catalogVersion = catalogResult.index.scripts[id]?.version;
			} else {
				inCatalog = record.provenance === "curated";
				catalogVersion = undefined;
			}

			const local = await this._resolveLocal(id, record);
			const input: EvaluateStateInput = { record, inCatalog, local, catalogVersion, online };
			const state = evaluateState(input);

			items.push({
				id,
				displayName: id,
				description: `Source: ${record.source}`,
				record,
				state,
				version: record.okayed?.version ?? 0,
				provenance: record.provenance,
				catalogVersion,
			});
		}

		return items;
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	/**
	 * Fetch the catalog index, caching the result for this resolve pass.
	 *
	 * online determination:
	 *   1. If onlineProbe() returns false → skip fetch, return { ok: false }
	 *   2. If fetchIndex() succeeds → { ok: true, index }
	 *   3. If fetchIndex() throws → { ok: false }
	 */
	private async _fetchIndexCached(): Promise<{ ok: true; index: CatalogIndex } | { ok: false }> {
		if (this._cachedIndex !== undefined) {
			return this._cachedIndex;
		}

		if (!this._deps.onlineProbe()) {
			this._cachedIndex = { ok: false };
			return this._cachedIndex;
		}

		try {
			const index = await this._deps.catalog.fetchIndex();
			this._cachedIndex = { ok: true, index };
		} catch {
			this._cachedIndex = { ok: false };
		}

		return this._cachedIndex;
	}

	/**
	 * Resolve the local file state for a script.
	 *
	 * - If the file is absent → null
	 * - If the file exists → { version, checksum }
	 *   version = manifest entry for id, OR okayed.version as fallback when manifest
	 *   has no entry (file present but not tracked → assume okayed version so step 5
	 *   passes and step 6 checksum check is authoritative).
	 */
	private async _resolveLocal(
		id: string,
		record: ScriptRecord | undefined,
	): Promise<{ version: number; checksum: string } | null> {
		const filePath = this._deps.destPath(id);
		const exists = await this._deps.vault.exists(filePath);
		if (!exists) return null;

		let buf: ArrayBuffer;
		try {
			buf = await this._deps.vault.readBinary(filePath);
		} catch {
			return null;
		}

		// Normalize to Uint8Array before hashing (ADR-14: gotcha)
		const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
		const checksum = sha256Bytes(bytes);

		// Read version from fingerprint store; fallback to okayed.version if absent
		const manifestVersion = await this._deps.fingerprints.getVersion(id);
		const version = manifestVersion ?? record?.okayed?.version ?? 0;

		return { version, checksum };
	}
}
