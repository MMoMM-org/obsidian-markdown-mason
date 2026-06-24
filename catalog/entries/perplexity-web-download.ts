// Catalog entry envelope — Perplexity web-download (ADR-16)
//
// Standalone `perplexity-web-download.cjs` artifact entry point. Wraps the
// pure-domain script + parser into the ADR-16 envelope.
//
// PRIORITY (PRD F10 / detect order): perplexity-web-download = 200.

import { perplexityWebDownloadScript } from "../scripts/perplexityWebDownload";
import { perplexityWebDownload } from "../parsers/perplexityWebDownload";

export default {
	run: perplexityWebDownloadScript,
	paste: {
		canHandle: (input: string): boolean => perplexityWebDownload.canParse(input),
		priority: 200,
	},
};
