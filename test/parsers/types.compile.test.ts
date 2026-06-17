import { describe, it, expect } from "vitest";
import type { CitationParser } from "../../src/parsers/types";
import type { ParseResult } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Compile fixture — verifies that the CitationParser contract in
// src/parsers/types.ts can be constructed from a concrete literal and that
// it correctly references ParseResult from src/core/types.
// The real assertion is that tsc accepted this file (noEmit).
// The trivial it() below lets vitest collect the file so CI surfaces type
// errors as test failures.
// ---------------------------------------------------------------------------

// Concrete ParseResult used as return type in the implementation below.
const _parseResult: ParseResult = {
	body: "Parsed body text.",
	inline: [{ marker: "[^1]", n: 1 }],
	sources: [{ incomingId: 1, snippet: "snippet", title: "Title", url: "https://example.com" }],
};

// CitationParser — concrete implementation satisfying the interface contract.
const _citationParser: CitationParser = {
	canParse(input: string): boolean {
		return input.length > 0;
	},
	parse(input: string): ParseResult {
		void input;
		return _parseResult;
	},
};

// Suppress unused-variable warnings from noUnusedLocals by referencing values.
void _parseResult;
void _citationParser;

describe("src/parsers/types — compile fixture", () => {
	it("CitationParser contract constructs without compile errors", () => {
		// The real assertion is that tsc accepted this file.
		// A runtime truth-check keeps vitest from skipping it.
		expect(true).toBe(true);
	});
});
