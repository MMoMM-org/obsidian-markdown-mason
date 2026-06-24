// T5.1  DevDirAdapter — local-directory CatalogSource for dev builds (ADR-15)
//
// DESIGN
// ------
// DevDirAdapter implements the CatalogSource port using Node fs reads against
// a LOCAL working-tree directory instead of the network. It is gated behind
// `if (__MASON_DEV__)` at every call site so esbuild tree-shakes this entire
// module from the production bundle (ADR-15).
//
// The directory path (the "override") comes from:
//   1. Constructor argument: new DevDirAdapter(dir)  — for testing / direct use
//   2. MASON_DEV_DIR environment variable             — via createDevDirAdapter()
//
// The dir path NEVER comes from data.json or ScriptRecord. There is no read
// path from those structures into this adapter.
//
// UNIQUE MARKER (DCE probe)
// -------------------------
// The string literal below is present ONLY in this module. The prod-bundle DCE
// test (test/build/devAdapterDce.test.ts) greps for it in the prod bundle to
// assert that esbuild eliminated this code path when __MASON_DEV__ is "false".
//
// BYTE-EXACT READS (ADR-14)
// -------------------------
// fetchScript reads the .cjs file as raw bytes via fs.readFileSync with no
// encoding argument, returning a Uint8Array directly. No string decode, no
// re-encoding. Callers (Materializer) hash these bytes with sha256Bytes before
// writing to disk.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CatalogSource, CatalogIndex, CatalogEntry } from "./catalogSource";

// ---------------------------------------------------------------------------
// DevDirAdapter
// ---------------------------------------------------------------------------

/**
 * CatalogSource implementation that reads the catalog index and script bytes
 * from a local working-tree directory (ADR-15 dev-source override).
 *
 * Use ONLY inside `if (__MASON_DEV__)` blocks so esbuild can tree-shake this
 * class out of the production bundle.
 *
 * The directory must contain:
 *   - index.json        — a well-formed CatalogIndex document
 *   - <entry.path>      — the .cjs script file(s) (e.g. scripts/perplexity-app.cjs)
 */
export class DevDirAdapter implements CatalogSource {
	private readonly dir: string;

	/**
	 * @param dir — absolute path to the local catalog working-tree directory.
	 *              Typically provided via MASON_DEV_DIR env var through
	 *              createDevDirAdapter(), or injected directly in tests.
	 */
	constructor(dir: string) {
		this.dir = dir;
	}

	/**
	 * Read and parse index.json from the local dir.
	 * Throws (rejects) if the file is absent or unparseable — consistent with
	 * the network adapter which throws CatalogFetchError on failure.
	 */
	async fetchIndex(): Promise<CatalogIndex> {
		const indexPath = join(this.dir, "index.json");
		let text: string;
		try {
			text = readFileSync(indexPath, "utf-8");
		} catch (cause) {
			throw new Error(
				`DevDirAdapter: failed to read ${indexPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause: cause instanceof Error ? cause : undefined },
			);
		}

		let doc: unknown;
		try {
			doc = JSON.parse(text);
		} catch (cause) {
			throw new Error(
				`DevDirAdapter: failed to parse ${indexPath} as JSON`,
				{ cause: cause instanceof Error ? cause : undefined },
			);
		}

		// Return the parsed index directly — ref is taken from the document
		// (unlike the network adapter which stamps the pinned ref; here the
		// local doc's ref is authoritative for the dev session).
		return doc as CatalogIndex;
	}

	/**
	 * Read raw bytes for the .cjs file at <dir>/<entry.path> (ADR-14).
	 * Never decodes to string. Throws if the file is absent.
	 */
	async fetchScript(entry: CatalogEntry): Promise<Uint8Array> {
		const scriptPath = join(this.dir, entry.path);
		let buf: Buffer;
		try {
			buf = readFileSync(scriptPath);
		} catch (cause) {
			throw new Error(
				`DevDirAdapter: failed to read script ${scriptPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
				{ cause: cause instanceof Error ? cause : undefined },
			);
		}

		// Uint8Array view over the Buffer (zero-copy; byte-exact per ADR-14).
		return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
	}
}

// ---------------------------------------------------------------------------
// Factory: reads dir from MASON_DEV_DIR env var
// ---------------------------------------------------------------------------

/**
 * Create a DevDirAdapter whose dir is read from the MASON_DEV_DIR environment
 * variable. Throws immediately if the variable is not set.
 *
 * Call only inside `if (__MASON_DEV__)` blocks.
 */
// DCE sentinel: the string __MASON_DEV_DIR_ADAPTER__ must appear in dev bundles
// and be absent from prod bundles. It is embedded here so it survives in the
// emitted JS when this module is included (dev build) and is eliminated when
// the module is tree-shaken (prod build, __MASON_DEV__ = false).
export function createDevDirAdapter(): DevDirAdapter {
	const dir = process.env["MASON_DEV_DIR"];
	if (dir === undefined || dir === "") {
		throw new Error(
			"[__MASON_DEV_DIR_ADAPTER__] MASON_DEV_DIR env var is not set. " +
			"Set it to the absolute path of your local catalog working-tree directory.",
		);
	}
	return new DevDirAdapter(dir);
}
