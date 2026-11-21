/**
 * buildLifecycleOps — the Scripts page's action seam (spec 010 T2.2).
 *
 * Observable behaviour contracts:
 *   1. With a controller, every op delegates to it and the change callback is
 *      handed to the controller as its re-render path.
 *   2. With a controller, Browse official opens the modal over the catalog
 *      list, labelled with the current store state; enabling an entry drives
 *      controller.enableOfficial.
 *   3. Without a controller, enable / disable / remove mutate the store only
 *      and then invoke the change callback.
 *   4. Without a controller, every catalog-requiring op (Browse official
 *      included) shows the "catalog not available" Notice and opens no modal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	App,
	MockHTMLElement,
	clearLastOpenedModal,
	clearNoticeLog,
	lastOpenedModal,
	noticeLog,
} from "../__mocks__/obsidian";
import type { CatalogEntry } from "../../src/scripts/catalog/catalogSource";
import type { ScriptRecord } from "../../src/scripts/store";
import type { ScriptLifecycleOpsDeps } from "../../src/ui/scriptLifecycleOps";

const { buildLifecycleOps } = await import("../../src/ui/scriptLifecycleOps");

const CATALOG_UNAVAILABLE = "Mason: the script catalog is not available right now.";

function record(overrides: Partial<ScriptRecord> = {}): ScriptRecord {
	return {
		provenance: "curated",
		enabled: false,
		okayed: { version: 1, checksum: "sha256:abc" },
		source: "scripts/a.cjs",
		command: false,
		...overrides,
	};
}

function catalogEntry(id: string, name: string): CatalogEntry {
	return { id, version: 1, checksum: "sha256:abc", path: `scripts/${id}.cjs`, name, description: `${name} description.` };
}

function makeStore(initial: Record<string, ScriptRecord> = {}) {
	const scripts: Record<string, ScriptRecord> = { ...initial };
	return {
		scripts,
		getScripts: vi.fn(() => Promise.resolve({ ...scripts })),
		setRecord: vi.fn((id: string, rec: ScriptRecord) => {
			scripts[id] = rec;
			return Promise.resolve();
		}),
	};
}

function makeController(official: CatalogEntry[] = []) {
	return {
		enable: vi.fn().mockResolvedValue(undefined),
		disable: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		retry: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		reReview: vi.fn().mockResolvedValue(undefined),
		viewSource: vi.fn().mockResolvedValue(undefined),
		importFromVault: vi.fn().mockResolvedValue(undefined),
		listOfficial: vi.fn().mockResolvedValue(official),
		enableOfficial: vi.fn().mockResolvedValue(undefined),
		setRerender: vi.fn(),
	};
}

function makeDeps(
	store: ReturnType<typeof makeStore>,
	controller?: ReturnType<typeof makeController>,
): ScriptLifecycleOpsDeps {
	return { app: new App() as never, store, controller };
}

beforeEach(() => {
	clearNoticeLog();
	clearLastOpenedModal();
});

describe("buildLifecycleOps — controller present", () => {
	it("hands the change callback to the controller as its re-render path", () => {
		const controller = makeController();
		const onChanged = vi.fn();

		buildLifecycleOps(makeDeps(makeStore(), controller), onChanged);

		expect(controller.setRerender).toHaveBeenCalledOnce();
		expect(controller.setRerender).toHaveBeenCalledWith(onChanged);
		expect(onChanged).not.toHaveBeenCalled();
	});

	it.each([
		"enable", "disable", "remove", "retry", "update", "reReview", "viewSource",
	] as const)("%s delegates to the controller with the script id", async (op) => {
		const controller = makeController();
		const store = makeStore({ a: record() });
		const ops = buildLifecycleOps(makeDeps(store, controller), vi.fn());

		await ops[op]("a");

		expect(controller[op]).toHaveBeenCalledOnce();
		expect(controller[op]).toHaveBeenCalledWith("a");
		expect(store.setRecord).not.toHaveBeenCalled();
		expect(noticeLog()).toEqual([]);
	});

	it("importFromVault delegates to the controller", async () => {
		const controller = makeController();
		const ops = buildLifecycleOps(makeDeps(makeStore(), controller), vi.fn());

		await ops.importFromVault();

		expect(controller.importFromVault).toHaveBeenCalledOnce();
		expect(noticeLog()).toEqual([]);
	});

	it("browseOfficial opens the modal over the catalog list with the current store state", async () => {
		const controller = makeController([
			catalogEntry("on", "Already on"),
			catalogEntry("off", "Installed off"),
			catalogEntry("new", "Not installed"),
		]);
		const store = makeStore({ on: record({ enabled: true }), off: record({ enabled: false }) });
		const ops = buildLifecycleOps(makeDeps(store, controller), vi.fn());

		await ops.browseOfficial();

		expect(controller.listOfficial).toHaveBeenCalledOnce();
		const modal = lastOpenedModal();
		expect(modal).toBeDefined();
		const content = modal!.contentEl as unknown as MockHTMLElement;
		expect(content._collectText()).toContain("Already on");
		expect(content._collectText()).toContain("Not installed");
		// Only the enabled entry is non-actionable; installed-but-off and
		// not-yet-installed entries both offer "Enable".
		const labels = content._findAllButtons().map((b) => b._text);
		expect(labels).toEqual(["Enabled", "Enable", "Enable"]);
		expect(noticeLog()).toEqual([]);
	});

	it("enabling an entry in the modal drives controller.enableOfficial, not enable", async () => {
		const controller = makeController([catalogEntry("new", "Not installed")]);
		const ops = buildLifecycleOps(makeDeps(makeStore(), controller), vi.fn());

		await ops.browseOfficial();
		const content = lastOpenedModal()!.contentEl as unknown as MockHTMLElement;
		content._findButtonByText("Enable")!._click();

		expect(controller.enableOfficial).toHaveBeenCalledOnce();
		expect(controller.enableOfficial).toHaveBeenCalledWith("new");
		expect(controller.enable).not.toHaveBeenCalled();
	});
});

describe("buildLifecycleOps — store-only fallback (no controller)", () => {
	it("enable persists enabled=true on the record, then invokes the change callback", async () => {
		const store = makeStore({ a: record({ enabled: false }) });
		const onChanged = vi.fn();
		const ops = buildLifecycleOps(makeDeps(store), onChanged);

		await ops.enable("a");

		expect(store.setRecord).toHaveBeenCalledOnce();
		expect(store.setRecord).toHaveBeenCalledWith("a", record({ enabled: true }));
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("disable persists enabled=false on the record, then invokes the change callback", async () => {
		const store = makeStore({ a: record({ enabled: true }) });
		const onChanged = vi.fn();
		const ops = buildLifecycleOps(makeDeps(store), onChanged);

		await ops.disable("a");

		expect(store.setRecord).toHaveBeenCalledWith("a", record({ enabled: false }));
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("remove disables the record and drops its consent, then invokes the change callback", async () => {
		const store = makeStore({ a: record({ enabled: true }) });
		const onChanged = vi.fn();
		const ops = buildLifecycleOps(makeDeps(store), onChanged);

		await ops.remove("a");

		expect(store.setRecord).toHaveBeenCalledWith("a", record({ enabled: false, okayed: null }));
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("invokes the change callback only after the store write has landed", async () => {
		const store = makeStore({ a: record() });
		const enabledWhenChanged: boolean[] = [];
		const ops = buildLifecycleOps(makeDeps(store), () => {
			enabledWhenChanged.push(store.scripts["a"]!.enabled);
		});

		await ops.enable("a");

		expect(enabledWhenChanged).toEqual([true]);
	});

	it.each(["enable", "disable", "remove"] as const)(
		"%s on an unknown script neither writes nor invokes the change callback",
		async (op) => {
			const store = makeStore();
			const onChanged = vi.fn();
			const ops = buildLifecycleOps(makeDeps(store), onChanged);

			await ops[op]("missing");

			expect(store.setRecord).not.toHaveBeenCalled();
			expect(onChanged).not.toHaveBeenCalled();
		},
	);

	it.each(["retry", "update", "reReview", "viewSource"] as const)(
		"%s shows the catalog-not-available Notice and leaves the store alone",
		async (op) => {
			const store = makeStore({ a: record() });
			const onChanged = vi.fn();
			const ops = buildLifecycleOps(makeDeps(store), onChanged);

			await ops[op]("a");

			expect(noticeLog()).toEqual([CATALOG_UNAVAILABLE]);
			expect(store.setRecord).not.toHaveBeenCalled();
			expect(onChanged).not.toHaveBeenCalled();
		},
	);

	it("importFromVault shows the catalog-not-available Notice", async () => {
		const ops = buildLifecycleOps(makeDeps(makeStore()), vi.fn());

		await ops.importFromVault();

		expect(noticeLog()).toEqual([CATALOG_UNAVAILABLE]);
	});

	it("browseOfficial shows the catalog-not-available Notice and opens no modal", async () => {
		const ops = buildLifecycleOps(makeDeps(makeStore()), vi.fn());

		await ops.browseOfficial();

		expect(noticeLog()).toEqual([CATALOG_UNAVAILABLE]);
		expect(lastOpenedModal()).toBeUndefined();
	});
});
