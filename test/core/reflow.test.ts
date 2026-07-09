// test/core/reflow.test.ts — spec 006 OCR / slide reflow transform.
// TDD: behaviours calibrated against three real TextSniper captures (see the
// "real captures" describe block at the bottom).

import { describe, it, expect } from "vitest";
import type { OperationContext } from "../../src/core/types";
import { reflow } from "../../src/core/reflow";
import { applyToString } from "../../src/core/applyToString";

const makeSettings = () => ({ debugLogging: false as const, resourcesName: "Resources" });
const makeCtx = (doc: string): OperationContext => ({ doc, cursor: 0, settings: makeSettings() });
const run = (doc: string): string => applyToString(doc, reflow(makeCtx(doc)));

// ============================================================
// Paragraph mode (no bullet markers) — terminal + width signals
// ============================================================

describe("reflow — paragraph mode", () => {
	it("joins a soft-wrapped paragraph into one line", () => {
		const doc = "This sentence was hard wrapped\nacross two lines here.\n";
		expect(run(doc)).toBe("This sentence was hard wrapped across two lines here.\n");
	});

	it("splits into two paragraphs at a sentence boundary (terminal punctuation)", () => {
		// First line ends with '.', so the following line starts a new paragraph.
		const doc = "First thought ends on this line right here.\nSecond thought begins on the next one.\n";
		expect(run(doc)).toBe(
			"First thought ends on this line right here.\n\nSecond thought begins on the next one.\n",
		);
	});

	it("does NOT split on a period that falls mid-line (only line ends are inspected)", () => {
		// Realistic near-full-width wrapping; the sentence end sits mid-line in line 2.
		const doc =
			"Recovery point objective is used to specify the maximum amount of\ntime between the last backup and the failure point. The RPO helps\ndetermine data loss.\n";
		expect(run(doc)).toBe(
			"Recovery point objective is used to specify the maximum amount of time between the last backup and the failure point. The RPO helps determine data loss.\n",
		);
	});

	it("splits a short title line with no terminal punctuation via the width signal", () => {
		const doc =
			"Short Title\nThis is a much longer body line that wraps onto\nthe next line here.\n";
		expect(run(doc)).toBe(
			"Short Title\n\nThis is a much longer body line that wraps onto the next line here.\n",
		);
	});
});

// ============================================================
// List mode (bullet markers present) — marker-only segmentation
// ============================================================

describe("reflow — list mode", () => {
	it("rebuilds a •-marked, hard-wrapped list into a tidy dash list", () => {
		const doc =
			"• first point that wraps\nonto a second line\n• second point here\n";
		expect(run(doc)).toBe(
			"- first point that wraps onto a second line\n- second point here\n",
		);
	});

	it("keeps a multi-sentence bullet intact (terminal punctuation is ignored in list mode)", () => {
		// The mid-bullet sentence end must NOT split the bullet — only markers do.
		const doc =
			"• First sentence ends here.\ncontinues in the same bullet.\n• Next bullet.\n";
		expect(run(doc)).toBe(
			"- First sentence ends here. continues in the same bullet.\n- Next bullet.\n",
		);
	});

	it("keeps a leading marker-less line as its own paragraph above the list", () => {
		const doc = "Slide title here\n• one\n• two\n";
		expect(run(doc)).toBe("Slide title here\n\n- one\n- two\n");
	});

	it("leaves an already-tidy dash list unchanged", () => {
		expect(reflow(makeCtx("- one\n- two\n- three\n"))).toHaveLength(0);
	});
});

// ============================================================
// Hyphen handling at wrap boundaries
// ============================================================

describe("reflow — hyphenated line breaks", () => {
	it("preserves a compound broken across a line ('on-\\npremises' → 'on-premises')", () => {
		const doc = "data lives in an on-\npremises store today.\n";
		expect(run(doc)).toBe("data lives in an on-premises store today.\n");
	});

	it("does not glue a compound into one word", () => {
		const doc = "a cross-\nsell opportunity appears.\n";
		expect(run(doc)).toContain("cross-sell");
		expect(run(doc)).not.toContain("crosssell");
	});
});

// ============================================================
// Barriers / protected blocks
// ============================================================

describe("reflow — barriers and protected blocks", () => {
	it("never touches a fenced code block", () => {
		const doc = "```\nline one\nline two\n```\n";
		expect(reflow(makeCtx(doc))).toHaveLength(0);
	});

	it("does not merge an ATX heading into the paragraph below it", () => {
		const doc = "## A heading\nbody line one\nbody line two.\n";
		expect(run(doc)).toBe("## A heading\nbody line one body line two.\n");
	});

	it("reflows two blank-line-separated paragraphs independently", () => {
		const doc = "aa\nbb.\n\ncc\ndd.\n";
		expect(run(doc)).toBe("aa bb.\n\ncc dd.\n");
	});

	it("leaves frontmatter untouched", () => {
		const doc = "---\ntitle: My Note\ntags: [a, b]\n---\nbody wraps\nhere.\n";
		expect(run(doc)).toBe("---\ntitle: My Note\ntags: [a, b]\n---\nbody wraps here.\n");
	});
});

