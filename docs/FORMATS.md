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
- In the Write view a `![[…]]` alone on a line is also drawn live under the line (read-only, with an Open button); the text on disk stays exactly as written.
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
| Callout | `> [!tip] Title` then `> body` | GitHub and Obsidian types: note, abstract (summary, tldr), info, todo, tip (hint), success (check, done), question (help, faq), warning (attention), important, failure (fail, missing), danger (error), caution, bug, example, quote (cite). Unknown types are notes. `[!tip]-` starts folded, `[!tip]+` can fold. Without a title only the type's icon is drawn, beside the text (Notion); `[!note\|💡 yellow]` sets an emoji and a colour. |
| Notion callout (icon, colour) | `> [!callout|💡 yellow] Title` | Obsidian metadata after `|`: an emoji and/or a colour from the list below. Works on any type. |
| Toggle | `<details>`, `<summary>Title</summary>`, a blank line, the content, `</details>` | `<details open>` starts open. Toggles can nest. |
| Toggle heading | `<summary><h2>Title</h2></summary>` inside a toggle | h1 to h3. |
| Formatting in a toggle title | `<summary><strong>Bold</strong> and <a href="https://…">link</a></summary>` | `<summary>` is HTML, so a title's formatting uses inline tags: `<a href="…">`, `<strong>`, `<em>`, `<s>`, `<u>`, `<mark>`, `<sup>`, `<sub>`, `<code>`, nested in that order (a link outside, code inside). In a formatted title every `<` in the text is written `&lt;` and `&` before an entity `&amp;`. Any other text in a title, `**Bold**` included, is kept literally as written. |
| Columns | `:::: columns`, then two to five `::: column` … `:::`, then `::::` | The outer fence has four colons so it can hold the inner ones. |
| Table of contents | `[TOC]` on its own line | Live list of the page's headings. |
| Breadcrumb | `[BREADCRUMB]` on its own line | Where the page sits in the workspace. Folio only. |
| Page break | `<div class="page-break"></div>` | A new page in print and PDF export. |
| Image with width and caption | `![Alt|400](.asset/3fa9c1d2-photo.png "Caption")` | Width in pixels after `|` (Obsidian); the title is the caption. |
| Video, audio | `![Demo](.asset/9be41c07-clip.mp4)`, `![](.asset/1c0d5e22-talk.mp3)` | Image syntax with a media file: mp4, webm, mov, m4v; mp3, m4a, wav, ogg, aac, flac. |
| PDF | `![Annual report](.asset/77ab0e91-report.pdf)` | A card that opens the file. |
| Web embed | `![](https://www.youtube.com/watch?v=…)` | YouTube, Vimeo, Loom, Figma, Google Maps and Drive, Miro, X, CodePen, Gist, Spotify, SoundCloud, Excalidraw, Canva: a card that opens in the browser (Folio does not load other sites inside the page). |
| Web bookmark, file | a paragraph that is only a link: `[https://site.com](https://site.com)`, `[budget.xlsx](.asset/d20f6a3b-budget.xlsx)` | Drawn as a card. |
| Code block | ```` ```python ```` | Coloured as in the Read view; the language is chosen in the block's top bar, which also has Copy and Wrap (Wrap is view only and never saved). |
| Wiki link | `[[Note]]`, `[[Note#Heading|label]]` | |
| Block id, link to a block | `A paragraph. ^abc123`, then `[[Note#^abc123]]` | Obsidian syntax. For a table, quote or code block the id is a line `^abc123` after it. **Copy link to block** adds one. |
| Link to a day | `[[2026-11-21]]` | The daily note, `Journal/2026-11-21.md`, made when you first open it. `@tomorrow`, `@next friday`, `@domani` and their first letters (`@tod`, `@ven`) write it. The file always keeps the ISO day; the page shows it as a date mention in the user's format (Settings → Date format: relative “Today”, “Friday”, “3 Dec”; full; short; D/M/Y; M/D/Y; ISO). A valid day link is never reported as broken; an impossible calendar date is. |
| Date with time, end, reminder | `[[2026-12-01]]{09:00}`, `[[2026-12-03]]{→ 2026-12-05}`, `[[2026-12-01]]{09:00 → 10:30 remind 30m}`, `[[2026-12-01]]{remind 1d}` | The day link stays as it is (date only: `[[2026-12-01 09:00]]` is never written, it would be a missing page); a brace group follows `]]` with no space. Inside, in this order, separated by spaces: a start time `HH:MM` (24 h); `→` then an end day `YYYY-MM-DD`, an end time, or both (an end time needs a start time); `remind` (at the start) or `remind N` with `m`, `h`, `d` or `w` (minutes, hours, days, weeks before). An all-day date reminds from 9:00 on its day (`{remind 1d}` = 9:00 the day before). Folio writes `→`; `->` is read too. Braces that do not read exactly like this (`[[2026-12-07]]{see notes}`) are ordinary text. The page shows one chip: “@Tomorrow 9:00”, “@3 Dec → 5 Dec”, a bell when there is a reminder, red from the day it is due (unless the to-do is checked). Set from the date popover (Include time, End date, Remind) or typed: `@tomorrow 9am`, `@3 dec - 5 dec`, `@remind tomorrow 9am`, `@ricordami domani alle 9`. Other editors show the day link followed by the braces. |
| Link to a person | `[[Ada Lovelace]]` | A note in a `People/` folder; shown as a person chip. |
| Tag | `#project`, `#project/alpha` | Starts after a space, has a letter, may contain `-`, `_`, `/`. Also read from front matter `tags:`. Not in code. |
| Status chip, inline field | `[status:: In progress]`, `[owner:: Ada]` | Dataview inline field. `status` is a coloured chip (Not started, In progress, Blocked, Done; other words are grey). Click the chip to change it. A page can offer its own words in the front matter: `folio:` then `  status: [Idea, Design, Shipped]` (or a `- Idea` list); the `@` picker offers the same words. |
| Emoji | `😄` | The character itself. `:smile` in the Write view looks it up. |
| Table column alignment | `\| :--- \| :---: \| ---: \|` | GFM. Set from a column's menu or the Table tab; sorting, moving rows and columns (menu or dragging a grip) rewrite only the table. **Header row** off leaves the header cells empty (`\|  \|  \|`, valid GFM, hidden in Folio); on removes an empty header again. |
| Properties | YAML front matter: `title: Text`, `count: 3`, `done: true`, `due: 2026-12-01`, `tags: [a, b/c]`, `owner: "[[Ada]]"` | Edited as fields above the title (a type chosen from a field's menu is remembered per property name in `.folio/property-types.json`; it only applies when the value fits); only the changed property's lines are rewritten. Nested maps are kept and shown read-only. |
| Page icon | front matter `icon: 🚀` | One emoji shown large above the title (Notion). Not listed with the properties; other editors see an ordinary property. |
| Page appearance (Notion's Appearance & layout) | front matter `font: serif` (or `mono`), `small-text: true`, `full-width: true`, `toc: true`, `cover: .asset/<file>` (or `gradient-1` to `gradient-6`), `cover-y: 30` | Per page, written only when not the default, so a default page has none of these lines (the app-wide text size, width and the docked outline stay in Settings). `font` absent = the sans-serif of the interface; `small-text` makes the page text 87.5 % of the Text size setting; `full-width` overrides the page width setting; `toc: true` shows a floating table of contents on the right edge when the page has two or more headings (thin lines that open to the list on hover or focus; the current section is marked; a click scrolls). `cover` is a picture copied into the page's `.asset/` folder or a built-in gradient; any other value (a web address, a path elsewhere) is not drawn, is never requested and stays an ordinary property. `cover-y` is the picture's vertical position, 0 (top) to 100 (bottom), absent = 50; removing the cover removes it. These keys are not listed with the properties. Changing one rewrites only its own line (CRLF files stay CRLF), except that choosing a different cover also removes `cover-y`, so a new picture starts centred. Other editors see ordinary properties. |
| Template button (Folio) | ```` ```template-button ```` with `label: New meeting`, `template: Meeting notes`, optional `where: above` | Drawn as a button; inserts the template from `Templates/` (or a starter). Other editors show a code block. |
| Suggested insertion, deletion, replacement | `{++new text++}`, `{--old text--}`, `{~~old~>new~~}` | CriticMarkup. Accept or reject in the review pane; Suggesting mode writes them as you type. |
| Comment | `{==quoted text==}{>>Ada, 2026-11-20 14:05: Comment<<}` | CriticMarkup. The `Author, date time:` prefix is optional; comments that follow each other are replies. |
| Resolved comment | `{==quoted text==}{>>Ada, …: Comment<<}{>>Bob, 2026-11-27 10:05: [resolved]<<}` | Resolve adds a reply whose text is exactly `[resolved]`; the comments and the highlight stay in the file. A thread is resolved while that reply is its last one (one-emoji reactions aside), so a later reply reopens it; Reopen removes the marker. Resolved threads are hidden in the review pane until Show resolved. Delete thread removes the comments and keeps the text. |
| Text colour, background (Folio) | `[text]{color=red}`, `[text]{bg=yellow}`, `[text]{color=blue bg=yellow}` | Colours: gray, brown, orange, yellow, green, blue, purple, pink, red. |
| Alignment (Folio) | a paragraph, then `{align=center}` on the next line; a heading: `## Title {align=right}` | left, center, right, justify. |

The Write view has pickers for these: `[[` (pages, people, `Note#` headings, `Note#^` blocks, "Create"), `@` (people, pages, dates in English and Italian, status), `#` (tags in the workspace) and `:` (emoji). They only insert the plain text above.

### Assets (`.asset`)

Pictures, video, audio, PDFs, fonts and attachments live in a hidden `.asset` folder next to the page that first used them. A reference is an ordinary relative path in the Markdown (`![](.asset/3fa9c1d2-photo.png)`, `../.asset/…` from a sub-folder), so the file stays portable and any editor can read it.

- **Names.** `<8 hex of the content hash>-<name>`: the same bytes are stored once (pasting a picture twice, or the same file into two pages, reuses the file). Writes are atomic (temp file, then rename). One file is at most 250 MB.
- **Hidden and protected.** The folder starts with a dot, so the tree, search, tags and backlinks never list it, and Folio also sets the hidden attribute on Windows and macOS. Folio refuses to rename, move, create or trash a path inside `.asset`. The operating system can still delete it: Folio then reports which files a page is missing (on open and when the window regains focus).
- **Removing a picture from a page** asks once whether to remove the file too, only if no other page uses it. The choice can be remembered (move to the asset trash, delete permanently, or keep). Nothing is removed while you can still press Undo: the question appears about two seconds after the save, and a reference that comes back cancels it.
- **AI edits.** When an AI assistant's edit drops the last reference to a file, Folio asks the same question. Removal re-checks that no page uses the file at that moment. MCP tools `find_unused_assets` and `find_missing_assets` list them; none of them removes anything.
- **Asset trash.** `.asset/.trash/<time>~<name>`, purged after 30 days. A reference to a file that is gone (Undo after removing it, restoring an old version) brings it back from there automatically.
- **Moving a page** to another folder copies the files it uses into the new folder's `.asset` and rewrites its references.
- **Duplicating a page** (Duplicate in the sidebar or ••• menu) writes `<name> copy.md` next to it (the word follows the interface language; then `copy 2`, `copy 3`…). Every file the page uses gets a new file of its own in the copy's `.asset` (`<hash>-<name>-2.<ext>` when the plain name is taken), so the two pages share no files; only those references change, `[[links]]` stay as written. A folder is duplicated with all its pages and sub-folders by the same rules; other files in it are not copied.
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

### Working on a page as an assistant (MCP)

Work by section instead of rewriting the page: `get_outline` (level, text, first and last line of each section), `read_section`, `replace_section` (everything under a heading, sub-sections included; the heading stays), `insert_after` (after a heading's section, or after the block ending with a block id ` ^abc123`). A heading is named by its text (case does not matter), by a path (`Plan > Goals`) when twins exist, or by its line. To propose instead of apply, `suggest_edit` writes a tracked change (`{~~old~>new~~}`, `{--old--}`, or `{++new++}` after an anchor) and `add_comment` writes `{==passage==}{>>Client, date: comment<<}`; the person accepts or rejects them in the Review tab. The passage must match exactly once outside code (pass `occurrence` otherwise) and may not contain CriticMarkup delimiters. `resolve_link` says where `[[Note#Heading]]` or `[[Note#^id]]` points. Every write adds a version, and `list_versions`, `get_version`, `diff_versions` and `restore_version` (itself a version first) bring any earlier text back.

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
- **Incremental lists** (Marp fragmented lists): list items written with `*` bullets or `1)` numbers appear one per click when presenting, in reading order (the slide text, then its boxes and shapes, nested items too); items written with `-`, `+` or `1.` are always shown. They build before the slide's `animate:` lines, and appear as one paragraph build each in PowerPoint. The editing canvas, thumbnails, PDF and handouts show every item. The on-canvas text editor keeps a box's `*` and `1)` markers (a box that mixes `*` with `-`, or `1)` with `1.`, is edited in the Markdown instead).

  ```markdown
  * Shown on the first click
  * Then this one
  - Always visible
  ```
- **Marp transition names** play as the nearest Folio transition and export the same way: `push`, `slide`, `swipe`, `swoosh` → `push-left`; `cover` → `cover-left`; `pull` → `uncover-left`; `wipe` → `wipe-left`; `melt` → `wipe-down`; `iris-in`, `iris-out`, `diamond`, `star` → `iris`; `clockwise`, `counterclockwise`, `wiper` → `clock`; `coverflow`, `cylinder`, `swap` → `cube`; `drop`, `pivot` → `fall`; `explosion` → `zoom`; `implode`, `in-out` → `zoom-out`; `fade-out` → `fade-black`; `overlap` → `dissolve`; `glow` → `fade`; `rotate` → `flip`. The file keeps the name as written. `<!-- _transition: … -->` means the same as `<!-- transition: … -->` (this slide only); unlike Marp, a transition directive on a slide does not carry over to the following slides (use front matter for the deck default).

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

### Slides and AI assistants (MCP)

Connected assistants can work on a deck object by object instead of rewriting the file:

- Read: `list_slides`, `list_slide_objects` (ids, kinds, geometry in px, attributes, text, links), `get_design_ideas`.
- Change: `add_object`, `move_object`, `restyle_object`, `remove_object`, `set_animations`, `set_transition` (one slide or all), `rewrite_links`, `set_alt_text`, `set_speaker_notes`, `apply_design_idea`.
- **Translate a deck:** `read_note` the deck, then `write_note` it back with every heading, paragraph, list item, table cell and object text translated, keeping front matter, `:::` lines, `#ids`, attributes, comments (`animate:`, `transition:`, notes) and links unchanged; translate the notes with `set_speaker_notes`. Save as a copy (`Deck (Italiano).slides.md`) unless asked to replace it.
- **Describe pictures:** `list_slide_objects` on each slide, then `set_alt_text` for every image, icon, chart and diagram without a description; the Review pane's accessibility check lists what is still missing.

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
- Place as free box (Arrange menu, or right-click a block of the slide text): the block's lines move unchanged into a new `::: box #box-N x= y= w= h=` at the end of the slide, sized and positioned where the block was drawn (`align=` is added when the text was centred, right-aligned or justified). Nothing else in the slide changes. A block that shares its lines with a placed object is not moved.
- Rulers and guides are view state: guides dragged out of the rulers snap objects while they move, are kept per open deck for the session, and are never written to the file.
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
// inside a quoted label: \" is a quote, \n a line break, \\ a backslash
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

## Meeting notes

The meeting recorder writes a normal page in `Meetings/`, named `YYYY-MM-DD hh-mm Title.md`. Nothing in it needs Folio to read.

```markdown
---
type: meeting
title: "Weekly sync"
date: 2026-11-20T14:04:00.000Z
duration: 00:42:10
transcription: whisper-large-v3-turbo-int8
notes: qwen3-1.7b-q4km          # only when notes were written
worker_peak_mb: 2080            # measured on this computer during the recording
app_peak_mb: 2710
transcription_speed: 0.21       # seconds of work per second of audio
---

# Weekly sync

## Notes
### Summary
### Decisions
- Use Whisper for transcription (line 6)
### Action items
- [ ] Prepare the Windows build · owner: Marco · due: Friday 27 November (line 3)
### Open questions

## Transcript

**1** · 00:00:00 · Others: Good morning, let's start.
```

- Every transcript line has a number; every note cites the line it comes from. Folio keeps a point only when its quote is on that line, and keeps an owner or a date only when it is written on that line.
- `You` is the microphone, `Others` is the computer's sound. Microphone lines that repeat what Others said at the same moment (echo without headphones) are left out.
- Writing notes later never rewrites the person's edits: if the page changed, the notes are inserted above `## Transcript`.

## Reminders

A reminder is a date mention with `remind` in its brace group (see *Date with time, end, reminder* above). While Folio is open
it fires once at its time: a system notification (click it to open the page at that line) and a toast with **Open**.
Nothing is sent when Folio is closed; a reminder whose time passed meanwhile is listed as overdue, not announced.
The **Reminders** section of the sidebar lists every reminder of the folder, soonest first, with **Done** and **Dismiss**.
Done and Dismiss are kept in the app's settings file per folder, never in the page: the page keeps the reminder as written.
A reminder is known by its own text and its place among identical ones on the page, so editing the words around it keeps
its state, and changing its date, time or offset makes it a new reminder. Front matter dates have no reminder.
