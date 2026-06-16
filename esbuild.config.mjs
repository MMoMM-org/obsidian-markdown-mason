import esbuild from "esbuild";
import builtins from "builtin-modules";

const isProd = process.argv[2] === "production";

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
});

if (isProd) {
	await context.rebuild();
	await context.dispose();
} else {
	await context.watch();
}
