// T6.1  MaterializedFingerprintStore — per-device version manifest (RED → GREEN)
//
// Tests the per-device fingerprint store that records which VERSION of a script
// was materialized on THIS device. This store NEVER writes to data.json
// (synced plugin data); it lives at a path in the per-device scripts dir
// (e.g. <pluginDir>/scripts/.materialized.json) via the VaultAdapterPort.
//
// The store is tested in complete isolation: all I/O is through a fake vault
// adapter backed by an in-memory map.

import { describe, it, expect, vi } from "vitest";
import type { VaultAdapterPort } from "../../src/scripts/runtime";

// ---------------------------------------------------------------------------
// Dynamic import — module under test (written after RED phase)
// ---------------------------------------------------------------------------

const { MaterializedFingerprintStore } = await import("../../src/scripts/materializedFingerprint");

// ---------------------------------------------------------------------------
// Fake VaultAdapterPort backed by an in-memory map
// ---------------------------------------------------------------------------

function makeFakeVault(initial: Record<string, string> = {}): {
	vault: Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir">;
	store: Map<string, string>;
} {
	const store = new Map<string, string>(Object.entries(initial));

	const vault: Pick<VaultAdapterPort, "readBinary" | "writeBinary" | "exists" | "mkdir"> = {
		exists: vi.fn(async (path: string) => store.has(path)),
		readBinary: vi.fn(async (path: string) => {
			const content = store.get(path);
			if (content === undefined) throw new Error(`Not found: ${path}`);
			return new TextEncoder().encode(content).buffer;
		}),
		writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
			store.set(path, new TextDecoder().decode(data));
		}),
		mkdir: vi.fn(async () => {}),
	};

	return { vault, store };
}

const MANIFEST_PATH = ".obsidian/plugins/markdown-mason/scripts/.materialized.json";

// ---------------------------------------------------------------------------
// getVersion — reads from in-memory manifest
// ---------------------------------------------------------------------------

