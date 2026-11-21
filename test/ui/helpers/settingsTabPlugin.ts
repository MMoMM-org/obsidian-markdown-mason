/**
 * Test double for the plugin surface MasonSettingTab consumes (spec 010):
 * in-memory settings, a spy-able saveSettings, a script store over a mutable
 * record map, a command manager, and the optional live resolver / controller.
 */

import { vi } from "vitest";
import { App } from "obsidian";
import type { MasonSettings } from "../../../src/core/types";
import type { LifecycleState } from "../../../src/scripts/lifecycle";
import type { ScriptRecord } from "../../../src/scripts/store";
import type { ScriptItem } from "../../../src/ui/scriptsPage";

export const TEST_MANIFEST = {
	id: "markdown-mason",
	name: "Markdown Mason",
	version: "9.8.7",
	minAppVersion: "1.13.1",
	description: "Test description.",
	author: "Marcus Breiden <marcus@example.com>",
	isDesktopOnly: true,
};

export function makeScriptRecord(overrides?: Partial<ScriptRecord>): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:abc" },
		source: "vault/script.cjs",
		command: false,
		...overrides,
	};
}

/** A live-resolver fake: every record resolves to `states[id]`, else Disabled. */
export function makeFakeResolver(states: Record<string, LifecycleState>) {
	return {
		clearCache: vi.fn(),
		resolveItems: vi.fn(async (records: Record<string, ScriptRecord>): Promise<ScriptItem[]> =>
			Object.entries(records).map(([id, record]) => ({
				id,
				displayName: id,
				description: `About ${id}.`,
				record,
				state: states[id] ?? { kind: "Disabled" },
				version: 1,
				provenance: record.provenance,
				catalogVersion: undefined,
			})),
		),
	};
}

/** A live-controller fake; every op is observable. */
export function makeFakeController() {
	return {
		enable: vi.fn().mockResolvedValue(undefined),
		disable: vi.fn().mockResolvedValue(undefined),
		remove: vi.fn().mockResolvedValue(undefined),
		retry: vi.fn().mockResolvedValue(undefined),
		update: vi.fn().mockResolvedValue(undefined),
		reReview: vi.fn().mockResolvedValue(undefined),
		viewSource: vi.fn().mockResolvedValue(undefined),
		importFromVault: vi.fn().mockResolvedValue(undefined),
		listOfficial: vi.fn().mockResolvedValue([]),
		enableOfficial: vi.fn().mockResolvedValue(undefined),
		setRerender: vi.fn(),
	};
}

export interface TabPluginOptions {
	settings?: Partial<MasonSettings>;
	scripts?: Record<string, ScriptRecord>;
	lifecycleResolver?: ReturnType<typeof makeFakeResolver>;
	lifecycleController?: ReturnType<typeof makeFakeController>;
}

/**
 * The plugin double. `scripts` is the store's backing map: the store hands out
 * copies, and a test may mutate the map to change what the next read returns.
 */
export function makeTabPlugin(options: TabPluginOptions = {}) {
	const scripts: Record<string, ScriptRecord> = { ...(options.scripts ?? {}) };
	const settings: MasonSettings = {
		resourcesName: "## Resources",
		debugLogging: false,
		...options.settings,
	};
	const plugin: {
		app: App;
		manifest: typeof TEST_MANIFEST;
		settings: MasonSettings;
		saveSettings: ReturnType<typeof vi.fn<() => Promise<void>>>;
		store: {
			getScripts: ReturnType<typeof vi.fn<() => Promise<Record<string, ScriptRecord>>>>;
			setRecord: ReturnType<typeof vi.fn<(id: string, record: ScriptRecord) => Promise<void>>>;
		};
		commandManager: { register: ReturnType<typeof vi.fn>; unregister: ReturnType<typeof vi.fn> };
		lifecycleResolver?: ReturnType<typeof makeFakeResolver>;
		lifecycleController?: ReturnType<typeof makeFakeController>;
		updatableScriptCount?: number;
	} = {
		app: new App(),
		manifest: { ...TEST_MANIFEST },
		settings,
		saveSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
		store: {
			getScripts: vi.fn(async () => ({ ...scripts })),
			setRecord: vi.fn(async (id: string, record: ScriptRecord) => {
				scripts[id] = record;
			}),
		},
		commandManager: { register: vi.fn(), unregister: vi.fn() },
		lifecycleResolver: options.lifecycleResolver,
		lifecycleController: options.lifecycleController,
	};
	return { plugin, scripts };
}

/** Lets already-settled promise continuations (store read, resolve, handlers) run. */
export async function settle(): Promise<void> {
	for (let turn = 0; turn < 10; turn++) {
		await Promise.resolve();
	}
}
