// T6.2  LifecycleController — live Scripts-tab ops
//
// PURPOSE
// -------
// One async method per Scripts-tab lifecycle op (enable, disable, retry, update,
// reReview, remove, viewSource, browseOfficial/listOfficial, importFromVault),
// composing the EXISTING units:
//
//   - ScriptDisclosureModal (consent gate — shows {version,checksum,size})
//   - materialize()         (the ONLY writer of script code; fail-closed match-gate)
//   - ScriptStore           (persists decisions; consent rides okayed)
//   - FingerprintStore      (per-device materialized-version manifest, T6.1)
//   - CatalogSource         (curated {version,checksum} + raw bytes)
//
// NO NEW LIFECYCLE/TRUST LOGIC lives here. Consent is recorded as okayed; code is
// written only by materialize; the per-device fingerprint is updated only on a
// successful materialize. The settings tab delegates to this controller and
// re-renders via its GUARDED path (injected as `rerender`).
//
// TEST SEAMS (all injectable, default to real impls in main.ts):
//   ask           — show the disclosure and return the decision (default: ScriptDisclosureModal)
//   openUrl       — open a repo URL (default: window.open)
//   listCjsFiles  — list vault .cjs candidate paths for import
//   pickCjsFile   — pick one path from the candidates (default: a minimal modal)
//
// COMMUNITY COMPLIANCE
// --------------------
// All Notice / modal text is sentence case; no innerHTML; console.debug only.

import { Notice } from "obsidian";
import type { App } from "obsidian";
import { ScriptDisclosureModal } from "./disclosure";
import type { ScriptInfo } from "./disclosure";
import { materialize } from "./materializer";
import type { MaterializeReason } from "./materializer";
import { sha256Bytes } from "./checksum";
import { extractScriptDescription } from "./loader";
import { debug } from "../core/debug";
import { RAW_BASE, PINNED_REF } from "./catalog/pinnedRef";
import type { CatalogSource, CatalogEntry } from "./catalog/catalogSource";
import type { FingerprintStore } from "./materializedFingerprint";
import type { ScriptRecord, ScriptStore } from "./store";
import type { AskDecision } from "./runner";

// ---------------------------------------------------------------------------
// Vault surface — materialize/import + best-effort delete (remove is optional)
// ---------------------------------------------------------------------------

