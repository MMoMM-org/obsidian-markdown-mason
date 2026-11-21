// scriptLifecycleOps — builds the Scripts page's LifecycleOps action seam.
//
// DESIGN
// ──────
// Two shapes, chosen by whether the live LifecycleController is wired:
//
//   Controller present (production + integration tests): EVERY op delegates to
//   it — the controller composes the existing services (disclosure consent gate,
//   materializer, store, per-device fingerprint, catalog) and refreshes the page
//   through the change callback handed to it here. Browse official presents a
//   modal listing the curated entries, each with an enable action.
//
//   Controller absent (init failure path, card-rendering unit tests that inject
//   only a fake store): enable / disable / remove operate on the store directly;
//   the catalog-requiring ops surface a sentence-case Notice rather than a stub.
//
// The builder takes a narrow deps object rather than the whole plugin, so it is
// testable without one.

import { Notice } from "obsidian";
import type { App } from "obsidian";
import type { LifecycleController } from "../scripts/lifecycleController";
import type { ScriptStore } from "../scripts/store";
import { BrowseOfficialModal } from "./browseOfficialModal";
import type { BrowseEntryStatus } from "./browseOfficialModal";
import type { LifecycleOps } from "./scriptsTab";

/** The slice of the script store the lifecycle ops read and write. */
export type ScriptLifecycleStore = Pick<ScriptStore, "getScripts" | "setRecord">;

/** The slice of the live controller the lifecycle ops delegate to. */
export type ScriptLifecycleController = Pick<
	LifecycleController,
	| "enable"
	| "disable"
	| "remove"
	| "retry"
	| "update"
	| "reReview"
	| "viewSource"
	| "importFromVault"
	| "listOfficial"
	| "enableOfficial"
	| "setRerender"
>;

/** Everything buildLifecycleOps needs from its host. */
export interface ScriptLifecycleOpsDeps {
	/** Owner of the Browse official modal. */
	app: App;
	store: ScriptLifecycleStore;
	/** Absent when lifecycle initialisation failed → store-only fallback ops. */
	controller?: ScriptLifecycleController;
}

/**
 * Build the Scripts page's LifecycleOps.
 *
 * `onChanged` is invoked whenever an op changed script state and the page must
 * refresh: the controller calls it as its re-render path; the fallback ops call
 * it after each store write.
 */
export function buildLifecycleOps(deps: ScriptLifecycleOpsDeps, onChanged: () => void): LifecycleOps {
	const { controller } = deps;
	if (controller === undefined) return buildStoreOnlyOps(deps.store, onChanged);
	controller.setRerender(onChanged);
	return buildControllerOps(deps.app, deps.store, controller);
}

function buildControllerOps(
	app: App,
	store: ScriptLifecycleStore,
	controller: ScriptLifecycleController,
): LifecycleOps {
	return {
		enable: (id) => controller.enable(id),
		disable: (id) => controller.disable(id),
		remove: (id) => controller.remove(id),
		retry: (id) => controller.retry(id),
		update: (id) => controller.update(id),
		reReview: (id) => controller.reReview(id),
		viewSource: (id) => controller.viewSource(id),
		importFromVault: () => controller.importFromVault(),
		browseOfficial: async () => {
			const entries = await controller.listOfficial();
			// Reflect each entry's current state so an already-enabled script
			// shows as "Enabled" instead of offering a redundant "Enable".
			const records = await store.getScripts();
			const statusOf = (id: string): BrowseEntryStatus => {
				const record = records[id];
				if (record === undefined) return "available";
				return record.enabled ? "enabled" : "installed";
			};
			new BrowseOfficialModal(app, entries, (id: string) => {
				// enableOfficial creates the curated record first — enable() alone
				// would silently no-op for a catalog entry that has no record yet.
				void controller.enableOfficial(id);
			}, statusOf).open();
		},
	};
}

function buildStoreOnlyOps(store: ScriptLifecycleStore, onChanged: () => void): LifecycleOps {
	const setEnabled = async (id: string, enabled: boolean): Promise<void> => {
		const record = (await store.getScripts())[id];
		if (record === undefined) return;
		await store.setRecord(id, { ...record, enabled });
		onChanged();
	};

	const showCatalogUnavailable = (): void => {
		new Notice("Mason: the script catalog is not available right now.");
	};

	return {
		enable: (id) => setEnabled(id, true),
		disable: (id) => setEnabled(id, false),
		remove: async (id) => {
			const record = (await store.getScripts())[id];
			if (record === undefined) return;
			await store.setRecord(id, { ...record, enabled: false, okayed: null });
			onChanged();
		},
		retry: showCatalogUnavailable,
		update: showCatalogUnavailable,
		reReview: showCatalogUnavailable,
		viewSource: showCatalogUnavailable,
		importFromVault: showCatalogUnavailable,
		browseOfficial: showCatalogUnavailable,
	};
}
