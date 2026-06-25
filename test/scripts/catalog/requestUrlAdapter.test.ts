import { describe, it, expect } from "vitest";
import {
	RequestUrlCatalogSource,
	CatalogFetchError,
} from "../../../src/scripts/catalog/requestUrlAdapter";
import { RAW_BASE, PINNED_REF } from "../../../src/scripts/catalog/pinnedRef";
import type { CatalogEntry } from "../../../src/scripts/catalog/catalogSource";
import type { RequestUrlFn, RequestUrlResponseLike } from "../../../src/scripts/catalog/requestUrlAdapter";

// ---------------------------------------------------------------------------
// Test factories
// ---------------------------------------------------------------------------

const makeEntry = (overrides?: Partial<CatalogEntry>): CatalogEntry => ({
	id: "perplexity-app",
	version: 3,
	checksum: "sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
	path: "scripts/perplexity-app.cjs",
	name: "Perplexity App",
	description: "Search the web via Perplexity from Obsidian.",
	...overrides,
});

/** Build a minimal fake catalog index document body (as parsed JSON). */
const makeIndexDoc = (overrides?: { schemaVersion?: number; ref?: string; scripts?: Record<string, CatalogEntry> }) => ({
	schemaVersion: overrides?.schemaVersion ?? 1,
	ref: overrides?.ref ?? "document-sha-that-should-be-overridden",
	scripts: overrides?.scripts ?? { "perplexity-app": makeEntry() },
});

/** Build a fake RequestUrlResponseLike with a JSON body. */
const makeJsonResponse = (json: unknown, status = 200): RequestUrlResponseLike => ({
	status,
	json,
	text: JSON.stringify(json),
	arrayBuffer: new ArrayBuffer(0),
});

/** Build a fake RequestUrlResponseLike with a binary body. */
const makeBinaryResponse = (bytes: Uint8Array, status = 200): RequestUrlResponseLike => ({
	status,
	json: null,
	text: "",
	arrayBuffer: bytes.buffer as ArrayBuffer,
});

/** Fake requestUrlFn that always resolves with the given response. */
const makeOkFn = (resp: RequestUrlResponseLike): RequestUrlFn =>
	async (_params) => resp;

/** Fake requestUrlFn that captures the last url called, then resolves. */
const makeCapturingFn = (resp: RequestUrlResponseLike): { fn: RequestUrlFn; lastUrl: () => string } => {
	let captured = "";
	const fn: RequestUrlFn = async (params) => {
		captured = params.url;
		return resp;
	};
	return { fn, lastUrl: () => captured };
};

/** Fake requestUrlFn that always rejects with the given error. */
const makeRejectingFn = (err: Error): RequestUrlFn =>
	async (_params) => {
		throw err;
	};

// ---------------------------------------------------------------------------
// Suite: fetchIndex
// ---------------------------------------------------------------------------

