# Performance budget

Folio applies Apple's responsiveness thresholds to its two interface threads (the Electron main process and the window):

- **Under 100 ms** of synchronous work in response to a discrete interaction (a click, a key, opening a document).
- **No hang**: never 250 ms or more without updating the interface.
- **Frames**: for scrolling and typing, keep the work per frame well under 16.7 ms (60 Hz).
- **Launch**: defer work that is not needed to show the first window.

Sources: Apple, [Improving app responsiveness](https://developer.apple.com/documentation/xcode/improving-app-responsiveness)
and [WWDC22 Track down hangs](https://developer.apple.com/wwdc22/10082); Electron,
[Performance](https://www.electronjs.org/docs/latest/tutorial/performance).

## Budgets

| What | Budget | Baseline, 20 Nov 2026 |
|---|---|---|
| Process start to page loaded | < 1,000 ms | 470–500 ms |
| Longest task at startup | < 100 ms | 91–108 ms (over budget in some runs) |
| Longest task opening a 400-section page | < 100 ms | 101–110 ms (over budget) |
| Longest task per keystroke | < 100 ms | 50–57 ms |
| Scroll, command palette, quick open | < 100 ms | 0–57 ms |
| Memory at rest, all processes | as low as possible | 597 MB |
| Installer: app code inside the asar | as small as possible | 14 MB (was 322 MB) |
| JavaScript parsed at startup | as small as possible | 863 KB after 1.3.0 (237 KB before it; 1.3 MB before lazy editors) |
| Meeting recorder: worker / whole app | 3,072 / 4,096 MB | 1.5 GB / 2.2 GB (see [spike](meeting-spike.md)) |

The baseline was measured with `scripts/perf.mjs` in a Linux cloud machine (2 vCPU, software rendering); Windows and
macOS computers are usually faster, with less GPU-process memory. Re-measure on the target computer before and after a
change ([how-to](../how-to/measure-performance.md)).

## Next to look at

- The startup task and opening a long page are over the 100 ms budget: profile them (likely editor creation and the first
  layout of a long document).
- Memory at rest: about 600 MB on Linux, a third of it the software GPU process; measure on Windows first.
