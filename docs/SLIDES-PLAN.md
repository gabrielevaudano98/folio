# Slides Studio — plan to PowerPoint-level editing

Goal: the slides editor becomes a full WYSIWYG canvas. The user can put anything anywhere and has full control.
The file stays plain, readable slides-md that an AI can write, and remains lossless when round-tripped through the visual editor.

## Principles

1. **The file is the truth.** Every action in the canvas is a minimal text edit on the `.slides.md`, the same rule as boards and sheets. Slides that were not touched keep their bytes.
2. **Two kinds of content on a slide.** *Flow* content is ordinary Markdown laid out by the slide's layout, which is today's behaviour. *Placed* content is boxes with explicit geometry. A slide can mix the two, and dragging a flow block "places" it.
3. **Real DOM, not a bitmap canvas.** Text stays selectable, accessible and editable with the same TipTap engine as pages. Geometry is in slide units (1280×720), so it maps 1:1 to PPTX.
4. **Reuse before building.** Use maintained MIT libraries for the hard interaction parts. Use PPTist (AGPL-3.0, Vue) as the behavioural reference: its licence is compatible with ours, and any code we port gets credited.

## Format extension (slides-md v2)

```markdown
::: box x=80 y=160 w=520 h=300 rotate=0 z=2 fill=#f2f2f2 radius=12
## Placed title
Any Markdown: lists, images, charts, tables.
:::

::: shape type=arrow-right x=640 y=300 w=200 h=80 fill=#111 :::

![Photo](assets/a.jpg){x=700 y=120 w=480 h=320 crop=0,0,1,0.8}
```

- Units are slide pixels on a 1280×720 canvas. `size: 4:3` scales them.
- Marp compatibility: Marp shows placed boxes as normal flow content, so a deck still presents in Marp, just without free positioning. This gets documented in FORMATS.md.

## Libraries

| Need | Library | Licence |
|---|---|---|
| Drag, resize, rotate, snap guides, group transforms | [Moveable](https://github.com/daybrush/moveable) (vanilla) | MIT |
| Marquee and multi-select | [Selecto](https://github.com/daybrush/selecto) | MIT |
| Text inside boxes | TipTap (already in Folio) | MIT |
| Shapes | Folio board shape library (already built) | ours |
| PPTX export | pptxgenjs (already in Folio) | MIT |
| PPTX import | [pptxtojson](https://github.com/pipipi-pikachu/pptxtojson) | MIT |
| Behaviour reference | [PPTist](https://github.com/pipipi-pikachu/PPTist) | AGPL-3.0 |

## Phases (each one ships, is tested and closes its issue)

| # | Phase | Done when |
|---|---|---|
| S0 | **Model**: parse and serialise `::: box`, `::: shape` and image geometry; lossless round-trip tests; FORMATS.md | Round-trip corpus passes; old decks are byte-identical |
| S1 | **Canvas**: select, drag, resize, rotate, marquee, shift/alt modifiers, arrow-key nudge, smart guides and snapping to edges, centres and other boxes | Every transform writes one minimal edit; undo/redo |
| S2 | **Arrange**: align, distribute, z-order, group/ungroup, lock, duplicate, copy/paste across slides, "place" a flow block | Same as PowerPoint's Arrange menu |
| S3 | **Text in boxes**: inline TipTap with font, size, colour, highlight, alignment, line spacing, lists, autofit/shrink-on-overflow, vertical align | Edit text on the canvas without opening code |
| S4 | **Insert**: shapes and lines/arrows (connectors that follow), images (crop, replace, mask), tables, charts, icons, video/audio, maths, text box | Insert ribbon matches Google Slides |
| S5 | **Format pane**: fill, gradient, border, shadow, opacity, radius, padding; theme and master editing; editable layouts; backgrounds; slide size | Every visual property is reachable without code |
| S6 | **Slide operations**: sorter grid, sections, hide/skip, duplicate, transitions, element animations with build order and a timeline | Animations play in present mode and export to PPTX where supported |
| S7 | **Present**: presenter view with timer, next slide and notes, laser pointer, pen, black/white screen, rehearsal | Parity with PowerPoint's presenter view |
| S8 | **Interop**: PPTX export at 1:1 geometry, PPTX import through pptxtojson into slides-md, Google Slides through PPTX, PDF | Import, then export, of a reference deck looks the same |
| S9 | **AI and MCP**: tools such as `add_slide_element`, `move_element` and `restyle_slide`; the AI sees geometry as text | An agent can build a positioned deck end to end |
| S10 | **Polish**: accessibility (keyboard-only editing, screen reader names), performance on 200-slide decks, visual regression shots in CI | No regressions; 60 fps drag |

Order: S0 → S1 → S2 → S3 come first, because that is "put things where I want". S4–S5 make it complete, S6–S8 bring parity, and S9–S10 add the edge.
