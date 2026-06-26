# Changelog

All notable changes to this project are documented here. From 0.2.0 onward this
file is maintained automatically by [semantic-release](https://semantic-release.gitbook.io/)
from the Conventional Commit history; entries below 0.2.0 were recorded manually.

## 0.1.1 (2026-06-26)

### Fixes

- Clear the Obsidian community scorecard for the published build: resolve the
  `no-unsupported-api` failure (retype the command host so `.settings` no longer
  depends on the Obsidian 1.13.0 / Catalyst-beta `Plugin.settings` slot; set
  `minAppVersion` to 1.7.2 for `removeCommand`), attest `styles.css` alongside
  `main.js`, replace the `builtin-modules` package with Node's native
  `module.builtinModules`, and clear the type-assertion / unsafe-assignment /
  misused-promise lint warnings. Disclose filesystem and clipboard access in the
  README.

## 0.1.0 (2026-06-25)

- Initial release: heading cascade, footnote renumbering and dedup, and the
  consent-gated runnable script library.