describe("RequestUrlCatalogSource.fetchIndex (T2.2, ADR-13)", () => {
	it("builds the correct index URL from the pinned constants by default", async () => {
		const indexDoc = makeIndexDoc();
		const { fn, lastUrl } = makeCapturingFn(makeJsonResponse(indexDoc));
		const source = new RequestUrlCatalogSource(fn);

		await source.fetchIndex();

		expect(lastUrl()).toBe(`${RAW_BASE}/${PINNED_REF}/index.json`);
	});

	it("returns a CatalogIndex with ref stamped as PINNED_REF, not the document's ref", async () => {
		// Document carries a DIFFERENT ref — adapter must override it with PINNED_REF.
		const indexDoc = makeIndexDoc({ ref: "this-is-a-different-sha-from-the-document" });
		const source = new RequestUrlCatalogSource(makeOkFn(makeJsonResponse(indexDoc)));

		const result = await source.fetchIndex();

		// Adapter stamps the pinned ref — never trusts the document's ref field.
		expect(result.ref).toBe(PINNED_REF);
	});

	it("preserves schemaVersion from the document", async () => {
		const indexDoc = makeIndexDoc({ schemaVersion: 42 });
		const source = new RequestUrlCatalogSource(makeOkFn(makeJsonResponse(indexDoc)));

		const result = await source.fetchIndex();

		expect(result.schemaVersion).toBe(42);
	});

	it("preserves the scripts map from the document", async () => {
		const scripts = { "perplexity-app": makeEntry() };
		const indexDoc = makeIndexDoc({ scripts });
		const source = new RequestUrlCatalogSource(makeOkFn(makeJsonResponse(indexDoc)));

		const result = await source.fetchIndex();

		expect(result.scripts).toEqual(scripts);
	});

	it("falls back to JSON.parse(resp.text) when resp.json is not available", async () => {
		const indexDoc = makeIndexDoc();
		// Provide a response with no .json field — only .text
		const resp: RequestUrlResponseLike = {
			status: 200,
			json: undefined as unknown as null,
			text: JSON.stringify(indexDoc),
			arrayBuffer: new ArrayBuffer(0),
		};
		const source = new RequestUrlCatalogSource(makeOkFn(resp));

		const result = await source.fetchIndex();

		expect(result.schemaVersion).toBe(1);
		expect(result.ref).toBe(PINNED_REF);
	});

	it("throws CatalogFetchError on network failure (requestUrlFn rejects)", async () => {
		const networkErr = new Error("Network unavailable");
		const source = new RequestUrlCatalogSource(makeRejectingFn(networkErr));

		await expect(source.fetchIndex()).rejects.toBeInstanceOf(CatalogFetchError);
	});

	it("CatalogFetchError from network failure carries the url", async () => {
		const source = new RequestUrlCatalogSource(makeRejectingFn(new Error("timeout")));

		const err = await source.fetchIndex().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CatalogFetchError);
		expect((err as CatalogFetchError).url).toBe(`${RAW_BASE}/${PINNED_REF}/index.json`);
	});

	it("throws CatalogFetchError on non-2xx response (404)", async () => {
		const indexDoc = makeIndexDoc();
		const source = new RequestUrlCatalogSource(makeOkFn(makeJsonResponse(indexDoc, 404)));

		await expect(source.fetchIndex()).rejects.toBeInstanceOf(CatalogFetchError);
	});

	it("CatalogFetchError from non-2xx carries the status (404)", async () => {
		const source = new RequestUrlCatalogSource(makeOkFn(makeJsonResponse(makeIndexDoc(), 404)));

		const err = await source.fetchIndex().catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CatalogFetchError);
		expect((err as CatalogFetchError).status).toBe(404);
	});

	it("accepts constructor overrides for rawBase and ref (deterministic test base)", async () => {
		const indexDoc = makeIndexDoc();
		const { fn, lastUrl } = makeCapturingFn(makeJsonResponse(indexDoc));
		const source = new RequestUrlCatalogSource(fn, {
			rawBase: "https://example.com",
			ref: "test-sha-123",
		});

		await source.fetchIndex();

		expect(lastUrl()).toBe("https://example.com/test-sha-123/index.json");
	});

	it("stamps overridden ref (not PINNED_REF) when constructor ref option is provided", async () => {
		const source = new RequestUrlCatalogSource(
			makeOkFn(makeJsonResponse(makeIndexDoc())),
			{ rawBase: "https://example.com", ref: "test-sha-123" },
		);

		const result = await source.fetchIndex();

		expect(result.ref).toBe("test-sha-123");
	});

	it("throws CatalogFetchError when resp.json is null and resp.text is malformed JSON (W1)", async () => {
		const resp: RequestUrlResponseLike = {
			status: 200,
			json: null,
			text: "THIS IS NOT JSON",
			arrayBuffer: new ArrayBuffer(0),
		};
		const source = new RequestUrlCatalogSource(makeOkFn(resp));

		await expect(source.fetchIndex()).rejects.toBeInstanceOf(CatalogFetchError);
	});

	it("normalizes rawBase trailing slash to prevent double-slash URLs (S1)", async () => {
		const { fn, lastUrl } = makeCapturingFn(makeJsonResponse(makeIndexDoc()));
		const source = new RequestUrlCatalogSource(fn, {
			rawBase: "https://example.com/",
			ref: "test-sha-123",
		});

		await source.fetchIndex();

		expect(lastUrl()).toBe("https://example.com/test-sha-123/index.json");
	});
});

