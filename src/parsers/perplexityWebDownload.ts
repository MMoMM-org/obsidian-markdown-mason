// No obsidian import — this module is pure domain; unit-testable without Obsidian.

import type { FootnoteRef, InlineMarker, ParseResult } from "../core/types";
import type { CitationParser } from "./types";

// ---------------------------------------------------------------------------
// Contracts
//
// incomingId : sequential 1..N across the whole document, in definition-line
//              order.  Answer-1 defs ([^1_1]..[^1_15]) → ids 1..15.
//              Answer-2 defs ([^2_1]..[^2_11]) → ids 16..26.
// title      : new URL(url).host   (e.g. "www.thestar.com.my")
// snippet    : the raw URL string   (same value as `url`)
// ---------------------------------------------------------------------------

/** Regex that identifies web-download definition lines: [^a_b]: <url> */
const DEF_LINE_RE = /^\[\^(\w+)_(\w+)\]:\s+(\S+)$/;

/** Inline marker pattern: [^a_b] (not followed by :) */
const INLINE_RE = /\[\^(\w+)_(\w+)\](?!:)/g;

/** canParse: true when at least one definition line is present in the input. */
function canParse(input: string): boolean {
	return input.split("\n").some((line) => DEF_LINE_RE.test(line.trim()));
}

/** Strip HTML noise: <img …>, hidden <span…>…</span>, and <div align="center">⁂</div>. */
function stripHtmlNoise(text: string): string {
	// Remove <img ...> tags (self-closing or not)
	let result = text.replace(/<img[^>]*\/?>/gi, "");
	// Remove hidden <span style="display:none">…</span> (may span text with markers)
	result = result.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "");
	// Remove <div align="center">…</div> (the ⁂ dividers)
	result = result.replace(/<div[^>]*>[\s\S]*?<\/div>/gi, "");
	// Remove any bare ⁂ glyphs that may remain
	result = result.replace(/⁂/g, "");
	return result;
}

/** Extract definition lines and build a marker→incomingId lookup. */
function buildSourceMap(lines: string[]): {
	sources: FootnoteRef[];
	markerToId: Map<string, number>;
} {
	const sources: FootnoteRef[] = [];
	const markerToId = new Map<string, number>();
	let seq = 0;

	for (const line of lines) {
		const match = DEF_LINE_RE.exec(line.trim());
		if (!match) continue;
		const [, a, b, url] = match;
		seq++;
		const marker = `[^${a}_${b}]`;
		let host: string;
		try {
			host = new URL(url).host;
		} catch {
			host = url;
		}
		sources.push({ incomingId: seq, snippet: url, title: host, url });
		markerToId.set(marker, seq);
	}

	return { sources, markerToId };
}

/** Build body by removing HTML noise and definition lines, keeping prose. */
function buildBody(stripped: string): string {
	// Work from the noise-stripped version, then remove definition lines
	const strippedLines = stripped.split("\n");
	const bodyLines = strippedLines.filter((line) => {
		return !DEF_LINE_RE.test(line.trim());
	});
	// Collapse runs of more than two consecutive blank lines to at most two
	return bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Extract inline markers from the prose (noise-stripped but defs still present). */
function extractInlineMarkers(
	stripped: string,
	markerToId: Map<string, number>,
): InlineMarker[] {
	// Remove definition lines before scanning so we don't match inside them
	const prose = stripped
		.split("\n")
		.filter((line) => !DEF_LINE_RE.test(line.trim()))
		.join("\n");

	const inline: InlineMarker[] = [];
	let m: RegExpExecArray | null;
	// Fresh instance to avoid shared lastIndex state across calls
	const re = new RegExp(INLINE_RE.source, "g");
	while ((m = re.exec(prose)) !== null) {
		const marker = `[^${m[1]}_${m[2]}]`;
		const n = markerToId.get(marker);
		if (n !== undefined) {
			inline.push({ marker, n });
		}
	}
	return inline;
}

function parse(input: string): ParseResult {
	const lines = input.split("\n");
	const stripped = stripHtmlNoise(input);
	const { sources, markerToId } = buildSourceMap(lines);
	const body = buildBody(stripped);
	const inline = extractInlineMarkers(stripped, markerToId);
	return { body, inline, sources };
}

export const perplexityWebDownload: CitationParser = { canParse, parse };
