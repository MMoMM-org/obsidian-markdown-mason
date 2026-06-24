"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// catalog/entries/perplexity-web-download.ts
var perplexity_web_download_exports = {};
__export(perplexity_web_download_exports, {
  default: () => perplexity_web_download_default
});
module.exports = __toCommonJS(perplexity_web_download_exports);

// catalog/parsers/perplexityWebDownload.ts
var DEF_LINE_RE = /^\[\^(\w+)_(\w+)\]:\s+(\S+)$/;
var INLINE_RE = /\[\^(\w+)_(\w+)\](?!:)/g;
function canParse(input) {
  return input.split("\n").some((line) => DEF_LINE_RE.test(line.trim()));
}
function stripHtmlNoise(text) {
  let result = text.replace(/<img[^>]*\/?>/gi, "");
  result = result.replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "");
  result = result.replace(/<div[^>]*>[\s\S]*?<\/div>/gi, "");
  result = result.replace(/⁂/g, "");
  return result;
}
function buildSourceMap(lines) {
  const sources = [];
  const markerToId = /* @__PURE__ */ new Map();
  let seq = 0;
  for (const line of lines) {
    const match = DEF_LINE_RE.exec(line.trim());
    if (!match) continue;
    const [, a, b, url] = match;
    seq++;
    const marker = `[^${a}_${b}]`;
    let host;
    try {
      host = new URL(url).host;
    } catch {
      host = url;
    }
    sources.push({ incomingId: seq, snippet: host, title: host, url });
    markerToId.set(marker, seq);
  }
  return { sources, markerToId };
}
function buildBody(stripped) {
  const strippedLines = stripped.split("\n");
  const bodyLines = strippedLines.filter((line) => {
    return !DEF_LINE_RE.test(line.trim());
  });
  return bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
function extractInlineMarkers(stripped, markerToId) {
  const prose = stripped.split("\n").filter((line) => !DEF_LINE_RE.test(line.trim())).join("\n");
  const inline = [];
  let m;
  const re = new RegExp(INLINE_RE.source, "g");
  while ((m = re.exec(prose)) !== null) {
    const marker = `[^${m[1]}_${m[2]}]`;
    const n = markerToId.get(marker);
    if (n !== void 0) {
      inline.push({ marker, n });
    }
  }
  return inline;
}
function parse(input) {
  const lines = input.split("\n");
  const stripped = stripHtmlNoise(input);
  const { sources, markerToId } = buildSourceMap(lines);
  const body = buildBody(stripped);
  const inline = extractInlineMarkers(stripped, markerToId);
  return { body, inline, sources };
}
var perplexityWebDownload = { canParse, parse };

// src/core/url.ts
function normalizeUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.trim().toLowerCase();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return raw.trim().toLowerCase();
  }
  return buildCanonical(parsed);
}
function buildCanonical(url) {
  const host = url.host;
  const pathname = stripTrailingSlash(url.pathname);
  url.searchParams.sort();
  const query = url.searchParams.toString();
  const suffix = query ? `?${query}` : "";
  return `${url.protocol}//${host}${pathname}${suffix}`;
}
function stripTrailingSlash(pathname) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  if (pathname === "/") {
    return "";
  }
  return pathname;
}

