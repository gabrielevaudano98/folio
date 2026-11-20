# Folio formats

Every Folio document is a Markdown file. The type comes from the file name.

| File name | Type | Visual view |
| --- | --- | --- |
| `name.md` | Page | Word-style editor |
| `name.slides.md` | Slides (slides-md) | Slide editor, presenter, PowerPoint and PDF export |
| `name.board.md` | Board (board-md) | draw.io-style canvas |
| `name.sheet.md` | Sheet (sheet-md) | Excel-style grid, Kanban |

## References between documents

Any document can point at a part of another one. References are plain text, so they work in pages, slides (flow text and boxes), and anything an AI writes.

| Write | Shows |
|---|---|
| `[[Budget.sheet#Costs!H6]]` or `[[Budget.sheet#Costs!H6\|the total]]` | a link; Ctrl/⌘ click opens the document at that part |
| `{{Budget.sheet#Costs!H6}}` | the live value, formatted like the cell (e.g. €28,050.00) |
| `![[Budget.sheet#Costs!A1:H5]]` | the part drawn in place |

- Target: a document name (`Budget`, `Budget.sheet`), a file name (`Budget.sheet.md`), a path relative to this document, or a path from the workspace root (`/Finance/Budget.sheet.md`).
- Parts: sheets `Sheet!A1`, `Sheet!A1:D9`, `A1` (first sheet) or `Sheet` (whole sheet); slides `3` (slide number, value is its title); boards nothing (whole board) or a shape id (value is its label); pages `Heading text` (a section) or `^block-id`.
- Values and embeds update when the source changes. Renaming or moving a document in Folio (or with the `move_note` tool) rewrites every reference to it.
- References inside code spans and code fences are text.
- In sheet formulas a reference is a value: `={{Budget.sheet#Costs!H6}}*1.22`, `=SUM({{Budget.sheet#Costs!D2:D5}})`. A missing target or a loop between documents gives `#REF!`.
- Synced slide copies: a slide that starts with `<!-- source: Pitch.slides#2 -->` is a copy of that slide. Folio shows when the source has changed and offers Update (replace this slide with the source) or Unlink (remove the comment).
- MCP tools: `resolve_ref`, `get_backlinks`, `find_broken_links`.

## slides-md

A superset of [Marp](https://marp.app) Markdown. A Marp deck opens as is.

```markdown
---
marp: true
theme: folio          # folio | graphite | paper (Marp default, gaia, uncover map to these)
size: 16:9            # or 4:3
paginate: true
footer: Company, 2027
---

<!-- layout: title -->
# Title of the talk

Subtitle

---

## A normal slide

- Bullet
- Bullet

<!--
Any other HTML comment is a speaker note.
-->

---

<!-- layout: two-columns -->
## Compare

::: left
Left column
:::

::: right
Right column
:::

---

![bg right:40%](assets/photo.jpg)

## Text with a picture on the right
```

- Slides are separated by a line with `---`.
- Directives (Marp): `theme`, `paginate`, `header`, `footer`, `class`, `backgroundColor`, `backgroundImage`, `color`. Without `_` they apply to this and following slides, with `_` (for example `<!-- _class: invert -->`) to this slide only.
- Folio layouts, per slide: `<!-- layout: X -->` with X one of `default`, `title`, `section`, `two-columns`, `image-right`, `image-left`, `quote`, `big-number`, `cards`, `blank`.
- Blocks: `::: left`, `::: right`, `::: columns` with `::: column` inside, `::: card`, `::: center`, `::: note`, `::: small`, `::: big`.
- Backgrounds (Marp): `![bg](img)`, `![bg left](img)`, `![bg right:40%](img)`, `![bg contain](img)`, filters `grayscale`, `blur`, `brightness:0.5`.

### Themes, masters and templates

How to build a template, step by step: [TEMPLATES.md](TEMPLATES.md).

Front matter can set theme tokens; Marp ignores them:

```yaml
paper: "#fafaf7"        # slide background
ink: "#1f1f1f"          # text
muted: "#666666"        # secondary text
accent: "#0a5c36"       # links and accents
card: "#f2f2f2"         # cards
heading-font: Georgia
body-font: Inter
fonts: assets/Inter-Regular.woff2, assets/Inter-Bold.woff2   # font files; family and weight come from the file name
size: 16:9              # 16:9, 4:3, 16:10, 1:1, 9:16, A4, A4-portrait
template: Brand.slides  # take theme, tokens, fonts and masters from another deck
```

- A slide starting with `<!-- master -->` is a master: its placed objects and background appear behind every slide. `<!-- master: title -->` applies only to slides with that layout. Masters are not numbered, presented or exported, and the flow text on a master is a note for the author.
- Placeholders: in a master, `::: box placeholder=title|subtitle|body x= y= w= h= size= …` places and styles the slide's first heading (title) and the rest of its text (body, or subtitle when there is no body placeholder). `<!-- master: title only -->` leaves out the all-slides master on title slides. A master's own background applies to its slides.
- With `template:`, the template's front matter is the base (the deck's own keys win) and the template's masters come before the deck's own.
- Slide backgrounds: `<!-- _backgroundColor: #f2f2f2 -->` or `<!-- _backgroundImage: linear-gradient(135deg, #ffffff, #d9d9d9) -->` for one slide, the same keys in front matter for all slides, or `![bg](picture.jpg)`.

