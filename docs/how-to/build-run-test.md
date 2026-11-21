# Build, run and test Folio

You need Node.js 22 and git. On Linux, tests that open the window need `xvfb`.

1. Get the code and the packages:
   ```sh
   git clone https://github.com/gabrielevaudano98/folio && cd folio
   npm ci
   ```
2. Start the app from the sources: `npm start` (builds `dist/`, then runs Electron).
3. Run every test: `npm test` (on Linux: `xvfb-run -a npm test`). It covers file formats, MCP end to end, security,
   atomic writes, optional features, the generated reference pages and UI smoke tests.
4. Run one test file: `node test/features.test.mjs`. UI tests need a build first: `npm run build`.
5. Build an installer for your own computer: `npm run dist:win` or `npm run dist:mac`. The result is in `release/`.

## Tests that need extra setup

- **Meeting recorder end to end** downloads about 2.8 GB of components once, then records a wav file through the app:
  ```sh
  FOLIO_MEETING_E2E=1 FOLIO_COMPONENTS_DIR=~/folio-components FOLIO_MEETING_WAV=meeting.wav xvfb-run -a node test/meeting.test.mjs
  ```
  The wav is played by Chromium's fake microphone, so the audio goes through the page and the worker as in a real recording. The components folder must already hold the installed components; the simplest
  way is to install them once from Settings in a dev build started with the same `FOLIO_COMPONENTS_DIR`.
- **A packaged binary**: after `npx electron-builder --linux dir` (output in `release/linux-unpacked/`),
  `FOLIO_BINARY=release/linux-unpacked/folio node test/stdio-binary.test.mjs` checks the MCP bridge
  through the installed app.

## Useful environment variables (development only)

| Variable | Effect |
|---|---|
| `FOLIO_USER_DATA` | Use another settings folder. |
| `FOLIO_SHOT` | Run a JSON list of steps in the window, then quit (tests, screenshots, `metrics` for memory). |
| `FOLIO_COMPONENTS_DIR` | Where optional components are installed. |
| `FOLIO_FEATURES_ANY_PLATFORM=1` | Offer the meeting recorder outside Windows (tests). |
| `FOLIO_MEETING_FAKE_WAV` | Feed a wav file to the meeting worker instead of the sound card. |
