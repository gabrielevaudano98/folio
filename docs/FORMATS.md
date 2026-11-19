# Folio formats

Every Folio document is a Markdown file. The type comes from the file name.

| File name | Type | Visual view |
| --- | --- | --- |
| `name.md` | Page | Word-style editor |
| `name.slides.md` | Slides (slides-md) | Slide editor, presenter, PowerPoint and PDF export |
| `name.board.md` | Board (board-md) | draw.io-style canvas |
| `name.sheet.md` | Sheet (sheet-md) | Excel-style grid, Kanban |

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
