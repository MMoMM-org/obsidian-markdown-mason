// test/core/releaseNotes.test.ts — spec 009: the build-time release-notes constant.
//
// Under vitest no esbuild `define` runs, so __MASON_RELEASE_NOTES__ is undefined.
// A bare `declare const` reference would throw ReferenceError there — this suite
// guards the `typeof` fallback that makes the module safe to import anywhere,
// and exercises the shared cap directly since RELEASE_NOTES cannot reach it here.

import { describe, it, expect } from "vitest";
import { RELEASE_NOTES, capNotes } from "../../src/core/releaseNotes";

describe("RELEASE_NOTES", () => {
	it("imports without throwing when no define global exists", () => {
		expect(() => RELEASE_NOTES.features.length).not.toThrow();
	});

	it("falls back to two empty groups under the vitest runner", () => {
		expect(RELEASE_NOTES).toEqual({ features: [], fixes: [] });
	});
});

describe("capNotes", () => {
	const bullets = (prefix: string, n: number) =>
		Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

	it("passes a small release through untouched", () => {
		const notes = { features: bullets("feat", 2), fixes: bullets("fix", 3) };
		expect(capNotes(notes)).toEqual(notes);
	});

	it("caps both groups at 8 bullets TOTAL", () => {
		const capped = capNotes({ features: bullets("feat", 6), fixes: bullets("fix", 6) });
		expect(capped.features).toHaveLength(6);
		expect(capped.fixes).toHaveLength(2);
	});

	it("spends the whole budget on features when there are enough of them", () => {
		const capped = capNotes({ features: bullets("feat", 12), fixes: bullets("fix", 4) });
		expect(capped.features).toHaveLength(8);
		expect(capped.fixes).toEqual([]);
	});

	it("gives a fix-only release the full budget", () => {
		const capped = capNotes({ features: [], fixes: bullets("fix", 12) });
		expect(capped.fixes).toHaveLength(8);
	});
});
