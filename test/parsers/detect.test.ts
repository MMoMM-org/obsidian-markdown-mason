import { describe, it, expect } from "vitest";
import { loadFixture } from "../fixtures";
import { perplexityApp } from "../../src/parsers/perplexityApp";
import { perplexityWeb } from "../../src/parsers/perplexityWeb";
import { perplexityWebDownload } from "../../src/parsers/perplexityWebDownload";
import { detect } from "../../src/parsers/detect";

// ---------------------------------------------------------------------------
// Fixture routing — each fixture must route to its canonical parser
// ---------------------------------------------------------------------------

describe("detect — fixture routing", () => {
	it("routes the app fixture to perplexityApp", () => {
		const input = loadFixture("app");
		expect(detect(input)).toBe(perplexityApp);
	});

	it("routes the web fixture to perplexityWeb", () => {
		const input = loadFixture("web");
		expect(detect(input)).toBe(perplexityWeb);
	});

	it("routes the webDownload fixture to perplexityWebDownload", () => {
		const input = loadFixture("webDownload");
		expect(detect(input)).toBe(perplexityWebDownload);
	});
});

// ---------------------------------------------------------------------------
// Null case — plain prose with no recognisable markers
// ---------------------------------------------------------------------------

describe("detect — null case", () => {
	it("returns null for plain prose with no links or markers", () => {
		const plainProse = "Tokyo is famous for its cherry blossoms in spring.\nNo links or markers here.";
		expect(detect(plainProse)).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(detect("")).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Precedence: app wins over inline links
// ---------------------------------------------------------------------------

describe("detect — precedence: app > web", () => {
	it("routes to perplexityApp when Sources block AND inline links are both present", () => {
		// An app-format copy often contains inline [text](url) links alongside
		// the Sources block. The Sources block must win so the structured source
		// list is preserved. App takes precedence over web.
		const ambiguous = [
			"## Answer",
			"",
			"Tokyo has [great parks](https://www.tokyo-park.or.jp/) for hanami.[1][2]",
			"",
			"Sources",
			"[1] Cherry Blossom Guide https://www.japan-guide.com/sakura/",
			"[2] Tokyo Parks https://www.tokyo-park.or.jp/",
		].join("\n");

		expect(detect(ambiguous)).toBe(perplexityApp);
	});

	it("Sources block alone (no inline [text](url)) still routes to perplexityApp", () => {
		const appOnly = [
			"## Answer",
			"",
			"Tokyo sakura bloom in late March.[1]",
			"",
			"Sources",
			"[1] Japan Guide https://www.japan-guide.com/sakura/",
		].join("\n");

		expect(detect(appOnly)).toBe(perplexityApp);
	});
});

// ---------------------------------------------------------------------------
// Precedence: web-download wins over inline links
// ---------------------------------------------------------------------------

describe("detect — precedence: web-download > web", () => {
	it("routes to perplexityWebDownload when [^a_b]: def lines AND inline [text](url) links coexist", () => {
		// A web-download document has [^a_b]: def lines for footnotes but may
		// also contain inline markdown links. The def lines must win because
		// they are the canonical footnote mechanism for this format.
		const ambiguous = [
			"## Answer",
			"",
			"See [cherry blossom guide](https://www.japan-guide.com/sakura/) for details.[^1_1]",
			"",
			"[^1_1]: https://www.japan-guide.com/sakura/",
		].join("\n");

		expect(detect(ambiguous)).toBe(perplexityWebDownload);
	});

	it("web-download without inline links still routes to perplexityWebDownload", () => {
		const webDownloadOnly = [
			"## Answer",
			"",
			"Sakura in Tokyo.[^1_1][^1_2]",
			"",
			"[^1_1]: https://www.japan-guide.com/sakura/",
			"[^1_2]: https://n-kishou.com/sakura/",
		].join("\n");

		expect(detect(webDownloadOnly)).toBe(perplexityWebDownload);
	});
});

// ---------------------------------------------------------------------------
// Web — inline links only (no Sources block, no [^a_b]: defs)
// ---------------------------------------------------------------------------

describe("detect — web (inline links only)", () => {
	it("routes to perplexityWeb when only inline [text](url) links are present", () => {
		const webOnly = [
			"## Answer",
			"",
			"See [cherry blossoms](https://www.japan-guide.com/sakura/) in Tokyo.",
			"Best time is [late March](https://n-kishou.com/sakura/).",
		].join("\n");

		expect(detect(webOnly)).toBe(perplexityWeb);
	});
});
