import { describe, it, expect } from "vitest";
import { checkManifest } from "../scripts/check-manifest.mjs";

const compliantManifest = () => ({
	id: "markdown-mason",
	description: "Fit pasted Markdown into the target note's structure.",
	isDesktopOnly: true,
});

describe("checkManifest", () => {
	it("returns [] for a fully-compliant manifest", () => {
		const failures = checkManifest(compliantManifest());
		expect(failures).toEqual([]);
	});

	it("fails when isDesktopOnly is false", () => {
		const failures = checkManifest({ ...compliantManifest(), isDesktopOnly: false });
		expect(failures.length).toBeGreaterThanOrEqual(1);
		expect(failures.some((f) => f.includes("isDesktopOnly"))).toBe(true);
	});

	it("fails when id contains 'obsidian'", () => {
		const failures = checkManifest({ ...compliantManifest(), id: "my-obsidian-thing" });
		expect(failures.length).toBeGreaterThanOrEqual(1);
		expect(failures.some((f) => f.toLowerCase().includes("obsidian"))).toBe(true);
	});

	it("fails when description does not end with '.'", () => {
		const failures = checkManifest({ ...compliantManifest(), description: "No period here" });
		expect(failures.length).toBeGreaterThanOrEqual(1);
		expect(failures.some((f) => f.includes("end with"))).toBe(true);
	});

	it("fails when description contains the word 'Obsidian'", () => {
		const failures = checkManifest({
			...compliantManifest(),
			description: "Works inside Obsidian only.",
		});
		expect(failures.length).toBeGreaterThanOrEqual(1);
		expect(failures.some((f) => f.toLowerCase().includes("obsidian"))).toBe(true);
	});

	it("returns failures for missing id and missing description without throwing", () => {
		const failures = checkManifest({ isDesktopOnly: true });
		expect(failures.some((f) => f.includes("id"))).toBe(true);
		expect(failures.some((f) => f.includes("description"))).toBe(true);
	});
});
