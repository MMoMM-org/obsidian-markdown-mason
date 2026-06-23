// T5.5B  Script import flow — unit-testable vault import logic.
//
// DESIGN
// ------
// importScript encapsulates the "vault import" flow: reading a .cjs file from
// the vault as raw bytes, writing it byte-exact to the plugin scripts directory,
// and recording the imported ScriptRecord in the store.
//
// All side-effects are injected (store + vaultAdapter) so the function is
// fully unit-testable without touching a real Plugin or Obsidian vault.
//
// T2.3 (ADR-14): I/O is now byte-exact. importScript reads via readBinary,
// hashes raw bytes with sha256Bytes, writes via writeBinary — no string
// round-trip. A script with CRLF line endings will round-trip with CRLF intact
// and hash differently from its LF-only counterpart, as required.
//
// MKDIR-SAFE WRITE
// ----------------
// Before writing the script file, importScript calls vaultAdapter.mkdir on the
// destination directory. The VaultAdapterPort.mkdir is optional (some adapters
// may not need it); importScript calls it only when defined. The dest directory
// is derived by slicing everything after the last "/" from destPath.

import path from "node:path";
import type { ScriptStore } from "./store";
import { sha256Bytes } from "./checksum";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal vault adapter surface used by the import flow.
 *
 * string read/write are kept for other consumers (e.g. invariants.test.ts,
 * materializer T2.4). Binary methods added in T2.3 for byte-exact import I/O
 * (ADR-14). Mirrors Obsidian's vault.adapter.readBinary/writeBinary API surface.
 */
export interface VaultAdapterPort {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	readBinary(path: string): Promise<ArrayBuffer>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
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
	/** Script version number supplied by the caller; returned in the result for the disclosure flow. */
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
 *   1. Guard: reject absolute vaultPath / destPath.
 *   2. Guard: reject path traversal on "/" and "\" separators.
 *   3. Read raw bytes from vaultAdapter.readBinary(vaultPath) → ArrayBuffer.
 *   4. Compute byte-exact checksum: sha256Bytes(bytes) (ADR-14).
 *   5. Mkdir-safe: call vaultAdapter.mkdir(destDir) if mkdir is available.
 *   6. Write VERBATIM via vaultAdapter.writeBinary(destPath, buf) — no string round-trip.
 *   7. Record the ScriptRecord: store.setRecord(id, { provenance:"imported",
 *      enabled:false, okayed:null, source:vaultPath, command:false }).
 *      // okayed is set by disclosure on accept (PRD F2), not here —
 *      // import only materializes bytes + reports the byte-exact checksum.
 *   8. Return { version, checksum } for the disclosure flow (T3.4).
 *
 * Throws if readBinary rejects (file not found or permission error).
 * Throws if vaultPath or destPath is absolute (absolute paths rejected).
 * Throws if vaultPath or destPath contains a ".." segment on any separator (path traversal rejected).
 *
 * Callers should pre-normalize paths via Obsidian's normalizePath() before passing here.
 * Callers must construct destPath from a sanitized id (no ".." segments allowed).
 */
export async function importScript(args: ImportScriptArgs): Promise<{ version: number; checksum: string }> {
	const { id, vaultPath, destPath, version, store, vaultAdapter } = args;

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

	// 1. Read raw bytes from vault (ADR-14: binary I/O only — never route through read/write strings)
	const buf = await vaultAdapter.readBinary(vaultPath);
	const bytes = new Uint8Array(buf);

	// 2. Compute byte-exact checksum (ADR-14: CRLF ≠ LF)
	const checksum = sha256Bytes(bytes);

	// 3. Mkdir-safe: create the destination directory if the adapter supports it
	if (vaultAdapter.mkdir !== undefined) {
		const lastSlash = destPath.lastIndexOf("/");
		const destDir = lastSlash > 0 ? destPath.slice(0, lastSlash) : "";
		if (destDir.length > 0) {
			await vaultAdapter.mkdir(destDir);
		}
	}

	// 4. Write VERBATIM — same ArrayBuffer, no string round-trip (ADR-14)
	await vaultAdapter.writeBinary(destPath, buf);

	// 5. Record the imported script.
	// okayed is set by disclosure on accept (PRD F2), not here —
	// import only materializes bytes + reports the byte-exact checksum.
	await store.setRecord(id, {
		provenance: "imported",
		enabled: false,
		okayed: null,
		source: vaultPath,
		command: false,
	});

	return { version, checksum };
}
