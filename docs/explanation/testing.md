# Testing, CI and review

How Folio is checked, from a pure function to a packaged installer. Commands are in
[build, run and test](../how-to/build-run-test.md); this page explains what each layer protects and where to add a test.

## Layers

| Layer | Runs | Protects | Files |
|---|---|---|---|
| **Format round trips** | Node (bundled with esbuild first) | Invariant 1: parse → serialize gives the same bytes; one edit changes only its lines. Every format change adds a case here. | `test/formats.test.mjs`, fixtures in `test/fixture/` (`pages/` is the Markdown fidelity corpus) |
| **Pure cores** | Node | Page tools, history, assets, git log, i18n catalogues, components and catalog pins, call detection, thread count | `pagetools`, `history`, `assets`, `git-log`, `i18n`, `features`, `mic-watch`, `threads` `.test.mjs` |
| **Security** | Node and in-app | Workspace boundary (`..`, links out, hidden folders), token and Host/Origin checks, remote images only from public addresses, window lockdown | `security.test.mjs`, `security-app.test.mjs`, `remote-images.test.mjs` |
| **Data safety** | Node and in-app | Atomic writes, a failed save keeps the text, undo everywhere | `atomic.test.mjs`, `save-fail-ui.test.mjs`, `undo.test.mjs` |
| **MCP end to end** | Node | Every tool over stdio (and over HTTP with a running app), read-only switch, server version matches `package.json` | `mcp.test.mjs`, `mcp-gating.test.mjs`, `stdio-binary.test.mjs` |
| **Generated docs** | Node | `docs/reference/` matches the code; the source map lists every file | `scripts/docs-reference.mjs --check`, `docs-map.test.mjs` |
| **In-app UI** | Electron under xvfb on Linux | Each feature driven in the real window, with the file on disk checked after | about 35 files: `pages`, `tables-ui`, `chips-ui`, `review-ui`, `canvas`, `arrange`, `text`, `motion`, `presenter`, `interop`, `templates`… |
| **Accessibility** | In-app | axe-core on the shell; keyboard and names on the slide canvas | `a11y-ui.test.mjs`, `a11y-canvas.test.mjs` |
| **Performance** | In-app | 200-slide deck opens and edits within budget | `perf.test.mjs`; the full baseline is `scripts/perf.mjs` ([how-to](../how-to/measure-performance.md)) |
| **Visual regression** | In-app, Linux only | Slide rendering, compared with pixelmatch against `test/visual/*.png` | `visual.test.mjs` |
| **Smoke** | In-app | The app starts, opens every type, no console errors | `smoke.test.mjs` |
| **Opt-in** | On request | Meeting recorder end to end with real models (`FOLIO_MEETING_E2E=1`), packaged binary (`FOLIO_BINARY`) | `meeting.test.mjs`, `stdio-binary.test.mjs` |

`test/run.mjs` runs them in this order and skips the in-app ones when there is no display (`FOLIO_SKIP_UI=1` skips them
on purpose).

## The in-app harness

UI tests start the real app with `FOLIO_SHOT` pointing to a JSON list of steps; the app runs them in the window and quits
(`devShot` in `src/main/main.js`, development builds only). `test/harness.mjs` gives the building blocks:

- `workspace(name, port)`: a temporary copy of `test/fixture/` and a settings folder with its own MCP port;
- `runApp(w, steps)`: starts Electron and collects the values the steps log;
- steps: `{ js, wait, log }` to run code in the window, `{ size }`, `{ out }` for a screenshot; helpers `open(file)`,
  `pick(id)`, `step(expr)`, `log(expr)`, `errors` (console errors seen by the page).

A good UI test does the gesture, then reads **the file on disk** (`w.read('Name.md')`), because the file is the
document. Give each test file its own port so they can run in parallel.

## Where to add a test

- Changed a format (page syntax, slides, board, sheet, meeting note): a round-trip case in `test/formats.test.mjs` and
  a line in [FORMATS.md](../FORMATS.md). Required.
- Added or changed an MCP tool: a case in `test/mcp.test.mjs`, then `node scripts/docs-reference.mjs`.
- Touched paths, IPC or network: `test/security.test.mjs` or `security-app.test.mjs`.
- New interface feature: an in-app test with the harness that checks the file afterwards.
- New file in `src/`: a line in the [source map](../reference/source-map.md).
- Fixed a bug: a test that fails before the fix.

## Continuous integration (`.github/workflows/`)

| Workflow | When | What |
|---|---|---|
| `ci.yml` | Push to `main`, pull requests, manual | `npm ci`, `xvfb-run -a npm test`, attribution check (AGPL 7(b)); on push also packages Windows and macOS, checks Electron fuses and talks MCP to the packaged binary, uploads the installers as artifacts |
| `release.yml` | Push to `main` that changes `package.json` (or `release.yml`), manual | Tests again, builds Windows (NSIS x64/arm64, portable) and macOS (universal DMG and ZIP), publishes a GitHub release `v<version>` ([how-to](../how-to/release.md)) |
| `codeql.yml` | Push to `main`, pull requests | GitHub CodeQL security analysis |
| `roadmap.yml` | Push to `main` changing `.github/roadmap.json` | Creates labels, milestones and issues listed there (skips titles that exist) |
| `claude.yml` | `@claude` in an issue or a PR | Claude Code answers, reviews or opens a fix (needs `ANTHROPIC_API_KEY`) |

Dependabot (`.github/dependabot.yml`) opens weekly updates for npm and GitHub Actions.

## Review

Pull requests are reviewed by the maintainer and by AI reviewers: [cubic](https://cubic.dev) reads `cubic.yaml` (deeper
"ultrareview" when `src/main/**`, `src/mcp/**` or a format parser changes) and `AGENTS.md`; CodeAnt also comments.
Their comments are suggestions; the maintainer decides. The PR template (`.github/PULL_REQUEST_TEMPLATE.md`) asks for
the invariants each change keeps.
