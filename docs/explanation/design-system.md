# Design system

For designers and for anyone touching the interface. The rules are short and strict because Folio's look is part of
its promise: a calm paper-like surface where the one thing that stands out is a change an AI made. The binding version of
the rules is invariant 5 in [AGENTS.md](../../AGENTS.md); this page explains them and says where they live in code.

## Principles

1. **The page is the paper, the AI writes in the margin.** The interface recedes; content and AI edits come first. Live
   AI edits are marked in the margin, glow, then settle, with one-click Undo.
2. **Greys only.** The interface uses a neutral grey scale with chroma 0, plus black and white. The accent is ink: black
   in light mode, white in dark mode. This was a deliberate request, recorded as a waiver in `tokens.css`.
3. **Never meaning by colour alone.** States carry a word, a sign (+/−), a weight or a rule. This keeps the grey palette
   accessible and makes diffs readable for people who do not see colour.
4. **Native feel on each platform.** System fonts (SF Pro on macOS, Segoe UI Variable on Windows), translucent sidebar
   (vibrancy on macOS, Mica on Windows), light and dark follow the system.
5. **Office-familiar controls.** Ribbons, the `/` menu, the command palette and keyboard shortcuts follow what people
   know from Word, PowerPoint, Excel, Notion and Google Docs, so nothing needs to be learned twice.

The tokens file starts with its design brief, written with the [Hallmark](https://github.com/nutlope/hallmark) method
("app screen", restrained posture, light and dark, OKLCH tokens).

## Tokens (`src/renderer/tokens.css`)

Every colour, font, size, space, radius, shadow, duration and z-index added to the interface should use a CSS custom property from this file. Existing exceptions are listed below.
defines a raw value for these. Groups:

| Group | Tokens (examples) | Notes |
|---|---|---|
| Paper and ink | `--color-paper`, `--color-paper-2/3`, `--color-ink`, `--color-ink-2`, `--color-muted`, `--color-faint`, `--color-rule`, `--color-rule-strong` | OKLCH with chroma 0; a dark set overrides them under `prefers-color-scheme: dark` and the app's dark class. |
| Chrome | `--color-sidebar`, `--color-chrome`, `--color-hover`, `--color-press`, `--color-scrim`, `--color-backdrop` | Translucent where the platform blurs behind the window. |
| The one signal | `--color-accent`, `--color-accent-ink`, `--color-accent-soft`, `--color-focus`, `--color-select` | Ink, not a hue. |
| States | `--color-added(-bg)`, `--color-removed(-bg)`, `--color-warn` | Always paired with a sign or a word. |
| Type | `--font-sans`, `--font-display`, `--font-mono`, `--text-2xs` … `--text-4xl`, `--weight-regular/medium/bold`, `--measure` | System faces only; no web fonts in the interface. |
| Space and shape | `--space-3xs` … `--space-3xl`, `--radius-xs` … `--radius-pill`, `--control-h(-lg)` | |
| Depth | `--shadow-pop`, `--shadow-sheet`, `--shadow-control`, `--shadow-page`, `--shadow-thumb`, `--z-*` | |
| Motion | `--ease-out/in/in-out`, `--dur-micro/short/long` | Reduced to none under `prefers-reduced-motion`. |
| Layout | `--sidebar-w`, `--outline-w`, `--dock-w-review`, `--titlebar-h`, `--statusbar-h` | |
| Code | `--syn-keyword`, `--syn-string`, `--syn-number`, `--syn-type`, `--syn-title` | Greys and weights. |
| Content colours | `--content-gray`, `--content-brown`, `--content-orange`, `--content-yellow`, `--content-green`, `--content-blue`, `--content-purple`, `--content-pink`, `--content-red` and `-bg` variants | **Only for what an author colours in a page** (`[text]{color=red}`, callouts, chips). The interface itself must not use them; on `main` a few rules still do (find highlight, review switch, tag star, avatar), PR #77 removes them and adds `test/tokens.test.mjs`. |

Slide decks are a separate world: a deck's theme (fonts, colours, backgrounds) comes from its template and front matter,
not from `tokens.css`, because a deck is content.

## Rules a review checks

- Colours, fonts, radii and motion only through tokens; grey palette only (chroma 0) for interface elements.
- No uppercase tracked labels ("SMALL CAPS" headers).
- No emoji as icons. Icons are Folio's own line icons in `src/renderer/icons.js` (16 px grid, 1.5 stroke,
  `currentColor`); slides add Lucide icons as content.
- A visible `:focus-visible` ring on everything that takes focus.
- `prefers-reduced-motion` respected: transitions and the AI glow become instant.
- Every state is drawn: empty, loading, error, and for AI edits, fresh and settled.
- Text the person reads goes through i18n (`t('key')`), never a literal string in markup
  ([how-to](../how-to/add-ui-text.md)). Copy is sentence case, plain words, no jargon.

## Patterns

- **Ribbon** (`page-ribbon.js`): two layouts of the same commands, as in Microsoft 365: a compact one-row ribbon by
  default and full Word-style tabs (Home, Insert, Layout, Review, View, contextual Table).
- **Menus** (`showMenu`, `/`, `@`, `[[`): one list per item, a hint on the right, ARIA listbox or menu roles, full keyboard.
- **Command palette** (`Mod+Shift+P`): every command, insert and turn-into item, searchable with `fuzzy.js`.
- **Sheets and toasts**: modal sheets for decisions (`confirmSheet`, `prompt`), toasts for results, with an action
  such as Undo or Retry when one exists.
- **Docks**: one right dock with tabs (Outline, Review, Info) rather than several side panes.
- **AI edit banner**: assistant name, what changed in lines, time, Undo and Review.

## Accessibility

No formal WCAG level has been adopted yet; WCAG 2.2 AA is the aim. Menus, switches and listboxes carry ARIA roles; the slide canvas is operable from the keyboard with
names announced (`test/a11y-canvas.test.mjs`); the shell is checked with axe-core for serious and critical violations (`test/a11y-ui.test.mjs`). Known gaps:
the board canvas and the sheet grid ([#6](https://github.com/gabrielevaudano98/folio/issues/6)).

## How to check a change

- Run the app in light and dark mode, on macOS and Windows if you can, and with reduced motion on.
- `xvfb-run -a npm test` runs the UI tests, axe checks and the visual regression screenshots in `test/visual/`
  (slides; compared with pixelmatch on Linux).
- Search your diff for raw values: `grep -nE '#[0-9a-fA-F]{3,8}\b|rgb\(|oklch\(' src/renderer/styles.css`. About 30
  remain on `main` (fallbacks inside `var(…, rgb(…))`, shadows, the presenter's red laser dot, which is content); they are
  known debt. Do not add new ones; PR #77 adds `test/tokens.test.mjs`, which guards the content-colour rule.
