# Security Policy

## Reporting a vulnerability

If you discover a security issue in Obsidian Markdown Mason, please report it
privately rather than opening a public issue:

- Email: marcus@mmomm.org
- Or open a [GitHub security advisory](https://github.com/MMoMM-org/obsidian-markdown-mason/security/advisories/new)

Please include reproduction steps and the affected version. We aim to
acknowledge reports within a few days.

## Supported versions

The plugin is pre-1.0; only the latest released version receives security
fixes. Once a stable line is published this section will list supported ranges.

## Threat model

Markdown Mason runs entirely inside Obsidian on the user's machine. It:

- transforms Markdown text within the active vault,
- performs no network calls,
- starts no listening ports or external surfaces,
- stores no credentials.

The relevant risk surface is therefore local: malformed or adversarial Markdown
input must not cause the plugin to corrupt unrelated note content or escape the
intended target note. Tests covering the transform pipeline guard this.

## Dependency audit posture

`npm audit` currently reports advisories that all trace to a single root —
`esbuild` — inherited transitively through the `vitest` test chain
(`vitest → vite → esbuild`) and through the direct `esbuild` build dependency.

These are **development dependencies only**. Obsidian plugins ship as a single
bundled `main.js`; `devDependencies` are never distributed to users, so these
advisories do not reach an installed plugin.

The two esbuild advisories are additionally not reachable in our usage:

- `GHSA-gv7w-rqvm-qjhr` — RCE via the **Deno** esbuild module
  (`NPM_CONFIG_REGISTRY`). This project does not use Deno.
- `GHSA-g7r4-m6w7-qqqr` — arbitrary file read in the esbuild **dev server on
  Windows**. We bundle via `esbuild.config.mjs` and never run the dev server.

At the time of writing there is no fixed esbuild release for these advisories
(`npm audit` reports "No fix available"). Running `npm audit fix --force` is
**not** an accepted remediation here: it cannot clear the unpatched esbuild root
and would force a major bump of the `vitest` chain, risking build/test breakage
for no security gain.

**Action taken:** accepted and documented. When a patched `esbuild` release is
available, the whole chain will be resolved in one step via a `package.json`
`overrides` entry pinning the fixed version.
