// No obsidian import — this module is pure domain; unit-testable without Obsidian.

import type { FootnoteRef, InlineMarker } from "../core/types";
import type { CitationParser } from "./types";

// ---------------------------------------------------------------------------
// Contracts
//
// body:    Full input text, inline [n] markers retained, Sources blocks kept.
//          Nothing is stripped — downstream offset-based rewrites depend on
//          the original text being intact.
//
// sources: All FootnoteRef entries from every answer block, concatenated in
//          document order. incomingId RESTARTS at 1 for each block.
//          snippet = title (same short descriptor, keeps things consistent).
//
// inline:  Every [n] occurrence in answer prose (non-source lines),
//          in document order, per-block numbering as they appear in text.
// ---------------------------------------------------------------------------

// Matches a bare "Sources" (or "Citations:" / "Quellen") marker line.
const SOURCES_MARKER_RE = /^(Sources|Citations:|Quellen)\s*$/m;

// Matches a source entry line: "[n] <title> <url>"
// url is the last whitespace-separated http(s) token on the line.
const SOURCE_LINE_RE = /^\[(\d+)\]\s+(.+?)\s+(https?:\/\/\S+)\s*$/;

// Matches inline citation markers such as [1], [12], but NOT source entry
// lines (those start at column 0 with [n]).
const INLINE_MARKER_RE = /\[(\d+)\]/g;

// ---------------------------------------------------------------------------
// canParse
// ---------------------------------------------------------------------------

function canParse(input: string): boolean {
	if (!SOURCES_MARKER_RE.test(input)) return false;
	// Also require at least one well-formed source entry line.
	return input.split("\n").some((line) => SOURCE_LINE_RE.test(line));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface AnswerBlock {
	proseLines: string[];
	sourceLines: string[];
}

function splitIntoAnswerBlocks(lines: string[]): AnswerBlock[] {
	const blocks: AnswerBlock[] = [];
	let inAnswer = false;
	let inSources = false;
	let current: AnswerBlock = { proseLines: [], sourceLines: [] };

	for (const line of lines) {
		if (line.startsWith("## Answer")) {
			if (inAnswer) blocks.push(current);
			current = { proseLines: [], sourceLines: [] };
			inAnswer = true;
			inSources = false;
			current.proseLines.push(line);
			continue;
		}

		if (!inAnswer) continue;

		if (/^(Sources|Citations:|Quellen)\s*$/.test(line)) {
			inSources = true;
			current.proseLines.push(line);
			continue;
		}

		if (inSources) {
			current.proseLines.push(line);
			if (SOURCE_LINE_RE.test(line)) {
				current.sourceLines.push(line);
			}
		} else {
			current.proseLines.push(line);
		}
	}

	if (inAnswer) blocks.push(current);
	return blocks;
}

function parseSourceLine(line: string): Omit<FootnoteRef, "incomingId"> | null {
	const m = SOURCE_LINE_RE.exec(line);
	if (!m) return null;
	const title = m[2].trim();
	const url = m[3].trim();
	// snippet === title: simple, consistent short descriptor
	return { title, url, snippet: title };
}

function collectSources(blocks: AnswerBlock[]): FootnoteRef[] {
	const result: FootnoteRef[] = [];
	for (const block of blocks) {
		let n = 0;
		for (const line of block.sourceLines) {
			const parsed = parseSourceLine(line);
			if (!parsed) continue;
			n++;
			result.push({ incomingId: n, ...parsed });
		}
	}
	return result;
}

function collectInlineMarkers(lines: string[]): InlineMarker[] {
	const markers: InlineMarker[] = [];
	for (const line of lines) {
		// Skip source entry lines (start with "[n]" at column 0)
		if (SOURCE_LINE_RE.test(line)) continue;
		// Skip bare Sources/Citations/Quellen marker lines
		if (/^(Sources|Citations:|Quellen)\s*$/.test(line)) continue;
		let match: RegExpExecArray | null;
		INLINE_MARKER_RE.lastIndex = 0;
		while ((match = INLINE_MARKER_RE.exec(line)) !== null) {
			markers.push({ marker: `[${match[1]}]`, n: parseInt(match[1], 10) });
		}
	}
	return markers;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

function parse(input: string): import("../core/types").ParseResult {
	const lines = input.split("\n");
	const blocks = splitIntoAnswerBlocks(lines);
	const sources = collectSources(blocks);
	const inline = collectInlineMarkers(lines);
	// body = full input, nothing stripped
	return { body: input, inline, sources };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const perplexityApp: CitationParser = { canParse, parse };
