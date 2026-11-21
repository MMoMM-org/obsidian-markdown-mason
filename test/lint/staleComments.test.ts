import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const srcDir = path.join(repoRoot, "src");

// Spec 010 replaced the segmented settings tab with one main settings page plus
// the Scripts and Commands sub-pages, and the cleanup pipeline has grown past
// its original seven steps. These phrases describe the old shape; a comment
// that uses one is stale. A plain "settings tab" (the plugin's
// PluginSettingTab) stays legitimate and is not matched.
const STALE_PHRASES: ReadonlyArray<{ label: string; pattern: RegExp }> = [
	{ label: "Scripts tab (now the Scripts settings page)", pattern: /\bscripts(?:[- ]settings)?[- ]tab\b/i },
	{ label: "Commands tab (now the Commands settings page)", pattern: /\bcommands(?:[- ]settings)?[- ]tab\b/i },
	{ label: "General settings tab (now the main settings page)", pattern: /\bgeneral settings tab\b/i },
	{ label: "hard-coded cleanup step count", pattern: /\b7[- ](?:in-memory )?cleanup\b/i },
	{ label: "hard-coded cleanup step range", pattern: /\bsteps 1-7\b/i },
];

function listTypeScriptFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return listTypeScriptFiles(full);
		return entry.name.endsWith(".ts") ? [full] : [];
	});
}

function findStalePhrases(): string[] {
	const hits: string[] = [];
	for (const file of listTypeScriptFiles(srcDir)) {
		const lines = readFileSync(file, "utf8").split("\n");
		lines.forEach((line, index) => {
			for (const { label, pattern } of STALE_PHRASES) {
				if (pattern.test(line)) {
					hits.push(`${path.relative(repoRoot, file)}:${index + 1} — ${label}: ${line.trim()}`);
				}
			}
		});
	}
	return hits;
}

describe("src comments do not describe the pre-spec-010 settings UI or step count", () => {
	it("finds TypeScript sources to scan", () => {
		expect(listTypeScriptFiles(srcDir).length).toBeGreaterThan(0);
	});

	it("contains no stale phrase", () => {
		expect(findStalePhrases()).toEqual([]);
	});
});
