// Guards the authoring teaching template (docs/examples/example-script.cjs):
// it must stay a VALID Mason envelope and behave as the guide claims, so the
// documentation never drifts into a broken example.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const example = require(resolve(__dirname, "../../docs/examples/example-script.cjs")) as {
	run: (ctx: unknown) => unknown;
	paste?: { canHandle: (input: string) => boolean; priority: number };
};

interface Edit { from: number; to: number; insert: string }

function makeCtx(opts: {
	input: string;
	source?: string;
	cursor?: number;
	replaceRange?: { from: number; to: number };
}): unknown {
	return {
		input: opts.input,
		source: opts.source ?? "paste",
		op: {
			doc: "# Note\n\n",
			cursor: opts.cursor ?? 8,
			replaceRange: opts.replaceRange,
			settings: { resourcesName: "Resources", debugLogging: false },
		},
		logger: { info: () => {}, warn: () => {}, error: () => {} },
	};
}

describe("docs/examples/example-script.cjs — valid envelope + documented behaviour", () => {
	it("exports a callable run and a well-formed paste block", () => {
		expect(typeof example.run).toBe("function");
		expect(typeof example.paste?.canHandle).toBe("function");
		expect(typeof example.paste?.priority).toBe("number");
		expect(example.paste!.canHandle("hello")).toBe(true);
		expect(example.paste!.canHandle("   ")).toBe(false);
	});

	it("no-ops on empty input", () => {
		expect(example.run(makeCtx({ input: "   " }))).toBeUndefined();
	});

	it("paste mode: inserts at the cursor (from === to)", () => {
		const plan = example.run(makeCtx({ input: "hello", cursor: 8 })) as Edit[];
		expect(plan).toHaveLength(1);
		expect(plan[0].from).toBe(8);
		expect(plan[0].to).toBe(8);
		expect(plan[0].insert).toContain("> [!note]");
		expect(plan[0].insert).toContain("> hello");
	});

	it("command-on-selection: replaces the selection via replaceRange", () => {
		const plan = example.run(
			makeCtx({ input: "hello", source: "command", replaceRange: { from: 2, to: 7 } }),
		) as Edit[];
		expect(plan).toHaveLength(1);
		expect(plan[0].from).toBe(2);
		expect(plan[0].to).toBe(7); // a real replacement, not a zero-width insert
	});
});
