// T1.1  Byte-exact checksum helper (ADR-14)
//
// Tests behaviour of sha256Bytes: hashing must operate on raw bytes, not decoded
// strings. The key correctness property is that byte sequences that differ only in
// line-ending encoding (CRLF vs LF) produce DIFFERENT digests — proving no
// normalisation happens inside the helper.

import { describe, it, expect } from "vitest";
import { sha256Bytes } from "../../src/scripts/checksum";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a Uint8Array from a literal byte sequence — never relies on TextEncoder
 * line-ending behaviour so the intended byte sequences are explicit. */
function bytes(...values: number[]): Uint8Array {
	return new Uint8Array(values);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sha256Bytes", () => {
	it("returns a string prefixed with 'sha256:'", () => {
		const result = sha256Bytes(bytes(0x61)); // single byte: 'a'
		expect(result.startsWith("sha256:")).toBe(true);
	});

	it("hex digest follows the prefix and is 64 characters long", () => {
		const result = sha256Bytes(bytes(0x61));
		const hex = result.slice("sha256:".length);
		expect(hex).toHaveLength(64);
		expect(/^[0-9a-f]{64}$/.test(hex)).toBe(true);
	});

	it("identical byte sequences produce identical digests", () => {
		const a = sha256Bytes(new Uint8Array([1, 2, 3]));
		const b = sha256Bytes(new Uint8Array([1, 2, 3]));
		expect(a).toBe(b);
	});

	it("CRLF and LF byte sequences produce DIFFERENT digests (byte-exact proof)", () => {
		// "a\r\nb" in bytes:  0x61 0x0d 0x0a 0x62
		// "a\nb"  in bytes:  0x61 0x0a 0x62
		// If the helper ever decodes to a JS string or normalises newlines these
		// would collapse to the same digest — the test would fail, revealing the bug.
		const crlf = bytes(0x61, 0x0d, 0x0a, 0x62); // a CR LF b
		const lf   = bytes(0x61, 0x0a, 0x62);        // a LF b
		expect(sha256Bytes(crlf)).not.toBe(sha256Bytes(lf));
	});

	it("accepts an ArrayBuffer and produces the same digest as the equivalent Uint8Array", () => {
		const arr = new Uint8Array([10, 20, 30]);
		const buf: ArrayBuffer = arr.buffer;
		expect(sha256Bytes(buf)).toBe(sha256Bytes(arr));
	});

	it("empty input returns a stable, non-empty digest", () => {
		const result = sha256Bytes(new Uint8Array(0));
		// SHA-256 of empty input is deterministic — just verify format
		expect(result).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("produces the canonical SHA-256 digest for a known input", () => {
		// SHA-256("a") — RFC/NIST known-answer vector
		expect(sha256Bytes(bytes(0x61)))
			.toBe("sha256:ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb");
	});

	it("produces the canonical SHA-256 digest for empty input", () => {
		// SHA-256("") — known-answer vector
		expect(sha256Bytes(bytes()))
			.toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	});
});
