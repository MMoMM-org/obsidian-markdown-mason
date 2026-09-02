// scripts/releaseNotes.mjs — spec-009: turn a CHANGELOG.md section into splash notes.
//
// Runs at BUILD time under node (esbuild.config.mjs), never in the plugin — it
// would otherwise be dead code bundled into every user's main.js (ADR-46).
// Unit-tested from vitest, following the scripts/check-manifest.mjs precedent.
//
// Input grammar — @semantic-release/release-notes-generator, conventionalcommits:
//
//   ## [0.8.1](https://…/compare/0.8.0...0.8.1) (2026-08-31)   ← "#" for a major
//
//   ### Bug Fixes
//
//   * **scripts:** pass local id to removeCommand … ([#35](…)) ([3bfde5a](…)), closes [#25](…)
//
// Only "### Features" is read (ADR-45): the splash answers "what can I do now",
// not "what was repaired".

/** Matches a version section heading: "# [1.2.3](url) (date)" or "## 1.2.3 (date)". */
const SECTION_RE = /^#{1,2}\s+\[?([0-9][^\]\s)]*)\]?/gm;

/**
 * Strip commit-line noise from one changelog bullet, leaving prose.
 *
 * Mechanical removals only (ADR-47): link syntax, SHAs and emphasis markers are
 * provably not prose. Scopes and "(spec NNN)" references are left alone —
 * guessing at meaning would mangle real feature text.
 */
export function cleanBullet(line) {
	let s = String(line);
	s = s.replace(/^\s*[*-]\s+/, "");
	// ", closes [#25](url) [#26](url)" trailer
	s = s.replace(/,?\s*closes\s+(?:\[[^\]]*\]\([^)]*\)[,\s]*)+$/i, "");
	// " ([#35](url))" / " ([3bfde5a](url))" parenthesised link groups
	s = s.replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "");
	// any remaining inline link → its text
	s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
	s = s.replace(/\*\*/g, "");
	s = s.replace(/\s+/g, " ").trim();
	s = s.replace(/[,;]$/, "").trim();
	return s;
}

/**
 * The "### Features" bullets of one changelog section, cleaned for a reader.
 *
 * @param {string} changelog  Full CHANGELOG.md text.
 * @param {string} [version]  Section to read; the topmost section when omitted
 *                            or when no section matches it.
 * @returns {string[]}        Cleaned bullets; [] for anything missing or malformed.
 */
export function extractFeatureNotes(changelog, version) {
	if (typeof changelog !== "string" || changelog === "") return [];

	// 1. Locate every version section.
	const starts = [];
	SECTION_RE.lastIndex = 0;
	let m;
	while ((m = SECTION_RE.exec(changelog)) !== null) {
		starts.push({ version: m[1], index: m.index });
	}
	if (starts.length === 0) return [];

	// 2. Pick the requested section, else the topmost one.
	let picked = starts[0];
	if (typeof version === "string" && version !== "") {
		picked = starts.find((s) => s.version === version) ?? starts[0];
	}
	const end = starts.find((s) => s.index > picked.index)?.index ?? changelog.length;
	const section = changelog.slice(picked.index, end);

	// 3. The "### Features" subsection, up to the next "###" or the section end.
	const featuresAt = /^###\s+Features\s*$/m.exec(section);
	if (featuresAt === null) return [];
	const bodyStart = featuresAt.index + featuresAt[0].length;
	const nextSub = /^###\s+/m.exec(section.slice(bodyStart));
	const body = nextSub === null
		? section.slice(bodyStart)
		: section.slice(bodyStart, bodyStart + nextSub.index);

	// 4. Clean each bullet, dropping anything that cleans away to nothing.
	return body
		.split("\n")
		.filter((l) => /^\s*[*-]\s+\S/.test(l))
		.map(cleanBullet)
		.filter((l) => l !== "");
}
