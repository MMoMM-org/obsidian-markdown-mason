// Catalog envelope paste parity + chain ordering (T5.2, PRD F10/F11)
//
// Proves the migrated catalog .cjs envelopes preserve the curated paste
// behaviour they replaced:
//   1. PARITY — each envelope's paste.canHandle returns the SAME boolean as the
//      original parser's canParse across the real fixtures (app / web /
//      web-download) and a plain-text negative.
//   2. ORDERING — buildPasteChain over the three loaded curated scripts orders
//      them app → web-download → web (priority DESC: 300 > 200 > 100).
//
// Runs against the committed catalog/dist artifacts. Rebuild with
// `npm run build:catalog` after changing a catalog script/parser/entry.

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as module from "node:module";
import { fileURLToPath } from "node:url";
import { loadFixture } from "../fixtures";
import { loadScriptModule } from "../../src/scripts/loader";
import type { RequireFn, ScriptModule } from "../../src/scripts/loader";
import { buildPasteChain } from "../../src/scripts/paste/buildPasteChain";
import type { LoadedScript } from "../../src/scripts/paste/buildPasteChain";
import type { CatalogIndex } from "../../src/scripts/catalog/catalogSource";
import { perplexityApp } from "../../catalog/parsers/perplexityApp";
import { perplexityWeb } from "../../catalog/parsers/perplexityWeb";
import { perplexityWebDownload } from "../../catalog/parsers/perplexityWebDownload";
import type { CitationParser } from "../../src/parsers/types";

const here = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(here, "../../catalog/dist");

function loadIndex(): CatalogIndex {
	return JSON.parse(fs.readFileSync(path.join(distDir, "index.json"), "utf-8")) as CatalogIndex;
}

function makeRequireFn(): RequireFn {
	const sentinel = path.join(distDir, "_sentinel.cjs");
	return module.createRequire(sentinel) as unknown as RequireFn;
}

function loadEnvelope(id: string): ScriptModule {
	const index = loadIndex();
	const entry = index.scripts[id];
	if (entry === undefined) throw new Error(`missing catalog entry: ${id}`);
	return loadScriptModule(path.join(distDir, entry.path), makeRequireFn());
}

// Fixture inputs + a plain-text negative that no parser should claim.
const PLAIN = "Just some plain prose with no citations at all.\n";
const INPUTS: Record<string, string> = {
	app: loadFixture("app"),
	web: loadFixture("web"),
	webDownload: loadFixture("webDownload"),
	plain: PLAIN,
};

const PARSER_BY_ID: Record<string, CitationParser> = {
	"perplexity-app": perplexityApp,
	"perplexity-web": perplexityWeb,
	"perplexity-web-download": perplexityWebDownload,
};

// ---------------------------------------------------------------------------
// Parity: envelope.paste.canHandle === original parser.canParse, per fixture
// ---------------------------------------------------------------------------

describe("catalog envelope paste.canHandle parity with the original parser", () => {
	for (const id of Object.keys(PARSER_BY_ID)) {
		it(`${id}: canHandle matches parser.canParse across all fixtures`, () => {
			const envelope = loadEnvelope(id);
			const parser = PARSER_BY_ID[id]!;
			expect(envelope.paste, `${id} must have a paste block`).toBeDefined();
			for (const [name, input] of Object.entries(INPUTS)) {
				expect(
					envelope.paste!.canHandle(input),
					`${id}.canHandle("${name}") must equal parser.canParse`,
				).toBe(parser.canParse(input));
			}
		});
	}
});

// ---------------------------------------------------------------------------
// Ordering: buildPasteChain orders app → web-download → web (priority DESC)
// ---------------------------------------------------------------------------

describe("buildPasteChain over the three curated catalog scripts", () => {
	function makeLoaded(id: string): LoadedScript {
		return { id, record: { provenance: "curated" }, module: loadEnvelope(id) };
	}

	it("orders curated scripts app → web-download → web (PRD F10)", () => {
		// Deliberately supply them out of order to prove the sort, not the input order.
		const enabled = [
			makeLoaded("perplexity-web"),
			makeLoaded("perplexity-app"),
			makeLoaded("perplexity-web-download"),
		];
		const chain = buildPasteChain(enabled);
		expect(chain.map((h) => h.id)).toEqual([
			"perplexity-app",
			"perplexity-web-download",
			"perplexity-web",
		]);
	});
});
