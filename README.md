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

> ⚠️ **Noch offen / benötigt:** ein **roher** Perplexity-Paste (unbearbeitet, Inline-Citations
> + Quellenblock), um den Parser in §4 (C/D) korrekt zu bauen. Bisher ist nur das
> *kuratierte Ergebnis* bekannt, nicht das *Roh-Eingabeformat*. Perplexity variiert
> (mal `[1]` inline, mal „Citations:"-Block, mal Superscript-Links).

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

## 7. Extensibilität: kuratierte Transform-Bibliothek (Kern-Idee)

Das Hauptproblem mit Advanced Paste war: **Skripte lebten lose im Vault** → Obsidian
schleppt/synct sie mit, unübersichtlich. Markdown Mason dreht das um:

- **Transforms werden vom Plugin verwaltet**, gespeichert in einem **eigenen Skript-Verzeichnis
  im Plugin-Datenverzeichnis** (`.obsidian/plugins/markdown-mason/scripts/…`), **nicht** als
  Notiz-Dateien im Vault-Baum.
- **Built-in-Transforms** werden mit dem Plugin ausgeliefert (die obigen H/C/O/D/M + die
  Perplexity-Beispiele des Autors als kanonische Vorlage). Sie sind die **einzige durch die
  Maintainer geprüfte** Stufe; jede Aktivierung ist **Opt-in**. Pro Beispiel liegt im Repo eine
  Doku, *warum* es so gebaut ist (Feature-Set orientiert am Perplexity-Use-Case, ergänzt um
  Ideen — **nicht Code** — aus Paste Reformatter).
- **Import statt Auto-Galerie:** Es gibt **keinen** stillen Netzwerk-Installer. Sowohl
  Community- als auch selbstgebaute Transforms laufen über **denselben manuellen Pfad**: Datei
  im Vault ablegen → ins Skript-Verzeichnis importieren. Das Plugin führt eine **Quell-Liste**
  (kuratierte Repos + eigene Vault-Pfade), aus der re-importiert/aktualisiert werden kann — aber
  Installation und Upgrade sind immer **nutzer-bestätigt** (siehe §10).

### Entschieden: deklarativer Kern (A), JS nur als Escape-Hatch
Beim „Transforms aus einer Quelle ziehen und ausführen" entsteht eine **Trust-/Supply-Chain-Fläche**
(Code-Ausführung mit vollem Plugin-Rechten). Die Entscheidung ist gefallen:

- **(A) Deklarative Pipeline** aus sicheren Primitiven (Heading-Shift, Regex-Regeln, Footnote-Ops,
  Reihenfolge) ist **das Kernformat**. Ein Transform ist damit *Daten*, kein Code → PR-/Import-
  reviewbar **ohne** Ausführung, und „macht nur Markdown-Operationen" gilt **per Konstruktion**
  (die Primitiven sind die einzige Capability). Deckt H/C/O/D/M vollständig ab.
- **(B) Beliebiges JS** bleibt ein optionaler, deutlich gekennzeichneter **Power-User-Escape-Hatch**:
  desktop-only, pro Installation expliziter „du führst Fremdcode aus"-Consent, **nie** automatisch
  aus der Quell-Liste gezogen.

### Self-describing Transform-Format (eine Datei pro Transform)
Weil der Kern deklarativ ist, ist ein Transform ein strukturiertes Dokument und trägt seine
Metadaten **in sich** — keine Sidecar-Dateien für Changelog/Doku:

```yaml
id: perplexity-citations
version: 3
description: Wandelt Perplexity-Inline-Citations [n] in [^n]-Fußnoten …
changelog:
  - v3: "Citations:"-Block-Variante unterstützt
  - v2: Dedup über normalisierte URL
  - v1: initial
transform: [ … die deklarative Pipeline … ]
```

Vorteile: **eine** Datei zum Hashen/Holen/Speichern; der Update-Prompt liest `changelog` direkt
aus der eingehenden Version (kein zweiter Fetch); ein Changelog-Eintrag ändert den Checksum —
korrekt, weil er versionierter Inhalt ist. Längere „warum"-Prosa lebt zusätzlich als Repo-Doku
für den kuratierten Satz; zur Laufzeit braucht es nur die eine Datei. JS-Escape-Hatch-Transforms
tragen dieselben Felder als Header-Kommentarblock.

### Speicher- & Integritäts-Modell (Manifest/Lockfile)
`data.json` hält **nur Metadaten** pro Transform — die Skripte selbst liegen als Dateien im
Skript-Verzeichnis:

```json
{ "source": "…repo-url | vault-pfad", "checksum": "sha256:…", "version": 3, "enabled": true }
```

Regeln (Paketmanager-Logik: Hash pinnt Integrität, Version signalisiert Absicht):

- **Auf Disk** wird nur **Existenz** geprüft. Fehlt die Datei → von `source` holen; stimmt der
  geholte Checksum mit dem gespeicherten überein → **Autoinstall** (still). Mismatch → **nicht**
  still installieren (Quelle ist abgedriftet).
- **Drift-Erkennung** vergleicht Quell-Checksum gegen den gespeicherten:
  - **gleiche Version + anderer Checksum → unerwartete Drift → Fehler/Warnung** (Quelle hat sich
    ohne Ankündigung geändert: Manipulation oder schlampige Pflege — nie automatisch anwenden).
  - **höhere Version → legitime Änderung → Update-Prompt** (mit `changelog`) → Nutzer entscheidet.
    **Keine** Auto-Upgrades.
- Die Drift-Prüfung *bedeutet* je nach Quelle Unterschiedliches: bei einem **geprüften Repo**
  Manipulations-/Integritätsschutz; bei einem **Vault-Pfad** nur „du hast deine lokale Kopie
  editiert — neu importieren?". Gleiche Mechanik, andere Schwere.

**Cross-Instanz-Self-Heal (emergente Eigenschaft):** Obsidian Sync repliziert die **Plugin-Daten
(`data.json`)**, aber **nicht** die Skript-Dateien (→ §9, **noch zu verifizieren**). Auf einem
zweiten Gerät kommt also die Metadaten-Liste an, die Dateien fehlen → der Checksum-/Existenz-Pfad
zieht sie automatisch aus `source` nach. **Grenze:** das funktioniert nur für Transforms mit
*auflösbarer* `source` (geprüftes Repo / gehostete Datei). Rein selbstgeschriebene, aus dem Vault
importierte Skripte haben **keine** Remote-Quelle → auf einem zweiten Gerät müssen sie erneut aus
dem Vault importiert (oder selbst gehostet) werden.

---

## 8. Architektur-Skizze

```
core/                 reine Transform-Funktionen (kein Obsidian-Import) — unit-testbar
  headings.ts         H
  footnotes.ts        C, O, D, M
  pipeline.ts         Verkettung + Preset-Definitionen
sources/              dünne Adapter, die Input + Kontext liefern
  paste.ts            Clipboard → Cursor (Paste-Event)
  selection.ts        markierter Bereich
  note.ts             ganze Notiz
registry/             Transform-Bibliothek
  builtin/            mitgelieferte Transforms (inkl. Perplexity-Beispiele)
  format.ts           self-describing Transform-Schema (id/version/changelog/description/transform)
  sources.ts          Quell-Liste + Abruf/Import + Checksum-/Drift-/Update-Logik (kein Auto-Installer)
  store.ts            Manifest (data.json: source/checksum/version/enabled) + Skript-Verzeichnis (NICHT im Vault-Baum)
main.ts               Plugin-Lifecycle, Command-Registrierung, Settings-UI
```

Leitprinzip: **Kern weiß nichts von Obsidian.** Quellen + Registry + UI sind die dünne Hülle.
Damit ist derselbe Kern später trivial in einen Auto-on-Cmd+V-Modus portierbar.

---

## 9. Tech-Notes (Obsidian)

- **Editor-Transaktion** für den Zwei-Stellen-Edit (Body am Cursor + Definitionen am Ziel) —
  in einem Schritt, damit Offsets nicht verrutschen.
- **Paste-Event** abfangen via `this.app.workspace.on("editor-paste", …)` bzw.
  `registerEvent` — sauberes Cleanup beachten.
- **`requestUrl`** statt `fetch` für den Quell-Abruf/Import aus Repos (CORS/Obsidian-Konvention).
- **`normalizePath`** für jegliche Pfade; Persistenz über die Plugin-Data-API, nicht direkt im Vault.
- **Sync-Annahme (LOAD-BEARING, zu verifizieren):** Das Self-Heal- und Re-Import-Modell aus §7
  setzt voraus, dass Obsidian Sync **`data.json` repliziert, aber Skript-Dateien im Plugin-Verzeichnis
  nicht**. Das ist die zentrale Unbekannte: synct Obsidian beliebige Plugin-Verzeichnis-Dateien,
  ist das Self-Heal hinfällig **und** ungeprüftes JS würde still auf alle Geräte propagieren (anderes
  Risiko). Vor dem Festzurren von §7/§10 gegen die Obsidian-Doc / Skill `tcs-patterns:obsidian-plugin`
  klären.
- **Mobile:** wenn Netzwerk/Import kritisch → `isDesktopOnly` erwägen; JS-Escape-Hatch ohnehin
  desktop-only.
- **DOM-Sicherheit:** kein `innerHTML` mit Fremdinhalt (Transform-`description`/`changelog`) — XSS-sicher rendern.
- Vor Community-Einreichung: Skill **`tcs-patterns:obsidian-plugin`** durchlaufen (Manifest-Regeln,
  Lifecycle/Cleanup, Sample-Plugin-Reste, `console.debug` etc.).

---

## 10. Sicherheit & Vertrauen

**Vertrauensstufen.** Es gibt genau zwei:

- **Built-in (geprüft):** die mitgelieferten Beispiel-Transforms — von den Maintainern reviewt.
- **Community & selbstgebaut (ungeprüft):** alles andere. Das Plugin behandelt Community-Skripte
  **exakt wie deine eigenen handgeschriebenen** — kein Review, keine Sandbox, keine Garantie.

> **Community- und selbstgeschriebene Transforms sind ungeprüft.** Nur die mit dem Plugin
> ausgelieferten Built-in-Beispiele sind von den Maintainern geprüft. Das Installieren jedes
> anderen Transforms — aus dem Vault kopiert oder aus einer Community-Quelle gezogen — führt
> fremden Code **auf eigenes Ermessen und Risiko** des Nutzers aus.

Es soll zudem einen **expliziten Community-Bereich ohne Überprüfung** geben, in dem Nutzer ihre
Transforms teilen — mit den entsprechenden Sicherheits-Implikationen prominent dokumentiert.

**Verteidigungslinien (gestaffelt):**

- **Strukturell:** das deklarative Format (§7-A) ist die stärkste Verteidigung — ein Daten-Transform
  *kann* per Konstruktion nichts außer Markdown-Operationen. „Nur Markdown-Ops" muss nicht geprüft
  werden, es gilt durch das Format.
- **Integrität:** Checksum (Drift-Erkennung) + Version (Absicht) aus §7 — geprüfte Repos sind so
  manipulationssicher, Upgrades immer nutzer-bestätigt, nie automatisch.
- **Consent:** beim Import/Upgrade Quelle, Autor, Version/Changelog und — bei JS — expliziten
  „Fremdcode"-Consent zeigen.
- **PR-Vetting (für den kuratierten Satz):** Einreichungen sollen daraufhin geprüft werden, dass
  sie ausschließlich Markdown-Operationen ausführen; Zugriff auf Information außerhalb ist zu
  hinterfragen (idealerweise gar nicht möglich, weil deklarativ). Ein (perspektivisch
  automatisierbarer) Vetting-Prozess ist noch zu definieren (§12).
- **Keine Telemetrie**, keine stillen Netzwerkaufrufe außer dem expliziten, nutzer-ausgelösten
  Quell-Pull.

---

## 11. Roadmap (Vorschlag)

- **v0.1 — Kern & Quellen:** Built-in H/C/O/D/M (Kern als Edit-Plan, O+D als eine Footnote-Identity-
  Stufe — §5), Quellen Paste + Selektion + ganze Notiz, Einzel-Commands + Presets. Perplexity-
  Beispiele als Built-in im self-describing deklarativen Format (§7). H/M buildbar ohne das
  Roh-Sample; C/O/D brauchen es (§2).
- **v0.2 — Bibliothek:** Registry + Quell-Liste + Import/Re-Import (kein Auto-Installer), Manifest/
  Lockfile in `data.json` (source/checksum/version/enabled), Drift- & Update-Prompts, Cross-Instanz-
  Self-Heal. Hängt an der Sync-Verifikation aus §9.
- **v0.3 — Politur:** Settings-UI (Ziel-Sektionsname, Marker-Policy), JS-Escape-Hatch (desktop-only,
  Consent), ggf. Auto-on-Paste-Modus.

---

## 12. Offene Punkte / benötigte Inputs

1. **Roher Perplexity-Paste** — *teilweise gelöst:* Autor liefert je ein Sample aus Copy/Paste und
   aus Perplexity-Export. **Fixture-Strategie:** das behaltbare Sample wird als committetes Golden-
   Fixture für C/D genutzt; das persönliche bleibt **lokal/gitignored** (z.B. `test/fixtures/local/`).
   Dateien stehen noch aus.
2. ~~**Deklarativ vs. JS**~~ — **ENTSCHIEDEN** (§7): deklarativer Kern (A) als Format, JS nur als
   desktop-only, consent-gegateter Escape-Hatch, nie auto-gepullt.
3. **Sync-Verhalten verifizieren** (§9, LOAD-BEARING): synct Obsidian Plugin-Verzeichnis-Dateien
   oder nur `data.json`? Das ganze Self-Heal-/Re-Import-Modell hängt daran. → Skill
   `tcs-patterns:obsidian-plugin`.
4. **O↔D-Kopplung** (§5): Footnote-Identity als eine Stufe + Edit-Plan als Kern-Rückgabetyp —
   Design bestätigen, bevor §5 als final gilt.
5. **Vetting-Prozess** für den kuratierten Satz definieren (perspektivisch automatisierbar: „nur
   Markdown-Ops, kein Außenzugriff").
6. **Ziel-Default** für M: bestehende `## Resources` bevorzugen, sonst Notizende — bestätigen.
7. **Name** final: „Markdown Mason" ist Arbeitstitel; soll der Bibliotheks-/Advanced-Paste-Aspekt
   im Namen anklingen?

---

## 13. Referenzen

- Advanced Paste (entfernt): https://github.com/kxxt/obsidian-advanced-paste
- Paste Reformatter: https://github.com/keathmilligan/obsidian-paste-reformatter
- Perplexity Converter: https://github.com/heseber/perplexity-converter
- Paste transform (regex): https://github.com/rekby/obsidian-paste-transform
- Tidy Footnotes: https://github.com/charliecm/obsidian-tidy-footnotes
- Better Footnotes: https://github.com/Oudwins/obsidian-betterfotnotes
- Obsidian Linter: https://github.com/platers/obsidian-linter
- Offizieller Katalog (Verifikation): https://github.com/obsidianmd/obsidian-releases
