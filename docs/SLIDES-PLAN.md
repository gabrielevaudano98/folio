# Slides Studio — plan v2

Goal: a slides editor with PowerPoint and Google Slides capabilities and full user control, where the file stays plain `slides-md` that an AI can read and write, and where results can be linked across Folio documents.

## Principles

1. **The file is the truth.** Every action in the canvas is a minimal text edit. Slides that were not touched keep their bytes (the same rule as boards and sheets).
2. **Flow and placed content.** Flow content is Markdown laid out by the slide layout (today's behaviour). Placed content has explicit geometry. A slide can mix both, and dragging a flow block places it.
3. **Real DOM, 1280×720 units.** Text stays selectable, accessible and editable with the same TipTap engine as pages. Geometry maps 1:1 to PPTX.
4. **Everything is an object with an id.** Objects get stable ids, which animations, Morph, links and the MCP tools all use.
5. **Reuse before building.** Maintained MIT libraries for the hard interaction parts. PPTist (AGPL-3.0, same licence as Folio) is the behavioural reference, and any ported code is credited.
6. **Honest export.** What PPTX cannot hold is stated in the UI, not silently dropped.

## Format extensions (slides-md v2)

```markdown
::: box #title x=80 y=160 w=520 h=300 rotate=0 z=2 fill=#f2f2f2 radius=12 anim="fade-up@click"
## Placed title
Any Markdown: lists, images, charts, tables.
:::

::: shape #arrow type=arrow-right x=640 y=300 w=200 h=80 fill=#111 link="[[Pitch.slides#5]]"

::: smartart type=process
- Research
- Design
- Build
:::

![Photo](assets/a.jpg){x=700 y=120 w=480 h=320 crop=0,0,1,.8 alt="Team photo"}

<!-- transition: morph 0.8s -->
<!-- hidden -->
<!-- section: Results -->
```

Marp keeps working: it shows placed boxes as flow content. The loss of positioning in Marp is documented in FORMATS.md.

## Cross-document links (Folio references)

Any document can point at, embed or compute from any other document in the workspace.

| Kind | Syntax | Behaviour |
|---|---|---|
| **Link** | `[[Budget.sheet#Summary!B7]]` | Click to open the target and jump to the part. |
| **Value** | `{{Budget.sheet#Summary!B7}}` | Shows the computed result inline (text, number, formatted). Updates when the source changes. |
| **Embed** | `![[System.board]]`, `![[Pitch.slides#5]]`, `![[Budget.sheet#Summary!A1:D9]]` | Renders the target part in place: a board, a slide, a sheet range as a table, a page section. |
| **Synced copy** | `![[Pitch.slides#5]]{sync}` | Like Google's linked slides: a copy that shows "Source changed: Update / Unlink". |
| **Chart** | ` ```chart ` with `source: /Budget.sheet#Summary!A1:D9` | Already shipped. Joins the same resolver. |

Selectors by type: page `#Heading` or `^block-id`; slides `#3` or `#object-id`; board `#node-id`; sheet `#Sheet!A1:C9` or a named range.

Rules:
- References are plain text, so an AI can read them. An MCP tool resolves them on demand.
- Paths are relative to the document, or start with `/` for the workspace root.
- **Dependency index** in the main process (extends the chokidar watcher). A change in a source re-renders dependents. Cycles are detected and reported.
- **Rename and move rewrite inbound links** as minimal edits, in one undoable step.
- **Backlinks panel** and a **link graph** view. A **broken-link check** per document and per workspace.
- **Insert by picking**: type `[[` or `@`, fuzzy-search documents and their parts. "Copy link to selection" on any slide, object, node or cell range, then paste as link, embed, value or copy.
- **Sheets reference sheets**: `='Budget.sheet'!Summary!B7` (external references, with cycle detection).
- **Export bakes values.** PPTX, PDF and HTML contain the resolved results, and "Break link" freezes one.
- **Shared themes**: a deck can use `theme: [[Brand.theme]]`, so masters, fonts and colours live in one document.
- **Deck from page**: `source: [[Notes]]` builds slides from a page's headings, kept in sync.

## Libraries

| Need | Library | Licence |
|---|---|---|
| Drag, resize, rotate, snap guides, groups | [Moveable](https://github.com/daybrush/moveable) | MIT |
| Marquee and multi-select | [Selecto](https://github.com/daybrush/selecto) | MIT |
| Text in boxes | TipTap (in Folio) | MIT |
| Shapes, connectors, auto-layout | Board library and dagre (in Folio) | ours / MIT |
| Boolean shape ops (union, subtract, intersect) | [paper.js](https://github.com/paperjs/paper.js) or polygon-clipping | MIT |
| Icons | Lucide, Tabler, Phosphor (bundled sets) | MIT |
| Animations, motion paths | Web Animations API with SVG `offset-path` (no dependency) | native |
| PPTX export | pptxgenjs (in Folio) + our XML post-processing for animations and Morph | MIT |
| PPTX import | [pptxtojson](https://github.com/pipipi-pikachu/pptxtojson) | MIT |
| Image background removal | @imgly/background-removal (runs locally) | AGPL-3.0: check before adopting |
| 3D models | model-viewer / three.js (glTF) | MIT |
| Video and GIF export | ffmpeg.wasm or the system ffmpeg | LGPL |
| Speech (captions, coach) | Web Speech API / local Whisper, to be evaluated | — |
| Spelling | Electron's built-in spellchecker | — |
| Behaviour reference | [PPTist](https://github.com/pipipi-pikachu/PPTist) | AGPL-3.0 |

## What PowerPoint and Google Slides have, and where it lands

| Area | Features | Phase |
|---|---|---|
| **Home** | Layouts, reset slide, sections, fonts, paragraph, columns, text direction, quick styles, find/replace, selection pane | P2, P3, P8 |
| **Insert** | Text box, WordArt, shapes, lines and connectors, icons, images, screenshots, photo album, tables, charts, equations, symbols, video, audio, screen recording, 3D models, header/footer, date, slide number | P5 |
| **Insert, links** | Hyperlinks, Action buttons, Slide/Section/Summary Zoom | P11 |
| **Design** | Themes and variants, slide size, background format, Designer | P7, P9 |
| **Transitions** | 20+ transitions with options, duration, sound, advance on click or after N s, Morph | P10 |
| **Animations** | Entrance, emphasis, exit, motion paths, animation pane, triggers, delay, repeat, by paragraph, chart build, animation painter | P10 |
| **Slide Show** | From start/current, custom shows, kiosk/loop, rehearse timings, record narration, subtitles, presenter view, hide slide | P8, P11, P12 |
| **Review** | Spelling, accessibility checker, alt text, comments, translate, compare | P8, P14 |
| **View** | Outline, slide sorter, notes page, master views, guides, grid, ruler, zoom, greyscale, multiple windows | P8 |
| **Master** | Slide master, layouts, placeholders, theme fonts and colours | P7 |
| **Picture** | Crop to shape, aspect, corrections, colour, artistic effects, remove background, compress, replace, alt text | P6 |
| **Shape tools** | Merge shapes, edit points, freeform, ink to shape, rulers | P6 |
| **SmartArt** | Convert bullets to SmartArt, process/cycle/hierarchy/matrix/pyramid/list layouts | P9 |
| **Google Slides** | Linked charts and slides, smart chips and `@` mentions, audience Q&A, pen and laser, captions, "building blocks" (timeline, agenda), publish to web | P4, P9, P12, P13 |
| **Output** | PDF, handouts, notes pages, images, GIF, video, PPTX, outline | P13 |
| **Team** | Comments, version history, compare | P8, P14 |

## Phases

Each phase ships, is tested (round-trip tests, smoke test, screenshots) and closes its issue.

| # | Phase | Done when |
|---|---|---|
| **P0** | **Model.** Parse and serialise boxes, shapes, geometry, object ids, section/hidden/transition comments. FORMATS.md, round-trip tests. | Old decks are byte-identical; a corpus round-trips. |
| **P1** | **Canvas.** Select, drag, resize, rotate, marquee, modifiers, arrow nudge, smart guides and snapping, zoom and pan, undo/redo. | Each transform writes one minimal edit. |
| **P2** | **Arrange.** Align, distribute, z-order, group, lock, duplicate, copy/paste across slides, place a flow block, selection pane, guides, grid and ruler. | The Arrange menu matches PowerPoint. |
| **P3** | **Text.** Inline TipTap in boxes: font, size, colour, highlight, alignment, spacing, lists, columns, autofit, vertical align, WordArt effects. | Edit text on the canvas without code. |
| **P4** | **Links engine.** Reference syntax, resolver, dependency index, link, value, embed and synced copy, backlinks, rename rewrite, broken-link check, `[[` picker, external sheet references. | A slide shows a live sheet value, an embedded board and a linked slide; rename keeps them intact. |
| **P5** | **Insert.** Shapes and connectors that follow, images, tables (merge cells, styles), charts (more types), icons, equations, code, video, audio, screen recording, 3D (glTF). | The Insert ribbon covers PowerPoint's. |
| **P6** | **Format and tools.** Fill, gradient, border, shadow, glow, reflection, opacity, radius. Picture crop to shape, corrections, remove background, replace. Merge shapes, edit points, freeform, ink to shape. | Every visual property is reachable without code. |
| **P7** | **Themes and masters.** Theme fonts and colours, variants, editable masters and layouts with placeholders, backgrounds, slide size, font embedding, shared `.theme` documents. | A brand lives in one document used by many decks. |
| **P8** | **Slide management.** Sorter, outline view, sections, hide slide, reuse slides from other decks, find/replace, notes page, comments, version history and compare (text diff), accessibility checker, spellcheck, multiple windows. | Large decks stay manageable. |
| **P9** | **SmartArt and Designer.** Diagram generators from lists (process, cycle, hierarchy, matrix, pyramid, timeline, funnel, Venn) that can be converted to free shapes; layout suggestions from rules, then AI; building blocks (agenda, timeline, comparison). | "Convert to SmartArt" and "Design ideas" both work offline. |
| **P10** | **Motion.** Transitions (20+) and Morph by object id; entrance, emphasis, exit and motion-path animations; animation pane with timeline, triggers, delay, repeat, build by paragraph or chart series, animation painter. | Animations play in present mode and survive a round-trip through the file. |
| **P11** | **Interactivity.** Hyperlinks and actions on any object, Zoom (slide, section, summary), custom shows, buttons, kiosk and loop. | A deck can be navigated non-linearly. |
| **P12** | **Present and record.** Presenter view (timer, next slide, notes), pen, highlighter and laser, magnifier, black and white screen, rehearse timings, narration recording, live captions, audience Q&A and polls over the local network with a QR code. | Parity with presenter view and Google's audience tools. |
| **P13** | ✅ (export, import, templates, handouts) · **Interop.** PPTX export at 1:1 geometry with native animations and transitions (our XML post-processing), PPTX import via pptxtojson, handouts and notes pages, PNG/SVG/GIF/video, PDF, Google Slides through PPTX. | A reference deck survives import then export. |
| **P14** | **AI and MCP.** Geometry tools (`add_object`, `move_object`, `restyle`), link tools (`resolve_ref`, `get_backlinks`, `find_broken_links`, `rewrite_links`), alt-text and notes generation, translate deck, Designer ideas via the AI. | An agent builds a positioned, linked deck end to end. |
| **P15** | **Polish.** Keyboard-only editing, screen reader names, 200-slide performance, 60 fps drag, visual regression screenshots in CI. | No regressions; WCAG 2.2 AA. |

Order: P0 → P1 → P2 → P3 is "put things where I want". P4 comes next because links change the data model for everything after it. P5–P9 make it complete, P10–P12 add motion and delivery, and P13–P15 bring parity and polish.

## Execution plan for P10–P15 (v3, November 2026)

**Status: all increments done on the `slides-p10-p15` branch and released as 1.2.0.**

Each increment ships with a format change in FORMATS.md, an automated test (format round-trip or in-app test that checks the file on disk) and a screenshot check. Work happens on the `slides-p10-p15` branch, merged by pull request, then released as 1.2.0.

| Inc. | Scope | Test |
|---|---|---|
| **10.1** | Motion model: `transition:` (24 effects, duration, Morph) and `animate:` lines (entrance, emphasis, exit, motion path; click, with, after; delay, repeat, by paragraph) parsed and written back. | Round-trip, byte-identical. |
| **10.2** | Present engine in its own module: build steps, transitions between two layers, Morph by object id, back and forward through steps. | In-app: steps and slides advance in order. |
| **10.3** | Animations pane: transition for the slide or all, add, change, reorder and remove animations for the selection, order badges on the canvas, Preview. | In-app: pane edits write the expected lines. |
| **10.4** | PowerPoint: transitions and animations exported natively (`p:transition`, `p:timing`); transitions imported. | Package XML check, import check. |
| **11.1** | `link=` on any object: web, slide number, first/last/next/previous, end show, another Folio document. Works when presenting; exported as PowerPoint hyperlinks. | Format + in-app click. |
| **11.2** | Zoom objects (`::: zoom slide=` and `section=`), summary zoom from sections; jump and return when presenting. | Format + in-app. |
| **11.3** | Custom shows (`show-<name>:` in front matter), loop and kiosk (`loop: true`), auto-advance (`advance:`), rehearse timings writes it. | Format + in-app. |
| **12.1** | Presenter view: current, next, notes, timer, clock, slide counter, audience window on a second display. | In-app. |
| **12.2** | Pen, highlighter, laser, eraser, black and white screens, magnifier, go-to-slide. | In-app. |
| **12.3** | Narration recording per slide (saved as audio objects), audience Q&A over the local network with a QR code. | In-app (recording mocked), HTTP check. |
| **14.1** | MCP geometry tools: `list_slide_objects`, `add_object`, `move_object`, `restyle_object`, `remove_object`, `set_animation`, `set_transition`, `rewrite_links`. | MCP test. |
| **14.2** | MCP content tools: `set_alt_text`, `set_speaker_notes`, `get_design_ideas`, `apply_design_idea`; agent recipe for translating a deck. | MCP test. |
| **15.1** | Keyboard-only editing (Tab through objects, Enter to edit text), names for screen readers, canvas zoom and pan, Alt-drag to copy. | In-app. |
| **15.2** | 200-slide deck stays fast (thumbnail virtualisation, measured); visual regression screenshots in CI. | Perf test, screenshot diff. |
| **R** | Docs, README, pull request, CI green, merge, release 1.2.0. | Release assets on GitHub. |

## Not planned (and why)

- **Real-time co-authoring.** Folio works on files, so teams share through Git or a synced folder. A CRDT layer (Yjs) can come later.
- **Real SmartArt (`.dgm`) export.** SmartArt exports as grouped native shapes, which look the same and stay editable.
- **Cloud-only extras** (Copilot, Cameo, stock-photo search, password protection). The MCP connection covers AI, and stock images arrive through the user's own AI tools.
