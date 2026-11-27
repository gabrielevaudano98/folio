# Folio documentation

## Start here

| You are… | Read, in this order |
|---|---|
| **New to Folio** (product, leadership, anyone) | [Folio in ten minutes](overview.md) → [Project status](STATUS.md) → [Roadmap](ROADMAP.md) |
| **Picking up the work** | [Project status](STATUS.md) (in flight, bugs, next, how to pick up) → [`AGENTS.md`](../AGENTS.md) → the issue you take |
| **Developer** | [Build, run and test](how-to/build-run-test.md) → [Source map](reference/source-map.md) → [How the editors work](explanation/editors.md) → [Testing, CI and review](explanation/testing.md) |
| **Architect** | [Architecture (arc42)](architecture/README.md) → [Decisions (ADR)](adr/README.md) → [Process model](explanation/process-model.md) → [Security](explanation/security.md) → [Data safety](explanation/data-safety.md) |
| **Designer** | [Design system](explanation/design-system.md) → [Folio in ten minutes](overview.md) → [Slide templates](TEMPLATES.md) |
| **AI agent working on the code** | [`AGENTS.md`](../AGENTS.md) → [Project status](STATUS.md) → [Source map](reference/source-map.md) |
| **AI assistant using Folio over MCP** | [MCP tools](reference/mcp-tools.md) → [File formats](FORMATS.md) (also served by the `get_format_guide` tool) |

## All pages

Organised with [Diátaxis](https://diataxis.fr): four kinds of pages for four needs. Architecture follows
[arc42](https://arc42.org) with [C4](https://c4model.com) diagrams; decisions are [ADRs](adr/README.md) in the MADR format.

| I want to… | Kind | Pages |
|---|---|---|
| **learn** Folio by doing | Tutorials | [Getting started](tutorials/getting-started.md) · [Record your first meeting](tutorials/first-meeting.md) |
| **get a task done** | How-to guides | [Build, run and test](how-to/build-run-test.md) · [Publish a release](how-to/release.md) · [Add an MCP tool](how-to/add-mcp-tool.md) · [Add a downloadable component](how-to/add-component.md) · [Add interface text or a language](how-to/add-ui-text.md) · [Measure performance](how-to/measure-performance.md) |
| **look something up** | Reference | [File formats](FORMATS.md) · [Slide templates](TEMPLATES.md) · [MCP tools](reference/mcp-tools.md) · [IPC](reference/ipc.md) · [Optional components](reference/components.md) · [Source map](reference/source-map.md) |
| **understand why** | Explanation | [Folio in ten minutes](overview.md) · [Architecture (arc42)](architecture/README.md) · [Decisions (ADR)](adr/README.md) · [How the editors work](explanation/editors.md) · [Process model](explanation/process-model.md) · [Data safety](explanation/data-safety.md) · [Security model](explanation/security.md) · [Design system](explanation/design-system.md) · [Testing, CI and review](explanation/testing.md) · [Meeting recorder](explanation/meeting-recorder.md) · [Performance budget](performance/budget.md) |

Plans, status and history: [Project status](STATUS.md) · [Roadmap](ROADMAP.md) · [Pages plan](PAGES-PLAN.md) ·
[Slides plan](SLIDES-PLAN.md) · [Meeting recorder measurements](performance/meeting-spike.md).

Pages in `reference/` marked *generated* come from the code (`node scripts/docs-reference.mjs`); the test suite fails
when they are out of date. The source map is written by hand, and `test/docs-map.test.mjs` fails when a file in `src/`
is missing from it.

## Keeping the docs true

- A pull request that changes behaviour updates the page that describes it, in the same pull request.
- A merged branch, a closed milestone or a new bug updates [STATUS.md](STATUS.md) and [ROADMAP.md](ROADMAP.md).
- A decision that changes the architecture gets a new ADR that supersedes the old one; ADRs are not edited.
- Write plain, short sentences in English; name the file and function a reader should open.
