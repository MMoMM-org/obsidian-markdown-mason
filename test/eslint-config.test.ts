import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Disable projectService so lintText works without a real tsconfig project.
// The no-console rule under test does not require type information.
const makeEslint = (): ESLint =>
	new ESLint({
		overrideConfigFile: path.join(repoRoot, "eslint.config.mjs"),
		overrideConfig: [
			{
				files: ["**/*.ts"],
				languageOptions: { parserOptions: { projectService: false } },
			},
		],
	});

describe("eslint flat config — CON-3 no-console enforcement", () => {
	// Shared instance — all four tests use the same config; no need to recreate it.
	const eslint = makeEslint();

	// "src/virtual.ts" is a non-existent path under src/ chosen so the flat
	// config's `files: ["src/**/*.ts"]` glob applies during lintText calls.
	const virtualFilePath = path.join(repoRoot, "src/virtual.ts");

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
