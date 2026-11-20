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

## Pages

A page is plain Markdown (CommonMark, GFM, Obsidian syntax) plus a few extensions. Write it as you would anywhere else.

| What | Markdown | Notes |
| --- | --- | --- |
| Bold, italic, strike, code, link | `**b**` `*i*` `~~s~~` `` `c` `` `[text](url)` | |
| Underline | `<u>text</u>` | |
| Highlight | `==text==` | |
| Superscript, subscript | `E = mc<sup>2</sup>`, `H<sub>2</sub>O` | |
| Inline maths | `$e^{i\pi} + 1 = 0$` | KaTeX. No space after the opening `$` or before the closing one, no digit right after it, so `$5 and $10` stays text. |
| Maths block | `$$` on its own line, the formula, `$$` | |
| Footnote | `Claim[^1]` and, anywhere, `[^1]: Source text.` | Labels can be words: `[^source]`. |
| Inline footnote | `Claim^[Source text.]` | |
| Hidden comment | `%%only in the file%%` | Not shown in Read view or exports. |
| Callout | `> [!tip] Title` then `> body` | GitHub and Obsidian types: note, abstract (summary, tldr), info, todo, tip (hint), success (check, done), question (help, faq), warning (attention), important, failure (fail, missing), danger (error), caution, bug, example, quote (cite). Unknown types are notes. `[!tip]-` starts folded, `[!tip]+` can fold. |
| Notion callout (icon, colour) | `> [!callout|💡 yellow] Title` | Obsidian metadata after `|`: an emoji and/or a colour from the list below. Works on any type. |
| Toggle | `<details>`, `<summary>Title</summary>`, a blank line, the content, `</details>` | `<details open>` starts open. Toggles can nest. |
| Toggle heading | `<summary><h2>Title</h2></summary>` inside a toggle | h1 to h3. |
| Columns | `:::: columns`, then two to five `::: column` … `:::`, then `::::` | The outer fence has four colons so it can hold the inner ones. |
| Table of contents | `[TOC]` on its own line | Live list of the page's headings. |
| Breadcrumb | `[BREADCRUMB]` on its own line | Where the page sits in the workspace. Folio only. |
| Page break | `<div class="page-break"></div>` | A new page in print and PDF export. |
| Image with width and caption | `![Alt|400](.asset/3fa9c1d2-photo.png "Caption")` | Width in pixels after `|` (Obsidian); the title is the caption. |
| Video, audio | `![Demo](.asset/9be41c07-clip.mp4)`, `![](.asset/1c0d5e22-talk.mp3)` | Image syntax with a media file: mp4, webm, mov, m4v; mp3, m4a, wav, ogg, aac, flac. |
| PDF | `![Annual report](.asset/77ab0e91-report.pdf)` | A card that opens the file. |
| Web embed | `![](https://www.youtube.com/watch?v=…)` | YouTube, Vimeo, Loom, Figma, Google Maps and Drive, Miro, X, CodePen, Gist, Spotify, SoundCloud, Excalidraw, Canva: a card that opens in the browser (Folio does not load other sites inside the page). |
| Web bookmark, file | a paragraph that is only a link: `[https://site.com](https://site.com)`, `[budget.xlsx](.asset/d20f6a3b-budget.xlsx)` | Drawn as a card. |
| Code block | ```` ```python ```` | Coloured as in the Read view; the language is chosen from the block's menu. |
| Wiki link | `[[Note]]`, `[[Note#Heading|label]]` | |
| Block id, link to a block | `A paragraph. ^abc123`, then `[[Note#^abc123]]` | Obsidian syntax. For a table, quote or code block the id is a line `^abc123` after it. **Copy link to block** adds one. |
| Link to a day | `[[2026-11-21]]` | The daily note, `Journal/2026-11-21.md`, made when you first open it. `@tomorrow`, `@next friday` and `@domani` write it. |
| Link to a person | `[[Ada Lovelace]]` | A note in a `People/` folder; shown as a person chip. |
| Tag | `#project`, `#project/alpha` | Starts after a space, has a letter, may contain `-`, `_`, `/`. Also read from front matter `tags:`. Not in code. |
| Status chip, inline field | `[status:: In progress]`, `[owner:: Ada]` | Dataview inline field. `status` is a coloured chip (Not started, In progress, Blocked, Done; other words are grey). |
| Emoji | `😄` | The character itself. `:smile` in the Write view looks it up. |
| Table column alignment | `\| :--- \| :---: \| ---: \|` | GFM. Set from a column's menu or the Table tab; sorting, moving rows and columns rewrite only the table. |
| Properties | YAML front matter: `title: Text`, `count: 3`, `done: true`, `due: 2026-12-01`, `tags: [a, b/c]`, `owner: "[[Ada]]"` | Edited as fields above the title; only the changed property's lines are rewritten. Nested maps are kept and shown read-only. |
| Template button (Folio) | ```` ```template-button ```` with `label: New meeting`, `template: Meeting notes`, optional `where: above` | Drawn as a button; inserts the template from `Templates/` (or a starter). Other editors show a code block. |
| Suggested insertion, deletion, replacement | `{++new text++}`, `{--old text--}`, `{~~old~>new~~}` | CriticMarkup. Accept or reject in the review pane; Suggesting mode writes them as you type. |
| Comment | `{==quoted text==}{>>Ada, 2026-11-20 14:05: Comment<<}` | CriticMarkup. The `Author, date time:` prefix is optional; comments that follow each other are replies. |
| Text colour, background (Folio) | `[text]{color=red}`, `[text]{bg=yellow}`, `[text]{color=blue bg=yellow}` | Colours: gray, brown, orange, yellow, green, blue, purple, pink, red. |
| Alignment (Folio) | a paragraph, then `{align=center}` on the next line; a heading: `## Title {align=right}` | left, center, right, justify. |

The Write view has pickers for these: `[[` (pages, people, `Note#` headings, `Note#^` blocks, "Create"), `@` (people, pages, dates in English and Italian, status), `#` (tags in the workspace) and `:` (emoji). They only insert the plain text above.

### Assets (`.asset`)

Pictures, video, audio, PDFs, fonts and attachments live in a hidden `.asset` folder next to the page that first used them. A reference is an ordinary relative path in the Markdown (`![](.asset/3fa9c1d2-photo.png)`, `../.asset/…` from a sub-folder), so the file stays portable and any editor can read it.

- **Names.** `<8 hex of the content hash>-<name>`: the same bytes are stored once (pasting a picture twice, or the same file into two pages, reuses the file). Writes are atomic (temp file, then rename). One file is at most 250 MB.
- **Hidden and protected.** The folder starts with a dot, so the tree, search, tags and backlinks never list it, and Folio also sets the hidden attribute on Windows and macOS. Folio refuses to rename, move, create or trash a path inside `.asset`. The operating system can still delete it: Folio then reports which files a page is missing (on open and when the window regains focus).
- **Removing a picture from a page** asks once whether to remove the file too, only if no other page uses it. The choice can be remembered (move to the asset trash, delete permanently, or keep). Nothing is removed while you can still press Undo: the question appears about two seconds after the save, and a reference that comes back cancels it.
- **Asset trash.** `.asset/.trash/<time>~<name>`, purged after 30 days. A reference to a file that is gone (Undo after removing it, restoring an old version) brings it back from there automatically.
- **Moving a page** to another folder copies the files it uses into the new folder's `.asset` and rewrites its references.
- **Old workspaces.** `assets/` references keep working. *Files: clean up unused files…* lists unused and missing files and moves `assets/` into `.asset` (a version of every changed page is kept first; the old files go to the asset trash).

### Paste, import and export

Nothing here adds syntax: pasting and importing write the Markdown above. HTML from Word, Google Docs, Notion and web pages becomes headings, lists, `- [ ]` tasks, GFM tables (column alignment kept), links, `**bold**`, `*italic*`, `~~strike~~`, `==highlight==`, `<sub>`, `<sup>`, `<u>` and `![alt|width](.asset/…)` images (pasted pictures are saved in the page's `.asset` folder). Export to Word writes headings, real lists and tables, footnotes, a contents field for `[TOC]`, and turns CriticMarkup into tracked changes (`{++ ++}`, `{-- --}`, `{~~ ~>  ~~}`) and comments (`{== ==}{>> <<}`, replies threaded); "Final text only" accepts every suggestion and drops comments. Hidden `%%comments%%`, front matter and `[BREADCRUMB]` are not exported.

Colour and alignment use Pandoc attribute syntax. Other editors show them as plain text; **Export as portable Markdown** removes them.

The Write view never reformats what you did not touch:

- Opening a page does not change the file.
- Editing a block rewrites only that block (a paragraph, a heading, a whole list or table). Every other byte stays as written, including blank lines, bullet markers and front matter.
- A rewritten list keeps the bullet marker (`*`, `+`, `-`) and numbering style (`1.` or `1)`) the page already uses.
- Markdown the Write view cannot edit without loss (raw HTML, link reference definitions) is shown drawn, marked "Kept as written", and edited as source (double-click, Enter, or "Edit source"). It is written back exactly as typed.

Assistants editing a page through MCP can rely on the same rule: unchanged blocks keep their text.

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
- With `template:`, the template's front matter is the base (the deck's own keys win) and the template's masters come before the deck's own.
- Slide backgrounds: `<!-- _backgroundColor: #f2f2f2 -->` or `<!-- _backgroundImage: linear-gradient(135deg, #ffffff, #d9d9d9) -->` for one slide, the same keys in front matter for all slides, or `![bg](picture.jpg)`.

### Sections, hidden slides and comments

- `<!-- section: Results -->` starts a section at this slide; it runs until the next section.
- `<!-- hidden -->` keeps a slide in the deck but leaves it out of presenting and exports. It keeps its number.
- `<!-- comment (Ana, 2026-11-19): Check these numbers -->` is a review comment on the slide. Author and date are optional. Comments are not speaker notes; Resolve deletes the line.

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

### Templates

A template is a page in `Templates/` (folders are categories). It can describe itself in a `template:` map at the top of its front matter (`description`, `category`, `icon`, `source`); that map is removed from pages made from it. When used, these variables are filled: `{{title}}` (the new page's name), `{{date}}`, `{{time}}`, `{{datetime}}`, `{{yesterday}}`, `{{tomorrow}}`, `{{weekday}}`, each with an optional moment.js format (`{{date:dddd D MMMM YYYY}}`), and `{{cursor}}` (where the caret goes). Other `{{…}}` text is left as written. The template's properties are merged into the page's.

## Version history

Not a document format: versions live beside the documents in `<workspace>/.folio/history/` — `objects/ab/cdef….gz` (SHA-256 of the text, gzip) and `files/<sha1(path), 20 chars>.json` (`{path, versions:[{id,t,size,words,delta,by,reason,name?,note?}]}`). Dot folders are ignored by the tree, search, tags and backlinks. Round-trip: `test/history.test.mjs` (snapshot, rename, retention, diff and revert) and the UI test (edit → version → name → restore).

### Template questions

In a template, `{{ask:Label}}` asks for a value when the template is used: `|people` writes the answer as `[[Name]]`, `|date` uses a date picker, `|long` a multi-line box. The same label is asked once. Round-trip: `test/formats.test.mjs` (template questions).
