// T5.2  ScriptRunner — unit tests (RED → GREEN)
//
// Tests exercise the runner's policy gate, ask-callback path, timeout, and
// error-handling through spy-based RunnerEffects. NO obsidian import.
//
// RunOutcome discriminated union variants exercised:
//   { kind: "blocked" }         — policy "disabled" or ask→"disable"
//   { kind: "applied"; count }  — script returned non-empty EditPlan
//   { kind: "noop" }            — script returned undefined or []
//   { kind: "failed"; reason }  — script threw or timed out
//
// Design constraints verified:
//   - applyPlan never called on failure (atomicity)
//   - rawFallback called on failure, NOT on noop
//   - notify called with a message on failure
//   - timer from globalThis (not window) so tests run under Node/vitest

import { describe, it, expect, vi } from "vitest";
import { ScriptRunner } from "../../src/scripts/runner";
import type {
	RunnerEffects,
	RunOptions,
	RunOutcome,
	AskCallback,
	AskDecision,
} from "../../src/scripts/runner";
import type { ScriptFunction } from "../../src/scripts/context";
import { buildScriptContext } from "../../src/scripts/context";
import { buildRegistry } from "../../src/core/registry";
import type { OperationContext, EditPlan, MasonSettings } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Helpers
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

interface EffectsSpy extends RunnerEffects {
	appliedPlans: EditPlan[];
	fallbackCount: number;
	notices: string[];
}

function makeEffects(): EffectsSpy {
	const spy: EffectsSpy = {
		appliedPlans: [],
		fallbackCount: 0,
		notices: [],
		applyPlan: (plan: EditPlan): void => { spy.appliedPlans.push(plan); },
		rawFallback: (): void => { spy.fallbackCount++; },
		notify: (msg: string): void => { spy.notices.push(msg); },
	};
	return spy;
}

function makeCtx() {
	const { api } = buildRegistry();
	return buildScriptContext({
		input: "hello world",
		source: "paste",
		op: makeOp(),
		mason: api,
	});
}

const samplePlan: EditPlan = [{ from: 0, to: 0, insert: "X" }];

// Script that returns a non-empty plan synchronously
const scriptReturnsPlan: ScriptFunction = (_ctx) => samplePlan;

// Script that returns undefined
const scriptReturnsUndefined: ScriptFunction = (_ctx) => undefined;

// Script that returns an empty plan
const scriptReturnsEmpty: ScriptFunction = (_ctx) => [];

// Script that throws synchronously
const scriptThrows: ScriptFunction = (_ctx): EditPlan => {
	throw new Error("script crashed");
};

// Script that returns a resolved promise with a plan
const scriptAsyncPlan: ScriptFunction = async (_ctx) => samplePlan;

// Script that returns a promise that never resolves (simulates async hang)
const makeScriptHangs = (): ScriptFunction => (_ctx) =>
	new Promise<EditPlan>(() => { /* never resolves */ });

// Script that returns a promise resolving after a delay
const makeScriptSlowAsync = (delayMs: number): ScriptFunction => (_ctx) =>
	new Promise<EditPlan>((resolve) => {
		globalThis.setTimeout(() => resolve(samplePlan), delayMs);
	});

// Script that returns a rejected promise (async throw)
const scriptAsyncThrows: ScriptFunction = async (_ctx): Promise<EditPlan> => {
	throw new Error("async crash");
};

// ---------------------------------------------------------------------------
// Policy: disabled
// ---------------------------------------------------------------------------