/** Minimal vault surface the controller needs for materialize, import, and delete. */
export interface LifecycleVault {
	readBinary(path: string): Promise<ArrayBuffer>;
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	exists(path: string): Promise<boolean>;
	mkdir?(path: string): Promise<void>;
	/** Best-effort delete of a materialized file (Obsidian DataAdapter.remove). Optional. */
	remove?(path: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface LifecycleControllerDeps {
	app: App;
	store: Pick<ScriptStore, "getScripts" | "setRecord" | "deleteRecord">;
	catalog: CatalogSource;
	vault: LifecycleVault;
	fingerprints: FingerprintStore;
	/** Build the materialized destination path for a script id. */
	destPath: (id: string) => string;
	/** Re-render the Scripts tab — the settings tab injects its GUARDED path. */
	rerender: () => void;

	// --- Test seams (default to real implementations) ---
	/** Show the disclosure modal and return the user's decision. */
	ask?: (info: ScriptInfo) => Promise<AskDecision>;
	/** Open an external URL (curated view-source). */
	openUrl?: (url: string) => void;
	/** List candidate vault .cjs paths for import-from-vault. */
	listCjsFiles?: () => Promise<string[]>;
	/** Pick one path from candidates (or null to cancel). */
	pickCjsFile?: (paths: string[]) => Promise<string | null>;
	/** Unregister the script's Obsidian command (in-memory only, no persistence). */
	unregisterCommand?: (id: string) => void;
	/**
	 * Re-register the script's Obsidian command with a FRESH module + state snapshot.
	 * Called after any op that changes runnability — a successful (re)materialize
	 * (update/retry/re-enable → rebinds new code, becomes Active) or a disable
	 * (refreshes the frozen snapshot to Disabled so the fail-safe blocks it). Avoids
	 * needing a plugin reload. No-op when the script has no command (command:false).
	 * Optional: omitted by tests that don't exercise commands.
	 */
	reRegisterCommand?: (id: string) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// LifecycleController
// ---------------------------------------------------------------------------

export class LifecycleController {
	private readonly _d: LifecycleControllerDeps;

	constructor(deps: LifecycleControllerDeps) {
		this._d = deps;
	}

	/**
	 * Override the re-render hook. The plugin constructs the controller before the
	 * settings tab exists; the tab calls this to inject its GUARDED re-render path
	 * (_selectSegment) so every op refreshes the Scripts tab without reintroducing
	 * an unguarded re-render.
	 */
	setRerender(rerender: () => void): void {
		this._d.rerender = rerender;
	}

	// -------------------------------------------------------------------------
	// enable — disclosure (when needed) → persist okayed → materialize → fingerprint
	// -------------------------------------------------------------------------

	/**
	 * Enable a script.
	 *
	 * - Unconsented (okayed===null) OR catalog/source {version,checksum} differs
	 *   from okayed → show the disclosure with the to-be-consented identity.
	 *     * enable-session → persist {enabled:true, okayed:{v,c}} → materialize →
	 *       on ok fingerprint.setVersion.
	 *     * enable-once → ephemeral (do NOT persist okayed; mirrors disclosure.ts).
	 *     * disable/cancel → leave disabled, no materialize.
	 * - Already consented with UNCHANGED {v,c} (re-enable) → NO modal: persist
	 *   enabled:true, materialize, fingerprint.
	 */
	async enable(id: string): Promise<void> {
		const rec = (await this._d.store.getScripts())[id];
		if (rec === undefined) {
			debug("[MarkdownMason] enable: no record for", id, "— nothing to enable");
			this._d.rerender();
			return;
		}

		const identity = await this._resolveIdentity(id, rec);
		if (identity === null) {
			debug("[MarkdownMason] enable: could not resolve identity for", id, "(source:", rec.source, ")");
			new Notice("Mason: could not load the script to enable.");
			this._d.rerender();
			return;
		}

		const consented = this._isConsented(rec, identity);
		debug("[MarkdownMason] enable:", id, "consented=", consented);
		if (consented) {
			await this._commitEnable(id, rec, identity);
			this._d.rerender();
			return;
		}

		const decision = await this._ask({
			vaultRelativePath: identity.vaultRelativePath,
			fileSizeBytes: identity.fileSizeBytes,
			version: identity.version,
			checksum: identity.checksum,
			description: identity.description,
		});
		debug("[MarkdownMason] enable:", id, "disclosure decision=", decision);

		if (decision === "enable-session") {
			await this._commitEnable(id, rec, identity);
		}
		// enable-once: ephemeral — no okayed persisted (disclosure.ts semantics).
		// disable/cancel: leave disabled, no materialize.
		this._d.rerender();
	}

	// -------------------------------------------------------------------------
	// disable — persist enabled:false (no materialize)
	// -------------------------------------------------------------------------

	async disable(id: string): Promise<void> {
		const rec = (await this._d.store.getScripts())[id];
		if (rec !== undefined) {
			await this._d.store.setRecord(id, { ...rec, enabled: false });
			// Refresh the command's frozen state snapshot to Disabled so its fail-safe
			// blocks invocation ("is disabled") instead of running the now-disabled
			// script off a stale Active snapshot. Command + hotkey persist (consistent
			// with _restoreScriptCommands keeping commands for non-Active scripts).
			await this._d.reRegisterCommand?.(id);
		}
		this._d.rerender();
	}

	// -------------------------------------------------------------------------
	// retry — re-materialize; on ok fingerprint, on failure surface the reason
	// -------------------------------------------------------------------------

	async retry(id: string): Promise<void> {
		const rec = (await this._d.store.getScripts())[id];
		if (rec === undefined || rec.okayed === null) {
			new Notice("Mason: nothing to retry — the script has no approved version.");
			this._d.rerender();
			return;
		}
		const result = await this._materialize(id, rec);
		if (result.ok) {
			await this._d.fingerprints.setVersion(id, rec.okayed.version);
			await this._d.reRegisterCommand?.(id);
		} else {
			new Notice(`Mason: retry failed — ${reasonText(result.reason)}.`);
		}
		this._d.rerender();
	}

	// -------------------------------------------------------------------------
	// update — re-disclose NEW catalog {v,c} → persist → materialize → fingerprint(new)
	// -------------------------------------------------------------------------

	async update(id: string): Promise<void> {
		const rec = (await this._d.store.getScripts())[id];
		if (rec === undefined) { this._d.rerender(); return; }

		const entry = await this._catalogEntry(id);
		if (entry === null) {
			new Notice("Mason: could not reach the catalog to update.");
			this._d.rerender();
			return;
		}

		const decision = await this._ask({
			vaultRelativePath: entry.path,
			fileSizeBytes: await this._curatedSize(entry),
			version: entry.version,
			checksum: entry.checksum,
			description: entry.description || rec.description,
		});

		if (decision === "enable-session") {
			const next: ScriptRecord = {
				...rec, enabled: true,
				okayed: { version: entry.version, checksum: entry.checksum },
			};
			await this._d.store.setRecord(id, next);
			const result = await this._materialize(id, next);
			if (result.ok) {
				await this._d.fingerprints.setVersion(id, entry.version);
				await this._d.reRegisterCommand?.(id);
			} else {
				new Notice(`Mason: update failed — ${reasonText(result.reason)}.`);
			}
		}
		this._d.rerender();
	}

	// -------------------------------------------------------------------------
	// reReview — re-show disclosure for current {v,c}; consent re-persists okayed
	// -------------------------------------------------------------------------

	async reReview(id: string): Promise<void> {
		const rec = (await this._d.store.getScripts())[id];
		if (rec === undefined || rec.okayed === null) {
			new Notice("Mason: nothing to re-review — the script has no approved version.");
			this._d.rerender();
			return;
		}

		const identity = await this._resolveIdentity(id, rec);
		const info: ScriptInfo = identity ?? {
			vaultRelativePath: rec.source,
			fileSizeBytes: 0,
			version: rec.okayed.version,
			checksum: rec.okayed.checksum,
			description: rec.description,
		};

		const decision = await this._ask({
			vaultRelativePath: info.vaultRelativePath,
			fileSizeBytes: info.fileSizeBytes,
			version: rec.okayed.version,
			checksum: rec.okayed.checksum,
			description: info.description,
		});

		if (decision === "enable-session") {
			// Re-persist the SAME okayed (no version change) — refresh the consent.
			await this._d.store.setRecord(id, {
				...rec, enabled: true,
				okayed: { version: rec.okayed.version, checksum: rec.okayed.checksum },
			});
		}
		this._d.rerender();
	}

	// -------------------------------------------------------------------------
	// remove — delete record + delete materialized file + remove fingerprint
	// -------------------------------------------------------------------------

	async remove(id: string): Promise<void> {
		this._d.unregisterCommand?.(id);
		await this._deleteMaterialized(id);
		await this._d.fingerprints.remove(id);
		await this._d.store.deleteRecord(id);
		this._d.rerender();
	}

	// -------------------------------------------------------------------------
	// viewSource — curated → repo URL; imported → reveal vault path
	// -------------------------------------------------------------------------

	async viewSource(id: string): Promise<void> {
		const rec = (await this._d.store.getScripts())[id];
		if (rec === undefined) {
			new Notice("Mason: no source to view.");
			return;
		}
		if (rec.provenance === "curated") {
			const entry = await this._catalogEntry(id);
			if (entry === null) {
				new Notice("Mason: could not reach the catalog to view the source.");
				return;
			}
			this._openUrl(`${RAW_BASE}/${PINNED_REF}/${entry.path}`);
			return;
		}
		// Imported: best-effort reveal — surface the vault path.
		new Notice(`Mason: source file is at ${rec.source}`);
	}

	// -------------------------------------------------------------------------
	// browseOfficial — fetch the catalog index and return curated entries
	// -------------------------------------------------------------------------

	/** Fetch the catalog index and return curated entries (for the browse modal). */
	async listOfficial(): Promise<CatalogEntry[]> {
		try {
			const index = await this._d.catalog.fetchIndex();
			return Object.values(index.scripts);
		} catch (err) {
			debug("[MarkdownMason] listOfficial: catalog fetch failed —", err);
			new Notice("Mason: could not reach the official catalog.");
			return [];
		}
	}

	/**
	 * Install a curated entry chosen in the Browse-official modal.
	 *
	 * Browse-official lists CATALOG entries — most have no stored record yet, and
	 * enable() silently no-ops on a missing record. So create the curated record
	 * first (source = the catalog path, for display/view-source), THEN run the
	 * shared enable (disclosure → materialize) flow. This mirrors importFromVault()
	 * on the curated side.
	 */
	async enableOfficial(id: string): Promise<void> {
		const existing = (await this._d.store.getScripts())[id];
		if (existing === undefined) {
			const entry = await this._catalogEntry(id);
			if (entry === null) {
				new Notice("Mason: could not reach the official catalog.");
				this._d.rerender();
				return;
			}
			const rec: ScriptRecord = {
				provenance: "curated",
				enabled: false,
				okayed: null,
				source: entry.path,
				command: false,
				...(entry.description ? { description: entry.description } : {}),
			};
			await this._d.store.setRecord(id, rec);
		}
		await this.enable(id);
	}

	// -------------------------------------------------------------------------
	// importFromVault — pick a .cjs → create imported record → enable flow
	// -------------------------------------------------------------------------

	async importFromVault(): Promise<void> {
		const candidates = await this._listCjs();
		debug("[MarkdownMason] importFromVault: candidates", candidates.length, candidates);
		const picked = await this._pickCjs(candidates);
		debug("[MarkdownMason] importFromVault: picked", picked);
		if (picked === null) {
			// Cancelled — nothing to do (no coming-soon stub).
			this._d.rerender();
			return;
		}

		const id = deriveId(picked);

		// Collision guard: refuse to silently overwrite an existing record.
		const existing = (await this._d.store.getScripts())[id];
		if (existing !== undefined) {
			debug("[MarkdownMason] importFromVault: id collision", id);
			new Notice(`Mason: a script named "${id}" already exists — rename the file or remove the existing one first.`);
			this._d.rerender();
			return;
		}

		const rec: ScriptRecord = {
			provenance: "imported",
			enabled: false,
			okayed: null,
			source: picked,
			command: false,
		};
		// Best-effort: surface a "// description:" header the user wrote in the
		// script. Parsed from source text — no execution before consent.
		const description = await this._readDescription(picked);
		if (description !== undefined) rec.description = description;
		await this._d.store.setRecord(id, rec);
		debug("[MarkdownMason] importFromVault: created imported record", id, "→ running enable flow");

		// Run the same disclosure → materialize flow as enable().
		await this.enable(id);
	}

	// =========================================================================
	// Private helpers
	// =========================================================================

	/**
	 * Persist enabled:true + okayed (the consented identity), materialize the
	 * bytes, and on success record the per-device fingerprint.
	 */
	private async _commitEnable(
		id: string,
		rec: ScriptRecord,
		identity: ResolvedIdentity,
	): Promise<void> {
		const next: ScriptRecord = {
			...rec,
			enabled: true,
			okayed: { version: identity.version, checksum: identity.checksum },
		};
		await this._d.store.setRecord(id, next);
		const result = await this._materialize(id, next);
		debug("[MarkdownMason] enable: materialize", id, result.ok ? "ok" : `failed (${result.reason})`);
		if (result.ok) {
			await this._d.fingerprints.setVersion(id, identity.version);
			await this._d.reRegisterCommand?.(id);
		} else {
			new Notice(`Mason: could not install the script — ${reasonText(result.reason)}.`);
		}
	}

	/** True when the record's okayed already matches the to-be-consented identity. */
	private _isConsented(rec: ScriptRecord, identity: ResolvedIdentity): boolean {
		return rec.okayed !== null
			&& rec.okayed.version === identity.version
			&& rec.okayed.checksum === identity.checksum;
	}

	/**
	 * Resolve the to-be-consented identity (version, checksum, size, path):
	 *   curated  → from the catalog entry (+ fetched bytes for size; doubles as pre-check)
	 *   imported → from the vault source bytes (size + checksum); version = okayed.version or 1
	 * Returns null when the source/catalog can't be reached.
	 */
	private async _resolveIdentity(id: string, rec: ScriptRecord): Promise<ResolvedIdentity | null> {
		if (rec.provenance === "curated") {
			const entry = await this._catalogEntry(id);
			if (entry === null) return null;
			return {
				version: entry.version,
				checksum: entry.checksum,
				fileSizeBytes: await this._curatedSize(entry),
				vaultRelativePath: entry.path,
				description: entry.description || rec.description,
			};
		}
		// Imported: read the vault source bytes for size + checksum.
		try {
			const buf = await this._d.vault.readBinary(rec.source);
			const bytes = new Uint8Array(buf);
			return {
				version: rec.okayed?.version ?? 1,
				checksum: sha256Bytes(bytes),
				fileSizeBytes: bytes.byteLength,
				vaultRelativePath: rec.source,
				// Prefer the live header (may have changed) over the stored copy.
				description: extractScriptDescription(new TextDecoder().decode(bytes)) ?? rec.description,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Best-effort read of a "// description:" header from a vault script source.
	 * Returns undefined when the file can't be read or declares no description.
	 */
	private async _readDescription(vaultPath: string): Promise<string | undefined> {
		try {
			const buf = await this._d.vault.readBinary(vaultPath);
			const text = new TextDecoder().decode(new Uint8Array(buf));
			return extractScriptDescription(text);
		} catch {
			return undefined;
		}
	}

	/** Fetch the catalog entry for an id, or null if unreachable/absent. */
	private async _catalogEntry(id: string): Promise<CatalogEntry | null> {
		try {
			const index = await this._d.catalog.fetchIndex();
			return index.scripts[id] ?? null;
		} catch (err) {
			debug("[MarkdownMason] _catalogEntry: catalog fetch failed for", id, "—", err);
			return null;
		}
	}

	/** Fetch curated bytes to derive the displayed size; 0 if unavailable. */
	private async _curatedSize(entry: CatalogEntry): Promise<number> {
		try {
			const bytes = await this._d.catalog.fetchScript(entry);
			return bytes.byteLength;
		} catch (err) {
			debug("[MarkdownMason] _curatedSize: script fetch failed for", entry.id, "—", err);
			return 0;
		}
	}

	/** Run the shared materializer against the current record. */
	private _materialize(id: string, record: ScriptRecord) {
		return materialize(id, {
			record,
			catalog: this._d.catalog,
			vault: this._d.vault,
			destPath: this._d.destPath(id),
		});
	}

	/** Best-effort delete of the materialized <id>.cjs (no-op when remove is absent). */
	private async _deleteMaterialized(id: string): Promise<void> {
		const path = this._d.destPath(id);
		if (this._d.vault.remove === undefined) return;
		try {
			if (await this._d.vault.exists(path)) {
				await this._d.vault.remove(path);
			}
		} catch (err: unknown) {
			debug("[MarkdownMason] could not delete materialized script:", err);
		}
	}

	// --- seam accessors (default to real implementations) ---

	private _ask(info: ScriptInfo): Promise<AskDecision> {
		if (this._d.ask !== undefined) return this._d.ask(info);
		return new ScriptDisclosureModal(this._d.app, info).present();
	}

	private _openUrl(url: string): void {
		if (this._d.openUrl !== undefined) { this._d.openUrl(url); return; }
		window.open(url, "_blank", "noopener,noreferrer");
	}

	private _listCjs(): Promise<string[]> {
		return this._d.listCjsFiles?.() ?? Promise.resolve([]);
	}

	private _pickCjs(paths: string[]): Promise<string | null> {
		if (this._d.pickCjsFile !== undefined) return this._d.pickCjsFile(paths);
		return Promise.resolve(null);
	}
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

/** Resolved to-be-consented identity for the disclosure + materialize flow. */
interface ResolvedIdentity {
	version: number;
	checksum: string;
	fileSizeBytes: number;
	vaultRelativePath: string;
	description?: string;
}

/** Sentence-case human reason for a materialize failure. */
function reasonText(reason: MaterializeReason): string {
	switch (reason) {
		case "drift":
			return "the script bytes changed since you approved them";
		case "offline":
			return "the catalog could not be reached";
		case "source-missing":
			return "the source file was not found";
		case "checksum-mismatch":
			return "the fetched bytes did not match the expected checksum";
	}
}

/** Derive a stable script id from a vault path: basename without the .cjs extension. */
function deriveId(vaultPath: string): string {
	const base = vaultPath.split(/[/\\]/).pop() ?? vaultPath;
	return base.replace(/\.cjs$/i, "");
}
