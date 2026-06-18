// No obsidian import — this module is pure domain; unit-testable without Obsidian.

// ---------------------------------------------------------------------------
// Contracts chosen for this parser:
//
// snippet:        The link text (same as title; plain text, e.g. "thestar.com").
//                 Compact single-line defs do not use snippet, but the field is
//                 kept sane for any downstream display.
//
// inline.marker:  The full `[text](url)` substring — the REAL stable locator.
//                 The conversion stage searches body for this string and
//                 replaces it with the footnote reference.
//
// body:           Input returned verbatim (links unchanged). The conversion
//                 stage replaces each marker string in-place with a `[^n]`
//                 reference after deduplication/renumbering.
// ---------------------------------------------------------------------------

import type { FootnoteRef, InlineMarker, ParseResult } from "../core/types";
import type { CitationParser } from "./types";

// Matches a Markdown inline link: [text](url)
// Negative lookbehind (?<!!) excludes image syntax ![alt](url).
// Capture group 1 = text, capture group 2 = url.
const INLINE_LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)]+)\)/g;

// Patterns that disqualify this format (signals a different parser should run).
const SOURCES_BLOCK_RE = /^Sources\b/m;
const CITATIONS_BLOCK_RE = /^Citations:/m;
const QUELLEN_BLOCK_RE = /^Quellen\b/m;
const FOOTNOTE_DEF_RE = /^\[\^[^\]]+\]:/m;

function hasDisqualifyingBlock(input: string): boolean {
	return (
		SOURCES_BLOCK_RE.test(input) ||
		CITATIONS_BLOCK_RE.test(input) ||
		QUELLEN_BLOCK_RE.test(input) ||
		FOOTNOTE_DEF_RE.test(input)
	);
}

function extractLinks(input: string): Array<{ text: string; url: string; raw: string }> {
	const links: Array<{ text: string; url: string; raw: string }> = [];
	let match: RegExpExecArray | null;
	INLINE_LINK_RE.lastIndex = 0;
	while ((match = INLINE_LINK_RE.exec(input)) !== null) {
		links.push({ text: match[1], url: match[2], raw: match[0] });
	}
	return links;
}

function buildSources(links: Array<{ text: string; url: string; raw: string }>): FootnoteRef[] {
	return links.map((link, i) => ({
		incomingId: i + 1,
		snippet: link.text,
		title: link.text,
		url: link.url,
	}));
}

function buildInline(links: Array<{ text: string; url: string; raw: string }>): InlineMarker[] {
	return links.map((link, i) => ({
		marker: link.raw,
		n: i + 1,
	}));
}

export const perplexityWeb: CitationParser = {
	canParse(input: string): boolean {
		if (hasDisqualifyingBlock(input)) return false;
		INLINE_LINK_RE.lastIndex = 0;
		return INLINE_LINK_RE.test(input);
	},

	parse(input: string): ParseResult {
		const links = extractLinks(input);
		return {
			body: input,
			inline: buildInline(links),
			sources: buildSources(links),
		};
	},
};