describe("ScriptRunner — policy 'disabled'", () => {
	it("returns blocked outcome without invoking the script", async () => {
		const effects = makeEffects();
		const options: RunOptions = { policy: "disabled" };
		const runner = new ScriptRunner(effects, options);
		const invoked = vi.fn();
		const script: ScriptFunction = (_ctx) => { invoked(); return undefined; };

		const outcome: RunOutcome = await runner.run(script, makeCtx());

		expect(outcome.kind).toBe("blocked");
		expect(invoked).not.toHaveBeenCalled();
	});

	it("does NOT call applyPlan or rawFallback when disabled", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "disabled" });

		await runner.run(scriptReturnsPlan, makeCtx());

		expect(effects.appliedPlans).toHaveLength(0);
		expect(effects.fallbackCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Policy: enabled — success paths
// ---------------------------------------------------------------------------

describe("ScriptRunner — policy 'enabled', success", () => {
	it("returns applied outcome with count when script returns non-empty plan", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		const outcome = await runner.run(scriptReturnsPlan, makeCtx());

		expect(outcome.kind).toBe("applied");
		if (outcome.kind === "applied") {
			expect(outcome.count).toBe(samplePlan.length);
		}
	});

	it("calls applyPlan with the returned plan", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		await runner.run(scriptReturnsPlan, makeCtx());

		expect(effects.appliedPlans).toHaveLength(1);
		expect(effects.appliedPlans[0]).toEqual(samplePlan);
	});

	it("does NOT call rawFallback on success", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		await runner.run(scriptReturnsPlan, makeCtx());

		expect(effects.fallbackCount).toBe(0);
	});

	it("handles async script returning a plan", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		const outcome = await runner.run(scriptAsyncPlan, makeCtx());

		expect(outcome.kind).toBe("applied");
		expect(effects.appliedPlans).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Policy: enabled — noop paths
// ---------------------------------------------------------------------------

describe("ScriptRunner — policy 'enabled', noop", () => {
	it("returns noop outcome when script returns undefined", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		const outcome = await runner.run(scriptReturnsUndefined, makeCtx());

		expect(outcome.kind).toBe("noop");
	});

	it("returns noop outcome when script returns empty array", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		const outcome = await runner.run(scriptReturnsEmpty, makeCtx());

		expect(outcome.kind).toBe("noop");
	});

	it("does NOT call applyPlan or rawFallback on noop", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		await runner.run(scriptReturnsUndefined, makeCtx());

		expect(effects.appliedPlans).toHaveLength(0);
		expect(effects.fallbackCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Policy: enabled — failure paths
// ---------------------------------------------------------------------------

describe("ScriptRunner — policy 'enabled', failure", () => {
	it("returns failed outcome when script throws", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		const outcome = await runner.run(scriptThrows, makeCtx());

		expect(outcome.kind).toBe("failed");
	});

	it("includes a reason in failed outcome", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		const outcome = await runner.run(scriptThrows, makeCtx());

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(typeof outcome.reason).toBe("string");
			expect(outcome.reason.length).toBeGreaterThan(0);
		}
	});

	it("calls rawFallback when script throws", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		await runner.run(scriptThrows, makeCtx());

		expect(effects.fallbackCount).toBe(1);
	});

	it("calls notify with a message when script throws", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		await runner.run(scriptThrows, makeCtx());

		expect(effects.notices).toHaveLength(1);
		expect(typeof effects.notices[0]).toBe("string");
	});

	it("does NOT call applyPlan when script throws (atomicity)", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		await runner.run(scriptThrows, makeCtx());

		expect(effects.appliedPlans).toHaveLength(0);
	});

	it("returns failed outcome when async script rejects", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled" });

		const outcome = await runner.run(scriptAsyncThrows, makeCtx());

		expect(outcome.kind).toBe("failed");
		if (outcome.kind === "failed") {
			expect(outcome.reason).toContain("async crash");
		}
		expect(effects.fallbackCount).toBe(1);
		expect(effects.notices).toHaveLength(1);
		expect(effects.appliedPlans).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Timeout — async hang
// ---------------------------------------------------------------------------

describe("ScriptRunner — timeout", () => {
	it("returns failed outcome when async script exceeds timeoutMs", async () => {
		const effects = makeEffects();
		// Script hangs indefinitely; timeout fires at 20ms
		const runner = new ScriptRunner(effects, { policy: "enabled", timeoutMs: 20 });
		const script = makeScriptHangs();

		const outcome = await runner.run(script, makeCtx());

		expect(outcome.kind).toBe("failed");
	}, 2000);

	it("calls rawFallback on timeout", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled", timeoutMs: 20 });

		await runner.run(makeScriptHangs(), makeCtx());

		expect(effects.fallbackCount).toBe(1);
	}, 2000);

	it("calls notify with a message on timeout", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled", timeoutMs: 20 });

		await runner.run(makeScriptHangs(), makeCtx());

		expect(effects.notices.length).toBeGreaterThan(0);
	}, 2000);

	it("does NOT call applyPlan on timeout (atomicity)", async () => {
		const effects = makeEffects();
		const runner = new ScriptRunner(effects, { policy: "enabled", timeoutMs: 20 });

		await runner.run(makeScriptHangs(), makeCtx());

		expect(effects.appliedPlans).toHaveLength(0);
	}, 2000);

	it("succeeds within timeoutMs when script is fast enough", async () => {
		const effects = makeEffects();
		// Script resolves after 10ms; timeout is 200ms — plenty of headroom
		const runner = new ScriptRunner(effects, { policy: "enabled", timeoutMs: 200 });
		const script = makeScriptSlowAsync(10);

		const outcome = await runner.run(script, makeCtx());

		expect(outcome.kind).toBe("applied");
	}, 2000);
});

