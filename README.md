# Markdown Mason (Arbeitstitel)

> Ein Obsidian-Plugin, das eingefügten, markierten oder ganzen Notiz-Text in die
> **Struktur der Zielnotiz einpasst** — Überschriften-Ebenen, Fußnoten/Quellen,
> Nummerierung, Dubletten. Quell-agnostisch (Perplexity, andere LLMs, Web), mit
> einer **kuratierten, im Plugin verwalteten Transform-Bibliothek** statt loser
> Skripte im Vault.

**Status:** Konzept / Starter. Noch kein Code. Dieses Dokument ist das Projekt-Briefing.
**Ort:** `/Volumes/Moon/Coding/obsidian-markdown-mason/` (außerhalb von MiYo, eigenständiges Repo).
**Plugin-ID (geplant):** `markdown-mason` · **Konvention:** folgt `obsidian-*` wie die Geschwister-Repos.

---

## 1. Problem & Motivation

Wenn man Antworten aus Perplexity (oder anderen LLM-/Web-Quellen) in eine bestehende
Notiz einfügt, passt das Ergebnis selten:

1. **Überschriften stimmen nicht.** Man steht z.B. unter einer `### Sektion`, aber die
   eingefügte Antwort kommt mit `#`/`##`. Sie müsste relativ nach unten kaskadiert werden
   (`#` → `####` usw.), damit die Hierarchie der Zielnotiz erhalten bleibt.
2. **Quellen-Referenzen kollidieren.** Perplexity liefert Inline-Citations `[1]`, `[2]` …
   und eine Quellenliste. Bei mehreren Pastes **fangen die Nummern jedes Mal wieder bei 1 an**
   → Kollisionen mit bereits vorhandenen Fußnoten in der Notiz.
3. **Quellen liegen verstreut.** Sie sollten als echte Fußnoten an einen festen Ort
   (eigene `## Resources`-Sektion oder Notizende) wandern, dedupliziert.

Bestehende Plugins lösen jeweils nur Bruchstücke (siehe §3). Keines deckt den ganzen
Flow ab, und der vielversprechendste Ansatz (Advanced Paste) ist **aus dem Community-Katalog
entfernt** (verifiziert gegen `obsidianmd/obsidian-releases`, 2026-06-16).

---

## 2. Die reale Format-Konvention (kanonisches Beispiel & Test-Fixture)

Aus echten Notizen (Privat-Vault, Japan-Reise) entschlüsselt — das ist der **Ziel-Stil**,
gegen den die Operationen getestet werden:

- **Heading-Hierarchie:** `# [[Titel]]` (H1) → `## Notes` / `## Resources` (H2) →
  `### Stadtteil` (H3) → `#### Sub` (H4). Paste landet typischerweise auf **H3/H4**.
- **Fußnoten = „Resources":** feste Sektion am Notizende:
  ```markdown
  ## Resources
  > [!note]
  > Resources are Footnotes!

  [^7]: Beschreibungs-Snippet der Quelle …
  [Titel des Links](https://example.com/…)
  ```
  → **2-zeiliges Format**: `[^n]: Snippet` ⏎ `[Titel](url)`.
- **Gemischte Marker:** numerisch `[^1]`, `[^7]` (aus Quellen) **und** Buchstaben
  `[^A]`, `[^B]` (manuell). Renumbering betrifft **nur die numerischen**.
- **Verwaiste Resources:** Snippet + Link **ohne** `[^n]:`-Präfix kommen vor (Quellen,
  die noch keiner Stelle zugeordnet sind) — dürfen nicht zerstört werden.

> ✅ **Gelöst:** Drei rohe Samples liegen unter `assets/sakura-in-tokyo-{app,web,web-download}.md`
> und sind die Golden-Fixtures. Sie zeigen **drei verschiedene Formate** — *App-Copy* (`[1][2]` +
> `Sources`-Block, Nummerierung pro Antwort neu), *Web-Copy* (Inline-Links `[domain](url)`, keine
> Marker/Block), *Web-Download* (bereits `[^a_b]`-Fußnoten + URL-only-Definitionsliste, mit HTML-
> Resten). Jedes Format = ein eigenes Skript (§7), kein gemeinsamer Parser.

---

## 3. Plugin-Landschaft (recherchiert) & warum keins passt

