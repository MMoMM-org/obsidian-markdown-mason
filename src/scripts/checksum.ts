// T1.1  Byte-exact SHA-256 helper (ADR-14)
//
// DESIGN
// ------
// sha256Bytes hashes raw bytes — never a decoded string. This makes drift
// detection trustworthy: two byte sequences that differ only in line-ending
// encoding (CRLF vs LF) will produce different digests, as they should.
//
// WHY THIS MATTERS (see runtime.ts:96 for the current bug)
// ---------------------------------------------------------
// The original importScript hashes a decoded UTF-8 string. Obsidian's
// vault.adapter.read decodes with the platform default encoding, which can
// silently normalise CRLF to LF — meaning a script that changed only its
// line endings passes the checksum check. sha256Bytes eliminates that hole
// by operating on the raw bytes returned by vault.adapter.readBinary /
// requestUrl arrayBuffer.
//
// USAGE (the contract from the SDD byte-exact example)
// ----------------------------------------------------
//   const bytes: Uint8Array = await catalog.fetchScript(entry);
//   const checksum = sha256Bytes(bytes);  // already includes "sha256:" prefix
//
// DESKTOP-ONLY
// ------------
// Uses node:crypto. Safe on Obsidian Desktop (Electron) where the full Node
// runtime is available — same assumption as runtime.ts.

import { createHash } from "node:crypto";

/**
 * Compute a byte-exact SHA-256 digest and return it with the "sha256:" prefix.
 *
 * Accepts either a Uint8Array or an ArrayBuffer. Both are fed to the hash as
 * raw bytes — no string decoding, no encoding conversion, no newline
 * normalisation.
 */
export function sha256Bytes(bytes: Uint8Array | ArrayBuffer): string {
	const raw = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
	return "sha256:" + createHash("sha256").update(raw).digest("hex");
}