describe("MaterializedFingerprintStore — getVersion", () => {
	it("returns undefined when the manifest file does not exist", async () => {
		const { vault } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		const result = await fp.getVersion("my-script");
		expect(result).toBeUndefined();
	});

	it("returns undefined for an id that is not in the manifest", async () => {
		const { vault } = makeFakeVault({
			[MANIFEST_PATH]: JSON.stringify({ "other-script": 3 }),
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		const result = await fp.getVersion("my-script");
		expect(result).toBeUndefined();
	});

	it("returns the recorded version for a known id", async () => {
		const { vault } = makeFakeVault({
			[MANIFEST_PATH]: JSON.stringify({ "perplexity-app": 5 }),
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		const result = await fp.getVersion("perplexity-app");
		expect(result).toBe(5);
	});

	it("handles a corrupt JSON manifest gracefully — returns undefined for all ids", async () => {
		const { vault } = makeFakeVault({
			[MANIFEST_PATH]: "not-json{{{",
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		const result = await fp.getVersion("any-script");
		expect(result).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// setVersion — writes to the manifest
// ---------------------------------------------------------------------------

describe("MaterializedFingerprintStore — setVersion", () => {
	it("creates the manifest when it does not exist", async () => {
		const { vault, store } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.setVersion("my-script", 2);
		expect(store.has(MANIFEST_PATH)).toBe(true);
		const parsed = JSON.parse(store.get(MANIFEST_PATH)!);
		expect(parsed["my-script"]).toBe(2);
	});

	it("updates an existing entry without clobbering other entries", async () => {
		const { vault, store } = makeFakeVault({
			[MANIFEST_PATH]: JSON.stringify({ "existing-script": 1 }),
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.setVersion("new-script", 3);
		const parsed = JSON.parse(store.get(MANIFEST_PATH)!);
		expect(parsed["existing-script"]).toBe(1);
		expect(parsed["new-script"]).toBe(3);
	});

	it("overwrites an existing version for the same id", async () => {
		const { vault, store } = makeFakeVault({
			[MANIFEST_PATH]: JSON.stringify({ "my-script": 1 }),
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.setVersion("my-script", 7);
		const parsed = JSON.parse(store.get(MANIFEST_PATH)!);
		expect(parsed["my-script"]).toBe(7);
	});

	it("calls vault.writeBinary (not any other method) to persist the manifest", async () => {
		const { vault } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.setVersion("s", 1);
		expect(vault.writeBinary).toHaveBeenCalledOnce();
		// Confirm it writes to the MANIFEST path — never to data.json
		const [calledPath] = (vault.writeBinary as ReturnType<typeof vi.fn>).mock.calls[0] as [string, ArrayBuffer];
		expect(calledPath).toBe(MANIFEST_PATH);
		expect(calledPath).not.toContain("data.json");
	});

	it("round-trips through getVersion after setVersion", async () => {
		const { vault } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.setVersion("round-trip", 9);
		const version = await fp.getVersion("round-trip");
		expect(version).toBe(9);
	});
});

// ---------------------------------------------------------------------------
// remove — removes an entry from the manifest
// ---------------------------------------------------------------------------

describe("MaterializedFingerprintStore — remove", () => {
	it("removes the entry for the given id", async () => {
		const { vault, store } = makeFakeVault({
			[MANIFEST_PATH]: JSON.stringify({ "delete-me": 4, "keep-me": 2 }),
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.remove("delete-me");
		const parsed = JSON.parse(store.get(MANIFEST_PATH)!);
		expect("delete-me" in parsed).toBe(false);
		expect(parsed["keep-me"]).toBe(2);
	});

	it("is a no-op when the id does not exist in the manifest", async () => {
		const { vault, store } = makeFakeVault({
			[MANIFEST_PATH]: JSON.stringify({ "other": 1 }),
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.remove("nonexistent");
		const parsed = JSON.parse(store.get(MANIFEST_PATH)!);
		expect(parsed["other"]).toBe(1);
	});

	it("is a no-op when the manifest does not exist", async () => {
		const { vault } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		// Should not throw
		await expect(fp.remove("any")).resolves.toBeUndefined();
	});

	it("getVersion returns undefined after remove", async () => {
		const { vault } = makeFakeVault({
			[MANIFEST_PATH]: JSON.stringify({ "my-script": 3 }),
		});
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.remove("my-script");
		const version = await fp.getVersion("my-script");
		expect(version).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// W2 — mkdir called before writeBinary when parent dir is absent (first write)
// ---------------------------------------------------------------------------

describe("MaterializedFingerprintStore — mkdir before writeBinary on first write", () => {
	it("calls vault.mkdir with the parent dir BEFORE vault.writeBinary on the first setVersion", async () => {
		const { vault } = makeFakeVault();

		// Track call order so we can assert mkdir precedes writeBinary.
		const callOrder: string[] = [];
		(vault.mkdir as ReturnType<typeof vi.fn>).mockImplementation(async () => {
			callOrder.push("mkdir");
		});
		(vault.writeBinary as ReturnType<typeof vi.fn>).mockImplementation(async (path: string, data: ArrayBuffer) => {
			callOrder.push("writeBinary");
			// Actually store so subsequent getVersion works.
			const store = (vault as unknown as { _store?: Map<string, string> })._store;
			if (store) store.set(path, new TextDecoder().decode(data));
		});

		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.setVersion("my-script", 1);

		// mkdir must have been called.
		expect(vault.mkdir).toHaveBeenCalledOnce();
		// The directory passed to mkdir must be the parent of MANIFEST_PATH.
		const expectedDir = MANIFEST_PATH.substring(0, MANIFEST_PATH.lastIndexOf("/"));
		expect(vault.mkdir).toHaveBeenCalledWith(expectedDir);

		// mkdir must appear BEFORE writeBinary in the call order.
		const mkdirIdx = callOrder.indexOf("mkdir");
		const writeIdx = callOrder.indexOf("writeBinary");
		expect(mkdirIdx).toBeGreaterThanOrEqual(0);
		expect(writeIdx).toBeGreaterThanOrEqual(0);
		expect(mkdirIdx).toBeLessThan(writeIdx);
	});

	it("subsequent setVersion calls still do not throw even if mkdir is a no-op", async () => {
		const { vault } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);

		// First write: dir absent — mkdir creates it.
		await fp.setVersion("script-a", 1);
		// Second write: dir already exists — mkdir is a no-op; should not throw.
		await expect(fp.setVersion("script-a", 2)).resolves.toBeUndefined();

		const version = await fp.getVersion("script-a");
		expect(version).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Isolation: store path is the scripts dir, NEVER data.json
// ---------------------------------------------------------------------------

describe("MaterializedFingerprintStore — data isolation", () => {
	it("writeBinary path never contains 'data.json'", async () => {
		const { vault } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, MANIFEST_PATH);
		await fp.setVersion("script", 1);
		const calls = (vault.writeBinary as ReturnType<typeof vi.fn>).mock.calls as [string, ArrayBuffer][];
		for (const [path] of calls) {
			expect(path).not.toContain("data.json");
		}
	});

	it("can use a custom path (e.g. different plugin id)", async () => {
		const customPath = ".obsidian/plugins/custom-plugin/scripts/.materialized.json";
		const { vault, store } = makeFakeVault();
		const fp = new MaterializedFingerprintStore(vault, customPath);
		await fp.setVersion("my-script", 1);
		expect(store.has(customPath)).toBe(true);
		expect(store.has(MANIFEST_PATH)).toBe(false);
	});
});
