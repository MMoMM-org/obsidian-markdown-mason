// T1.3  Lifecycle: derived state machine (ADR-11)
//
// Tests evaluateState() behaviour through its public API only.
// evaluateState is PURE and synchronous — all inputs are injected.
// State is NEVER persisted (ADR-11); drift is fail-closed (PRD/F6).
//
// Table-driven: each row is { label, input, expected }.

import { describe, it, expect } from "vitest";
import { evaluateState } from "../../src/scripts/lifecycle";
import type { EvaluateStateInput, LifecycleState } from "../../src/scripts/lifecycle";
import type { ScriptRecord } from "../../src/scripts/store";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function makeRecord(overrides: Partial<ScriptRecord> = {}): ScriptRecord {
	return {
		provenance: "curated",
		enabled: true,
		okayed: { version: 1, checksum: "sha256:abc" },
		source: "curated/scripts/test-script",
		command: false,
		...overrides,
	};
}

function makeInput(overrides: Partial<EvaluateStateInput> = {}): EvaluateStateInput {
	return {
		record: makeRecord(),
		inCatalog: true,
		local: { version: 1, checksum: "sha256:abc" },
		catalogVersion: 1,
		online: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Table-driven cases
// ---------------------------------------------------------------------------

interface TestCase {
	label: string;
	input: EvaluateStateInput;
	expected: LifecycleState;
}

const cases: TestCase[] = [
	// Step 1 — no record + in catalog → Available
	{
		label: "no record + inCatalog:true → Available",
		input: makeInput({ record: undefined, inCatalog: true }),
		expected: { kind: "Available" },
	},

	// Step 1 — no record + NOT in catalog → Absent
	{
		label: "no record + inCatalog:false → Absent",
		input: makeInput({ record: undefined, inCatalog: false }),
		expected: { kind: "Absent" },
	},

	// Step 2 — record exists, enabled:false → Disabled (overrides all later checks)
	{
		label: "enabled:false → Disabled (even with okayed set and drift conditions present)",
		input: makeInput({
			record: makeRecord({
				enabled: false,
				okayed: { version: 1, checksum: "sha256:abc" },
			}),
			local: { version: 1, checksum: "sha256:WRONG" }, // would be drift if we got there
		}),
		expected: { kind: "Disabled" },
	},

	// Step 3 — okayed===null + provenance curated → Available
	{
		label: "okayed:null + provenance:curated → Available",
		input: makeInput({
			record: makeRecord({ okayed: null, provenance: "curated" }),
		}),
		expected: { kind: "Available" },
	},

	// Step 3 — okayed===null + provenance imported → Absent
	{
		label: "okayed:null + provenance:imported → Absent",
		input: makeInput({
			record: makeRecord({ okayed: null, provenance: "imported" }),
		}),
		expected: { kind: "Absent" },
	},

	// Step 4 — local absent + online → Materializing
	{
		label: "local:null + online:true → Materializing",
		input: makeInput({ local: null, online: true }),
		expected: { kind: "Materializing" },
	},

	// Step 4 — local absent + offline → Blocked(offline)
	{
		label: "local:null + online:false → Blocked(offline)",
		input: makeInput({ local: null, online: false }),
		expected: { kind: "Blocked", reason: "offline" },
	},

	// Step 5 — local.version ≠ okayed.version → Materializing
	// (even if checksum would mismatch — stale wins over drift in precedence)
	{
		label: "local.version≠okayed.version → Materializing (stale wins over drift)",
		input: makeInput({
			record: makeRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			local: { version: 2, checksum: "sha256:DIFFERENT" }, // different version AND checksum
		}),
		expected: { kind: "Materializing" },
	},

	// Step 6 — same version, checksum ≠ okayed → Blocked(drift)
	{
		label: "same version + checksum mismatch → Blocked(drift)",
		input: makeInput({
			record: makeRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			local: { version: 1, checksum: "sha256:DIFFERENT" },
		}),
		expected: { kind: "Blocked", reason: "drift" },
	},

	// Step 6 — drift wins over offline: local present + checksum mismatch + online:false → Blocked(drift)
	// Proves that once local code exists, online state is irrelevant for drift detection
	{
		label: "drift wins over offline: local present + checksum mismatch + online:false → Blocked(drift)",
		input: makeInput({
			record: makeRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			local: { version: 1, checksum: "sha256:WRONG" },
			online: false,
		}),
		expected: { kind: "Blocked", reason: "drift" },
	},

	// Step 7 — curated, local matches, catalogVersion > okayed.version → UpdateAvailable
	{
		label: "curated + local matches + catalogVersion > okayed.version → UpdateAvailable",
		input: makeInput({
			record: makeRecord({ provenance: "curated", okayed: { version: 1, checksum: "sha256:abc" } }),
			local: { version: 1, checksum: "sha256:abc" },
			catalogVersion: 2,
		}),
		expected: { kind: "UpdateAvailable" },
	},

	// Step 8 — curated, local matches, catalogVersion === okayed.version → Active
	{
		label: "curated + local matches + catalogVersion === okayed.version → Active",
		input: makeInput({
			record: makeRecord({ provenance: "curated", okayed: { version: 1, checksum: "sha256:abc" } }),
			local: { version: 1, checksum: "sha256:abc" },
			catalogVersion: 1,
		}),
		expected: { kind: "Active" },
	},

	// Step 7 guard — catalogVersion undefined (offline) → Active, step 7 must NOT fire
	{
		label: "curated + local matches + catalogVersion:undefined → Active (step 7 guard)",
		input: makeInput({
			record: makeRecord({ provenance: "curated", okayed: { version: 1, checksum: "sha256:abc" } }),
			local: { version: 1, checksum: "sha256:abc" },
			catalogVersion: undefined,
		}),
		expected: { kind: "Active" },
	},

	// Step 8 — imported, local matches okayed → Active (imported never UpdateAvailable)
	{
		label: "imported + local matches + catalogVersion set → Active (not UpdateAvailable)",
		input: makeInput({
			record: makeRecord({ provenance: "imported", okayed: { version: 1, checksum: "sha256:abc" } }),
			local: { version: 1, checksum: "sha256:abc" },
			catalogVersion: 99, // high catalog version, but imported → no UpdateAvailable
		}),
		expected: { kind: "Active" },
	},
];

// ---------------------------------------------------------------------------
// Run the table
// ---------------------------------------------------------------------------

describe("evaluateState — table-driven", () => {
	for (const { label, input, expected } of cases) {
		it(label, () => {
			expect(evaluateState(input)).toEqual(expected);
		});
	}
});

// ---------------------------------------------------------------------------
// Precedence-focused cross-cut cases
// (prove short-circuit ordering: Disabled and stale-version before drift)
// ---------------------------------------------------------------------------

describe("evaluateState — precedence", () => {
	it("Disabled wins over drift: enabled:false short-circuits before checksum check", () => {
		const input = makeInput({
			record: makeRecord({
				enabled: false,
				okayed: { version: 1, checksum: "sha256:abc" },
			}),
			// same version but wrong checksum — would be Blocked(drift) if step 6 ran first
			local: { version: 1, checksum: "sha256:WRONG" },
		});
		expect(evaluateState(input)).toEqual({ kind: "Disabled" });
	});

	it("stale-version wins over drift: local.version mismatch emits Materializing not Blocked(drift)", () => {
		const input = makeInput({
			record: makeRecord({ okayed: { version: 1, checksum: "sha256:abc" } }),
			// different version AND wrong checksum — step 5 fires before step 6
			local: { version: 99, checksum: "sha256:WRONG" },
		});
		expect(evaluateState(input)).toEqual({ kind: "Materializing" });
	});
});