// src/core/footnotes.ts
function resolveFootnoteIdentity(incoming, existing) {
  const maxStart = existing.reduce((m, e) => Math.max(m, e.id), 0);
  let maxExisting = maxStart;
  const existingByUrl = buildExistingByUrl(existing);
  const seenInPaste = {};
  const idMap = {};
  const newRefs = [];
  for (const ref of incoming) {
    if (idMap[ref.incomingId] !== void 0) continue;
    const norm = normalizeUrl(ref.url);
    const firstInPaste = seenInPaste[norm];
    if (firstInPaste !== void 0) {
      idMap[ref.incomingId] = idMap[firstInPaste];
      continue;
    }
    seenInPaste[norm] = ref.incomingId;
    const existingId = existingByUrl[norm];
    if (existingId !== void 0) {
      idMap[ref.incomingId] = existingId;
    } else {
      const newId = ++maxExisting;
      idMap[ref.incomingId] = newId;
      newRefs.push({ ...ref, id: newId });
    }
  }
  return { idMap, newRefs };
}
function buildExistingByUrl(existing) {
  const map = {};
  for (const e of existing) {
    map[normalizeUrl(e.url)] = e.id;
  }
  return map;
}
function scanExistingRefs(doc) {
  const refs = [];
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const id = parseNumericDefLine(lines[i]);
    if (id === null) continue;
    const url = parseUrlLine(lines[i + 1]);
    refs.push({ id, url });
  }
  return refs;
}
function parseNumericDefLine(line) {
  const m = /^\[\^(\d+)\]:/.exec(line);
  if (!m) return null;
  return Number(m[1]);
}
function parseUrlLine(line) {
  if (!line) return "";
  const m = /^\[[^\]]*\]\(([^)]+)\)/.exec(line);
  return m ? m[1] : "";
}
function applyFootnoteInlineRename(body, idMap) {
  const plan = [];
  const re = /\[\^(\d+)\]/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1]);
    const newId = idMap[n];
    if (newId === void 0) continue;
    plan.push({
      from: m.index,
      to: m.index + m[0].length,
      insert: `[^${newId}]`
    });
  }
  return plan;
}
function formatFootnoteLink(ref) {
  return `[^${ref.id}]: [${ref.title}](${ref.url})`;
}
function compactRefDefinitions(newRefs) {
  return newRefs.map(formatFootnoteLink);
}
function moveToResources(ctx, defs) {
  if (defs.length === 0) return [];
  const { doc, settings } = ctx;
  const headingLine = `## ${settings.resourcesName}`;
  const insertOffset = findSectionInsertOffset(doc, headingLine);
  if (insertOffset === null) {
    return [buildNoteEndInsert(doc, headingLine, defs)];
  }
  return [buildSectionAppend(insertOffset, defs)];
}
function findSectionInsertOffset(doc, headingLine) {
  const lines = doc.split("\n");
  let inSection = false;
  let offset = 0;
  let sectionEndOffset = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inSection) {
      if (line === headingLine) {
        inSection = true;
      }
      offset += line.length + 1;
      continue;
    }
    if (line.startsWith("## ")) {
      sectionEndOffset = offset;
      break;
    }
    offset += line.length + 1;
    sectionEndOffset = offset;
  }
  if (!inSection) return null;
  return Math.min(sectionEndOffset, doc.length);
}
function buildSectionAppend(offset, defs) {
  const sep = defs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
  const content = "\n" + defs.join(sep) + "\n";
  return { from: offset, to: offset, insert: content };
}
function buildNoteEndInsert(doc, headingLine, defs) {
  const sep = defs.some((d) => d.includes("\n")) ? "\n\n" : "\n";
  const content = `
${headingLine}

${defs.join(sep)}`;
  return { from: doc.length, to: doc.length, insert: content };
}

// src/core/applyToString.ts
function applyToString(doc, plan) {
  if (plan.length === 0) return doc;
  const tagged = plan.map((edit, i) => ({ edit, i }));
  tagged.sort((a, b) => {
    const byFrom = b.edit.from - a.edit.from;
    if (byFrom !== 0) return byFrom;
    return b.i - a.i;
  });
  let result = doc;
  for (const { edit } of tagged) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}

