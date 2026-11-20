# Building a Folio slide template

A template is an ordinary slide deck (`.slides.md`) that other decks point at. It holds the design: colours, fonts, backgrounds, master slides with placeholders for each layout, colour variants and a few sample slides. It works like a PowerPoint `.potx`, but it is plain text, so you can version it, review it and share it like code. An AI connected to Folio can build one too: this guide is what it reads (`get_format_guide` with `type: template`).

## How decks use a template

```yaml
---
marp: true
template: Templates/Acme.slides   # path to the template, without .md
title: Quarterly report
---
```

- The template's front matter is the base and the deck's own keys win. A deck that sets `accent:` keeps its own accent.
- The template's masters apply to the deck's slides, before the deck's own masters.
- Sample slides in the template are not shown in decks that use it. They are copied once, as starting content, when someone creates a deck from the template.
- Change the template file and every deck that uses it changes. That is the point: a brand lives in one file.

Folio lists templates from two places:
- the built-in ones that ship with the app (Folio, Graphite, Editorial, Swiss, Corporate, Studio, Mono, Pitch);
- every `.slides.md` file in the workspace folder `Templates/`.

A built-in template is copied into `Templates/` the first time it is used, so decks never depend on the app version, and you can edit the copy.

## The file, step by step

### 1. Front matter: name, description, design tokens

```yaml
---
marp: true
template-name: Acme
template-description: Navy and white with a footer bar, for client decks.
template-tags: business, light
theme: folio                 # base theme: folio, graphite or paper
paper: "#ffffff"             # slide background
ink: "#1b2a3d"               # text
muted: "#5d6b7c"             # secondary text, page numbers
accent: "#1f4f8b"            # links, accents, diagram colour
card: "#eef2f7"              # cards and panels
heading-font: Georgia
body-font: Arial
fonts: assets/Acme-Regular.woff2, assets/Acme-Bold.woff2   # optional font files
paginate: true
size: 16:9
variant-teal: "#ffffff,#13302e,#56706d,#0f766e,#e9f4f2"     # paper, ink, muted, accent, card
variant-plum: "#ffffff,#2b1a33,#6c5a73,#6b2d7a,#f3ecf5"
---
```

- Quote colours (`"#1f4f8b"`). Without quotes YAML reads `#` as a comment.
- `template-*` keys describe the template and are not passed on to decks.
- **Variants** are alternative colour schemes, like PowerPoint's Design variants. They appear first under Colour schemes in the Design pane. Five colours in this order: paper, ink, muted, accent, card.
- **Font files**: put them in an `assets/` folder next to the template. Folio reads the family and weight from the file name (`Acme-Bold.woff2` is family Acme, weight 700). Without files, use fonts that people have installed, and the system font is the fallback.

### 2. The master for all slides, with placeholders

```markdown
<!-- master -->
## Master: all slides

::: box placeholder=title x=88 y=64 w=1104 h=104 size=46 valign=bottom
## Slide title
:::

::: box placeholder=body x=88 y=204 w=1104 h=420 size=28
- First level
  - Second level
:::

::: box #footer x=0 y=676 w=1280 h=44 fill=#1f4f8b
:::
```

- A slide that starts with `<!-- master -->` is a master. It is not numbered, presented or exported.
- **Placeholders** are boxes with `placeholder=title`, `placeholder=subtitle` or `placeholder=body`. On a slide that uses this master:
  - the first heading goes into the title placeholder;
  - everything else goes into the body placeholder, or into the subtitle placeholder when there is no body placeholder.

  The box's position, size and text attributes (`size`, `font`, `color`, `align`, `valign`, `line`, `fill`, `fit=shrink`) style that text. The text inside a placeholder on the master is only a prompt; it never shows on slides.
- Every other object on the master (a footer bar, a logo `![Logo](assets/logo.svg){x=… y=… w=… h=…}`, a line) is drawn behind every slide.
- Placeholders on the all-slides master do not apply to layouts with their own arrangement (two columns, cards, picture left/right, quote, big number, blank). Their decorations still show.

### 3. Masters for layouts

```markdown
<!-- master: title only -->
<!-- _backgroundColor: #1f4f8b -->
## Master: title slides

::: box placeholder=title x=88 y=210 w=760 h=220 size=68 valign=bottom color=#ffffff
# Presentation title
:::

::: box placeholder=subtitle x=88 y=460 w=760 h=120 size=26 color=#ffffff
Subtitle or speaker
:::
```

- `<!-- master: title -->` applies to slides with `<!-- layout: title -->`. Layouts: `default`, `title`, `section`, `two-columns`, `image-right`, `image-left`, `quote`, `big-number`, `cards`, `blank`.
- Add `only` (`<!-- master: title only -->`) to leave out the all-slides master on those slides, like "Hide background graphics" in PowerPoint.
- A master's own background (`<!-- _backgroundColor: … -->`, `<!-- _backgroundImage: linear-gradient(…) -->`, `![bg](picture.jpg)`) applies to its slides unless a slide sets its own.
- Placeholders in a layout master replace those of the all-slides master for that layout.

### 4. Sample slides

After the masters, add three or four normal slides: a title slide, a content slide, a section slide, and any layout you designed for. They are the preview in the template gallery and the starting content of new decks.

## Checklist before you share it

- [ ] Open the template in Folio and look at every sample slide in Normal and Sorter view.
- [ ] Review, Check accessibility: contrast of `ink` on `paper`, and of placeholder `color` on master backgrounds, at least 4.5:1 (3:1 for titles of 24px and up).
- [ ] Try each variant in Design, Colour schemes.
- [ ] Create a deck from it (New, Slides) and add a slide of each layout.
- [ ] Present it and export a PDF.
- [ ] If you use font files, check that their licence allows embedding and sharing.

## Sharing a template

- In a team: keep `Templates/` in the shared folder or Git repository. Everyone sees the same templates, and changes go through review like any file.
- Publicly: share the `.slides.md` file and its `assets/` folder. Someone else drops them into their `Templates/` folder.
- From the app: Design, Save as template turns the current deck (its effective design, masters and first slides) into a template file in `Templates/`.

## Templates and PowerPoint

- **From PowerPoint:** File, Import PowerPoint with a `.potx` (or a `.pptx` whose design you want) creates a template in `Templates/`. Each slide layout becomes a master for the matching Folio layout, with its background, shapes and title, subtitle and body placeholders; the theme colours and fonts become the tokens. Check the result against the checklist above: rename masters, adjust placeholder sizes, add colour variants.
- **To PowerPoint:** Export to PowerPoint writes each master as a PowerPoint slide layout named `Folio · <layout>` with real placeholders, and the tokens as the theme colours and fonts. In PowerPoint, New Slide offers those layouts, and the slides you export use them, so a deck made from your template stays on brand after it leaves Folio.
