// T6.1  MaterializedFingerprintStore — per-device version manifest
//
// DESIGN
// ------
// Records which VERSION of a script was materialized on THIS device. This is
// separate from the synced ScriptRecord in data.json (which carries the CONSENTED
// identity: okayed.version + okayed.checksum).
//
// The manifest lives at a per-device path in the plugin scripts dir
// (e.g. <pluginDir>/scripts/.materialized.json) via VaultAdapterPort — NOT in
// synced data.json (ADR-12: synced store is for decisions only).
//
// Schema (in .materialized.json):
//   { "<id>": <version:number>, ... }
//
// INJECTION
// ---------
// Both vault adapter and path are injected so the store is fully unit-testable
// with a fake vault. In production, the path is the per-device scripts directory.

import type { VaultAdapterPort } from "./runtime";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/** Per-device version manifest for materialized scripts. */
export interface FingerprintStore {
	/** Returns the version that was materialized on THIS device, or undefined if none. */
	getVersion(id: string): Promise<number | undefined>;
	/** Records that version `version` was successfully materialized on THIS device. */
	setVersion(id: string, version: number): Promise<void>;
	/** Removes the entry for `id` (e.g. when a script is removed). */
	remove(id: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// MaterializedFingerprintStore
// ---------------------------------------------------------------------------

/**
 * Reads/writes a per-device manifest `{ [id]: version }` recording the version
 * that was materialized on THIS device.
 *
 * The manifest is stored at `manifestPath` via the injected vault adapter.
 * It is NEVER written to data.json — the path must be the per-device scripts dir.
 */
export class MaterializedFingerprintStore implements FingerprintStore {
	private readonly _vault: Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir">;
	private readonly _manifestPath: string;

	constructor(
		vault: Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir">,
		manifestPath: string,
	) {
		this._vault = vault;
		this._manifestPath = manifestPath;
	}

	async getVersion(id: string): Promise<number | undefined> {
		const manifest = await this._readManifest();
		return manifest[id];
	}

	async setVersion(id: string, version: number): Promise<void> {
		const manifest = await this._readManifest();
		manifest[id] = version;
		await this._writeManifest(manifest);
	}

	async remove(id: string): Promise<void> {
		const manifest = await this._readManifest();
		if (!(id in manifest)) return;
		delete manifest[id];
		await this._writeManifest(manifest);
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async _readManifest(): Promise<Record<string, number>> {
		const exists = await this._vault.exists(this._manifestPath);
		if (!exists) return {};
		try {
			const buf = await this._vault.readBinary(this._manifestPath);
			const text = new TextDecoder().decode(buf);
			const parsed: unknown = JSON.parse(text);
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, number>;
			}
			return {};
		} catch {
			return {};
		}
	}

	private async _writeManifest(manifest: Record<string, number>): Promise<void> {
		const parentDir = this._manifestPath.substring(0, this._manifestPath.lastIndexOf("/"));
		await this._vault.mkdir?.(parentDir);
		const text = JSON.stringify(manifest);
		const buf = new TextEncoder().encode(text).buffer;
		await this._vault.writeBinary(this._manifestPath, buf);
	}
}