// src/core/headings.ts
function parseHeadings(text) {
  const headings = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    const m = line.match(/^(#{1,6})\s/);
    if (m) {
      headings.push({ offset: pos, level: m[1].length, text: line });
    }
    pos += line.length + 1;
  }
  return headings;
}
function findContextLevel(doc, cursor) {
  const textBefore = doc.slice(0, cursor);
  const headings = parseHeadings(textBefore);
  if (headings.length === 0) return 0;
  return headings[headings.length - 1].level;
}
function clampLevel(level) {
  return Math.max(1, Math.min(6, level));
}
function cascade(ctx) {
  const input = ctx.input ?? "";
  const ctxLevel = findContextLevel(ctx.doc, ctx.cursor);
  if (ctxLevel === 0) {
    return { plan: [], noContextHeading: true };
  }
  const inputHeadings = parseHeadings(input);
  if (inputHeadings.length === 0) {
    return { plan: [], noContextHeading: false };
  }
  const minIn = Math.min(...inputHeadings.map((h) => h.level));
  const shift = ctxLevel + 1 - minIn;
  const transformed = applyShiftToText(input, shift);
  return {
    plan: [{ from: ctx.cursor, to: ctx.cursor, insert: transformed }],
    noContextHeading: false
  };
}
function applyShiftToText(text, shift) {
  return text.replace(/^(#{1,6})(\s)/gm, (_match, hashes, space) => {
    const newLevel = clampLevel(hashes.length + shift);
    return "#".repeat(newLevel) + space;
  });
}

// catalog/scripts/replaceMarkersInBody.ts
function filterCitedSources(sources, inline) {
  const citedIds = new Set(inline.map((m) => m.n));
  return sources.filter((s) => citedIds.has(s.incomingId));
}
function replaceMarkersInBody(body, inline) {
  if (inline.length === 0) return body;
  const byMarker = /* @__PURE__ */ new Map();
  for (const m of inline) {
    const group = byMarker.get(m.marker);
    if (group) {
      group.push(m);
    } else {
      byMarker.set(m.marker, [m]);
    }
  }
  const plan = [];
  for (const [markerStr, entries] of byMarker) {
    const offsets = [];
    let searchFrom = 0;
    while (true) {
      const idx = body.indexOf(markerStr, searchFrom);
      if (idx === -1) break;
      offsets.push(idx);
      searchFrom = idx + markerStr.length;
    }
    const count = Math.min(offsets.length, entries.length);
    for (let i = 0; i < count; i++) {
      const offset = offsets[i];
      const entry = entries[i];
      plan.push({
        from: offset,
        to: offset + markerStr.length,
        insert: `[^${entry.n}]`
      });
    }
  }
  return applyToString(body, plan);
}

// catalog/scripts/perplexityWebDownload.ts
var perplexityWebDownloadScript = (ctx) => {
  if (!perplexityWebDownload.canParse(ctx.input)) return void 0;
  ctx.logger.info(`perplexity-web-download started (source=${ctx.source})`);
  const pr = perplexityWebDownload.parse(ctx.input);
  const bodyFC = replaceMarkersInBody(pr.body, pr.inline);
  const citedSources = filterCitedSources(pr.sources, pr.inline);
  const existing = scanExistingRefs(ctx.op.doc);
  const { idMap, newRefs } = resolveFootnoteIdentity(citedSources, existing);
  ctx.logger.info(`resolved ${citedSources.length} footnotes (${newRefs.length} new, ${citedSources.length - newRefs.length} reused)`);
  const renameEdits = applyFootnoteInlineRename(bodyFC, idMap);
  const finalBody = applyToString(bodyFC, renameEdits);
  const cascadeOp = { ...ctx.op, input: finalBody };
  const { plan: cascadePlan } = cascade(cascadeOp);
  const defs = compactRefDefinitions(newRefs);
  const resourcesPlan = moveToResources(ctx.op, defs);
  const plan = [...cascadePlan, ...resourcesPlan];
  ctx.logger.info(`plan: ${plan.length} edits`);
  return plan;
};

// catalog/entries/perplexity-web-download.ts
var perplexity_web_download_default = {
  run: perplexityWebDownloadScript,
  paste: {
    canHandle: (input) => perplexityWebDownload.canParse(input),
    priority: 200
  }
};
