// T2.1  CatalogSource port — catalog distribution interface (ADR-13)
//
// PORT DESIGN
// -----------
// CatalogSource is a minimal DI port (mirrors PluginDataPort / VaultAdapterPort
// style) that abstracts remote catalog access behind two methods:
//
//   fetchIndex()             — returns CatalogIndex (schemaVersion, pinned git
//                              SHA ref, scripts record-by-id) from the catalog
//                              JSON at a build-time-pinned SHA.
//   fetchScript(entry)       — returns raw bytes (Uint8Array) for the .cjs file
//                              at the pinned ref. Callers (Materializer, T2.4)
//                              hash these bytes with sha256Bytes and compare to
//                              entry.checksum before writing to disk (ADR-14).
//
// ADR-13: production adapter (T2.2) calls Obsidian requestUrl at a
//         build-time-pinned SHA so the plugin always fetches a known revision.
//
// ADR-14: fetchScript returns RAW BYTES (Uint8Array), never a decoded string.
//         Binary-safe — the Materializer hashes bytes and verifies the
//         sha256:<hex> checksum before writing.
//
// This file contains ONLY types and interfaces — no runtime logic, no Obsidian
// import, no node imports. Tests inject a network-free fake.

// ---------------------------------------------------------------------------
// CatalogEntry — per-script metadata carried in the catalog index
// ---------------------------------------------------------------------------

/**
 * Metadata for a single script in the catalog index.
 *
 * checksum: "sha256:"+hex (same convention as ScriptRecord.okayed.checksum and
 *           the output of sha256Bytes in src/scripts/checksum.ts).
 * path:     repo-relative path to the .cjs file (e.g. "scripts/perplexity-app.cjs").
 */
export interface CatalogEntry {
	id: string;
	version: number;
	checksum: string;
	path: string;
	name: string;
	description: string;
}

// ---------------------------------------------------------------------------
// CatalogIndex — top-level catalog document fetched from the pinned ref
// ---------------------------------------------------------------------------

/**
 * The full catalog document returned by CatalogSource.fetchIndex().
 *
 * ref: git SHA string pinned at build time.
 * scripts: record keyed by script id, each value a CatalogEntry.
 */
export interface CatalogIndex {
	schemaVersion: number;
	ref: string;
	scripts: Record<string, CatalogEntry>;
}

// ---------------------------------------------------------------------------
// CatalogSource port — injected, no Obsidian import at the top level
// ---------------------------------------------------------------------------

/**
 * Distribution port for the script catalog (ADR-13).
 *
 * Concrete adapter: T2.2 (uses Obsidian requestUrl at a build-time-pinned SHA).
 * Tests: inject a network-free fake (see test/scripts/catalog/catalogSource.test.ts).
 *
 * Exactly two methods — keep the port minimal.
 */
export interface CatalogSource {
	/** Fetch the catalog index document from the pinned ref. */
	fetchIndex(): Promise<CatalogIndex>;

	/** Fetch raw bytes for the .cjs file described by entry (ADR-14). */
	fetchScript(entry: CatalogEntry): Promise<Uint8Array>;
}
