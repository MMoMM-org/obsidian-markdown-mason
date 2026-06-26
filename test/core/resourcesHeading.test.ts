import { describe, it, expect } from "vitest";
import {
	parseAtxHeading,
	resourcesSectionName,
	resourcesCreateHeading,
	findResourcesSectionByName,
} from "../../src/core/resourcesHeading";

describe("parseAtxHeading", () => {
	it("parses levels 1–6 with their text", () => {
		expect(parseAtxHeading("# Title")).toEqual({ level: 1, text: "Title" });
		expect(parseAtxHeading("## Resources")).toEqual({ level: 2, text: "Resources" });
		expect(parseAtxHeading("###### Deep")).toEqual({ level: 6, text: "Deep" });
	});

	it("trims trailing whitespace and tolerates multiple leading spaces", () => {
		expect(parseAtxHeading("##   Resources  ")).toEqual({ level: 2, text: "Resources" });
	});

	it("rejects non-headings", () => {
		expect(parseAtxHeading("Resources")).toBeNull();
		expect(parseAtxHeading("#NoSpace")).toBeNull();
		expect(parseAtxHeading("####### TooDeep")).toBeNull();
		expect(parseAtxHeading("## ")).toBeNull();
		expect(parseAtxHeading("[^1]: a def")).toBeNull();
	});
});

describe("resourcesSectionName", () => {
	it("strips the level prefix to the bare name", () => {
		expect(resourcesSectionName("## Resources")).toBe("Resources");
		expect(resourcesSectionName("### My Notes")).toBe("My Notes");
		expect(resourcesSectionName("Resources")).toBe("Resources");
		expect(resourcesSectionName("###References")).toBe("References");
	});

	it("falls back to 'Resources' when empty", () => {
		expect(resourcesSectionName("")).toBe("Resources");
		expect(resourcesSectionName("## ")).toBe("Resources");
	});
});

describe("resourcesCreateHeading", () => {
	it("reuses a well-formed heading at its level (normalised spacing)", () => {
		expect(resourcesCreateHeading("## Resources")).toBe("## Resources");
		expect(resourcesCreateHeading("### My Notes")).toBe("### My Notes");
		expect(resourcesCreateHeading("##   Resources")).toBe("## Resources");
	});

	it("defaults a bare name to a level-2 heading", () => {
		expect(resourcesCreateHeading("Resources")).toBe("## Resources");
		expect(resourcesCreateHeading("Sources")).toBe("## Sources");
		expect(resourcesCreateHeading("")).toBe("## Resources");
	});
});

describe("findResourcesSectionByName", () => {
	function find(doc: string, name = "Resources") {
		return findResourcesSectionByName(doc.split("\n"), name, doc.length);
	}

	it("returns null when no matching section exists", () => {
		expect(find("# Intro\n\nBody text\n")).toBeNull();
	});

	it("adopts an existing section at any level", () => {
		const h3 = "# Note\n\n### Resources\n\n[^1]: a\n";
		const section = find(h3);
		expect(section?.level).toBe(3);
		expect(h3.slice(section!.from)).toContain("### Resources");
	});

	it("ends the section at the next heading of level ≤ its own", () => {
		// H2 Resources, then a deeper H3 (stays inside), then a sibling H2 (ends it).
		const doc = "## Resources\n\n[^1]: a\n\n### Sub\n\nmore\n\n## Next\n\nafter\n";
		const section = find(doc);
		expect(section?.level).toBe(2);
		const body = doc.slice(section!.from, section!.to);
		expect(body).toContain("### Sub"); // deeper heading stays inside
		expect(body).not.toContain("## Next"); // sibling heading terminates
	});

	it("runs an H3 section only until the next heading of level ≤ 3", () => {
		const doc = "### Resources\n\n[^1]: a\n\n### Sibling\n\nafter\n";
		const section = find(doc);
		expect(section?.level).toBe(3);
		const body = doc.slice(section!.from, section!.to);
		expect(body).toContain("[^1]: a");
		expect(body).not.toContain("### Sibling");
	});

	it("matches the name exactly, not as a prefix", () => {
		expect(find("## Resources and more\n\nx\n")).toBeNull();
	});
});
