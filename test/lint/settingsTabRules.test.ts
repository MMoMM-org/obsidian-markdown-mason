import { describe, it, expect, beforeAll } from "vitest";
import { ESLint, type Linter } from "eslint";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// Spec 010: the plugin's settings live on the Obsidian 1.13 declarative API.
// The obsidianmd ruleset ships the settings-tab rules below as warnings, which
// `npm run lint` does not fail on. The repo config raises them to errors so CI
// blocks a regression to the imperative API; this test pins that severity.
const ERROR_SEVERITY: Linter.Severity = 2;

// The obsidianmd settings-tab rules are version-gated: they stay silent unless
// manifest.json declares a minAppVersion that has the declarative settings API.
// Below that floor the severity assertions fail for a reason unrelated to the
// ESLint config, so the precondition is checked on its own first.
const SETTINGS_RULES_MIN_APP_VERSION = "1.13.0";

const manifestMinAppVersion = (
	JSON.parse(readFileSync(path.join(repoRoot, "manifest.json"), "utf8")) as { minAppVersion: string }
).minAppVersion;

const PRECONDITION = `manifest.json minAppVersion >= ${SETTINGS_RULES_MIN_APP_VERSION} (is "${manifestMinAppVersion}")`;

// The first lintText() call boots the type-aware config and a TS project
// service: a cold-start cost of several seconds, not a regression signal.
const COLD_START_TIMEOUT_MS = 30_000;

// Two tabs, because the rules exclude each other on a single class:
// prefer-setting-definitions fires only without getSettingDefinitions(), and
// no-deprecated-display only with it.
const IMPERATIVE_TABS = `
import { PluginSettingTab } from "obsidian";

export class ImperativeTab extends PluginSettingTab {
	display(): void {
		this.containerEl.empty();
	}

	refresh(): void {
		this.display();
	}
}

export class LeftoverDisplayTab extends PluginSettingTab {
	getSettingDefinitions(): [] {
		return [];
	}

	display(): void {
		this.containerEl.empty();
	}
}
`;

/** Throws unless `minAppVersion` is high enough for the settings-tab rules to run. */
function assertSettingsRulesActive(minAppVersion: string): void {
	const parse = (version: string): number[] => {
		if (/^\d+\.\d+\.\d+$/.test(version) === false) {
			throw new Error(`minAppVersion "${version}" is not a major.minor.patch version`);
		}
		return version.split(".").map(Number);
	};
	const actual = parse(minAppVersion);
	const floor = parse(SETTINGS_RULES_MIN_APP_VERSION);
	const firstDiff = actual.findIndex((part, i) => part !== floor[i]);
	if (firstDiff !== -1 && actual[firstDiff] < floor[firstDiff]) {
		throw new Error(
			`manifest.json minAppVersion "${minAppVersion}" is below ${SETTINGS_RULES_MIN_APP_VERSION}: ` +
				"the obsidianmd settings-tab rules do not run, so their severity cannot be verified",
		);
	}
}

describe("assertSettingsRulesActive", () => {
	it("throws below the settings-rules floor", () => {
		expect(() => assertSettingsRulesActive("1.12.9")).toThrow(/minAppVersion "1\.12\.9".*1\.13\.0/);
	});

	it("passes at or above the settings-rules floor", () => {
		expect(() => assertSettingsRulesActive("1.13.0")).not.toThrow();
		expect(() => assertSettingsRulesActive("1.13.1")).not.toThrow();
	});

	it("rejects a value that is not a major.minor.patch version", () => {
		expect(() => assertSettingsRulesActive("latest")).toThrow(/not a major\.minor\.patch version/);
	});
});

describe("eslint flat config: settings-tab rules are errors (spec 010)", { timeout: COLD_START_TIMEOUT_MS }, () => {
	let messages: Linter.LintMessage[] = [];

	beforeAll(async () => {
		const eslint = new ESLint({
			cwd: repoRoot,
			overrideConfigFile: path.join(repoRoot, "eslint.config.mjs"),
		});
		// Attributed to an existing src/ file: the config's `src/**/*.ts` block is
		// type-aware (projectService), and the project service rejects a path that
		// is not part of the TS project. Nothing is read from or written to it.
		const results = await eslint.lintText(IMPERATIVE_TABS, {
			filePath: path.join(repoRoot, "src/ui/settingsTab.ts"),
		});
		messages = results.flatMap((r) => r.messages);
	}, COLD_START_TIMEOUT_MS);

	it("manifest.json minAppVersion keeps the settings-tab rules active", () => {
		expect(() => assertSettingsRulesActive(manifestMinAppVersion)).not.toThrow();
	});

	it.each([
		"obsidianmd/settings-tab/prefer-setting-definitions",
		"obsidianmd/settings-tab/prefer-update-over-display",
		"obsidianmd/settings-tab/no-deprecated-display",
	])("%s reports as an error", (ruleId) => {
		const reported = messages.filter((m) => m.ruleId === ruleId);
		expect(
			reported.map((m) => m.severity),
			`${ruleId} must report exactly once at severity ${ERROR_SEVERITY}. ` +
				`Precondition: ${PRECONDITION}, otherwise the rule does not run. ` +
				`Required config: "${ruleId}": "error" in eslint.config.mjs.`,
		).toEqual([ERROR_SEVERITY]);
	});
});
