# Contributing to Folio

Thank you for improving Folio. Two rules matter more than any other:

1. **Send your change back.** Open a pull request against `main` of
   https://github.com/gabrielevaudano98/folio. If you ship a modified Folio, the
   AGPL-3.0 already requires you to publish its source; a pull request is how
   the change reaches everyone.
2. **Keep the origin visible.** Do not remove the attribution in `NOTICE`, the
   README or the About window: "Based on Folio by Gabriele Vaudano". It is an
   additional term of the license (AGPL-3.0, section 7(b)).

## How to work

- Fork, branch from `main` (`feat/…`, `fix/…`), keep pull requests small.
- `npm ci && npm test` must pass locally; CI runs the same checks.
- Every file format change (slides-md, board-md, sheet-md) needs a round-trip
  test in `test/formats.test.mjs`: parse, serialize, compare.
- UI changes follow the design rules in `AGENTS.md` (tokens only, grey palette,
  focus visible, reduced motion).
- Pull requests are reviewed by the maintainer and by AI reviewers (cubic,
  Claude). Their comments are suggestions; the maintainer decides.

By opening a pull request you agree that your contribution is licensed under
the AGPL-3.0 with the attribution terms in `NOTICE`.
