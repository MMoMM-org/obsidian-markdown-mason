import esbuild from "esbuild";
import builtins from "builtin-modules";
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
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
		...builtins,
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
