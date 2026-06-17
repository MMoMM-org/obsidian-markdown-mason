// No obsidian import — this module is pure domain; unit-testable without Obsidian.

import type { CitationParser } from "./types";
import { perplexityApp } from "./perplexityApp";
import { perplexityWeb } from "./perplexityWeb";
import { perplexityWebDownload } from "./perplexityWebDownload";

// ---------------------------------------------------------------------------
// Precedence order (first match wins):
//   1. app        — Sources/Citations:/Quellen marker block
//   2. web-download — [^a_b]: definition lines
//   3. web          — inline [text](url) links only
//   4. null         — no recognisable format
//
// Why app before web: an app-format copy frequently contains inline [text](url)
// links alongside the structured Sources block (e.g. Perplexity embeds them
// in prose). If web ran first, those inputs would be misclassified. The Sources
// block is the more specific, reliable signal and must win.
//
// Why web-download before web: web-download docs may also contain inline links
// in prose, but their canonical citation mechanism is [^a_b]: def lines. The
// def lines are the stronger, unambiguous signal and must win.
// ---------------------------------------------------------------------------

export function detect(input: string): CitationParser | null {
	if (perplexityApp.canParse(input)) return perplexityApp;
	if (perplexityWebDownload.canParse(input)) return perplexityWebDownload;
	if (perplexityWeb.canParse(input)) return perplexityWeb;
	return null;
}
