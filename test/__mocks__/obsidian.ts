/**
 * Minimal vitest mock for the 'obsidian' package (types-only, no runtime).
 * Exposes the minimal surface used by MarkdownMasonPlugin.
 * Reusable by later test phases.
 */

export interface EventRef {
	_mockEventRef: true;
}

export class App {
	workspace: Workspace;
	constructor() {
		this.workspace = new Workspace();
	}
}

export class Workspace {
	private _layoutReadyCallbacks: Array<() => void> = [];

	onLayoutReady(cb: () => void): void {
		this._layoutReadyCallbacks.push(cb);
	}

	/** Test helper: fire all registered onLayoutReady callbacks. */
	_fireLayoutReady(): void {
		for (const cb of this._layoutReadyCallbacks) {
			cb();
		}
	}

	/** Test helper: how many layout-ready callbacks were registered. */
	get _layoutReadyCount(): number {
		return this._layoutReadyCallbacks.length;
	}
}

export class Plugin {
	app: App;
	private _registeredCleanups: Array<() => void> = [];
	private _registeredEventRefs: EventRef[] = [];
	private _savedData: unknown = undefined;

	constructor(app: App, _manifest?: unknown) {
		this.app = app;
	}

	async loadData(): Promise<unknown> {
		return this._savedData ?? {};
	}

	async saveData(data: unknown): Promise<void> {
		this._savedData = data;
	}

	registerEvent(ref: EventRef): void {
		this._registeredEventRefs.push(ref);
	}

	register(cb: () => void): void {
		this._registeredCleanups.push(cb);
	}

	addCommand(_cmd: unknown): void {
		// no-op
	}

	/** Test helper: cleanups registered via register(). */
	get _cleanups(): Array<() => void> {
		return [...this._registeredCleanups];
	}

	/** Test helper: event refs registered via registerEvent(). */
	get _eventRefs(): EventRef[] {
		return [...this._registeredEventRefs];
	}

	/** Test helper: the in-memory saved data. */
	get _persistedData(): unknown {
		return this._savedData;
	}
}
