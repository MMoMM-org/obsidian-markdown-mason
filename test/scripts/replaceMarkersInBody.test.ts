// replaceMarkersInBody tests
//
// Tests cover: single marker replaced, same marker string appearing twice (per-marker
// offset queue), and empty inline returning body unchanged.

import { describe, it, expect } from "vitest";
import { replaceMarkersInBody } from "../../src/scripts/library/replaceMarkersInBody";
import type { InlineMarker } from "../../src/core/types";

// ---------------------------------------------------------------------------
// empty inline
// ---------------------------------------------------------------------------

describe("replaceMarkersInBody — empty inline", () => {
	it("returns body unchanged when inline is empty", () => {
		const body = "Some prose [^a_1] with markers.";
		expect(replaceMarkersInBody(body, [])).toBe(body);
	});
});

// ---------------------------------------------------------------------------
// single marker, one occurrence
// ---------------------------------------------------------------------------

describe("replaceMarkersInBody — single marker", () => {
	it("replaces a single marker occurrence with its [^n] footnote ref", () => {
		const body = "Text before [^a_1] text after.";
		const inline: InlineMarker[] = [{ marker: "[^a_1]", n: 1 }];
		expect(replaceMarkersInBody(body, inline)).toBe("Text before [^1] text after.");
	});

	it("replaces a marker that appears only at the start of the body", () => {
		const body = "[^b_2] leads the sentence.";
		const inline: InlineMarker[] = [{ marker: "[^b_2]", n: 3 }];
		expect(replaceMarkersInBody(body, inline)).toBe("[^3] leads the sentence.");
	});
});

// ---------------------------------------------------------------------------
// same marker string appearing twice — per-marker offset queue
// ---------------------------------------------------------------------------

describe("replaceMarkersInBody — repeated marker", () => {
	it("replaces both occurrences of the same marker string with their respective [^n] refs", () => {
		// The same marker string "[^a_1]" appears twice; the two InlineMarker entries
		// carry distinct n values (2 and 5).  The first occurrence in the body gets n=2,
		// the second gets n=5.
		const body = "First [^a_1] and second [^a_1] citation.";
		const inline: InlineMarker[] = [
			{ marker: "[^a_1]", n: 2 },
			{ marker: "[^a_1]", n: 5 },
		];
		expect(replaceMarkersInBody(body, inline)).toBe("First [^2] and second [^5] citation.");
	});

	it("handles two different markers each appearing once", () => {
		const body = "See [^a_1] and also [^b_3].";
		const inline: InlineMarker[] = [
			{ marker: "[^a_1]", n: 1 },
			{ marker: "[^b_3]", n: 2 },
		];
		expect(replaceMarkersInBody(body, inline)).toBe("See [^1] and also [^2].");
	});
});
