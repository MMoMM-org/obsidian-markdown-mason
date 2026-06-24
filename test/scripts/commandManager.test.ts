// T4.3  CommandManager — register/unregister + cleanup
//
// Tests behaviour of CommandManager through an injected minimal plugin surface.
// No real Obsidian runtime required — CommandManager is designed for DI.
//
// Behaviour under test:
//   REGISTRATION
//   (a) toggling command ON registers a command with no default hotkeys
//   (b) toggling command OFF unregisters it (removeCommand called with full prefixed id)
//   (c) re-registering (already registered) removes first, then adds (idempotent)
//   (d) unregister on unknown id is a no-op (no crash)
//
//   CLEANUP (disable / remove)
//   (e) disableScript unregisters the command AND clears record.command=false via store.setRecord
//   (f) removeScript unregisters the command AND clears record.command=false via store.setRecord
//   (g) disableScript on a script with command=false (never registered) is a no-op (no crash)
//
//   FAIL-SAFE (stale command)
//   (h) invoking a command whose script is Disabled calls notify() with reason and does NOT execute
//   (i) invoking a command whose script is Blocked calls notify() with reason and does NOT execute
//   (j) invoking a command whose script is Active DOES execute (script is called)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { clearNoticeLog, noticeLog } from "../__mocks__/obsidian";
import type { CommandSpec } from "../__mocks__/obsidian";
import type { Editor, EditorPosition, EditorSelection } from "obsidian";
import type { ScriptRecord } from "../../src/scripts/store";
import type { LifecycleState } from "../../src/scripts/lifecycle";
import { DEFAULT_SETTINGS } from "../../src/core/types";
import type { EditPlan } from "../../src/core/types";

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

const { CommandManager } = await import("../../src/scripts/commandManager");
import type { CommandManagerInjection } from "../../src/scripts/commandManager";

// ---------------------------------------------------------------------------
// Helpers — minimal plugin surface double
// ---------------------------------------------------------------------------

interface MockPluginSurface {
	addCommand(spec: CommandSpec): CommandSpec;
	removeCommand(fullId: string): void;
	pluginId: string;
	// test helpers
	_commands: CommandSpec[];
	_removedIds: string[];
}

function makePluginSurface(pluginId = "markdown-mason"): MockPluginSurface {
	const commands: CommandSpec[] = [];
	const removed: string[] = [];
	return {
		pluginId,
		addCommand(spec: CommandSpec): CommandSpec {
			commands.push(spec);
			return spec;
		},
		removeCommand(fullId: string): void {
			removed.push(fullId);
			const idx = commands.findIndex(c => `${pluginId}:${c.id}` === fullId);
			if (idx !== -1) {
				commands.splice(idx, 1);
			}
		},
		get _commands(): CommandSpec[] {
			return [...commands];
		},
		get _removedIds(): string[] {
			return [...removed];
		},
	};
}

// ---------------------------------------------------------------------------
// Helpers — fake store
// ---------------------------------------------------------------------------

type FakeStore = {
	getScripts: ReturnType<typeof vi.fn>;
	setRecord: ReturnType<typeof vi.fn>;
};

function makeStore(scripts: Record<string, ScriptRecord> = {}): FakeStore {
	return {
		getScripts: vi.fn().mockResolvedValue(scripts),
		setRecord: vi.fn().mockResolvedValue(undefined),
	};
}

// ---------------------------------------------------------------------------
// Helpers — base ScriptRecord factory
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ScriptRecord> = {}): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "abc123" },
		source: "https://example.com/script.cjs",
		command: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Helpers — minimal Editor mock
// The editorCallback wires selectionContext(editor, settings) internally, so
// the editor must support the minimal surface that selectionContext reads.
// ---------------------------------------------------------------------------

function makeMinimalEditor(doc = ""): Editor {
	const pos: EditorPosition = { line: 0, ch: 0 };
	const sel: EditorSelection = { anchor: pos, head: pos };
	return {
		getValue: () => doc,
		listSelections: () => [sel],
		posToOffset: (_p: EditorPosition) => 0,
		getSelection: () => "",
		replaceSelection: (_s: string) => {},
	} as unknown as Editor;
}

// ---------------------------------------------------------------------------
// Helpers — state resolver
// ---------------------------------------------------------------------------

function makeStateResolver(state: LifecycleState): (id: string) => LifecycleState {
	return (_id: string) => state;
}

// ---------------------------------------------------------------------------
// Helpers — stub script function
// ---------------------------------------------------------------------------