### Sections, hidden slides and comments

- `<!-- section: Results -->` starts a section at this slide; it runs until the next section.
- `<!-- hidden -->` keeps a slide in the deck but leaves it out of presenting and exports. It keeps its number.
- `<!-- comment (Ana, 2026-11-19): Check these numbers -->` is a review comment on the slide. Author and date are optional. Comments are not speaker notes; Resolve deletes the line.

### Transitions and animations

```markdown
<!-- transition: push-left 0.6s -->

::: box #claim x=80 y=160 w=520 h=300
...
:::

<!--
animate: #claim fade-in
animate: #chart fly-in-up after 0.4s delay=200ms
animate: body appear by=paragraph
-->
```

- `transition:` applies to the slide it is on (front matter `transition:` sets the deck default). Names: `none`, `fade`, `fade-black`, `dissolve`, `push-left|right|up|down`, `wipe-left|right|up|down`, `cover-left|right`, `uncover-left|right`, `split`, `reveal`, `zoom`, `zoom-out`, `iris`, `clock`, `blinds`, `flip`, `cube`, `fall`, `morph`. An optional duration follows (`0.6s`, `800ms`; default 0.5s).
- **Morph:** objects with the same `#id` on the previous slide glide to their new place and size; everything else cross-fades.
- `animate:` lines live in one comment at the end of the slide, in build order. Each line: target (`#id` or `body` for the slide text), effect, then in any order: trigger `click` (default), `with` (with the previous) or `after` (after the previous ends); a duration; `delay=`; `repeat=2` or `repeat=loop`; `by=paragraph` (one click per paragraph or list item); `path=dx,dy` for `path-custom`.
- Effects. Entrance: `appear`, `fade-in`, `zoom-in`, `grow-in`, `fly-in-left|right|up|down`, `float-in`, `wipe-in`, `spin-in`, `bounce-in`. Emphasis: `pulse`, `spin`, `grow`, `teeter`, `flash`, `shake`. Exit: `disappear`, `fade-out`, `zoom-out`, `fly-out-left|right|up|down`, `wipe-out`. Motion paths: `path-left|right|up|down|arc|custom`.
- Objects whose first animation is an entrance start hidden. An unchanged line is written back exactly as typed. Marp ignores both (they are comments).

### Links, zooms and how a show runs

```markdown
---
show-short: 1, 3, 5-7      # a custom show: slide numbers, ranges allowed
loop: true                 # start again after the last slide
kiosk: true                # loop, and only links and Esc work (for a stand or a screen)
advance: 8s                # deck default for auto-advance
---

<!-- advance: 5s -->       # this slide moves on by itself after its builds

::: box #cta x=80 y=520 w=320 h=80 link=next
Continue
:::

::: zoom #z1 x=80 y=180 w=384 h=216 section=Results :::
::: zoom #z2 x=520 y=180 w=384 h=216 slide=7 return=false :::
```

- `link=` on any placed object: `next`, `prev`, `first`, `last`, `back` (last slide viewed), `end`, `slide:7`, a web address (`https://…`, `mailto:…`) or a Folio document (`"[[Budget#Totals]]"`). Links work when presenting; web addresses and slide jumps export as PowerPoint hyperlinks.
- `::: zoom` shows a live copy of a slide (`slide=` number) or of a section's first slide (`section=`). When presenting, a click zooms into it; a section zoom plays the section, then comes back (`return=false` stays). Insert → Summary zoom makes a slide with one zoom per section. In PowerPoint a zoom becomes a card that jumps to its slide.
- Custom shows appear in the Present menu. `advance:` (per slide or for the deck) and `loop`/`kiosk` also apply in PowerPoint (`advTm`).

### Presenting

- **Present** starts full screen from the current slide; the ▾ menu adds From the beginning, **Presenter view**, **Rehearse timings** and custom shows.
- Keys: → Space Enter next, ← previous, Home/End, a number then Enter jumps to that slide, B black screen, W white screen, + and − magnifier, Ctrl+P pen, Ctrl+I highlighter, Ctrl+E eraser, Ctrl+L laser, Ctrl+A arrow, E erases the ink on the slide, Esc ends (or leaves a tool first).
- **Presenter view:** the live slide, the next slide (or the next build), speaker notes with A− / A+, elapsed time with pause and reset, the clock and the tools. **Audience window** opens the show full screen on a second display and keeps it in step.
- **Rehearse timings** records the time spent on each slide; keep them and each slide gets `<!-- advance: Ns -->`.
- **Q&A** opens a page on the local network (address and QR code in the presenter view); questions appear beside the notes. It listens only while Q&A is open and keeps questions in memory.
- **Record narration** records one audio clip per slide from the microphone and adds it to the slide as `::: media #narration … autoplay=true :::`.

