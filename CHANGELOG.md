# [0.4.0](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.3.0...0.4.0) (2026-06-28)


### Features

* configurable Format selection recipe (5 per-step toggles) [spec 003] ([#17](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/17)) ([9acc818](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/9acc818057e67ea64ecfec28b5757ce42c89dedb))

# [0.3.0](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.2.0...0.3.0) (2026-06-28)


### Bug Fixes

* **scripts:** wire live catalog and log catalog fetch failures ([ad888eb](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/ad888eb20515493c41f8b66d4d21b399da8ead30))


### Features

* **catalog:** inject RAW_BASE/PINNED_REF at build time and auto-pin on release ([bef667c](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/bef667cce3e1c8bac94c7c855e4b23a68d873c4e))

# [0.2.0](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.1.1...0.2.0) (2026-06-26)


### Features

* **footnotes:** Resources section at any heading level ([7dffab4](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/7dffab47ddc76420014bb9dd866102c97562f733))

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