// ============================================================
// Degenerate cases + idempotency
// ============================================================

describe("reflow — degenerate cases and idempotency", () => {
	it("emits no edit for a single-line paragraph", () => {
		expect(reflow(makeCtx("just one line\n"))).toHaveLength(0);
	});

	it("is idempotent: a second pass returns []", () => {
		const doc =
			"Recovery point objective is used to specify the maximum\namount of data lost.\nRecovery time objective specifies the recovery duration\nbudget for the site.\n";
		const first = run(doc);
		expect(reflow(makeCtx(first))).toHaveLength(0);
	});
});

// ============================================================
// Real TextSniper captures (spec-006 calibration fixtures)
// Expected output is derived from the SAME source lines to avoid
// transcription drift.
// ============================================================

describe("reflow — real OCR captures", () => {
	it("capture 1: RPO/RTO/RLO with no markers → three paragraphs", () => {
		const L = [
			"Recovery point objective (RPO) is used to specify the maximum amount of",
			"time between the Last accessible backup and failure point. The RPO will help",
			"in determining the amount of data that the business can manage to Lose in",
			"the event of a failure.",
			"Recovery time objective (RTO) is used to specify the maximum time a data",
			"recovery process will take. It defines the amount of time the business can",
			"afford for the site or service to be unavailable.",
			"Recovery Level objective (RLO) is the objective that defines the granularity",
			"with which you must be able to recover data - whether you must be able to",
			"recover everything involved in a disaster or only partial",
		];
		const doc = L.join("\n") + "\n";
		const expected =
			[L.slice(0, 4).join(" "), L.slice(4, 7).join(" "), L.slice(7, 10).join(" ")].join("\n\n") + "\n";
		expect(run(doc)).toBe(expected);
	});

	it("capture 2: •-bulleted Azure Data Factory slide → title + dash list", () => {
		const L = [
			"What is Azure Data Factory?",
			"• In the world of big data, raw, unorganized data is often stored in relational,",
			"non-relational, and other storage systems.",
			"• However, on its own, raw data doesn't have the proper context or meaning to",
			"provide meaningful insights to analysts, data scientists, or business decision",
			"makers.",
			"• Big data requires a service that can orchestrate and operationalize processes to",
			"refine these enormous stores of raw data into actionable business insights.",
			"• Azure Data Factory is a managed cloud service that's built for these complex",
			"hybrid extract-transform-load (ETL), extract-load-transform (ELT), and data",
			"integration projects.",
		];
		const doc = L.join("\n") + "\n";
		const strip = (s: string) => s.replace(/^•\s+/, "");
		const bullets = [
			"- " + strip(L[1]!) + " " + L[2],
			"- " + strip(L[3]!) + " " + L[4] + " " + L[5],
			"- " + strip(L[6]!) + " " + L[7],
			"- " + strip(L[8]!) + " " + L[9] + " " + L[10],
		];
		const expected = L[0] + "\n\n" + bullets.join("\n") + "\n";
		expect(run(doc)).toBe(expected);
	});

	it("capture 3: Usage Scenarios slide → title, subtitle, and four paragraphs", () => {
		const L = [
			"Usage Scenarios",
			"REAL WORLD SCENARIO:",
			"Imagine a gaming company that collects petabytes of game logs that are produced",
			"by games in the cloud. The company wants to analyze these logs to gain insights",
			"into customer preferences, demographics, and usage behavior. It also wants to",
			"identify up-sell and cross-sell opportunities, develop compelling new features,",
			"drive business growth, and provide a better experience to its customers.",
			"To analyze these logs, the company needs to use reference data such as customer",
			"information, game information, and marketing campaign information that is in an",
			"on-premises data store. The company wants to utilize this data from the on-",
			"premises data store, combining it with additional log data that it has in a cloud",
			"data store.",
			"To extract insights, it hopes to process the joined data by using a Spark cluster in",
			"the cloud (Azure HDInsight), and publish the transformed data into a cloud data",
			"warehouse such as Azure Synapse Analytics to easily build a report on top of it.",
			"They want to automate this workflow, and monitor and manage it on a daily",
			"schedule. They also want to execute it when files land in a blob store container.",
		];
		const doc = L.join("\n") + "\n";
		const p3 = L.slice(2, 7).join(" ");
		// p4: lines 7,8,9,10,11 — line 9 ends with a hyphen, so 9+10 join with no space.
		const p4 = L[7] + " " + L[8] + " " + L[9] + L[10] + " " + L[11];
		const p5 = L.slice(12, 15).join(" ");
		const p6 = L.slice(15, 17).join(" ");
		const expected = [L[0], L[1], p3, p4, p5, p6].join("\n\n") + "\n";

		const result = run(doc);
		expect(result).toBe(expected);
		// Guard the headline artefact: the compound must survive the wrap.
		expect(result).toContain("on-premises data store. The company wants to utilize this data from the on-premises data store");
		expect(result).not.toContain("on- premises");
		expect(result).not.toContain("onpremises");
	});
});
