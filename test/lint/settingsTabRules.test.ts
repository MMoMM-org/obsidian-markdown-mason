import { describe, it, expect, beforeAll } from "vitest";
import { ESLint, type Linter } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

// Spec 010: the plugin's settings live on the Obsidian 1.13 declarative API.
// The obsidianmd ruleset ships the settings-tab rules below as warnings, which
// `npm run lint` does not fail on. The repo config raises them to errors so CI
// blocks a regression to the imperative API; this test pins that severity.
const ERROR_SEVERITY: Linter.Severity = 2;

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

	it.each([
		"obsidianmd/settings-tab/prefer-setting-definitions",
		"obsidianmd/settings-tab/prefer-update-over-display",
		"obsidianmd/settings-tab/no-deprecated-display",
	])("%s reports as an error", (ruleId) => {
		const reported = messages.filter((m) => m.ruleId === ruleId);
		expect(reported.map((m) => m.severity)).toEqual([ERROR_SEVERITY]);
	});
});
