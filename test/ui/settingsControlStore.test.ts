import { describe, it, expect } from "vitest";
import {
	FIXED_KEYS,
	isFixedKey,
	readControl,
	writeControl,
	type FixedKey,
} from "../../src/ui/settingsControlStore";
import { DEFAULT_SETTINGS, type MasonSettings } from "../../src/core/types";
import {
	resolveFormatSelectionRecipe,
	type FormatSelectionRecipe,
} from "../../src/core/formatSelection";

// ---------------------------------------------------------------------------
// Spec 010 T1.2 — settingsControlStore
//
// Maps the declarative settings tab's control keys onto MasonSettings:
// flat keys read/write top-level fields, "formatSelection.<step>" keys
// read/write the nested recipe. Reads always return a concrete value.
// ---------------------------------------------------------------------------

const GENERAL_KEYS = ["resourcesName", "showUpdateSplash", "numericOnly", "pasteListContext"];

const RECIPE_KEYS: (keyof FormatSelectionRecipe)[] = [
	"cascade", "normalize", "fromCitations", "identity", "move",
	"boxTable", "reflow",
	"dewrap", "dehyphenate", "decomposeLigatures",
	"tidyWhitespace", "normalizeBullets", "normalizeOrdered",
];

const NESTED_KEYS = RECIPE_KEYS.map((step) => `formatSelection.${step}`);

const EXPECTED_FIXED_KEYS = [...GENERAL_KEYS, ...NESTED_KEYS, "debugLogging"];

/** The traced-walkthrough blob: what a 0.9.4 install could have persisted. */
const storedBlob = (): MasonSettings & { scripts: Record<string, unknown> } =>
	({
		resourcesName: "## Sources",
		formatSelection: { reflow: true },
		scripts: { "some-script": { enabled: true } },
	}) as unknown as MasonSettings & { scripts: Record<string, unknown> };

/** Persisted data with every optional field absent. */
const sparseSettings = (): MasonSettings =>
	({ debugLogging: false, resourcesName: "## Resources" });

describe("isFixedKey", () => {
	it("knows exactly the 18 fixed keys", () => {
		expect([...FIXED_KEYS].sort()).toEqual([...EXPECTED_FIXED_KEYS].sort());
		expect(FIXED_KEYS).toHaveLength(18);
	});

	it.each(EXPECTED_FIXED_KEYS)("accepts %s", (key) => {
		expect(isFixedKey(key)).toBe(true);
	});

	it.each([
		"bogus",
		"formatSelection.",
		"formatSelection",
		"formatSelection.bogus",
		"scripts",
		"lastSeenVersion",
		"",
		"__proto__",
		"constructor",
		"formatSelection.__proto__",
	])("rejects %j", (key) => {
		expect(isFixedKey(key)).toBe(false);
	});
});

describe("readControl — traced walkthrough (0.9.4 stored blob)", () => {
	it("returns a stored flat value", () => {
		expect(readControl(storedBlob(), "resourcesName")).toBe("## Sources");
	});

	it("falls back to DEFAULT_SETTINGS for a missing flat value", () => {
		expect(readControl(storedBlob(), "numericOnly")).toBe(true);
	});

	it("returns a stored nested value", () => {
		expect(readControl(storedBlob(), "formatSelection.reflow")).toBe(true);
	});

	it("falls back to the recipe default for a missing nested value", () => {
		expect(readControl(storedBlob(), "formatSelection.dewrap")).toBe(true);
	});
});