| Plugin | Macht | Warum es nicht reicht |
|---|---|---|
| **Advanced Paste** (kxxt) | Custom-JS-Transforms aufs Clipboard, `editor`-Zugriff | **Aus dem Katalog entfernt / tot.** War konzeptioneller Vorbild. |
| **Paste Reformatter** (keathmilligan) | Header-Kaskade beim Paste („Contextual Cascade") | Nur Header, **null** Fußnoten-Logik. |
| **Perplexity Converter** (heseber) | Fixt Referenz-Hyperlinks aus Perplexity-Paste | Macht **keine echten `[^n]`-Fußnoten**; braucht Select-all; Wartung fraglich. |
| **Paste transform** (rekby) | Clipboard per **Regex**-Regeln umschreiben | Regex-only → **kein** zustandsbehaftetes Offset-Renumbering/Dedup. |
| **Tidy Footnotes** / **Better Footnotes** | Fußnoten renummerieren/sortieren | Gehen von **eindeutigen IDs** aus → kollidieren genau beim „startet wieder bei 1"; kennen die `## Resources`-Konvention nicht. |
| **Linter** (platers) | Globale Markdown-Normalisierung, „move footnotes to bottom" | Läuft on-save (nutzt der Anwender kaum), global/intransparent, bricht den Schreibfluss. |
| **Clean AI Paste / PastePolish / Smart Paste** | Whitespace-/HTML-Cleanup beim Paste | Adressieren das Fußnoten-/Heading-Problem nicht; teils nicht Obsidian-reviewed. |

**Entscheidung:** Eigenständiges Plugin bauen (kein leichter Harness mehr verfügbar).

---

## 4. Kernkonzept: Operationen × Quellen

Der von Advanced Paste übernommene Gedanke: **kleine, klar umrissene Operationen**, die auf
eine **Quelle** angewendet werden. „Paste" / „Selektion" / „ganze Notiz" sind nur drei Quellen
für **dieselben** Operationen.

### Operationen

| Kürzel | Operation | Kurzbeschreibung |
|---|---|---|
| **H** | Header-Kaskade (relativ) | Eingefügte Überschriften relativ zur Cursor-/Umgebungsebene nach unten verschieben. |
| **C** | Citation → Footnote | `[n]` (Perplexity-Inline-Citation) → `[^n]`. |
| **O** | Footnote-Offset / Renumber | Numerische Fußnoten gegen die bereits vorhandenen versetzen (kein Neustart bei 1). |
| **D** | Footnote-Dedup | Quellen mit gleicher URL zu **einer** Fußnote zusammenführen (inkl. Abgleich gegen bestehende). |
| **M** | Footnotes verschieben | Definitionen ans Ziel (`## Resources` / Notizende) im 2-Zeilen-Format einsortieren. |

### Quellen-Matrix

| | H | C | O | D | M |
|---|---|---|---|---|---|
| **Paste** (Clipboard → Cursor) | ✅ relativ z. Cursor | ✅ | ✅ | ✅ | ✅ |
| **Selektion** | ✅ relativ z. Umgebung | ✅ | ✅ | ✅ | ✅ |
| **Ganze Notiz** | ⚠️ „Hierarchie normalisieren"* | ✅ | ✅ | ✅ | ✅ |

\* Header-Kaskade braucht Cursor-Kontext. Auf der ganzen Notiz wird H zur **Normalisierungs-/
Reparatur-Operation** (Hierarchie-Lücken schließen) — leicht andere Semantik, bewusst getrennt halten.

---

## 5. Algorithmen (Spec)

Alle Operationen sind **reine Funktionen** über (Text, Kontext) → Text/Edit-Plan. Keine UI,
keine Obsidian-Abhängigkeit im Kern (testbar ohne Obsidian — vgl. MiYo-Constitution-Prinzip
„Domänenlogik ohne Framework testbar").

### H — Header-Kaskade (relativ)
1. Nächste Überschrift **oberhalb** des Cursors finden → `ctxLevel` (z.B. `###` = 3).
2. Ziel-Basis = `ctxLevel + 1`.
3. Kleinstes Heading im Input finden (`minIn`). `shift = (ctxLevel + 1) − minIn`.
4. `shift` auf **alle** Headings anwenden, bei H6 clampen. → Relative Struktur bleibt erhalten.

### C — Citation → Footnote
1. Inline-Citations im Input erkennen (Format aus Roh-Sample ableiten — siehe §2-Blocker).
2. Quellenliste parsen → Map `n → { snippet, title, url }`.
3. Inline `[n]` → `[^n]` (vor Offset).

### O — Offset / Renumber
1. In der Zielnotiz die höchste **numerische** Fußnote finden (`[^A]`/`[^B]` ignorieren) → `offset`.
2. Alle neuen `[^n]` → `[^(n + offset)]` (inline **und** Definition synchron).

### D — Dedup / Merge
1. Neue Quellen per **URL** vergleichen → gleiche URL = eine Fußnote.
2. Gegen **bestehende** Resources der Notiz prüfen: existiert die URL schon →
   bestehende Nummer wiederverwenden statt neu anlegen.

### M — Verschieben / Einsortieren
1. Definitionen im 2-Zeilen-Format bauen: `[^n]: snippet` ⏎ `[title](url)`.
2. An `## Resources` anhängen, falls vorhanden; sonst Sektion am Notizende erzeugen
   (konfigurierbar: eigener Header-Name vs. plain Notizende).
3. **Verwaiste Resources nicht anfassen.**

**Edit-Plan:** Body (mit Inline-`[^n]`) an den Cursor; Definitionen ans Ziel → **Zwei-Stellen-Edit**
in einer Editor-Transaktion. Kern-Rückgabetyp ist ein **Edit-Plan** (`{from, to, insert}[]`),
kein transformierter Text — nur so lässt sich der Zwei-Stellen-Edit atomar in **einer**
CodeMirror-Transaktion anwenden (alle Ranges gegen das **Original**-Dokument berechnen, als ein
`changes`-Array dispatchen, damit Offsets nicht verrutschen).

> ⚠️ **Kopplung O↔D (zu entscheiden):** O und D sind **nicht** unabhängig hintereinander
> ausführbar. Versetzt O zuerst auf frische Hoch-Nummern und merged D danach per URL, entstehen
> Lücken/Kollisionen, und „bestehende Nummer wiederverwenden" widerspricht der gerade vergebenen
> Offset-Nummer. Vorschlag: O+D zu **einer** „Footnote-Identity"-Stufe verschmelzen, die
> (1) im Paste per URL dedupliziert, (2) gegen bestehende URLs matcht (Nummer wiederverwenden),
> (3) nur den echt neuen Quellen `max(bestehend)+1…` vergibt. Als Commands dürfen O/D getrennt
> bleiben; der reine Kern braucht eine Stufe, die die Nummerierung end-to-end besitzt.

---

## 6. Befehls-Design

- **Einzel-Operationen** (H/C/O/D/M) je als eigener Command mit Hotkey — „such-dir-aus-was-läuft"
  (UX-Vorbild: Text Format).
- **Presets** (verkettete Operationen) für den Standardfall, z.B.:
  - `Mason: Paste & format (full)` = H → C → O → D → M auf Clipboard.
  - `Mason: Format selection` = dieselben auf Selektion.
  - `Mason: Tidy footnotes (whole note)` = C → O → D → M auf ganze Notiz.

---

## 7. Extensibilität: Skripte (Advanced-Paste-Modell) + erweiterbare Operations-API

> **Richtungswechsel (PRD v1.1):** Der frühere „deklarative Kern, JS nur als Escape-Hatch"-Ansatz
> ist **verworfen**. Markdown Mason ist **JS-Skript-first** im Geist von Advanced Paste: ein Skript
> läuft **beim Paste** oder **als Command auf einer Selektion**. Das Plugin ist deshalb **desktop-only**.

Das Hauptproblem mit Advanced Paste war: **Skripte lebten lose im Vault**. Mason übernimmt sein
gutes Modell (Custom-Skript beim Paste) und behebt die Schwäche: Skripte werden **vom Plugin
verwaltet**, gespeichert in einem **eigenen Skript-Verzeichnis im Plugin-Datenverzeichnis**
(`.obsidian/plugins/markdown-mason/scripts/…`), **nicht** als Notiz-Dateien im Vault-Baum.

### Operationen = in-plugin API; Skripte = Erweiterungsschicht
- **H/C/O/D/M sind eine getestete, in-plugin Operations-API** (`mason.*`) **und** je ein Standalone-
  `Mason:`-Command. Skripte rufen diese API — sie reimplementieren nichts.
- **Skripte (JS/`.cjs`)** sind die Erweiterungsschicht: an Command/Hotkey **bindbar**, ausführbar
  **beim Paste** oder **auf Selektion**. Skript-Support ist **Fundament ab v0.1** — kein späterer Umbau.
- **Perplexity = herunterladbare Skripte, nicht Built-in.** Die drei Surfaces sind je ein eigenes
  Skript (`assets/sakura-in-tokyo-{app,web,web-download}.md` als Golden-Fixtures, siehe §2).
- **Erweiterbare, versionierte API:** neue plugin-integrierte Operationen können dazukommen und
  stehen dann allen Skripten unter `mason.*` zur Verfügung; ein Skript deklariert die benötigte
  **API-Version**. Additiv oder dokumentierter Major-Bump.

### Bezug & Trust (zwei Wege)
1. **Download aus dem offiziellen, geprüften Repo** (spezielles Skript-Verzeichnis): Skripte werden
   per PR eingereicht, **brauchen eine Doku**, was sie tun, und dürfen **nur Markdown in der Notiz**
   bearbeiten — **kein** Netzwerk, **keine** externen Aufrufe, **kein** Cross-Plugin-Zugriff (sonst
   nicht gemerged). Das ist die geprüfte Stufe.
2. **Copy aus dem Vault → Import** (eigene oder Community-Skripte): **auf eigenes Ermessen/Risiko**.
   Community-Sharing läuft über den **Forum-/Diskussionsbereich** des Repos; von dort kopiert der
   Nutzer ins Vault und importiert. Es gibt **keinen** stillen Netzwerk-Installer für ungeprüften Code.

### Ausführungsmodell (wiederverwendet aus `miyo-tomo-hashi` `src/hooks/`)
- **Fresh-Load pro Lauf** via `createRequire` + **Cache-Evict per Verzeichnis-Präfix** (kein stales
  Helper-Modul nach Edit).
- **Policy `enabled | disabled | ask`** — `disabled` ist der **Kill-Switch**.
- **Disclosure-Modal:** „läuft mit vollen Plugin-Rechten (Vault, Node fs/Netzwerk, Shell, env)".
- **Consent: einmal pro Checksum/Version** (nicht pro Session); **Re-Prompt** bei Fingerprint-
  Änderung (size+mtime). Geprüfte Repo-Skripte: leichtes Enable; importierte/Community: volle Disclosure.
- **hooksDir-Escape-Guard:** ein per Sync manipulierter Pfad, der aus dem zulässigen Verzeichnis
  ausbricht, wird abgelehnt.
- **Timeout** (async) + **Fehler-Fallback:** wirft ein Skript oder läuft in den Timeout, bleibt der
  Paste/die Selektion roh erhalten — nie ein stiller Teil-Edit.

### Self-describing Skript-Metadaten + Manifest/Integrität
Jedes Skript trägt seine Metadaten im Header (`id`, `version`, `description`, `changelog`,
`required-api-version`). `data.json` hält **nur Metadaten** pro Skript:

```json
{ "source": "offizielles-repo | vault-pfad", "checksum": "sha256:…", "version": 3, "enabled": true }
```

Regeln (Paketmanager-Logik: Hash pinnt Integrität, Version signalisiert Absicht):
- **Auf Disk** nur **Existenz**-Check. Fehlt die Datei → von `source` holen; Checksum-Match →
  Autoinstall, Mismatch → **nicht** still installieren.
- **gleiche Version + anderer Checksum → Hard-Block** (deaktivieren bis explizite Auflösung).
- **höhere Version → nutzer-bestätigtes Update** (mit `changelog`), **keine** Auto-Upgrades.
- **Per-Device `enabled`/Consent NICHT in `data.json`** (das synct), sondern in einem **Sidecar**
  via `vault.adapter` — sonst propagiert ungeprüftes JS bzw. eine Freigabe still auf alle Geräte (§9).

---

## 8. Architektur-Skizze

```
core/                 reine Operationen (kein Obsidian-Import) — unit-testbar
  headings.ts         H
  footnotes.ts        C, O+D (Footnote-Identity), M
  api.ts              versionierte Operations-API (mason.*) — Registry der Operationen
sources/              dünne Adapter, die Input + Kontext liefern
  paste.ts            Clipboard → Cursor (editor-paste-Hook)
  selection.ts        markierter Bereich
  note.ts             ganze Notiz
scripts/              Skript-Runtime (Modell aus miyo-tomo-hashi src/hooks/)
  loader.ts           Fresh-Load via createRequire + Cache-Evict per Präfix; Fingerprint
  runner.ts           Policy enabled|disabled|ask, Kill-Switch, Timeout, Fehler-Fallback
  disclosure.ts       Consent-Modal (volle Rechte), Acknowledge pro Checksum/Version
  store.ts            Manifest (data.json) + Per-Device-Sidecar (enabled/Consent)
  distribution.ts     Download aus offiziellem Repo + Vault-Import + Drift-/Update-Logik
main.ts               Lifecycle, Command-Registrierung (Ops + gebundene Skripte), Settings-UI, Paste-Hook
```

Leitprinzip: **Kern (Operationen) weiß nichts von Obsidian** und ist via Fixtures testbar. Quellen,
Skript-Runtime und UI sind die dünne Hülle; Skripte komponieren die Operations-API.

---

## 9. Tech-Notes (Obsidian)

- **Editor-Transaktion** für den Zwei-Stellen-Edit (Body am Cursor + Definitionen am Ziel) —
  in einem Schritt, damit Offsets nicht verrutschen.
- **Paste-Event** abfangen via `this.app.workspace.on("editor-paste", …)` bzw.
  `registerEvent` — sauberes Cleanup beachten.
- **`requestUrl`** statt `fetch` für den Quell-Abruf/Import aus Repos (CORS/Obsidian-Konvention).
- **`normalizePath`** für jegliche Pfade; Persistenz über die Plugin-Data-API, nicht direkt im Vault.
- **Sync (Recherche-Befund, LOAD-BEARING, noch per 2-Geräte-Test zu bestätigen):** Obsidian Sync
  repliziert bei aktivem „Installed community plugin list" **das ganze Plugin-Verzeichnis inkl.
  Unterordner** (Forum-Sync-Logs, hoch-confident, nicht vendor-bestätigt). Konsequenz: ungeprüftes
  JS könnte **still auf alle Geräte propagieren** → **Per-Device-Consent zwingend**, `enabled`/Consent
  in einem **Sidecar** (nicht `data.json`). Vor v0.2 empirisch verifizieren.
- **Desktop-only:** `isDesktopOnly: true` — die Skript-Runtime braucht Node (`require`, Fresh-Load +
  Cache-Evict). Kein Mobile-Gating nötig, weil Mobile gar nicht unterstützt wird.
- **DOM-Sicherheit:** kein `innerHTML` mit Fremdinhalt (Skript-`description`/`changelog`) — XSS-sicher rendern.
- Vor Community-Einreichung: Skill **`tcs-patterns:obsidian-plugin`** durchlaufen (Manifest-Regeln,
  Lifecycle/Cleanup, Sample-Plugin-Reste, `console.debug` etc.).

---

## 10. Sicherheit & Vertrauen

> **Ehrliches Modell:** Alle Skripte sind **echter JS-Code mit vollen Plugin-Rechten** — es gibt
> **keine** „Safety by construction" mehr (der deklarative Ansatz ist verworfen, §7). Schutz kommt
> aus **Policy + Disclosure + Consent + Desktop-only**, wie bei Templater/Dataview.

**Vertrauensstufen.** Es gibt genau zwei:

- **Offizielles Repo (geprüft):** per PR eingereichte Skripte mit Pflicht-Doku, die **nur Markdown in
  der Notiz** tun. Netzwerk/extern/Cross-Plugin wird **nicht gemerged**. Maintainer-reviewt.
- **Community & selbstgebaut (ungeprüft):** aus dem Vault importiert. Das Plugin behandelt sie **wie
  deine eigenen handgeschriebenen** — kein Review, keine Sandbox, keine Garantie.

> **Community-/selbstgeschriebene Skripte sind ungeprüft** und laufen **auf eigenes Ermessen und
> Risiko**. Sharing über den Forum-/Diskussionsbereich des Repos → manuell ins Vault → Import.

**Verteidigungslinien (gestaffelt):**

- **Policy (statt Struktur):** das offizielle Repo akzeptiert nur Markdown-in-Note-Skripte (PR-Review
  + Doku-Pflicht). Das ist die erste Linie — durchgesetzt durch Menschen, nicht durch das Format.
- **Disclosure + Consent:** vor Ausführung Modal mit vollen Rechten; Acknowledge **pro Checksum/
  Version**; Re-Prompt bei Fingerprint-Änderung; **Kill-Switch** (`disabled`).
- **Integrität:** Checksum (Drift = Hard-Block) + Version (Absicht); geprüfte Quellen an Commit-SHA
  pinnen; Per-Device-Consent im Sidecar (nicht `data.json`).
- **Isolation-Hygiene:** Fresh-Load + Cache-Evict per Präfix; hooksDir-Escape-Guard; Timeout +
  Roh-Fallback. (Echte Sandbox ist **nicht** machbar/vorgesehen — ehrlich kommuniziert.)
- **Keine Telemetrie**, keine stillen Netzwerkaufrufe außer dem expliziten, nutzer-ausgelösten
  Pull aus dem offiziellen Repo.

---

## 11. Roadmap (Vorschlag)

- **v0.1 — Operationen + Skript-Runtime:** H/C/O+D/M als in-plugin API + Standalone-Commands
  (Kern als Edit-Plan, O+D als eine Footnote-Identity-Stufe — §5); **Skript-Runtime** (Hashi-Modell)
  mit Invocation **beim Paste / auf Selektion / als Command**; **Vault-Import**; die **drei Perplexity-
  Skripte**; versionierte API; desktop-only; Submission-Compliance. Samples vorhanden → C/O/D unblocked.
- **v0.2 — Distribution:** Download aus dem **offiziellen, geprüften Repo** + Manifest/Integrität
  (`source/checksum/version/enabled`, Drift = Hard-Block, Update-Prompts), Per-Device-Consent-Sidecar.
  Hängt an der Sync-Verifikation aus §9.
- **v0.3 — Politur:** Auto-on-Paste-Modus, Preview/Dry-run, weitere offizielle Skripte (z.B. HTML),
  reichere Library-UI, Settings-Politur (Ziel-Sektionsname, Marker-Policy).

---

## 12. Offene Punkte / benötigte Inputs

1. ~~**Roher Perplexity-Paste**~~ — **GELÖST:** drei Samples committed unter `assets/`
   (`sakura-in-tokyo-{app,web,web-download}.md`) — drei verschiedene Formate, je ein Skript. Keine
   persönliche/gitignored Variante nötig.
2. ~~**Deklarativ vs. JS**~~ — **GEÄNDERT (PRD v1.1):** JS-Skripte-first (Advanced-Paste-Modell),
   deklarativer Kern verworfen. Operationen = in-plugin API; Skripte = Erweiterung; desktop-only.
3. ~~**O↔D-Kopplung**~~ — **ENTSCHIEDEN** (§5): Footnote-Identity als eine Stufe + Edit-Plan.
4. **Sync-Verhalten verifizieren** (§9, LOAD-BEARING): 2-Geräte-Test, ob das Plugin-Verzeichnis
   wirklich wholesale synct. Bestimmt die Per-Device-Consent-Mechanik.
5. **Vetting-Prozess** für das offizielle Repo definieren: Doku-Template, „Markdown-in-Note-only"-Check
   (manuell vs. teil-automatisiert), wer reviewt.
6. **Operations-API-Surface** + wie Skripte die `required-api-version` deklarieren — Detail im SDD.
7. **Update-Kadenz** für installierte offizielle Skripte: on-load / gedrosselt / nur manuell?
8. *(bestätigt)* M-Default = `## Resources` am Notizende, Name konfigurierbar, kein Callout; Name
   „Markdown Mason" bleibt.

---

## 13. Referenzen

- Advanced Paste (entfernt): https://github.com/kxxt/obsidian-advanced-paste
- Paste Reformatter: https://github.com/keathmilligan/obsidian-paste-reformatter
- Perplexity Converter: https://github.com/heseber/perplexity-converter
- Paste transform (regex): https://github.com/rekby/obsidian-paste-transform
- Tidy Footnotes: https://github.com/charliecm/obsidian-tidy-footnotes
- Better Footnotes: https://github.com/Oudwins/obsidian-betterfotnotes
- Obsidian Linter: https://github.com/platers/obsidian-linter
- MiYo Tomo Hashi (Skript-/Hook-Ausführungsmodell, `src/hooks/`): https://github.com/MMoMM-org/miyo-tomo-hashi
- Offizieller Katalog (Verifikation): https://github.com/obsidianmd/obsidian-releases
