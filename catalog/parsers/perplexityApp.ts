// No obsidian import — this module is pure domain; unit-testable without Obsidian.

import type { FootnoteRef, InlineMarker, ParseResult } from "../../src/core/types";
import type { CitationParser } from "../../src/parsers/types";

// ---------------------------------------------------------------------------
// Contracts
//
// sources: All FootnoteRef entries across ALL answer blocks, concatenated in
//          document order. incomingId is GLOBALLY UNIQUE and SEQUENTIAL
//          starting at 1. Block 1's entries receive ids 1..N₁; block 2's
//          entries receive ids (N₁+1)..(N₁+N₂); etc. No URL dedup here —
//          the fused-identity stage (resolveFootnoteIdentity) owns dedup.
//          snippet === title (consistent short descriptor).
//
// inline:  Every inline prose [n] occurrence (NOT source-list lines), in
//          document order, with n = the GLOBAL incomingId of the source it
//          references. Block-local [n] values are shifted by the block's
//          offset (count of all sources in preceding blocks).
//
// body:    Answer prose with:
//          (a) inline prose markers renumbered to global [n], and
//          (b) Sources blocks REMOVED — the bare "Sources" marker line AND
//              every following [n] title url source-entry line are stripped.
//          Headings (## Question / ## Answer / ## Key dates … / ## Practical
//          planning tip) and prose are preserved. Answer ordering preserved.
//
// canParse: reads the INPUT (not body) — detects a bare Sources/Citations:/
//           Quellen block. UNCHANGED.
// ---------------------------------------------------------------------------

// Matches a bare "Sources" (or "Citations:" / "Quellen") marker line.
const SOURCES_MARKER_RE = /^(Sources|Citations:|Quellen)\s*$/m;

// Matches a source entry line: "[n] <title> <url>"
// url is the last whitespace-separated http(s) token on the line.
const SOURCE_LINE_RE = /^\[(\d+)\]\s+(.+?)\s+(https?:\/\/\S+)\s*$/;

// Matches inline citation markers such as [1], [12].
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

		if (SOURCES_MARKER_RE.test(line)) {
			inSources = true;
			// Do NOT push the Sources marker line into proseLines — it will be stripped.
			continue;
		}

		if (inSources && line.startsWith("## ")) {
			inSources = false;
		}

		if (inSources) {
			if (SOURCE_LINE_RE.test(line)) {
				current.sourceLines.push(line);
				// Do NOT push source-entry lines into proseLines — they are stripped.
			}
			// Skip blank lines that are part of the sources section too:
			// any non-source content after Sources marker is also not kept.
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
	let globalCounter = 0;
	for (const block of blocks) {
		for (const line of block.sourceLines) {
			const parsed = parseSourceLine(line);
			if (!parsed) continue;
			globalCounter++;
			result.push({ incomingId: globalCounter, ...parsed });
		}
	}
	return result;
}

/**
 * Renumber all inline [n] markers in a prose line by adding offset to each n.
 * Source-entry lines and Sources marker lines are never passed here.
 */
function renumberProseMarkers(line: string, offset: number): string {
	if (offset === 0) return line;
	return line.replace(INLINE_MARKER_RE, (_match, digits: string) => {
		return `[${parseInt(digits, 10) + offset}]`;
	});
}

function collectInlineMarkers(proseLines: string[], offset: number): InlineMarker[] {
	const markers: InlineMarker[] = [];
	for (const line of proseLines) {
		INLINE_MARKER_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = INLINE_MARKER_RE.exec(line)) !== null) {
			const globalN = parseInt(match[1], 10) + offset;
			markers.push({ marker: `[${globalN}]`, n: globalN });
		}
	}
	return markers;
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

function parse(input: string): ParseResult {
	const inputLines = input.split("\n");
	const blocks = splitIntoAnswerBlocks(inputLines);

	// Compute per-block source offsets (count of sources in all preceding blocks).
	const offsets: number[] = [];
	let running = 0;
	for (const block of blocks) {
		offsets.push(running);
		running += block.sourceLines.length;
	}

	const sources = collectSources(blocks);

	// Collect inline markers from each block's prose using the block's offset.
	const inline: InlineMarker[] = [];
	for (let i = 0; i < blocks.length; i++) {
		const blockMarkers = collectInlineMarkers(blocks[i].proseLines, offsets[i]);
		inline.push(...blockMarkers);
	}

	// Build body: pre-answer content + per-block prose lines with renumbered markers.
	// Pre-answer content = everything before the first ## Answer heading.
	const firstAnswerIdx = inputLines.findIndex((l) => l.startsWith("## Answer"));
	const preLines = firstAnswerIdx >= 0 ? inputLines.slice(0, firstAnswerIdx) : [];

	const bodyLines: string[] = [...preLines];
	for (let i = 0; i < blocks.length; i++) {
		const offset = offsets[i];
		for (const line of blocks[i].proseLines) {
			bodyLines.push(renumberProseMarkers(line, offset));
		}
		// Append a blank line between blocks if there is a next block
		if (i < blocks.length - 1) {
			bodyLines.push("");
		}
	}

	const body = bodyLines.join("\n");

	return { body, inline, sources };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const perplexityApp: CitationParser = { canParse, parse };