### PowerPoint in and out

- **Export to PowerPoint** (File menu) renders each slide at its real size and measures it, so the .pptx matches Folio: text frames keep position, fonts, sizes, colours and spacing; placed objects become native shapes, lines and arrows, freeforms, pictures (crop kept), tables, charts, video and audio; masters become slide layouts with title, subtitle and body placeholders; the deck's tokens become the theme colours and fonts. Hidden slides stay hidden, sections and speaker notes are kept. Gradients are drawn as pictures. Fonts are named, not embedded: the portable family of a font stack is used (`Segoe UI` for the system stack, `Georgia` for serif, `Consolas` for mono).
- **Handouts and notes pages** (File menu) are PDFs on A4: 1, 2, 3, 4, 6 or 9 slides a page (3 a page adds lines for notes), or one slide a page with its speaker notes.
- **Import PowerPoint** reads a `.pptx` into a new deck next to the open note, with pictures and media saved in `assets/`: each PowerPoint layout in use becomes a `<!-- master: … only -->` with its shapes, background and placeholders; titles and body text become ordinary Markdown in the flow; everything else becomes placed objects at the same geometry (scaled to the nearest Folio size); hidden slides, sections and speaker notes come across. A `.potx` becomes a template in `Templates/` (its layouts as masters, one sample slide each), ready in New from template.
- Layouts map by type or name: title → `title`, section header → `section`, two content or comparison → `two-columns`, blank → `blank`, title only → `title-only`, everything else → `default`.

### Placed objects (slides-md v2)

Content is laid out by the slide's layout (flow). Objects with explicit geometry sit on top, in slide pixels on a 1280×720 canvas (960×720 for `size: 4:3`), origin top left.

```markdown
::: box #claim x=80 y=160 w=520 h=300 rotate=0 z=2 fill=#f2f2f2 radius=12
### Any Markdown
- lists, images, charts, tables
:::

::: shape #dot type=ellipse x=700 y=220 w=200 h=200 fill=#111

Optional label
:::

![Photo](assets/a.jpg){x=960 y=200 w=240 h=240 crop=0,0,1,.8 alt="Team"}
```

