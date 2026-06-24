// Catalog entry envelope — Perplexity web (ADR-16)
//
// Standalone `perplexity-web.cjs` artifact entry point. Wraps the pure-domain
// script + parser into the ADR-16 envelope.
//
// PRIORITY (PRD F10 / detect order): perplexity-web = 100 (tried last).

import { perplexityWebScript } from "../scripts/perplexityWeb";
import { perplexityWeb } from "../parsers/perplexityWeb";

export default {
	run: perplexityWebScript,
	paste: {
		canHandle: (input: string): boolean => perplexityWeb.canParse(input),
		priority: 100,
	},
};
