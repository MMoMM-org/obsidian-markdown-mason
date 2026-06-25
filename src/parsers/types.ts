// No obsidian import — this module is pure domain; unit-testable without Obsidian.

import type { ParseResult } from "../core/types";

export interface CitationParser {
	/** Cheap heuristic: does this parser recognise the input format? */
	canParse(input: string): boolean;
	/** Parse the input into a ParseResult (body + inline markers + sources). */
	parse(input: string): ParseResult;
}
