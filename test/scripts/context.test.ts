// T5.2  ScriptContext factory — unit tests (RED → GREEN)
//
// Verifies that buildScriptContext assembles all required fields correctly:
//   - input and source are threaded through as-is
//   - op (OperationContext) is threaded through
//   - mason is the MasonApi passed in (no new registry instantiation here)
//   - logger surfaces a ScriptLogger with info/warn/error methods
//
// NO obsidian import in context.ts — these tests confirm purity.

import { describe, it, expect, vi } from "vitest";
import { buildScriptContext } from "../../src/scripts/context";
import type { ScriptContext } from "../../src/scripts/context";
import { buildRegistry } from "../../src/core/registry";
import type { OperationContext, MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

const makeSettings = (): MasonSettings => ({
	debugLogging: false,
	resourcesName: "Resources",
});

const makeOp = (overrides: Partial<OperationContext> = {}): OperationContext => ({
	doc: "# Hello\n\nWorld.\n",
	cursor: 0,
	settings: makeSettings(),
	...overrides,
});

// ---------------------------------------------------------------------------
// buildScriptContext — field assembly
// ---------------------------------------------------------------------------

describe("buildScriptContext — field assembly", () => {
	it("threads input through to ctx.input", () => {
		const { api } = buildRegistry();
		const op = makeOp();
		const ctx: ScriptContext = buildScriptContext({
			input: "clipboard text",
			source: "paste",
			op,
			mason: api,
		});
		expect(ctx.input).toBe("clipboard text");
	});

	it("threads source through to ctx.source", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({
			input: "selection text",
			source: "selection",
			op: makeOp(),
			mason: api,
		});
		expect(ctx.source).toBe("selection");
	});

	it("accepts 'command' as source", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({
			input: "",
			source: "command",
			op: makeOp(),
			mason: api,
		});
		expect(ctx.source).toBe("command");
	});

	it("threads op through to ctx.op", () => {
		const { api } = buildRegistry();
		const op = makeOp({ doc: "# Custom doc\n", cursor: 5 });
		const ctx = buildScriptContext({ input: "", source: "paste", op, mason: api });
		expect(ctx.op).toBe(op);
	});

	it("threads mason through to ctx.mason", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({ input: "", source: "paste", op: makeOp(), mason: api });
		expect(ctx.mason).toBe(api);
	});

	it("provides a logger with info, warn, error methods", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({ input: "", source: "paste", op: makeOp(), mason: api });
		expect(typeof ctx.logger.info).toBe("function");
		expect(typeof ctx.logger.warn).toBe("function");
		expect(typeof ctx.logger.error).toBe("function");
	});

	it("logger.info is callable without throwing", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({ input: "", source: "paste", op: makeOp(), mason: api });
		expect(() => ctx.logger.info("test message")).not.toThrow();
	});

	it("logger.warn is callable without throwing", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({ input: "", source: "paste", op: makeOp(), mason: api });
		expect(() => ctx.logger.warn("test warning")).not.toThrow();
	});

	it("logger.error is callable without throwing", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({ input: "", source: "paste", op: makeOp(), mason: api });
		expect(() => ctx.logger.error("test error")).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// buildScriptContext — mason API wired to real registry
// ---------------------------------------------------------------------------

describe("buildScriptContext — mason wired to real registry", () => {
	it("ctx.mason.headings.cascade(ctx.op) returns an EditPlan array", () => {
		const { api } = buildRegistry();
		const op = makeOp({ doc: "# H1\n## H2\n\nText.\n" });
		const ctx = buildScriptContext({ input: "", source: "paste", op, mason: api });
		const plan = ctx.mason.headings.cascade(ctx.op);
		expect(Array.isArray(plan)).toBe(true);
	});

	it("ctx.mason.headings.normalize(ctx.op) returns an EditPlan array", () => {
		const { api } = buildRegistry();
		const op = makeOp({ doc: "### H3\n\nText.\n" });
		const ctx = buildScriptContext({ input: "", source: "paste", op, mason: api });
		const plan = ctx.mason.headings.normalize(ctx.op);
		expect(Array.isArray(plan)).toBe(true);
	});

	it("ctx.mason.util.normalizeUrl('https://example.com') returns a string", () => {
		const { api } = buildRegistry();
		const ctx = buildScriptContext({ input: "", source: "paste", op: makeOp(), mason: api });
		const result = ctx.mason.util.normalizeUrl("https://example.com");
		expect(typeof result).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// buildScriptContext — accepts a custom logger
// ---------------------------------------------------------------------------

describe("buildScriptContext — custom logger injection", () => {
	it("uses the provided logger when passed", () => {
		const { api } = buildRegistry();
		const infoMessages: string[] = [];
		const customLogger = {
			info: (s: string): void => { infoMessages.push(s); },
			warn: vi.fn(),
			error: vi.fn(),
		};
		const ctx = buildScriptContext({
			input: "",
			source: "paste",
			op: makeOp(),
			mason: api,
			logger: customLogger,
		});
		ctx.logger.info("hello");
		expect(infoMessages).toEqual(["hello"]);
	});
});
