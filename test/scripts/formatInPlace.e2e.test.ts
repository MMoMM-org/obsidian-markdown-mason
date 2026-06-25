// Format-in-place E2E — running a paste-formatter as a COMMAND on a selection.
//
// This proves the "Fix → Feature" behaviour: when perplexity-app runs as a
// command over selected raw Perplexity text (embedded in the note), the script
// REPLACES the selection with the formatted result instead of inserting a copy
// at the cursor and leaving the raw text behind (which would duplicate it).
//
// The command path is modelled exactly as commandManager._invokeScript builds it
// for a non-empty selection: cursor anchored to the selection START, replaceRange
// set to the selection span, input = the selected raw text, source = "command".

import { describe, it, expect, vi } from "vitest";
import { buildRegistry } from "../../src/core/registry";
import { buildScriptContext } from "../../src/scripts/context";
import { applyToString } from "../../src/core/applyToString";
import { loadFixture } from "../fixtures";
import { perplexityAppScript } from "../../catalog/scripts/perplexityApp";
import type { ScriptContext } from "../../src/scripts/context";
import type { MasonSettings, EditPlan } from "../../src/core/types";

const rawInput = loadFixture("app");

function makeSettings(): MasonSettings {
	return { debugLogging: false, resourcesName: "Resources" };
}

/** Build the command-on-selection ScriptContext for raw text embedded in a note. */
function makeCommandCtx(doc: string, from: number, to: number): ScriptContext {
	const { api } = buildRegistry();
	return buildScriptContext({
		input: doc.slice(from, to),
		source: "command",
		op: {
			doc,
			// Mirrors commandManager: cursor = selection start, replaceRange = span.
			cursor: from,
			selection: { from, to },
			replaceRange: { from, to },
			input: doc.slice(from, to),
			settings: makeSettings(),
		},
		mason: api,
		logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	});
}

describe("perplexity-app as a command on a selection — format-in-place", () => {
	// A note with an H1, then the raw Perplexity copy pasted as plain text and
	// selected. The selection spans exactly the raw block.
	const HEADER = "# Sakura Notes\n\n";
	const doc = `${HEADER}${rawInput}\n`;
	const from = HEADER.length;
	const to = HEADER.length + rawInput.length;

	// perplexityAppScript is synchronous; the ScriptFunction union widens to include
	// Promise, so narrow it here for the assertions.
	const plan = perplexityAppScript(makeCommandCtx(doc, from, to)) as EditPlan | undefined;
	const output = applyToString(doc, plan ?? []);

	it("produces a non-empty plan (the selection is processed)", () => {
		expect(plan).toBeDefined();
		expect((plan ?? []).length).toBeGreaterThan(0);
	});

	it("replaces the raw selection — no leftover Sources scaffolding", () => {
		// If the selection were NOT replaced, the raw "Sources" block and bare
		// [n] <title> <url> source lines would still be present in the output.
		expect(output).not.toMatch(/^Sources\s*$/m);
		expect(output).not.toMatch(/^\[\d+\]\s+\S.*https?:\/\/\S+\s*$/m);
	});

	it("formats in place — body has [^n] footnotes and the header is not duplicated", () => {
		expect(output).toMatch(/\[\^\d+\]/); // citations converted to footnotes
		// The note header survives exactly once (no duplicate insertion).
		expect(output.match(/# Sakura Notes/g)).toHaveLength(1);
		// The formatted body sits under the header (cascaded), not appended after raw.
		expect(output.startsWith(HEADER)).toBe(true);
	});
});