// ---------------------------------------------------------------------------
// Suite: fetchScript
// ---------------------------------------------------------------------------

describe("RequestUrlCatalogSource.fetchScript (T2.2, ADR-14)", () => {
	it("builds the correct script URL from entry.path and pinned constants", async () => {
		const entry = makeEntry({ path: "scripts/perplexity-app.cjs" });
		const { fn, lastUrl } = makeCapturingFn(makeBinaryResponse(new Uint8Array([1, 2, 3])));
		const source = new RequestUrlCatalogSource(fn);

		await source.fetchScript(entry);

		expect(lastUrl()).toBe(`${RAW_BASE}/${PINNED_REF}/scripts/perplexity-app.cjs`);
	});

	it("returns a Uint8Array (raw bytes, ADR-14)", async () => {
		const bytes = new Uint8Array([0xca, 0xfe, 0xba, 0xbe]);
		const source = new RequestUrlCatalogSource(makeOkFn(makeBinaryResponse(bytes)));

		const result = await source.fetchScript(makeEntry());

		expect(result).toBeInstanceOf(Uint8Array);
	});

	it("returns byte-exact content matching the fake's arrayBuffer", async () => {
		const expected = new Uint8Array([0x01, 0x02, 0x03, 0xff]);
		const source = new RequestUrlCatalogSource(makeOkFn(makeBinaryResponse(expected)));

		const result = await source.fetchScript(makeEntry());

		expect(Array.from(result)).toEqual(Array.from(expected));
	});

	it("throws CatalogFetchError on network failure (requestUrlFn rejects)", async () => {
		const source = new RequestUrlCatalogSource(makeRejectingFn(new Error("offline")));

		await expect(source.fetchScript(makeEntry())).rejects.toBeInstanceOf(CatalogFetchError);
	});

	it("CatalogFetchError from network failure carries the url", async () => {
		const entry = makeEntry({ path: "scripts/perplexity-app.cjs" });
		const source = new RequestUrlCatalogSource(makeRejectingFn(new Error("offline")));

		const err = await source.fetchScript(entry).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CatalogFetchError);
		expect((err as CatalogFetchError).url).toBe(
			`${RAW_BASE}/${PINNED_REF}/scripts/perplexity-app.cjs`,
		);
	});

	it("throws CatalogFetchError on non-2xx response (500)", async () => {
		const source = new RequestUrlCatalogSource(
			makeOkFn(makeBinaryResponse(new Uint8Array([]), 500)),
		);

		await expect(source.fetchScript(makeEntry())).rejects.toBeInstanceOf(CatalogFetchError);
	});

	it("CatalogFetchError from non-2xx carries the status (500)", async () => {
		const source = new RequestUrlCatalogSource(
			makeOkFn(makeBinaryResponse(new Uint8Array([]), 500)),
		);

		const err = await source.fetchScript(makeEntry()).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(CatalogFetchError);
		expect((err as CatalogFetchError).status).toBe(500);
	});

	it("accepts constructor overrides for rawBase and ref", async () => {
		const entry = makeEntry({ path: "scripts/my-script.cjs" });
		const { fn, lastUrl } = makeCapturingFn(makeBinaryResponse(new Uint8Array([1])));
		const source = new RequestUrlCatalogSource(fn, {
			rawBase: "https://example.com",
			ref: "test-sha-abc",
		});

		await source.fetchScript(entry);

		expect(lastUrl()).toBe("https://example.com/test-sha-abc/scripts/my-script.cjs");
	});
});
