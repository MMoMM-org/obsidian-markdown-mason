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
in einer Editor-Transaktion.

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

- **Transforms werden vom Plugin verwaltet**, gespeichert im **Plugin-Datenverzeichnis**
  (`.obsidian/plugins/markdown-mason/…`), **nicht** als Notiz-Dateien im Vault-Baum.
- **Built-in-Transforms** werden mit dem Plugin ausgeliefert (u.a. die obigen H/C/O/D/M +
  die Perplexity-Beispiele des Autors als kanonische Vorlage).
- **Community-Beiträge per PR** ins Plugin-Repo: andere reichen geprüfte Transforms ein.
- **In-Plugin-Galerie:** ein Browser im Plugin listet die im Repo geprüften Transforms und
  **installiert sie direkt** (Pull aus dem Repo / einem Manifest) ins Plugin-Datenverzeichnis.
  → Kein manuelles Ablegen im Vault mehr.

### Wichtige Design-Gabelung: deklarativ vs. beliebiges JS
Beim „Transforms aus dem Internet ziehen und ausführen" entsteht eine **Trust-/Supply-Chain-Fläche**
(Code-Ausführung mit vollem Plugin-Rechten). Zwei Wege:

- **(A) Deklarative Pipeline** aus sicheren Primitiven (Heading-Shift, Regex-Regeln, Footnote-Ops,
  Reihenfolge). PR-reviewbar **ohne** Code-Ausführung, deutlich sicherer, etwas weniger mächtig.
- **(B) Beliebiges JS** (wie Advanced Paste). Maximal flexibel, aber jeder installierte Transform
  ist ausführbarer Fremdcode → expliziter „du führst Code aus dem Netz aus"-Consent nötig.

**Empfehlung:** Kern als **(A) deklarativ** bauen (deckt H/C/O/D/M vollständig ab), JS als
optionalen, deutlich gekennzeichneten Power-User-Escape-Hatch. Diese Entscheidung vor v0.2 final treffen.

**note:**
Ich würde a) nehmen, außerdem sollte es auch möglich sein scripte aus dem vault in das Plugin Verzeichnis zu kopieren.
Dafür müssen wir dann die Referenzen woher die einzelnen scripte incl. einer hash summe (freigabe) speichern.
Damit kann der Nutzer in jeder Instanz von Obsidian seine freigebenen scripte (offiziell, Community, selbstgebaut) wieder
automatisch in das Pluginverzeichnis pullen lassen und nutzen.

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
  gallery.ts          Repo/Manifest abrufen, geprüfte Transforms installieren
  store.ts            Persistenz im Plugin-Datenverzeichnis (NICHT im Vault-Baum)
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
- **`requestUrl`** statt `fetch` für den Galerie-Abruf (CORS/Obsidian-Konvention).
- **`normalizePath`** für jegliche Pfade; Persistenz über die Plugin-Data-API, nicht direkt im Vault.
- **Sync-Hinweis:** Plugin-Datenverzeichnis kann von Obsidian Sync (Plugin-Sync) erfasst werden,
  ist aber **getrennt von Vault-Content** — löst das „liegt als Notiz herum"-Problem trotzdem.
  **note:**
  es wird nur obsidian plugin spezifisches material gesynced, keine zusätzlichen dateien die ein plugin erzeugt (unsere scripte)
- **Mobile:** wenn Galerie/Netzwerk kritisch → `isDesktopOnly` erwägen; sonst Feature-Gate.
- **DOM-Sicherheit:** kein `innerHTML` mit Fremdinhalt (Galerie-Beschreibungen) — XSS-sicher rendern.
- Vor Community-Einreichung: Skill **`tcs-patterns:obsidian-plugin`** durchlaufen (Manifest-Regeln,
  Lifecycle/Cleanup, Sample-Plugin-Reste, `console.debug` etc.).
**note:**
wir müssen uns einen Vettingprozess für die PR überlegen und am besten dann einen automatischen prozess haben ob wir die Scripte erlauben wollen.
Generell sollten nur Scripte akzeptiert werden die Markdown Operationen ausführen, es ist zu prüfen ob zugriff auf andere informationen außerhalb überhaupt notwendig sind.
ich denke wir sollten einen community bereich einrichten wo user ihre scripte sharen können (ohne überprüfung).
alles natürlich ordentlich in der Readme mit den entsprechenden sicherheits implikationen dokumentiert.
---

## 10. Sicherheit & Vertrauen

- Galerie-Transforms = potenziell Fremdcode. PR-Review ist die erste Verteidigungslinie;
  deklaratives Format (§7-A) ist die strukturelle.
- Beim Installieren eines Galerie-Transforms: Quelle, Autor und (bei JS) expliziten Consent zeigen.
- Keine Telemetrie, keine stillen Netzwerkaufrufe außer dem expliziten Galerie-Pull.

---

## 11. Roadmap (Vorschlag)

- **v0.1 — Kern & Quellen:** Built-in H/C/O/D/M, Quellen Paste + Selektion + ganze Notiz,
  Einzel-Commands + Presets. Perplexity-Beispiele als Built-in. (Braucht das Roh-Sample aus §2.)
- **v0.2 — Bibliothek:** Registry + In-Plugin-Galerie, Pull geprüfter Transforms aus dem Repo,
  deklaratives Transform-Format finalisiert.
- **v0.3 — Politur:** Settings-UI (Ziel-Sektionsname, Marker-Policy), optionaler JS-Escape-Hatch,
  ggf. Auto-on-Paste-Modus.

---

## 12. Offene Punkte / benötigte Inputs

1. **Roher Perplexity-Paste** (1–2 Sektionen, unbearbeitet) — Blocker für C/D-Parser.
2. **Deklarativ vs. JS** (§7) — vor v0.2 entscheiden.
3. **Ziel-Default** für M: bestehende `## Resources` bevorzugen, sonst Notizende — bestätigen.
4. **Name** final: „Markdown Mason" ist Arbeitstitel; soll der Bibliotheks-/Advanced-Paste-Aspekt
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
