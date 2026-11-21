# Measure performance

## The baseline script

```sh
npm run build && xvfb-run -a node scripts/perf.mjs
```

It builds a heavy notebook (1,500 notes, one 400-section page), starts the app and prints JSON: time to the loaded page,
memory of every process just after start, at rest and after work, and, for each action (startup, opening the long page,
typing, scrolling, palette, quick open), the longest main-thread task over 50 ms (`longestTaskOver50Ms`, 0 when there was
none, because the browser reports only tasks of 50 ms or more) and how many there were. To check an action against the
100 ms budget in detail, record it in the Performance panel (below). Run it before and after a change and compare;
the budgets are in [`performance/budget.md`](../performance/budget.md).

On Linux the GPU process renders in software, so its memory and the paint times are higher than on Windows or macOS.

## Find what is slow

- Window: open the developer tools in a dev build (`npm start`, then View → Toggle Developer Tools), record in the
  Performance panel, look for long tasks (red corners) and their call tree.
- Main process: start with `npm run build && npx electron --inspect=9229 .` and attach Chrome's `chrome://inspect`.

## Meeting recorder on a real computer

Meeting notes record, when they were measured, `worker_peak_mb`, `app_peak_mb` and `transcription_speed` (seconds of work
per second of audio) in their front matter; a field is missing when the worker did not report it before stopping. Record a real one-hour call with headphones and read them; the limits are worker 3,072 MB,
app 4,096 MB, speed at most 0.5 with the call app running.
