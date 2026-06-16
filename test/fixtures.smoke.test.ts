import { describe, it, expect } from "vitest";
import { fixtures, loadFixture } from "./fixtures.js";

describe("golden fixtures", () => {
	it("app fixture is non-empty", () => {
		expect(fixtures.app.length).toBeGreaterThan(0);
	});

	it("web fixture is non-empty", () => {
		expect(fixtures.web.length).toBeGreaterThan(0);
	});

	it("webDownload fixture is non-empty", () => {
		expect(fixtures.webDownload.length).toBeGreaterThan(0);
	});

	it("loadFixture('app') returns the app fixture string", () => {
		expect(loadFixture("app")).toBe(fixtures.app);
	});

	it("loadFixture('web') returns the web fixture string", () => {
		expect(loadFixture("web")).toBe(fixtures.web);
	});

	it("loadFixture('webDownload') returns the webDownload fixture string", () => {
		expect(loadFixture("webDownload")).toBe(fixtures.webDownload);
	});
});
