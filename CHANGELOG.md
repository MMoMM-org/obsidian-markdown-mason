## [0.6.2](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.6.1...0.6.2) (2026-07-01)

### Bug Fixes

* **release:** conventionalcommits preset so semantic-release keeps ! commits ([#22](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/22)) ([a21e899](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/a21e8990009f9e08ce51a8a91d470b21734928bf))

## [0.6.1](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.6.0...0.6.1) (2026-06-30)


### Bug Fixes

* **release:** drop spurious issue links from 0.6.0 changelog ([#21](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/21)) ([86431e9](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/86431e9f79d89cad4870814ba7be19fb96b00765))

# [0.6.0](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.5.0...0.6.0) (2026-06-30)


### Features

* paste command UX — Paste and format, Paste and run scripts, settings marker + logging [spec 005] ([#20](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/20)) ([cb5b194](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/cb5b1943fdfc2a44cbcb73e573c0624d2c035a89))

# [0.5.0](https://github.com/MMoMM-org/obsidian-markdown-mason/compare/0.4.0...0.5.0) (2026-06-29)


### Features

* text format transforms — six markdown-aware cleanup/list transforms [spec 004] ([#19](https://github.com/MMoMM-org/obsidian-markdown-mason/issues/19)) ([438e4eb](https://github.com/MMoMM-org/obsidian-markdown-mason/commit/438e4eb66e2e60b163c74fb6b3c545c60b972a70))

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
