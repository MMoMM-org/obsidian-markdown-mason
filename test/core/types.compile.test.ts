import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import type {
	Edit,
	EditPlan,
	MasonSettings,
	OperationContext,
	FootnoteRef,
	ExistingRef,
	ParseResult,
	Operation,
} from "../../src/core/types";
import type { FormatSelectionRecipe } from "../../src/core/formatSelection";

// ---------------------------------------------------------------------------
// Compile fixture — verifies that every contract type in src/core/types.ts
// can be constructed from a concrete literal value and that the module shape
// is exactly as specified by the SDD. The real assertion is that this file
// compiles under tsc (noEmit). The trivial it() below lets vitest collect
// the file so CI surfaces type errors as test failures.
// ---------------------------------------------------------------------------

// Edit
const _edit: Edit = { from: 0, to: 5, insert: "hello" };

// EditPlan
const _editPlan: EditPlan = [
	{ from: 0, to: 3, insert: "abc" },
];

// OperationContext — uses real MasonSettings shape (debugLogging + resourcesName)
const _ctx: OperationContext = {
	doc: "# Title\n\nBody text.",
	cursor: 10,
	selection: { from: 0, to: 7 },
	input: "paste payload",
	settings: { debugLogging: false, resourcesName: "Resources" },
};

// FootnoteRef
const _footnoteRef: FootnoteRef = {
	incomingId: 1,
	snippet: "some text",
	title: "Example Domain",
	url: "https://example.com",
};

// ExistingRef
const _existingRef: ExistingRef = { id: 2, url: "https://example.org" };

// ParseResult
const _parseResult: ParseResult = {
	body: "Body after extraction.",
	inline: [{ marker: "[^1]", n: 1 }],
	sources: [_footnoteRef],
};

// Operation — concrete implementation with run returning an EditPlan
const _operation: Operation = {
	id: "headings.cascade",
	apiName: "mason.headings.cascade",
	command: { name: "Cascade headings" },
	run(_runCtx: OperationContext): EditPlan {
		return [];
	},
};

// MasonSettings.formatSelection is OPTIONAL — accepts Partial<FormatSelectionRecipe>
const _settingsWithPartialFormatSelection: MasonSettings = {
	debugLogging: false,
	resourcesName: "Resources",
	formatSelection: { move: false },
};

// Suppress unused-variable warnings from noUnusedLocals by referencing values.
void _edit;
void _editPlan;
void _ctx;
void _footnoteRef;
void _existingRef;
void _parseResult;
void _operation;
void _settingsWithPartialFormatSelection;

describe("src/core/types — compile fixture", () => {
	it("all contract types construct without compile errors", () => {
		// The real assertion is that tsc accepted this file.
		// A runtime truth-check keeps vitest from skipping it.
		expect(true).toBe(true);
	});
});

describe("DEFAULT_SETTINGS.formatSelection", () => {
	it("deep-equals the all-on recipe (reflow opt-in: off)", () => {
		const expected: FormatSelectionRecipe = {
			cascade: true,
			normalize: true,
			fromCitations: true,
			identity: true,
			move: true,
			reflow: false,
			dewrap: true,
			dehyphenate: true,
			decomposeLigatures: true,
			tidyWhitespace: true,
			normalizeBullets: true,
			normalizeOrdered: true,
		};
		expect(DEFAULT_SETTINGS.formatSelection).toEqual(expected);
	});
});
