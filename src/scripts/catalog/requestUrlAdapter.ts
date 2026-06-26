// T2.2  requestUrl CatalogSource adapter (ADR-13, ADR-14)
//
// DESIGN
// ------
// RequestUrlCatalogSource implements the CatalogSource port using Obsidian's
// requestUrl API (not bare fetch — compliance-banned). The adapter is pinned
// to a specific git SHA (PINNED_REF from pinnedRef.ts) so the plugin always
// fetches a known, reviewed revision of the catalog (ADR-13). A moving branch
// ref is never acceptable.
//
// ADR-13: CORS-safe network access via Obsidian requestUrl (not window.fetch).
//         The catalog URL is `${rawBase}/${ref}/index.json` and script URLs are
//         `${rawBase}/${ref}/${entry.path}`. The adapter STAMPS the pinned ref
//         into the returned CatalogIndex — it never trusts a ref field from the
//         document, because the document's ref could differ if the SHA drifts.
//
// ADR-14: fetchScript returns RAW BYTES (Uint8Array) from resp.arrayBuffer.
//         No string decode, no re-encoding. The Materializer (T2.4) hashes the
//         raw bytes with sha256Bytes and compares to entry.checksum before
//         writing to disk.
//
// TESTABILITY
// -----------
// The requestUrl dependency is INJECTED via the RequestUrlFn constructor
// parameter. This lets unit tests supply a fake without importing obsidian.
// The production factory (createCatalogSource) wires in Obsidian's requestUrl
// at runtime; it is never called by unit tests (they inject a fake directly).

import type { CatalogSource, CatalogIndex, CatalogEntry } from "./catalogSource";
import { RAW_BASE, PINNED_REF } from "./pinnedRef";
import { requestUrl } from "obsidian";

// ---------------------------------------------------------------------------
// Injected port types (minimal subset of Obsidian's requestUrl surface)
// ---------------------------------------------------------------------------

/**
 * Minimal response shape used by this adapter.
 * Compatible with Obsidian's RequestUrlResponse (superset).
 */
export interface RequestUrlResponseLike {
	status: number;
	arrayBuffer: ArrayBuffer;
	text: string;
	json: unknown;
}

/**
 * Injected network function type (ADR-13, testability).
 * Matches the `{ url: string }` overload of Obsidian's requestUrl.
 * Tests supply a fake; production uses Obsidian's requestUrl.
 */
export type RequestUrlFn = (params: { url: string }) => Promise<RequestUrlResponseLike>;

// ---------------------------------------------------------------------------
// CatalogFetchError — typed error for network and HTTP failures
// ---------------------------------------------------------------------------

/**
 * Thrown by RequestUrlCatalogSource when a network request fails or returns
 * a non-2xx status. Callers (e.g. Materializer, T2.4) catch this and map it
 * to an offline/unavailable state.
 */
export class CatalogFetchError extends Error {
	/** The full URL that was requested. */
	readonly url: string;
	/** HTTP status code, if available (undefined for network-level failures). */
	readonly status: number | undefined;

	constructor(message: string, url: string, status?: number, options?: ErrorOptions) {
		super(message, options);
		this.name = "CatalogFetchError";
		this.url = url;
		this.status = status;
	}
}

// ---------------------------------------------------------------------------
// RequestUrlCatalogSource
// ---------------------------------------------------------------------------

/** Optional constructor overrides — used in tests to pin deterministic URLs. */
interface SourceOptions {
	rawBase?: string;
	ref?: string;
}

/**
 * Concrete CatalogSource that fetches from the curated script repository at
 * a build-time-pinned SHA using Obsidian's requestUrl (ADR-13).
 *
 * Inject a fake RequestUrlFn in tests — never import from "obsidian" in tests.
 * Use createCatalogSource() for the production instance.
 */
export class RequestUrlCatalogSource implements CatalogSource {
	private readonly requestUrlFn: RequestUrlFn;
	private readonly rawBase: string;
	private readonly ref: string;

	constructor(requestUrlFn: RequestUrlFn, options?: SourceOptions) {
		this.requestUrlFn = requestUrlFn;
		this.rawBase = (options?.rawBase ?? RAW_BASE).replace(/\/$/, "");
		this.ref = options?.ref ?? PINNED_REF;
	}

	/** Fetch the catalog index. Stamps `ref` with the pinned SHA (ADR-13). */
	async fetchIndex(): Promise<CatalogIndex> {
		const url = `${this.rawBase}/${this.ref}/index.json`;
		const resp = await this.request(url);
		const doc = this.parseJson(resp, url);
		return {
			schemaVersion: (doc as { schemaVersion: number }).schemaVersion,
			ref: this.ref,
			scripts: (doc as { scripts: Record<string, CatalogEntry> }).scripts,
		};
	}

	/** Fetch raw bytes for a script entry (ADR-14 — never decode to string). */
	async fetchScript(entry: CatalogEntry): Promise<Uint8Array> {
		const url = `${this.rawBase}/${this.ref}/${entry.path}`;
		const resp = await this.request(url);
		return new Uint8Array(resp.arrayBuffer);
	}

	private async request(url: string): Promise<RequestUrlResponseLike> {
		let resp: RequestUrlResponseLike;
		try {
			resp = await this.requestUrlFn({ url });
		} catch (cause) {
			throw new CatalogFetchError(`Network failure fetching ${url}`, url, undefined, {
				cause: cause instanceof Error ? cause : undefined,
			});
		}
		if (resp.status < 200 || resp.status >= 300) {
			throw new CatalogFetchError(
				`HTTP ${resp.status} fetching ${url}`,
				url,
				resp.status,
			);
		}
		return resp;
	}

	private parseJson(resp: RequestUrlResponseLike, url: string): unknown {
		if (resp.json !== null && resp.json !== undefined) {
			return resp.json;
		}
		try {
			return JSON.parse(resp.text);
		} catch (cause) {
			throw new CatalogFetchError(
				`Failed to parse catalog index JSON from ${url}`,
				url,
				resp.status,
				{ cause: cause instanceof Error ? cause : undefined },
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Production factory — ONLY place that imports from "obsidian"
// ---------------------------------------------------------------------------

/**
 * Returns the production CatalogSource backed by Obsidian's requestUrl.
 * Never import this in tests — inject a fake RequestUrlFn into
 * RequestUrlCatalogSource directly.
 */
export function createCatalogSource(): CatalogSource {
	return new RequestUrlCatalogSource(requestUrl);
}
