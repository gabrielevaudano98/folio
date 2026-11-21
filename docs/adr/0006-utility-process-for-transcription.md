# 0006. Transcription runs in a utilityProcess that lives only while recording

- Status: Accepted
- Date: 2026-11-20

## Context and problem

Speech models use 1–2 GB of memory and seconds of CPU per segment. In the main process they would block the app; kept loaded they would cost memory all day.

## Options considered

- Electron utilityProcess per recording
- Worker thread in the main process
- Keep a long-lived service

## Decision

`src/main/meeting/asr-worker.js` runs sherpa-onnx in a utilityProcess started for one recording and ended after it. Audio goes from the window's AudioWorklet to the worker on a MessagePort, without passing through the main process.

## Consequences

- Memory goes back to the system when the recording ends; a crash of the worker does not take the app down.
- sherpa-onnx must be used without external buffers in Electron (measured, docs/performance/meeting-spike.md).