// ---------------------------------------------------------------------------
// Policy: ask — callback paths
// ---------------------------------------------------------------------------

describe("ScriptRunner — policy 'ask'", () => {
	it("returns blocked and does not run when askCallback returns 'disable'", async () => {
		const effects = makeEffects();
		const askCallback: AskCallback = async (): Promise<AskDecision> => "disable";
		const runner = new ScriptRunner(effects, { policy: "ask", askCallback });
		const invoked = vi.fn();
		const script: ScriptFunction = (_ctx) => { invoked(); return samplePlan; };

		const outcome = await runner.run(script, makeCtx());

		expect(outcome.kind).toBe("blocked");
		expect(invoked).not.toHaveBeenCalled();
	});

	it("runs the script when askCallback returns 'enable-session'", async () => {
		const effects = makeEffects();
		const askCallback: AskCallback = async (): Promise<AskDecision> => "enable-session";
		const runner = new ScriptRunner(effects, { policy: "ask", askCallback });

		const outcome = await runner.run(scriptReturnsPlan, makeCtx());

		expect(outcome.kind).toBe("applied");
		expect(effects.appliedPlans).toHaveLength(1);
	});

	it("runs the script when askCallback returns 'enable-once'", async () => {
		const effects = makeEffects();
		const askCallback: AskCallback = async (): Promise<AskDecision> => "enable-once";
		const runner = new ScriptRunner(effects, { policy: "ask", askCallback });

		const outcome = await runner.run(scriptReturnsPlan, makeCtx());

		expect(outcome.kind).toBe("applied");
	});

	it("calls askCallback exactly once per run invocation", async () => {
		const effects = makeEffects();
		const askSpy = vi.fn(async (): Promise<AskDecision> => "enable-once");
		const runner = new ScriptRunner(effects, { policy: "ask", askCallback: askSpy });

		await runner.run(scriptReturnsPlan, makeCtx());

		expect(askSpy).toHaveBeenCalledTimes(1);
	});

	it("does NOT call applyPlan or rawFallback when ask returns 'disable'", async () => {
		const effects = makeEffects();
		const askCallback: AskCallback = async (): Promise<AskDecision> => "disable";
		const runner = new ScriptRunner(effects, { policy: "ask", askCallback });

		await runner.run(scriptReturnsPlan, makeCtx());

		expect(effects.appliedPlans).toHaveLength(0);
		expect(effects.fallbackCount).toBe(0);
	});

	it("returns blocked when policy is 'ask' but no askCallback is wired", async () => {
		const effects = makeEffects();
		// Deliberately omit askCallback — the runner must treat this as blocked.
		const runner = new ScriptRunner(effects, { policy: "ask" });
		const invoked = vi.fn();
		const script: ScriptFunction = (_ctx) => { invoked(); return samplePlan; };

		const outcome = await runner.run(script, makeCtx());

		expect(outcome.kind).toBe("blocked");
		expect(invoked).not.toHaveBeenCalled();
		expect(effects.appliedPlans).toHaveLength(0);
		expect(effects.fallbackCount).toBe(0);
	});
});
