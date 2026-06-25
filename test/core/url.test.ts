import { describe, it, expect } from "vitest";
import { normalizeUrl } from "../../src/core/url";
import { fixtures } from "../fixtures";

// ---------------------------------------------------------------------------
// T2.2  URL normalization
// Spec: lowercase scheme/host; strip trailing slash; sort query params;
// drop fragment; non-URL → trimmed lowercase.
//
// Canonical root form decision: the root URL "https://x.com/" strips to
// "https://x.com" (no trailing slash, even at root level). This produces the
// shortest unambiguous canonical form and is consistent with the "strip
// trailing slash" rule applied uniformly regardless of path depth.
// ---------------------------------------------------------------------------

describe("normalizeUrl — scheme and host casing", () => {
	it("lowercases the scheme", () => {
		expect(normalizeUrl("HTTPS://Example.com/path")).toBe(
			"https://example.com/path",
		);
	});

	it("lowercases the host", () => {
		expect(normalizeUrl("https://EXAMPLE.COM/path")).toBe(
			"https://example.com/path",
		);
	});

	it("preserves path case (paths are case-sensitive)", () => {
		expect(normalizeUrl("https://example.com/Foo/Bar")).toBe(
			"https://example.com/Foo/Bar",
		);
	});
});

describe("normalizeUrl — trailing slash stripping", () => {
	it("strips a trailing slash from a non-root path", () => {
		expect(normalizeUrl("https://x.com/a/")).toBe("https://x.com/a");
	});

	it("strips the trailing slash from the root URL", () => {
		// Canonical root form: no trailing slash.
		expect(normalizeUrl("https://x.com/")).toBe("https://x.com");
	});

	it("does not add a slash when the path already has no trailing slash", () => {
		expect(normalizeUrl("https://x.com/a")).toBe("https://x.com/a");
	});
});

describe("normalizeUrl — query parameter sorting", () => {
	it("sorts query parameters so param order does not affect the key", () => {
		const a = normalizeUrl("https://example.com/?b=2&a=1");
		const b = normalizeUrl("https://example.com/?a=1&b=2");
		expect(a).toBe(b);
	});

	it("produces the expected sorted query string", () => {
		expect(normalizeUrl("https://example.com/?b=2&a=1")).toBe(
			"https://example.com?a=1&b=2",
		);
	});
});

describe("normalizeUrl — fragment (hash) removal", () => {
	it("drops the fragment from a URL", () => {
		expect(normalizeUrl("https://example.com/page#section")).toBe(
			"https://example.com/page",
		);
	});

	it("drops the fragment when path also has a trailing slash", () => {
		expect(normalizeUrl("https://example.com/page/#section")).toBe(
			"https://example.com/page",
		);
	});
});

describe("normalizeUrl — non-URL fallback", () => {
	it("returns trimmed lowercase for a plain string", () => {
		expect(normalizeUrl("  Some Title  ")).toBe("some title");
	});

	it("lowercases and trims a single word", () => {
		expect(normalizeUrl("Wikipedia")).toBe("wikipedia");
	});

	it("returns empty string for an all-whitespace input", () => {
		expect(normalizeUrl("   ")).toBe("");
	});
});

describe("normalizeUrl — collision avoidance and encoding correctness", () => {
	it("treats a percent-encoded ampersand in a value as ONE param (not two)", () => {
		// "?a=x%26b%3D2" is one param: key "a", value "x&b=2"
		// "?a=x&b=2"     is two params: key "a" value "x", key "b" value "2"
		// They must NOT share the same dedup key.
		expect(normalizeUrl("https://e.com/?a=x%26b%3D2")).not.toBe(
			normalizeUrl("https://e.com/?a=x&b=2"),
		);
	});

	it("collapses encoding variants of the same decoded value (space)", () => {
		// "?a=x%20y" and "?a=x y" decode to the same param value — same key.
		expect(normalizeUrl("https://e.com/?a=x%20y")).toBe(
			normalizeUrl("https://e.com/?a=x y"),
		);
	});
});

describe("normalizeUrl — non-http(s) scheme fallback", () => {
	it("returns trimmed lowercase for mailto: (not a mangled mailto:// key)", () => {
		expect(normalizeUrl("mailto:User@Example.com")).toBe(
			"mailto:user@example.com",
		);
	});

	it("returns trimmed lowercase for data: URIs", () => {
		expect(normalizeUrl("data:text/plain,Hello")).toBe(
			"data:text/plain,hello",
		);
	});
});

describe("normalizeUrl — real dedup case (n-kishou.com)", () => {
	// The committed fixtures all contain the same n-kishou.com URL verbatim:
	//   https://n-kishou.com/corp/news-contents/sakura/?lang=en
	// (app fixture lines 25 and 60; web fixture lines 11, 30, 32;
	//  web-download fixture lines 26 and 74)
	//
	// Because no genuinely-differing variant (case / trailing-slash / fragment)
	// appears in those fixtures, we synthesize an equivalent pair that exercises
	// the same normalization axes (uppercase host + trailing slash + fragment)
	// while sharing the fixture's real origin (n-kishou.com). Both should
	// collapse to the same canonical key.

	it("synthesized pair: uppercase host vs lowercase host with trailing slash and fragment collapse to the same key", () => {
		// Variant A: uppercase host + trailing slash
		const variantA =
			"https://N-KISHOU.COM/corp/news-contents/sakura/?lang=en";
		// Variant B: fragment appended
		const variantB =
			"https://n-kishou.com/corp/news-contents/sakura/?lang=en#section";

		expect(normalizeUrl(variantA)).toBe(normalizeUrl(variantB));
	});

	it("both synthesized variants normalize to the expected canonical key", () => {
		const variantA =
			"https://N-KISHOU.COM/corp/news-contents/sakura/?lang=en";
		expect(normalizeUrl(variantA)).toBe(
			"https://n-kishou.com/corp/news-contents/sakura?lang=en",
		);
	});

	it("the verbatim fixture URL also matches the canonical key", () => {
		// Confirm the actual fixture string maps to the same canonical key.
		const fixtureUrl =
			"https://n-kishou.com/corp/news-contents/sakura/?lang=en";
		const canonical = "https://n-kishou.com/corp/news-contents/sakura?lang=en";
		// Verify the URL appears in at least one fixture (smoke-checks fixture loading).
		expect(fixtures.app).toContain(fixtureUrl);
		expect(normalizeUrl(fixtureUrl)).toBe(canonical);
	});
});
