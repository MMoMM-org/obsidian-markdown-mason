// T2.4  Materializer — cross-device safety core (ADR-11, ADR-14)
//
// MATCH-GATE / FAIL-CLOSED SEMANTICS
// ------------------------------------
// materialize() is the device-B safety enforcer (T7.5 sync-spike). It NEVER
// writes code to disk unless ALL of the following hold:
//
//   1. The bytes can be fetched (curated) or read (imported) without error.
//   2. For curated: the fetched bytes hash byte-exactly to entry.checksum
//      (repo integrity — tampered bytes are caught here).
//   3. The entry.version AND computed hash BOTH match okayed.version and
//      okayed.checksum (the identity the user consented to on device A).
//
// If ANY check fails, writeBinary is NOT called. This is non-negotiable:
// the four failure reasons below cover every non-ok path:
//
//   "drift"             — bytes or version no longer match the consented identity
//   "offline"           — fetchIndex or fetchScript threw (network unavailable)
//   "source-missing"    — id absent from catalog index, or imported source doesn't exist
//   "checksum-mismatch" — fetched bytes don't match catalog's declared checksum (tamper)
//
// BYTE-EXACT WRITE (ADR-14)
// --------------------------
// Curated: fetchScript returns Uint8Array. We write bytes.buffer, but slice
//   first to guard against subarray views: bytes.buffer.slice(bytes.byteOffset,
//   bytes.byteOffset + bytes.byteLength). Never round-trip through a string.
// Imported: readBinary returns ArrayBuffer buf; we write buf directly (verbatim).
//
// MKDIR-SAFE
// ----------
// If vault.mkdir is defined, it is called on destPath's parent directory ONLY
// on the {ok:true} path, immediately before writeBinary.
//
// References: ADR-11 (lifecycle/device-safety), ADR-14 (byte-exact I/O),
//             T7.5 sync-spike (device-B safety test).

import { sha256Bytes } from "./checksum";
import { debug } from "../core/debug";
import type { ScriptRecord } from "./store";
import type { CatalogSource } from "./catalog/catalogSource";
import type { VaultAdapterPort } from "./runtime";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MaterializeReason = "drift" | "offline" | "source-missing" | "checksum-mismatch";
export type MaterializeResult = { ok: true } | { ok: false; reason: MaterializeReason };

/** All I/O is injected — no Obsidian import, no real network, no Date. */
export interface MaterializeDeps {
	/** The enabled+okayed record; okayed is assumed non-null at call time. */
	record: ScriptRecord;
	/** Used only for provenance "curated". */
	catalog: CatalogSource;
	/** Minimal vault surface for binary I/O and path existence checks. */
	vault: Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir">;
	/** Destination path (absolute-ish plugin path) to write <id>.cjs verbatim. */
	destPath: string;
}

// ---------------------------------------------------------------------------
// materialize
// ---------------------------------------------------------------------------

/**
 * Fetch or copy a script's code to THIS device, verify it byte-exactly against
 * the consented okayed identity, write it verbatim, and return a typed result.
 *
 * FAIL-CLOSED: writeBinary is called ONLY on the {ok:true} path.
 *
 * @param id      — script id (used to look up catalog entry).
 * @param deps    — all I/O injected for testability; no Obsidian/network in scope.
 */
export async function materialize(id: string, deps: MaterializeDeps): Promise<MaterializeResult> {
	const { record, catalog, vault, destPath } = deps;
	const okayed = record.okayed;

	// Defensive guard: caller contract says okayed is non-null, but treat null
	// as a programming error rather than writing. Return drift to stay fail-closed.
	if (okayed === null) {
		return { ok: false, reason: "drift" };
	}

	if (record.provenance === "curated") {
		return materializeCurated(id, okayed, catalog, vault, destPath);
	}
	return materializeImported(okayed, record.source, vault, destPath);
}

// ---------------------------------------------------------------------------
// Curated path
// ---------------------------------------------------------------------------

async function materializeCurated(
	id: string,
	okayed: { version: number; checksum: string },
	catalog: CatalogSource,
	vault: Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir">,
	destPath: string,
): Promise<MaterializeResult> {
	// Step 1 — fetch index; map any error to offline
	let index;
	try {
		index = await catalog.fetchIndex();
	} catch (err) {
		debug("[MarkdownMason] materialize: fetchIndex failed for", id, "—", err);
		return { ok: false, reason: "offline" };
	}

	// Step 2 — look up entry; absent id → source-missing
	const entry = index.scripts[id];
	if (entry === undefined) {
		return { ok: false, reason: "source-missing" };
	}

	// Step 3 — fetch raw bytes; map any error to offline
	let bytes: Uint8Array;
	try {
		bytes = await catalog.fetchScript(entry);
	} catch (err) {
		debug("[MarkdownMason] materialize: fetchScript failed for", id, "—", err);
		return { ok: false, reason: "offline" };
	}

	// Step 4 — compute hash of the fetched bytes
	const hash = sha256Bytes(bytes);

	// Step 5 — repo integrity: fetched bytes must match catalog's declared checksum
	if (hash !== entry.checksum) {
		return { ok: false, reason: "checksum-mismatch" };
	}

	// Step 6 — consent check: bytes/version must match the identity okayed on device A
	if (entry.version !== okayed.version || hash !== okayed.checksum) {
		return { ok: false, reason: "drift" };
	}

	// Step 7 — write verbatim (byte-exact, ADR-14)
	// Slice to guard against subarray views: extract exact bytes into a fresh buffer.
	// Cast to ArrayBuffer: buffer.slice always returns a plain ArrayBuffer in the
	// Electron/Node context this plugin targets (no SharedArrayBuffer at play).
	const buf = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
	await mkdirSafe(vault, destPath);
	await vault.writeBinary(destPath, buf);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Imported path
// ---------------------------------------------------------------------------

async function materializeImported(
	okayed: { version: number; checksum: string },
	sourcePath: string,
	vault: Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir">,
	destPath: string,
): Promise<MaterializeResult> {
	// Step 1 — check source file exists
	if (!(await vault.exists(sourcePath))) {
		return { ok: false, reason: "source-missing" };
	}

	// Step 2 — read raw bytes; map any error to source-missing
	let buf: ArrayBuffer;
	try {
		buf = await vault.readBinary(sourcePath);
	} catch {
		return { ok: false, reason: "source-missing" };
	}

	// Step 3 — compute hash of the raw bytes
	const hash = sha256Bytes(new Uint8Array(buf));

	// Step 4 — consent check: bytes must match the identity okayed
	if (hash !== okayed.checksum) {
		return { ok: false, reason: "drift" };
	}

	// Step 5 — write verbatim (buf is already an ArrayBuffer — write directly)
	await mkdirSafe(vault, destPath);
	await vault.writeBinary(destPath, buf);
	return { ok: true };
}

// ---------------------------------------------------------------------------
// Mkdir-safe helper — called ONLY on the write path (fail-closed invariant)
// ---------------------------------------------------------------------------

async function mkdirSafe(
	vault: Pick<VaultAdapterPort, "mkdir">,
	destPath: string,
): Promise<void> {
	if (vault.mkdir === undefined) return;
	const lastSlash = destPath.lastIndexOf("/");
	if (lastSlash <= 0) return;
	await vault.mkdir(destPath.slice(0, lastSlash));
}
