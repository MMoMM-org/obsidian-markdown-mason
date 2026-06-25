import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);

const read = (filename: string): string =>
	fs.readFileSync(path.join(repoRoot, "assets", filename), "utf-8");

export type FixtureName = "app" | "web" | "webDownload";

export const fixtures: Record<FixtureName, string> = {
	app: read("sakura-in-tokyo-app.md"),
	web: read("sakura-in-tokyo-web.md"),
	webDownload: read("sakura-in-tokyo-web-download.md"),
};

export const loadFixture = (name: FixtureName): string => fixtures[name];
