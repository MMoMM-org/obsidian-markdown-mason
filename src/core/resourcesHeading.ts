// Resources-section heading helpers (pure; no Obsidian import — CON-2).
//
// The `resourcesName` setting is the HEADING that "Tidy / Move footnotes" uses
// as the destination for footnote definitions. It carries an optional ATX level
// prefix, so the user controls the heading level:
//
//   "## Resources"   → level-2 section (default)
//   "### Resources"  → level-3 section
//   "Resources"      → tolerated; treated as "## Resources"
//
// Detection is name-based and level-agnostic: if a section with the configured
// NAME already exists at ANY level, footnotes are placed there at its level.
// Only when no such section exists is a new one CREATED, using the configured
// heading (default level 2).

/** A parsed ATX heading: its level (1–6) and trimmed text. */
export interface AtxHeading {
	level: number;
	text: string;
}

/**
 * Parse an ATX heading line ("## Title") into { level, text }, or null when the
 * line is not a well-formed ATX heading. Requires 1–6 leading "#", at least one
 * space/tab, then non-empty text. "####### x" (7+) and "#x" (no space) are not
 * headings.
 */
export function parseAtxHeading(line: string): AtxHeading | null {
	const m = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
	if (m === null) return null;
	return { level: m[1].length, text: m[2] };
}

/**
 * The section NAME (heading text without level/prefix) from the configured
 * setting. Strips a leading run of "#" and surrounding whitespace. Falls back to
 * "Resources" when the result would be empty.
 */
export function resourcesSectionName(setting: string): string {
	const name = setting.trim().replace(/^#{1,6}[ \t]*/, "").trim();
	return name === "" ? "Resources" : name;
}

/**
 * The heading line to CREATE when no Resources section exists yet. A well-formed
 * configured heading is reused (with normalised single-space spacing); anything
 * else defaults to a level-2 heading of the derived name.
 */
export function resourcesCreateHeading(setting: string): string {
	const heading = parseAtxHeading(setting.trim());
	if (heading !== null) {
		return `${"#".repeat(heading.level)} ${heading.text}`;
	}
	return `## ${resourcesSectionName(setting)}`;
}

/** Bounds of a located Resources section. */
export interface ResourcesSectionBounds {
	/** Offset of the start of the heading line. */
	from: number;
	/** Offset just past the section content (start of the next heading of level ≤ own, or clamped EOF). */
	to: number;
	/** ATX level of the section heading. */
	level: number;
}

/**
 * Locate a Resources section by NAME at any level. The section runs from its
 * heading until the next heading of level ≤ its own (deeper sub-headings stay
 * inside); if none follows, it runs to the end of the document.
 *
 * Offsets are computed against the original document (lines joined by "\n"),
 * matching the ADR-1 offset convention used by the footnote movers.
 */
export function findResourcesSectionByName(
	lines: string[],
	name: string,
	docLength: number,
): ResourcesSectionBounds | null {
	let level = 0;
	let sectionFrom = 0;
	let inSection = false;
	let offset = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineLen = line.length + 1; // +1 for the newline

		if (!inSection) {
			const heading = parseAtxHeading(line);
			if (heading !== null && heading.text === name) {
				inSection = true;
				level = heading.level;
				sectionFrom = offset;
			}
			offset += lineLen;
			continue;
		}

		// Inside the section: stop at the next heading of level ≤ the section's.
		const heading = parseAtxHeading(line);
		if (heading !== null && heading.level <= level) {
			return { from: sectionFrom, to: offset, level };
		}

		offset += lineLen;
	}

	if (!inSection) return null;
	return { from: sectionFrom, to: Math.min(offset, docLength), level };
}
