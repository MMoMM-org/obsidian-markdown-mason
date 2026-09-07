// src/core/indent.ts — leading-whitespace measurement shared by the transforms
// that reason about list nesting (fitToList, reflow). CON-2: no plugin imports.

/**
 * Leading-whitespace width in columns; a tab counts as 4.
 *
 * The exact tab width does not matter — every caller uses the result only to
 * COMPARE and RANK indents, never to rebuild one — but a fixed value keeps a
 * tab consistently deeper than three spaces and shallower than five.
 */
export function indentWidth(line: string): number {
	let w = 0;
	for (const ch of line) {
		if (ch === "\n" || ch === "\r") break;
		else if (ch === "\t") w += 4;
		// Any other whitespace counts as one column: clipboard text from a web
		// page, Word or Confluence often indents with NBSP (U+00A0) or another
		// Unicode space, and that IS the author's nesting — reading it as width 0
		// would collapse the hierarchy.
		else if (/\s/.test(ch)) w += 1;
		else break;
	}
	return w;
}
