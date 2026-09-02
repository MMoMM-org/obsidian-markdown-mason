// test/core/releaseNotes.test.ts — spec 009: the build-time release-notes constant.
//
// Under vitest no esbuild `define` runs, so __MASON_RELEASE_NOTES__ is undefined.
// A bare `declare const` reference would throw ReferenceError there — this suite
// guards the `typeof` fallback that makes the module safe to import anywhere.

import { describe, it, expect } from "vitest";
import { RELEASE_NOTES } from "../../src/core/releaseNotes";

describe("RELEASE_NOTES", () => {
	it("imports without throwing when no define global exists", () => {
		expect(() => RELEASE_NOTES.length).not.toThrow();
	});

	it("falls back to an empty list under the vitest runner", () => {
		expect(RELEASE_NOTES).toEqual([]);
	});
});
