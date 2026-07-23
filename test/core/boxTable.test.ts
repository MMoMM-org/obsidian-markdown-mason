// test/core/boxTable.test.ts — spec 007 box-drawing table transform.
// Primary fixture: a real Claude-Code table copied from WezTerm (wrapped cells).

import { describe, it, expect } from "vitest";
import type { OperationContext } from "../../src/core/types";
import { boxTable } from "../../src/core/boxTable";
import { applyToString } from "../../src/core/applyToString";

const makeSettings = () => ({ debugLogging: false as const, resourcesName: "Resources" });
const makeCtx = (doc: string): OperationContext => ({ doc, cursor: 0, settings: makeSettings() });
const run = (doc: string): string => applyToString(doc, boxTable(makeCtx(doc)));

describe("boxTable — basic conversion", () => {
	it("converts a simple light-line table", () => {
		const doc =
			"┌───┬───┐\n" +
			"│ A │ B │\n" +
			"├───┼───┤\n" +
			"│ 1 │ 2 │\n" +
			"└───┴───┘\n";
		expect(run(doc)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
	});

	it("joins a cell wrapped across physical rows", () => {
		const doc =
			"┌──────┬──────┐\n" +
			"│ Name │ Note │\n" +
			"├──────┼──────┤\n" +
			"│ Foo  │ line │\n" +
			"│      │ two  │\n" +
			"└──────┴──────┘\n";
		expect(run(doc)).toBe(
			"| Name | Note |\n| --- | --- |\n| Foo | line two |\n",
		);
	});

	it("preserves surrounding prose and only rewrites the table", () => {
		const doc =
			"Intro line.\n\n" +
			"┌───┬───┐\n│ A │ B │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘\n\n" +
			"Outro line.\n";
		expect(run(doc)).toBe(
			"Intro line.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro line.\n",
		);
	});
});

describe("boxTable — variants", () => {
	it("handles heavy/double-line frames", () => {
		const doc =
			"╔═══╦═══╗\n" +
			"║ A ║ B ║\n" +
			"╠═══╬═══╣\n" +
			"║ 1 ║ 2 ║\n" +
			"╚═══╩═══╝\n";
		expect(run(doc)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
	});

	it("handles the ASCII +--+ | frame", () => {
		const doc =
			"+-----+-----+\n" +
			"| A   | B   |\n" +
			"+-----+-----+\n" +
			"| 1   | 2   |\n" +
			"+-----+-----+\n";
		expect(run(doc)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
	});
});

describe("boxTable — indented (terminal scrollback)", () => {
	it("converts a 4-space-indented table (would be indentedCode) flush-left", () => {
		const doc =
			"    ┌───┬───┐\n" +
			"    │ A │ B │\n" +
			"    ├───┼───┤\n" +
			"    │ 1 │ 2 │\n" +
			"    └───┴───┘\n";
		expect(run(doc)).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n");
	});

	it("converts only the indented table, leaving surrounding indented prose untouched", () => {
		const doc =
			"  das ist eine copy:\n" +
			"    ┌───┬───┐\n" +
			"    │ A │ B │\n" +
			"    ├───┼───┤\n" +
			"    │ 1 │ 2 │\n" +
			"    └───┴───┘\n" +
			"\n" +
			"    Entscheidend:\n";
		expect(run(doc)).toBe(
			"  das ist eine copy:\n" +
			"\n" + // blank line inserted so the table renders
			"| A | B |\n| --- | --- |\n| 1 | 2 |\n" +
			"\n" +
			"    Entscheidend:\n",
		);
	});
});

describe("boxTable — blank-line separation (Markdown rendering)", () => {
	it("inserts a blank line before and after when a caption/prose hugs the frame", () => {
		const doc =
			"Caption:\n" +
			"┌───┬───┐\n│ A │ B │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘\n" +
			"Next para.\n";
		expect(run(doc)).toBe(
			"Caption:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nNext para.\n",
		);
	});

	it("does not add blank lines when they already exist", () => {
		const doc =
			"Caption:\n\n" +
			"┌───┬───┐\n│ A │ B │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘\n" +
			"\nNext para.\n";
		expect(run(doc)).toBe(
			"Caption:\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nNext para.\n",
		);
	});
});

describe("boxTable — safety", () => {
	it("bails on a ragged grid (row column count differs from header)", () => {
		const doc =
			"┌───┬───┐\n│ A │ B │\n├───┼───┤\n│ 1 │ 2 │ 3 │\n└───┴───┘\n";
		expect(run(doc)).toBe(doc); // unchanged
	});

	it("escapes a literal pipe inside a │-delimited cell", () => {
		const doc =
			"┌─────────┬───┐\n" +
			"│ a | b   │ c │\n" +
			"├─────────┼───┤\n" +
			"│ x       │ y │\n" +
			"└─────────┴───┘\n";
		expect(run(doc)).toBe("| a \\| b | c |\n| --- | --- |\n| x | y |\n");
	});

	it("leaves box-drawing characters inside a fenced code block untouched", () => {
		const doc =
			"```\n" +
			"┌───┬───┐\n│ A │ B │\n└───┴───┘\n" +
			"```\n";
		expect(run(doc)).toBe(doc);
	});

	it("does not touch an existing Markdown table (no border rule to start a run)", () => {
		const doc = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";
		expect(run(doc)).toBe(doc);
	});

	it("does not touch prose that merely contains a pipe", () => {
		const doc = "This is a | pipe in prose, not a table.\n";
		expect(run(doc)).toBe(doc);
	});

	it("is idempotent — a converted table is unchanged on re-run", () => {
		const doc =
			"┌───┬───┐\n│ A │ B │\n├───┼───┤\n│ 1 │ 2 │\n└───┴───┘\n";
		const once = run(doc);
		expect(run(once)).toBe(once);
	});
});

describe("boxTable — real WezTerm/Claude-Code capture", () => {
	it("reconstructs a 3-column table with wrapped cells", () => {
		const doc =
			"┌───────────┬──────────────────────────────┬──────────────────────┐\n" +
			"│ Artefakt  │ Form                         │ Wer liest sie        │\n" +
			"├───────────┼──────────────────────────────┼──────────────────────┤\n" +
			"│ Report    │ Prosa-Satz, gerendert in     │ Nur du (Human        │\n" +
			"│ (.md)     │ render.py:102-110            │ Channel)             │\n" +
			"├───────────┼──────────────────────────────┼──────────────────────┤\n" +
			"│ Wire      │ detail.candidate_mocs: []    │ Pass-2-Parser und    │\n" +
			"│ (.json)   │ roh                          │ Hashi/Tomo-Editor    │\n" +
			"└───────────┴──────────────────────────────┴──────────────────────┘\n";
		expect(run(doc)).toBe(
			"| Artefakt | Form | Wer liest sie |\n" +
			"| --- | --- | --- |\n" +
			"| Report (.md) | Prosa-Satz, gerendert in render.py:102-110 | Nur du (Human Channel) |\n" +
			"| Wire (.json) | detail.candidate_mocs: [] roh | Pass-2-Parser und Hashi/Tomo-Editor |\n",
		);
	});
});
