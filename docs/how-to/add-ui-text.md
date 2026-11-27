# Add interface text or a language

Every sentence Folio shows goes through [i18next](https://www.i18next.com) (`src/renderer/i18n.js`). English
(`src/renderer/locales/en.js`) is the source catalogue. At run time a missing key falls back to English, then to the key
itself, but **Italian must be complete**: `test/i18n.test.mjs` fails when an English key has no Italian text. Other
languages may be partial.

## Add a string

1. Add the key to `locales/en.js` first. Keys are flat strings with a dotted prefix for the area (`review.accept`,
   `app.could-not-save-path-message`); the dot is not nesting (`keySeparator: false`).
2. Use it:
   - in code: `import { t as tr } from './i18n.js'` then `tr('review.accept')`, with variables `tr('info.minutes', { n })`;
   - in `index.html`: `data-i18n="ui.workspace"` for the text, `data-i18n-attr="aria-label:ui.workspace;data-tip:ui.x"`
     for attributes (filled by `applyStatic()` at start);
   - for tables of commands written in English (ribbon, insert menu, native menu in `main.js`): `tl('menu', 'New Note')`
     looks up `menu.new-note` and falls back to the English text.
3. Add the Italian text to `locales/it.js` under the same key.
4. `node test/i18n.test.mjs`: it checks that every translated key exists in English, that placeholders match, and that no
   `{{` slipped in.

## Rules

- **Variables** are `{name}` (one brace). Numbers passed as `n` are printed in the language's number format.
- **Plurals**: `key_one` / `key_other` (CLDR categories of each language), chosen by `n`.
- **Copy**: sentence case, plain words, say what happened and what to do next ("Could not save Notes.md: the disk is
  full. Retry"). No uppercase labels, no exclamation marks.
- Never build a sentence by concatenating translated fragments; make one key with variables.
- The language is chosen in Settings and remembered in the window's local storage (`folio.lang`); changing it reloads
  the window, so text built at start already speaks the new language.

## Add a language

1. Create `locales/<code>.js` exporting an object like `it.js` (only the keys you translate).
2. Register it in `LOCALES` in `i18n.js` (`{ name: 'Deutsch', dict: de }`).
3. Run `node test/i18n.test.mjs` (its completeness checks name `LOCALES.it`; decide whether the new language must be
   complete too) and check the Settings picker, the native menu and the slide, board and sheet editors.

Not covered by a language file today:

- natural-language dates in the `@` menu understand English and Italian only (`chrono-node` `en` and `it` in
  `page-mentions.js`; `longDay` formats with `en-GB`);
- the meeting language setting offers Detect, Italian and English (`meeting.js`, `meeting/service.js`);
- the starter text of a new board or sheet (`NEW_BOARD`, `NEW_SHEET` in `app.js`) is English.
