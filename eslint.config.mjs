import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	...tseslint.configs.recommended,
	// Obsidian community-review ruleset. configs.recommended is a flat-config
	// ARRAY (17 blocks, ~95 obsidianmd rules plus bundled security/import rules),
	// so it MUST be spread — never Object.entries()-filtered by rule name, which
	// silently yields zero rules. This mirrors the exact ruleset the
	// community.obsidian.md reviewer runs, catching submission problems locally.
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
			// Compile-time constants injected by esbuild `define` (see
			// esbuild.config.mjs). Declared readonly so no-undef doesn't flag them.
			globals: {
				__MASON_DEV__: "readonly",
				__MASON_RAW_BASE__: "readonly",
				__MASON_PINNED_REF__: "readonly",
			},
		},
		rules: {
			// CON-3: community submission compliance
			"no-console": ["error", { allow: ["debug", "warn", "error"] }],
			// Our UI copy intentionally uses acronyms and product/feature proper
			// names; teach the rule about them rather than lowercasing them (which
			// would corrupt meaning). Keeps the rule live for genuine violations.
			"obsidianmd/ui/sentence-case": ["warn", {
				acronyms: ["OCR", "PDF", "ASCII"],
				// Product name plus this plugin's own command/step labels, referenced
				// verbatim in prose and kept at their canonical casing.
				brands: ["Mason", "Unicode", "Tidy footnotes", "Format selection", "Paste and format", "Normalize headings"],
				// "Scripts" is both a settings-tab label (capitalised) and a common
				// noun ("run scripts"); skip it rather than force either casing.
				ignoreWords: ["Scripts"],
			}],
			// Deferred: the declarative settings-definitions API targets Obsidian
			// 1.13.0+, which is not yet generally available. Revisit when 1.13 ships.
			"obsidianmd/settings-tab/prefer-setting-definitions": "off",
		},
	},
	{
		// The script runner's timeout guard uses globalThis.setTimeout/clearTimeout
		// so it stays portable across the Obsidian runtime and vitest's node env
		// (where `window` is undefined). These timers are not popout-window scoped,
		// so no-global-this does not apply. The ruleset forbids inline disables of
		// this rule (eslint-comments/no-restricted-disable), so scope it off here.
		files: ["src/scripts/runner.ts"],
		rules: {
			"obsidianmd/no-global-this": "off",
		},
	},
];