function makeScript() {
	return vi.fn().mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// SUITE A — Registration behaviour
// ---------------------------------------------------------------------------

describe("CommandManager — registration", () => {
	it("(a) register adds a command with no hotkeys field", () => {
		const surface = makePluginSurface();
		const store = makeStore({ "my-script": makeRecord({ command: true }) });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register("my-script", "My Script", script, makeStateResolver({ kind: "Active" }));

		const commands = surface._commands;
		expect(commands).toHaveLength(1);
		expect(commands[0].id).toBe("my-script");
		expect(commands[0].name).toBe("My Script");
		// No default hotkeys — must not be set
		expect(commands[0].hotkeys).toBeUndefined();
	});

	it("(b) unregister calls removeCommand with the full prefixed id", () => {
		const surface = makePluginSurface("markdown-mason");
		const store = makeStore({ "my-script": makeRecord({ command: true }) });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register("my-script", "My Script", script, makeStateResolver({ kind: "Active" }));
		manager.unregister("my-script");

		expect(surface._removedIds).toContain("markdown-mason:my-script");
		expect(surface._commands).toHaveLength(0);
	});

	it("(c) re-registering an already-registered id removes then re-adds (idempotent)", () => {
		const surface = makePluginSurface("markdown-mason");
		const store = makeStore({ "my-script": makeRecord({ command: true }) });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register("my-script", "My Script", script, makeStateResolver({ kind: "Active" }));
		manager.register("my-script", "My Script (updated)", script, makeStateResolver({ kind: "Active" }));

		// Should have removed before re-adding
		expect(surface._removedIds).toContain("markdown-mason:my-script");
		// Only 1 command should be active
		expect(surface._commands).toHaveLength(1);
		expect(surface._commands[0].name).toBe("My Script (updated)");
	});

	it("(d) unregister on unknown id is a no-op (no crash)", () => {
		const surface = makePluginSurface();
		const store = makeStore({});
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);

		// Should not throw
		expect(() => manager.unregister("ghost-script")).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// SUITE B — Cleanup on disable / remove
// ---------------------------------------------------------------------------

describe("CommandManager — cleanup on disable/remove", () => {
	it("(e) disableScript unregisters the command AND sets record.command=false", async () => {
		const surface = makePluginSurface("markdown-mason");
		const existingRecord = makeRecord({ command: true, enabled: true });
		const store = makeStore({ "my-script": existingRecord });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register("my-script", "My Script", script, makeStateResolver({ kind: "Active" }));
		await manager.disableScript("my-script");

		// Command should be removed
		expect(surface._removedIds).toContain("markdown-mason:my-script");

		// store.setRecord should have been called with command=false, preserving other fields
		expect(store.setRecord).toHaveBeenCalledWith(
			"my-script",
			expect.objectContaining({ command: false }),
		);
		// Verify other fields are preserved (not wiped)
		const savedRecord = (store.setRecord as ReturnType<typeof vi.fn>).mock.calls[0][1] as ScriptRecord;
		expect(savedRecord.enabled).toBe(existingRecord.enabled);
		expect(savedRecord.provenance).toBe(existingRecord.provenance);
		expect(savedRecord.okayed).toEqual(existingRecord.okayed);
	});

	it("(f) removeScript unregisters the command AND sets record.command=false", async () => {
		const surface = makePluginSurface("markdown-mason");
		const existingRecord = makeRecord({ command: true, enabled: true });
		const store = makeStore({ "my-script": existingRecord });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register("my-script", "My Script", script, makeStateResolver({ kind: "Active" }));
		await manager.removeScript("my-script");

		// Command should be removed
		expect(surface._removedIds).toContain("markdown-mason:my-script");

		// store.setRecord should have been called with command=false
		expect(store.setRecord).toHaveBeenCalledWith(
			"my-script",
			expect.objectContaining({ command: false }),
		);
	});

	it("(g) disableScript on never-registered script is a no-op (no crash)", async () => {
		const surface = makePluginSurface("markdown-mason");
		const existingRecord = makeRecord({ command: false });
		const store = makeStore({ "my-script": existingRecord });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);

		// Never called register — command was never registered
		await expect(manager.disableScript("my-script")).resolves.not.toThrow();
		// No removeCommand called for this id
		expect(surface._removedIds).not.toContain("markdown-mason:my-script");
	});
});

// ---------------------------------------------------------------------------
// SUITE C — Fail-safe (stale command vs non-Active script)
// ---------------------------------------------------------------------------

describe("CommandManager — fail-safe (stale command)", () => {
	beforeEach(() => {
		clearNoticeLog();
	});

	it("(h) invoking command when script is Disabled calls notify and does NOT execute script", async () => {
		const surface = makePluginSurface("markdown-mason");
		const store = makeStore({ "slow-script": makeRecord() });
		let stateOverride: LifecycleState = { kind: "Active" };
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register(
			"slow-script",
			"Slow Script",
			script,
			(_id: string) => stateOverride,
		);

		// Simulate the script becoming disabled after registration (stale command)
		stateOverride = { kind: "Disabled" };

		// Find and invoke the registered command's editorCallback
		const cmd = surface._commands.find(c => c.id === "slow-script");
		expect(cmd).toBeDefined();
		await cmd!.editorCallback!(makeMinimalEditor());

		// Script must NOT have been called
		expect(script).not.toHaveBeenCalled();

		// A notice must have been shown
		const notices = noticeLog();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/disabled/i);
	});

	it("(i) invoking command when script is Blocked calls notify with reason and does NOT execute", async () => {
		const surface = makePluginSurface("markdown-mason");
		const store = makeStore({ "drift-script": makeRecord() });
		let stateOverride: LifecycleState = { kind: "Active" };
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register(
			"drift-script",
			"Drift Script",
			script,
			(_id: string) => stateOverride,
		);

		// Simulate the script becoming blocked (checksum drift)
		stateOverride = { kind: "Blocked", reason: "drift" };

		const cmd = surface._commands.find(c => c.id === "drift-script");
		await cmd!.editorCallback!(makeMinimalEditor());

		// Script must NOT have been called
		expect(script).not.toHaveBeenCalled();

		// A notice must have been shown that includes the block reason
		const notices = noticeLog();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/drift/i);
	});

	it("(j) invoking command when script is Active DOES execute the script", async () => {
		const surface = makePluginSurface("markdown-mason");
		const store = makeStore({ "active-script": makeRecord() });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		manager.register(
			"active-script",
			"Active Script",
			script,
			makeStateResolver({ kind: "Active" }),
		);

		const cmd = surface._commands.find(c => c.id === "active-script");
		await cmd!.editorCallback!(makeMinimalEditor("hello world"));

		// Script should have been invoked
		expect(script).toHaveBeenCalled();
	});

	it("(l) calling runScript directly when script is Disabled does NOT execute and notifies", async () => {
		const surface = makePluginSurface("markdown-mason");
		const store = makeStore({ "direct-script": makeRecord() });
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS);
		const script = makeScript();

		await manager.runScript(
			"direct-script",
			"Direct Script",
			script,
			makeStateResolver({ kind: "Disabled" }),
			makeMinimalEditor(),
		);

		// Script must NOT have been called
		expect(script).not.toHaveBeenCalled();

		// A notice must have been shown containing "disabled"
		const notices = noticeLog();
		expect(notices).toHaveLength(1);
		expect(notices[0]).toMatch(/disabled/i);
	});

	it("(k) invoking command when script returns a non-empty EditPlan applies the plan", async () => {
		// W2: this test was written to expose the W1 no-op bug.
		// Before the W1 fix, effects.applyPlan is a no-op and the spy is never called.
		// After the fix, effects.applyPlan calls the injected applyPlan spy with the plan.
		const surface = makePluginSurface("markdown-mason");
		const store = makeStore({ "plan-script": makeRecord() });

		const expectedPlan: EditPlan = [{ from: 0, to: 0, insert: "x" }];
		const planSpy = vi.fn<(editor: Editor, plan: EditPlan) => void>();

		const injection: CommandManagerInjection = { applyPlan: planSpy };
		const manager = new CommandManager(surface, store, DEFAULT_SETTINGS, injection);

		// Script that returns a non-empty EditPlan
		const script = vi.fn().mockResolvedValue(expectedPlan);

		manager.register(
			"plan-script",
			"Plan Script",
			script,
			makeStateResolver({ kind: "Active" }),
		);

		const cmd = surface._commands.find(c => c.id === "plan-script");
		await cmd!.editorCallback!(makeMinimalEditor("hello world"));

		// The injected applyPlan spy must have been called with the returned plan
		expect(planSpy).toHaveBeenCalledOnce();
		expect(planSpy.mock.calls[0][1]).toEqual(expectedPlan);
	});
});