describe("readControl — defaults", () => {
	it.each(EXPECTED_FIXED_KEYS as FixedKey[])(
		"reports today's default for %s on a fresh install",
		(key) => {
			const fresh = structuredClone(DEFAULT_SETTINGS);
			const expected = key.startsWith("formatSelection.")
				? DEFAULT_SETTINGS.formatSelection?.[key.slice("formatSelection.".length) as keyof FormatSelectionRecipe]
				: DEFAULT_SETTINGS[key as keyof MasonSettings];
			expect(expected).toBeDefined();
			expect(readControl(fresh, key)).toBe(expected);
		},
	);

	it.each(EXPECTED_FIXED_KEYS as FixedKey[])(
		"returns a concrete value for %s when optional fields are absent",
		(key) => {
			const fresh = structuredClone(DEFAULT_SETTINGS);
			expect(readControl(sparseSettings(), key)).toBe(readControl(fresh, key));
		},
	);

	it("defaults formatSelection.reflow to false when formatSelection is absent", () => {
		expect(readControl(sparseSettings(), "formatSelection.reflow")).toBe(false);
	});

	it("defaults formatSelection.reflow to false when only siblings are stored", () => {
		const settings: MasonSettings = { ...sparseSettings(), formatSelection: { dewrap: false } };
		expect(readControl(settings, "formatSelection.reflow")).toBe(false);
	});

	it("reports stored values that differ from the defaults", () => {
		const settings: MasonSettings = {
			debugLogging: true,
			resourcesName: "### Refs",
			numericOnly: false,
			showUpdateSplash: false,
			pasteListContext: false,
			formatSelection: { cascade: false, reflow: true },
		};
		expect(readControl(settings, "debugLogging")).toBe(true);
		expect(readControl(settings, "resourcesName")).toBe("### Refs");
		expect(readControl(settings, "numericOnly")).toBe(false);
		expect(readControl(settings, "showUpdateSplash")).toBe(false);
		expect(readControl(settings, "pasteListContext")).toBe(false);
		expect(readControl(settings, "formatSelection.cascade")).toBe(false);
		expect(readControl(settings, "formatSelection.reflow")).toBe(true);
	});

	it("does not mutate the settings it reads", () => {
		const settings = storedBlob();
		for (const key of EXPECTED_FIXED_KEYS as FixedKey[]) readControl(settings, key);
		expect(settings).toEqual(storedBlob());
	});
});

describe("writeControl", () => {
	it("writes a flat string key", () => {
		const settings = storedBlob();
		writeControl(settings, "resourcesName", "# Notes");
		expect(settings).toEqual({ ...storedBlob(), resourcesName: "# Notes" });
	});

	it("writes a flat boolean key that was absent", () => {
		const settings = storedBlob();
		writeControl(settings, "numericOnly", false);
		expect(settings).toEqual({ ...storedBlob(), numericOnly: false });
	});

	it("merges a nested key into an existing formatSelection without dropping siblings", () => {
		const settings = storedBlob();
		writeControl(settings, "formatSelection.dewrap", false);
		expect(settings).toEqual({
			...storedBlob(),
			formatSelection: { reflow: true, dewrap: false },
		});
	});

	it("overwrites an already stored nested key", () => {
		const settings = storedBlob();
		writeControl(settings, "formatSelection.reflow", false);
		expect(settings).toEqual({ ...storedBlob(), formatSelection: { reflow: false } });
	});

	it("creates formatSelection when absent", () => {
		const settings = sparseSettings();
		writeControl(settings, "formatSelection.cascade", false);
		expect(settings).toEqual({ ...sparseSettings(), formatSelection: { cascade: false } });
	});

	it.each(["bogus", "formatSelection.", "formatSelection.bogus", "scripts", "lastSeenVersion", "__proto__"])(
		"ignores the unknown key %j",
		(key) => {
			const settings = storedBlob();
			writeControl(settings, key as FixedKey, 1);
			expect(settings).toEqual(storedBlob());
			expect(({} as Record<string, unknown>).bogus).toBeUndefined();
		},
	);

	it("round-trips every fixed key through readControl", () => {
		for (const key of EXPECTED_FIXED_KEYS as FixedKey[]) {
			const settings = structuredClone(DEFAULT_SETTINGS);
			const flipped = key === "resourcesName" ? "### Changed" : readControl(settings, key) === false;
			writeControl(settings, key, flipped);
			expect(readControl(settings, key)).toBe(flipped);
		}
	});

	it("leaves the resolved recipe consistent with what was written", () => {
		const settings = sparseSettings();
		writeControl(settings, "formatSelection.reflow", true);
		expect(resolveFormatSelectionRecipe(settings)).toEqual({
			...resolveFormatSelectionRecipe(sparseSettings()),
			reflow: true,
		});
	});
});
