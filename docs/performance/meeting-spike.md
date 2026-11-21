# Meeting recorder — Phase 0 measurements

Measured on 20 November 2026 in a Linux cloud machine (2 vCPU, 7 GB RAM, no GPU), Electron 45.4.1, sherpa-onnx 2.0.2,
llama.cpp b12550. The audio is a 52-second Italian "meeting" made with a text-to-speech voice (piper `it_IT-paola-medium`),
so the quality numbers are only a first check: **the decision between speech models is taken on real Teams recordings on
the target Windows laptop** (see "What to measure on Windows").

## Results

| What | Whisper large-v3-turbo int8 (default) | Parakeet TDT 0.6B v3 int8 |
|---|---|---|
| Runs inside an Electron `utilityProcess` | yes | yes |
| Load time | 2.5 s | 2.5 s |
| Worker memory after loading (RSS) | 1.58 GB | 0.81 GB |
| Worker memory peak while transcribing (RSS) | 2.09 GB | 0.97 GB |
| Growth over 40 minutes of audio | not measured yet | +0.1 GB, then flat |
| Speed, 2 threads (seconds of work per second of audio) | 0.47 | 0.08 |
| Word error rate on the synthetic clip | 20.6 % (one sentence repeated) | 14.0 % |
| Names and numbers in the clip | "Marco", "3 GB", "Teams", "eco", "DOCS" right | "Michael", "6 gigabit" wrong |

Notes model, Qwen3-1.7B Q4_K_M through `llama-server` (one slot, 4,096-token context, 2 threads):

| What | Value |
|---|---|
| Memory of the server process | 2.7 GB RSS, of which 1.6 GB private and 1.1 GB the memory-mapped model file |
| Prompt speed / generation speed | 120 / 9 tokens per second |
| Notes for 12 lines | 45 s |

End to end in the app (`FOLIO_MEETING_E2E=1 node test/meeting.test.mjs`): the Settings section, a recording, the
transcript saved at stop, notes added after it. Peak of the worker as Electron reports it: 1.5 GB with Whisper,
0.9 GB with Parakeet; peak of the whole app: 2.2 GB with Whisper. Both inside the budget (worker 3 GB, app 4 GB).

## Findings that changed the design

1. **node-llama-cpp crashes inside Electron.** It loads under plain Node, but in Electron 45 (main process, utility
   process and `ELECTRON_RUN_AS_NODE`) it dies while loading the model (exit 4 or SIGILL), most likely on Electron's V8
   memory cage, which forbids external buffers. The notes engine is therefore llama.cpp's own `llama-server`, started as a
   child process for one meeting and stopped after it. When it exits, all its memory goes back to the system.
2. **sherpa-onnx needs copied buffers in Electron.** `readWave(file)` and `vad.front()` throw "External buffers are not
   allowed" unless called with `false`. The worker always copies.
3. **The voice detector misses pauses in large blocks.** Fed one second at a time, it returned a single segment for the
   whole minute; fed 100 ms at a time, twelve segments as expected. The worker splits every block into 100 ms.
4. **Whisper truncates Italian with the default token limit** (6 tokens per second of audio). The worker sets 15.
5. **Whisper sometimes writes a sentence twice.** Repeats and repeated tails are removed (`dedupeSentences`).
6. **A 1.7B model invents owners, dates and questions** (examples in `test/features.test.mjs`). The model only proposes:
   an item is kept when its quote is on the cited line, a decision or question only when that line reads like one, an
   owner or a date only when it is written on that line.
7. **node-llama-cpp's npm install also brings CUDA and Vulkan builds (≈ 700 MB on Linux).** Another reason not to ship it.

## What to measure on Windows (go/no-go, from the plan)

Meeting notes record `worker_peak_mb`, `app_peak_mb` and `transcription_speed` in their front matter when measured, so the gates are
measured by recording real meetings with headphones:

1. Capture: three one-hour calls (wired headset, USB headset unplugged and plugged back, Bluetooth). No gap in the
   transcript longer than the silence in the call; the bar shows "Computer sound reconnected" after a device change.
2. Resources: `worker_peak_mb` ≤ 3072, `app_peak_mb` ≤ 4096, `transcription_speed` ≤ 0.5 with Teams running.
3. Quality: on three real recordings of at least ten minutes, count wrong words and wrong names (about twenty terms).
   Try Parakeet on the same recordings; keep the model that is right more often within the budget.
4. Notes: over at least thirty action items, no invented owner or date.
