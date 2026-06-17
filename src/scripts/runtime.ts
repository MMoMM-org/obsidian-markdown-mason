// T5.5B  Script import flow — unit-testable vault import logic.
//
// DESIGN
// ------
// importScript encapsulates the "vault import" flow: reading a .cjs file from
// the vault, computing its sha256 checksum, writing it to the plugin scripts
// directory, and recording the manifest entry in the store.
//
// All side-effects are injected (store + vaultAdapter) so the function is
// fully unit-testable without touching a real Plugin or Obsidian vault.
//
// CHECKSUM SCHEME
// ---------------
// Checksums are prefixed with "sha256:" to allow future algorithm migration
// without breaking the manifest format. The hex digest is computed over the
// raw UTF-8 text bytes (Buffer encoding matches vault.adapter.read output).
//
// MKDIR-SAFE WRITE
// ----------------
// Before writing the script file, importScript calls vaultAdapter.mkdir on the
// destination directory. The VaultAdapterPort.mkdir is optional (some adapters
// may not need it); importScript calls it only when defined. The dest directory
// is derived by slicing everything after the last "/" from destPath.
//
// DESKTOP-ONLY
// ------------
// importScript uses node:crypto for sha256. This is safe on Obsidian Desktop
// (Electron) where the full Node runtime is available.

import { createHash } from "node:crypto";
import type { VaultAdapterPort, ScriptStore } from "./store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Arguments for importScript (all injected for testability). */
export interface ImportScriptArgs {
	/** The script's canonical id (e.g. "perplexity-auto"). */
	id: string;
	/** Vault-relative path to the source .cjs file (the user's vault copy). */
	vaultPath: string;
	/** Destination path within the plugin dir (e.g. ".obsidian/plugins/markdown-mason/scripts/my-script.cjs"). */
	destPath: string;
	/** Script version number (recorded in the manifest; used for consent gating). */
	version: number;
	/** ScriptStore instance to update the manifest entry. */
	store: Pick<ScriptStore, "setManifestEntry">;
	/** VaultAdapterPort for reading the source and writing the destination. */
	vaultAdapter: VaultAdapterPort;
}

// ---------------------------------------------------------------------------
// importScript
// ---------------------------------------------------------------------------

/**
 * Import a user-authored .cjs script from the vault into the plugin scripts dir.
 *
 * Steps:
 *   1. Read the source text from vaultAdapter.read(vaultPath)
 *   2. Compute checksum = "sha256:" + sha256hex(text)
 *   3. Mkdir-safe: call vaultAdapter.mkdir(destDir) if mkdir is available
 *   4. Write text to destPath via vaultAdapter.write(destPath, text)
 *   5. Record manifest entry: store.setManifestEntry(id, { source: vaultPath, checksum, version })
 *
 * Throws if the source file cannot be read (vaultAdapter.read rejects).
 */
export async function importScript(args: ImportScriptArgs): Promise<void> {
	const { id, vaultPath, destPath, version, store, vaultAdapter } = args;

	// 1. Read source text from vault
	const text = await vaultAdapter.read(vaultPath);

	// 2. Compute sha256 checksum
	const checksum = "sha256:" + createHash("sha256").update(text).digest("hex");

	// 3. Mkdir-safe: create the destination directory if the adapter supports it
	if (vaultAdapter.mkdir !== undefined) {
		const lastSlash = destPath.lastIndexOf("/");
		const destDir = lastSlash > 0 ? destPath.slice(0, lastSlash) : "";
		if (destDir.length > 0) {
			await vaultAdapter.mkdir(destDir);
		}
	}

	// 4. Write to plugin scripts dir
	await vaultAdapter.write(destPath, text);

	// 5. Record manifest entry
	await store.setManifestEntry(id, { source: vaultPath, checksum, version });
}
