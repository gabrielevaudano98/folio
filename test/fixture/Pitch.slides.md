---
marp: true
theme: folio
paginate: true
footer: Folio, November 2026
---

<!-- layout: title -->
# Folio

Notes, slides, boards and sheets your AI can edit

---

## Why now

- Teams write in many tools
- AI assistants can't see most of them
- Markdown is the format both people and models read

<!--
Open with the problem, not the product.
-->

---

<!-- layout: two-columns -->
## Before and after

::: left
### Today
- Copy and paste into chat
- Lost formatting
:::

::: right
### With Folio
- The AI edits the file
- You review each change
:::

---

![bg right:42%](assets/cover.png)

## One file, two views

- **Visual** for people
- **Code** for AI and version control

---

<!-- layout: big-number -->
# 4

Document types in one app

---

<!-- layout: cards -->
## What's inside

::: card
### Slides
Marp compatible
:::

::: card
### Boards
Diagrams as text
:::

::: card
### Sheets
Formulas in Markdown
:::

---

## Where the budget goes

- Engineering is most of it
- Marketing grows after launch
- Total for the year: {{Budget.sheet#Costs!H6}}

```chart
type: column
title: Costs by quarter
source: Budget.sheet.md
sheet: Costs
range: A1:G5
stacked: true
```

---

<!-- layout: quote -->
> Make the file the interface.

— Folio design note

---

<!-- source: Pitch.slides#2 -->
## A copy that drifted

Old text

---

## Placed objects

::: box #claim x=80 y=200 w=520 h=240 fill=#f2f2f2 radius=12
### Placed text
- Any Markdown
- Anywhere on the slide

::: note
Nested containers stay inside the box.
:::
:::

::: shape #dot type=ellipse x=700 y=220 w=200 h=200 fill=#111

Dot
:::

![Cover](assets/cover.png){x=960 y=200 w=240 h=240 crop=0,0,1,.8}

```
::: box x=1 y=1
this is a code fence, not an object
:::
```
