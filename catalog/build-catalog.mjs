// Catalog build — compile curated scripts to standalone .cjs envelopes + index.json
//
// WHAT THIS DOES (ADR-16, PRD F11)
// --------------------------------
// For each catalog entry under catalog/entries/, esbuild bundles a fully
// self-contained CommonJS module that exports the ADR-16 envelope:
//
//   module.exports = { run, paste: { canHandle, priority } }
//
// The bundled graph reaches only the pure-domain catalog scripts/parsers and
// the shared src/core/* helpers — NO obsidian import — so each .cjs is fully
// standalone (no externals). The .cjs files are emitted to catalog/dist/, and a
// CatalogIndex (catalog/dist/index.json) is generated alongside with a byte-exact
// sha256:<hex> checksum over each emitted .cjs (same algorithm as
// src/scripts/checksum.ts → sha256Bytes).
//
// REBUILD: `npm run build:catalog`. The committed catalog/dist/ artifacts are the
// deterministic inputs that the catalog tests + DevDirAdapter read.
//
// PINNED REF: index.json.ref is a placeholder constant here. The real release SHA
// is injected at release time (the SHA of the catalog commit the plugin pins to);
// see PINNED_REF_PLACEHOLDER below.

import esbuild from "esbuild";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = join(here, "dist");

// ---------------------------------------------------------------------------
// Entry manifest — id, entry source, user-facing name/description, version.
// Priorities live in the envelope wrappers (catalog/entries/*.ts), NOT here:
// the wrapper is the single source of truth for paste.priority (PRD F10).
// ---------------------------------------------------------------------------

const ENTRIES = [
	{
		id: "perplexity-app",
		entry: "entries/perplexity-app.ts",
		name: "Perplexity app",
		description: "Convert a Perplexity app copy-paste into a structured note with cascaded headings and filed footnotes.",
	},
	{
		id: "perplexity-web-download",
		entry: "entries/perplexity-web-download.ts",
		name: "Perplexity web download",
		description: "Convert a Perplexity web-download copy-paste into a structured note with cascaded headings and filed footnotes.",
	},
	{
		id: "perplexity-web",
		entry: "entries/perplexity-web.ts",
		name: "Perplexity web",
		description: "Convert a Perplexity web copy-paste into a structured note with cascaded headings and filed footnotes.",
	},
	{
		id: "backtick-code-tokens",
		entry: "entries/backtick-code-tokens.ts",
		name: "Backtick code tokens",
		description: "Backtick code-ish tokens (file:line refs, dotted identifiers, wikilinks, dataview fields) so Obsidian renders them literally. Command-only; run on a selection.",
		version: 1, // fresh script — its own version, independent of the shared perplexity SCRIPT_VERSION
	},
];

// schemaVersion of the CatalogIndex document shape (CatalogIndex.schemaVersion).
const SCHEMA_VERSION = 1;

// Per-script catalog version (CatalogEntry.version). Bump when a script's behaviour
// changes in a user-visible way.
// v2: cascadeOrInsert fix — pasting into a blank note no longer drops the body.
// v3: F-1 fix — an unresolvable perplexity-app citation stays a plain [n] instead
//     of becoming a dangling [^n] footnote with no definition.
// v4: format-in-place — run as a command on a selection now REPLACES the selected
//     raw text (via OperationContext.replaceRange) instead of inserting a formatted
//     copy at the cursor and leaving the original behind (which duplicated it).
const SCRIPT_VERSION = 4;

// Pinned git ref placeholder. The real release SHA (40 hex chars) is injected at
// release time — the SHA of the catalog commit the shipped plugin pins to.
const PINNED_REF_PLACEHOLDER = "0000000000000000000000000000000000000000";

// ---------------------------------------------------------------------------
// sha256:<hex> — byte-exact, identical to src/scripts/checksum.ts sha256Bytes.
// ---------------------------------------------------------------------------

function sha256Bytes(bytes) {
	return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async function buildEntry(entry) {
	const outfile = join(distDir, `${entry.id}.cjs`);
	await esbuild.build({
		entryPoints: [join(here, entry.entry)],
		outfile,
		bundle: true,
		format: "cjs",
		platform: "node",
		target: "es2020",
		treeShaking: true,
		// Fully self-contained pure domain — NO external. A leftover obsidian import
		// would surface here as a bundle error (desired: catalog scripts must be pure).
		external: [],
		logLevel: "warning",
	});
	const bytes = readFileSync(outfile);
	return {
		id: entry.id,
		version: entry.version ?? SCRIPT_VERSION,
		checksum: sha256Bytes(bytes),
		path: `${entry.id}.cjs`,
		name: entry.name,
		description: entry.description,
	};
}

async function main() {
	mkdirSync(distDir, { recursive: true });

	const scripts = {};
	for (const entry of ENTRIES) {
		const built = await buildEntry(entry);
		scripts[built.id] = built;
		console.log(`  built ${built.path} → ${built.checksum}`);
	}

	const index = {
		schemaVersion: SCHEMA_VERSION,
		ref: PINNED_REF_PLACEHOLDER,
		scripts,
	};

	const indexPath = join(distDir, "index.json");
	writeFileSync(indexPath, JSON.stringify(index, null, "\t") + "\n");
	console.log(`  wrote ${indexPath}`);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
