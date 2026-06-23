// T5.5B  Script import flow — unit-testable vault import logic.
//
// DESIGN
// ------
// importScript encapsulates the "vault import" flow: reading a .cjs file from
// the vault, writing it to the plugin scripts directory, and recording the
// imported ScriptRecord in the store.
//
// All side-effects are injected (store + vaultAdapter) so the function is
// fully unit-testable without touching a real Plugin or Obsidian vault.
//
// TRANSITIONAL (T1.4): the v0.1 import recorded a sha256 manifest entry at
// import time. The v0.2 store separates import from consent, so importScript
// now records a disabled, not-yet-okayed ScriptRecord. T2.3 reworks this fully
// with binary-safe hashing and okayed recording.
//
// MKDIR-SAFE WRITE
// ----------------
// Before writing the script file, importScript calls vaultAdapter.mkdir on the
// destination directory. The VaultAdapterPort.mkdir is optional (some adapters
// may not need it); importScript calls it only when defined. The dest directory
// is derived by slicing everything after the last "/" from destPath.

import path from "node:path";
import type { ScriptStore } from "./store";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal vault adapter surface used by the import flow.
 *
 * Relocated here from store.ts in the v0.2 store rewrite (T1.4). T2.3 extends
 * this with readBinary/writeBinary for binary-safe hashing.
 */
export interface VaultAdapterPort {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir?(path: string): Promise<void>;
}

/** Arguments for importScript (all injected for testability). */
export interface ImportScriptArgs {
	/** The script's canonical id (e.g. "perplexity-auto"). */
	id: string;
	/** Vault-relative path to the source .cjs file (the user's vault copy). */
	vaultPath: string;
	/** Destination path within the plugin dir (e.g. ".obsidian/plugins/markdown-mason/scripts/my-script.cjs"). */
	destPath: string;
	/** Script version number. TRANSITIONAL (T1.4): accepted but not recorded at import time; T2.3 reworks. */
	version: number;
	/** ScriptStore instance to record the imported script. */
	store: Pick<ScriptStore, "setRecord">;
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
 *   2. Mkdir-safe: call vaultAdapter.mkdir(destDir) if mkdir is available
 *   3. Write text to destPath via vaultAdapter.write(destPath, text)
 *   4. Record the imported ScriptRecord: store.setRecord(id, { provenance:"imported",
 *      enabled:false, okayed:null, source: vaultPath, command:false })
 *
 * Throws if the source file cannot be read (vaultAdapter.read rejects).
 * Throws if vaultPath or destPath is absolute (absolute paths rejected).
 * Throws if vaultPath or destPath contains a ".." segment on any separator (path traversal rejected).
 *
 * Callers should pre-normalize paths via Obsidian's normalizePath() before passing here.
 * Callers must construct destPath from a sanitized id (no ".." segments allowed).
 */
export async function importScript(args: ImportScriptArgs): Promise<void> {
	// TRANSITIONAL (T1.4): `version` is no longer recorded at import time (consent
	// is separate now); T2.3 reworks this fully with binary hashing + okayed.
	const { id, vaultPath, destPath, store, vaultAdapter } = args;

	// Guard: reject absolute paths
	for (const p of [vaultPath, destPath]) {
		if (path.isAbsolute(p)) {
			throw new Error(`importScript: absolute path rejected: ${p}`);
		}
	}

	// Guard: reject path traversal on both "/" and "\" separators (catches Windows-style paths)
	for (const p of [vaultPath, destPath]) {
		if (p.split(/[/\\]/).some((seg) => seg === "..")) {
			throw new Error(`importScript: path traversal rejected: ${p}`);
		}
	}

	// 1. Read source text from vault
	const text = await vaultAdapter.read(vaultPath);

	// 2. Mkdir-safe: create the destination directory if the adapter supports it
	if (vaultAdapter.mkdir !== undefined) {
		const lastSlash = destPath.lastIndexOf("/");
		const destDir = lastSlash > 0 ? destPath.slice(0, lastSlash) : "";
		if (destDir.length > 0) {
			await vaultAdapter.mkdir(destDir);
		}
	}

	// 3. Write to plugin scripts dir
	await vaultAdapter.write(destPath, text);

	// 4. Record the imported script (consent is recorded separately now).
	await store.setRecord(id, {
		provenance: "imported",
		enabled: false,
		okayed: null,
		source: vaultPath,
		command: false,
	});
}
