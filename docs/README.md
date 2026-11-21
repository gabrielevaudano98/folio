# Folio documentation

Organised with [Diátaxis](https://diataxis.fr): four kinds of pages for four needs. Architecture follows
[arc42](https://arc42.org) with [C4](https://c4model.com) diagrams; decisions are [ADRs](adr/README.md) in the MADR format.

| I want to… | Kind | Pages |
|---|---|---|
| **learn** Folio by doing | Tutorials | [Getting started](tutorials/getting-started.md) · [Record your first meeting](tutorials/first-meeting.md) |
| **get a task done** | How-to guides | [Build, run and test](how-to/build-run-test.md) · [Publish a release](how-to/release.md) · [Add an MCP tool](how-to/add-mcp-tool.md) · [Add a downloadable component](how-to/add-component.md) · [Measure performance](how-to/measure-performance.md) |
| **look something up** | Reference | [File formats](FORMATS.md) · [Slide templates](TEMPLATES.md) · [MCP tools](reference/mcp-tools.md) · [IPC](reference/ipc.md) · [Optional components](reference/components.md) |
| **understand why** | Explanation | [Architecture (arc42)](architecture/README.md) · [Decisions (ADR)](adr/README.md) · [Process model](explanation/process-model.md) · [Data safety](explanation/data-safety.md) · [Security model](explanation/security.md) · [Meeting recorder](explanation/meeting-recorder.md) · [Performance budget](performance/budget.md) |

Plans and history: [Roadmap](ROADMAP.md) · [Slides plan](SLIDES-PLAN.md) · [Meeting recorder measurements](performance/meeting-spike.md).

Pages in `reference/` marked *generated* come from the code (`node scripts/docs-reference.mjs`); the test suite fails
when they are out of date. For contributors and AI agents, the short version is [`AGENTS.md`](../AGENTS.md).
