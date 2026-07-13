import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Lint with the real flat config, type information included. The config now
// bundles type-aware rules (via the obsidianmd ruleset) that require a TS
// project, so projectService cannot be disabled; the snippet is attributed to
// an existing src/ file so the project's type info covers it. no-console is not
// type-aware and still fires regardless.
const makeEslint = (): ESLint =>
	new ESLint({
		overrideConfigFile: path.join(repoRoot, "eslint.config.mjs"),
	});

describe("eslint flat config — CON-3 no-console enforcement", () => {
	// Shared instance — all four tests use the same config; no need to recreate it.
	const eslint = makeEslint();

	// An existing file under src/ so both the flat config's `src/**/*.ts` glob
	// and the project's type information apply during lintText calls.
	const virtualFilePath = path.join(repoRoot, "src/main.ts");

	it("rejects console.log", async () => {
		const results = await eslint.lintText('console.log("hello");\n', {
			filePath: virtualFilePath,
		});
		const noConsoleErrors = results
			.flatMap((r) => r.messages)
			.filter((m) => m.ruleId === "no-console");
		expect(noConsoleErrors.length).toBeGreaterThanOrEqual(1);
	});

	it("accepts console.warn", async () => {
		const results = await eslint.lintText('console.warn("hello");\n', {
			filePath: virtualFilePath,
		});
		const noConsoleErrors = results
			.flatMap((r) => r.messages)
			.filter((m) => m.ruleId === "no-console");
		expect(noConsoleErrors.length).toBe(0);
	});

	it("accepts console.debug", async () => {
		const results = await eslint.lintText('console.debug("hello");\n', {
			filePath: virtualFilePath,
		});
		const noConsoleErrors = results
			.flatMap((r) => r.messages)
			.filter((m) => m.ruleId === "no-console");
		expect(noConsoleErrors.length).toBe(0);
	});

	it("accepts console.error", async () => {
		const results = await eslint.lintText('console.error("hello");\n', {
			filePath: virtualFilePath,
		});
		const noConsoleErrors = results
			.flatMap((r) => r.messages)
			.filter((m) => m.ruleId === "no-console");
		expect(noConsoleErrors.length).toBe(0);
	});
});