- `::: box` holds Markdown. `::: shape` draws one of the board shapes (`type=`: `rect`, `rounded`, `ellipse`, `diamond`, `triangle`, `star`, `cloud`, `cylinder`, ...) with the body as its label. A shape may also be written on one line: `::: shape type=rect x=0 y=0 w=100 h=60 :::`.
- `#id` is optional and stable; animations, links and tools refer to it. Without an id an object is addressed by its order.
- Attributes: `x y w h` (px), `rotate` (degrees), `z` (stacking, default 0), `fill`, `color` (text), `radius`, `border`, `stroke`, `opacity` (0..1). Images take them in curly braces after the image; `crop=x,y,w,h` is the visible part as fractions of the picture; `fit=cover|contain`. Unknown attributes are kept.
- Text attributes (boxes and shape labels): `font` (`sans`, `serif`, `mono`, `rounded` or a font name), `size` (px), `color`, `align` (`left`, `center`, `right`, `justify`), `valign` (`top`, `middle`, `bottom`), `line` (line height, e.g. `1.4`), `fit=shrink` (shrink text until it fits). Bold, italic, lists, headings and links are ordinary Markdown in the body.
- Lines and connectors: `::: line #id x=100 y=100 w=300 h=0 head=arrow :::` draws from (x, y) to (x+w, y+h); `w` and `h` may be negative. `from=` and `to=` attach an end to another object by id, optionally with a side (`from=a.right to=b.left`); without a side Folio picks the facing sides, and the line follows when the objects move. Options: `head=arrow`, `tail=arrow`, `stroke=#111`, `width=3`, `dash=true`, `route=elbow`.
- Icons: `::: icon #id name=rocket x= y= w= h= color=#111 weight=2 :::` (any [Lucide](https://lucide.dev) icon name).
- Video and audio: `::: media #id src=assets/clip.mp4 x= y= w= h= poster=assets/still.jpg loop=true muted=true :::`.
- Diagrams (SmartArt): `::: smartart #id type=process x= y= w= h= fill=#0a5c36` with a Markdown list as the body; indented items are sub-items (children in a hierarchy, details elsewhere). Types: `process`, `chevron`, `cycle`, `timeline` (items like `2026: Launch`), `hierarchy`, `pyramid`, `funnel`, `matrix`, `venn`, `list`, `stack`. Screen readers get the list.
- Tables, charts, equations and code are boxes with a Markdown table, a ` ```chart ` block, `$$ … $$` or a code block inside.
- Format attributes (any placed object): `fill=#f2f2f2`, `fill=none`, `fill=linear(#111,#888,90)` (angle in degrees, as in CSS), `fill=radial(#fff,#ccc)`; `stroke=#333 border=2 dash=true` (boxes, shapes, pictures, free shapes); `shadow=soft|medium|hard|glow`; `opacity=0.6`; `flip=h|v|hv`.
- Picture attributes: `mask=circle|ellipse|rounded|diamond|hexagon|triangle|star` (crop to shape), `crop=x,y,w,h` (visible part, fractions), `adjust=brightness:1.1,contrast:1.2,saturate:0.8,grayscale:1,blur:2`, `radius=12`, `alt="…"`.
- Free shapes: `::: path #id x= y= w= h= points="0,0 1,0 0.5,1" closed=true smooth=true :::` with points as fractions of the box (drawn with Insert, Freeform; points editable on the slide), or `d="M…Z"` for an outline made by Merge shapes (even-odd).
- Arrange attributes: `group=name` (objects with the same group are selected and moved together), `lock=true` (cannot be selected on the canvas).
- Only top-level objects are placed. Containers nested in a box (`::: note`, `::: card`) are ordinary content. Objects inside code fences are text.
- Editing the canvas rewrites only the opener line (or the image line) of the moved object. Everything else is untouched.
- Marp shows boxes as ordinary content in reading order, without positioning.

## board-md

One fenced block named `board`. Each line is a shape or a connector.

````markdown
```board
// shapes: id: shape "Label" @x,y WxH {style}
api: component "Orders API" @400,100
db: cylinder "Orders DB" @640,100
user: actor "Customer"                   // no position: placed by auto layout
Order: class "Order" @60,420 [
  + id: UUID
  --
  + pay(): void
]
customer: table "customer" @560,420 [
  id uuid PK
  email text
]

// connectors: from -> to "label" {style}
user -> api "HTTPS"
api -> db "SQL" {route: curved}
Order ..|> Payable
Order *-- Line "1..*"
```
````

- Shapes: rect, rounded, ellipse, circle, diamond, triangle, hexagon, parallelogram, trapezoid, star, cloud, cylinder, document, note, callout, step, cube, cross, text; flowchart terminator, predefined, manual, delay, connector, offpage; UML class, interface, actor, usecase, package, component, lifeline, state, initial, final, activity, fork, frame; ER table; architecture server, queue, browser, mobile; containers group, swimlane.
- Connectors: `->` arrow, `-->` dashed arrow, `--` line, `..` dashed line, `<->` both ends, `-|>` inheritance, `..|>` realization, `*--` composition, `o--` aggregation, `..>` dependency. Pick a side with `a.right -> b.left`.
- Shape style: `fill`, `stroke`, `color`, `line: dashed|dotted`, `width`, `size`, `bold`, `align: left|right`.
- Connector style: `route: orthogonal|straight|curved`, `stroke`, `width`, `line`, `start`, `end` (arrow, open, triangle, diamond, diamondOpen, circle, none).
- Class and table bodies go between `[` and `]`; `--` separates class compartments; table rows are `name type KEY`.

## sheet-md

Each `## Heading` followed by a Markdown table is one sheet. Row 1 (the header row) is row 1, so `A1` is the first header cell.

```markdown
## Costs

| Item   | Q1   | Q2   | Total        |
| ------ | ---- | ---- | ------------ |
| Design | 1200 | 800  | =SUM(B2:C2)  |
| Total  | =SUM(B2:B2) | =SUM(C2:C2) | =SUM(D2:D2) |

<!-- sheet: {"cols":{"B":{"format":"currency"},"D":{"format":"currency","bold":true}}} -->
```

- A cell that starts with `=` is a formula, Excel syntax: `SUM`, `AVERAGE`, `IF`, `IFS`, `IFERROR`, `COUNTIF`, `SUMIF`, `VLOOKUP`, `HLOOKUP`, `XLOOKUP`, `INDEX`, `MATCH`, `ROUND`, `TEXTJOIN`, dates, finance and about 380 more. `$` locks a reference. Write a pipe inside a cell as `\|`.
- The optional `<!-- sheet: {...} -->` comment right after a table holds formatting: `cols` and `cells` with `format` (`number`, `integer`, `currency`, `usd`, `percent`, `date`, `text`), `bold`, `italic`, `align`, `width`; `view: "kanban"` and `kanbanBy` (column index) for the Kanban view.
- Values are not stored, only formulas. Through MCP, `get_sheet_values` returns the computed values.
