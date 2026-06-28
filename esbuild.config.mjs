import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, readFileSync, writeFileSync, existsSync } from "node:fs";

const isProd = process.argv[2] === "production";

/**
 * Dev test-vault plugin directory — build files are COPIED here on every build.
 * Symlinks don't work: Electron's plugin loader doesn't follow a symlinked
 * main.js reliably, so we copy real files (the same approach miyo-kado uses).
 * The directory is gitignored (`test/mason/`); the copy is a no-op if absent.
 */
const VAULT_PLUGIN_DIR = "test/mason/.obsidian/plugins/markdown-mason";

/**
 * Write manifest.json into the vault with a `-dev.<timestamp>` version suffix so
 * Obsidian's plugin loader + Hot Reload treat every build as a fresh version and
 * never serve a stale cached module. The repo-root manifest.json stays on the
 * canonical semantic version — only the vault copy is stamped.
 */
function writeDevManifest(targetDir) {
	const manifest = JSON.parse(readFileSync("manifest.json", "utf-8"));
	const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
	manifest.version = `${manifest.version}-dev.${stamp}`;
	writeFileSync(`${targetDir}/manifest.json`, JSON.stringify(manifest, null, "\t") + "\n");
}

// Copy the built plugin into the dev test vault after every build. Runs in both
// dev (watch) and production modes so the running vault always matches the
// latest build; Hot Reload then reloads the plugin in place.
const copyToVault = {
	name: "copy-to-vault",
	setup(build) {
		build.onEnd(() => {
			if (!existsSync(VAULT_PLUGIN_DIR)) return;
			copyFileSync("main.js", `${VAULT_PLUGIN_DIR}/main.js`);
			// styles.css is auto-loaded by Obsidian from the plugin root; copy it
			// alongside main.js so the running vault always has current styling.
			if (existsSync("styles.css")) {
				copyFileSync("styles.css", `${VAULT_PLUGIN_DIR}/styles.css`);
			}
			writeDevManifest(VAULT_PLUGIN_DIR);
			console.log(`  Copied build to ${VAULT_PLUGIN_DIR}/ (manifest dev-stamped)`);
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	format: "cjs",
	platform: "node",
	target: "es2020",
	logLevel: "info",
	sourcemap: isProd ? false : "inline",
	treeShaking: true,
	minify: isProd,
	// ADR-15: dead-code elimination gate for DevDirAdapter and other dev-only paths.
	// "false" in production → esbuild eliminates all `if (__MASON_DEV__)` branches.
	// "true" in dev → branch is live and DevDirAdapter is bundled for local testing.
	//
	// ADR-15 Phase 5: catalog distribution coordinates. MASON_RAW_BASE /
	// MASON_PINNED_REF override RAW_BASE / PINNED_REF at build time (the release
	// workflow exports MASON_PINNED_REF resolved from the catalog repo's HEAD, so
	// releases auto-pin). Empty string when unset → pinnedRef.ts falls back to its
	// committed *_DEFAULT (its typeof guard makes "" fall through).
	define: {
		__MASON_DEV__: isProd ? "false" : "true",
		__MASON_RAW_BASE__: JSON.stringify(process.env.MASON_RAW_BASE ?? ""),
		__MASON_PINNED_REF__: JSON.stringify(process.env.MASON_PINNED_REF ?? ""),
	},
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
		...builtinModules,
		...builtinModules.map((m) => `node:${m}`),
	],
	outfile: "main.js",
	plugins: [copyToVault],
});

if (isProd) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
