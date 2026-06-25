// Catalog entry envelope — Perplexity app (ADR-16)
//
// This file is the esbuild entry point for the standalone `perplexity-app.cjs`
// artifact. It wraps the pure-domain script function and its parser's canParse
// predicate into the ADR-16 envelope shape that loadScriptModule expects:
//
//   module.exports = { run, paste: { canHandle, priority } }
//
// PRIORITY (PRD F10 / detect order): perplexity-app = 300 (tried first).
//
// PURITY: the bundled graph imports only catalog scripts/parsers and the shared
// pure-domain src/core/* helpers. There is NO obsidian import, so esbuild
// produces a fully self-contained .cjs with no externals.

import { perplexityAppScript } from "../scripts/perplexityApp";
import { perplexityApp } from "../parsers/perplexityApp";

export default {
	run: perplexityAppScript,
	paste: {
		canHandle: (input: string): boolean => perplexityApp.canParse(input),
		priority: 300,
	},
};
