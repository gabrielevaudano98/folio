# How the meeting recorder works

The meeting recorder is an optional feature: nothing is downloaded and nothing runs until you turn it on in
**Settings → Optional features**.

## The path of the sound

1. Your microphone and the computer's sound (Windows "loopback", what you hear from Teams or Meet) open as two
   separate streams. Keeping them apart is how the note knows **You** from **Others** without guessing voices.
2. An AudioWorklet in the window mixes each stream to mono at 16 kHz and cuts it into 100 ms blocks.
3. The blocks travel on a MessagePort to the **meeting worker**, a separate process that exists only while you record.
4. In the worker, a voice detector (Silero VAD) finds where speech starts and ends; each piece of speech (at most about
   30 seconds) is transcribed by Whisper large-v3-turbo. Lines come back to the app and are written to a work file at
   once, so a crash loses nothing.
5. At Stop, the transcript is saved as a note in `Meetings/`, and the worker exits.
6. If the notes model is installed, llama.cpp's server starts, reads the numbered transcript and proposes a summary,
   decisions, action items and open questions. Then it stops.

## Why the notes quote the transcript

A small local model writes fluent notes but invents details: owners, dates, questions nobody asked. So the model only
proposes. Folio keeps an item only when the words it quotes are on the line it cites; a decision or a question only when
that line reads like one; an owner or a date only when it is written on that line. Every point ends with *(line n)* so
you can check it.

## Limits

- Use headphones. Without them your microphone also hears the others; Folio drops lines that repeat what the other side
  said at the same moment, but real echo cancellation is not there yet.
- Windows only for now (the computer's sound is captured with Windows loopback).
- Tell everyone you are recording, and check that your organisation allows it.
- Memory: up to 3 GB for the worker and 4 GB for the whole app while it runs; none when idle. Each note records what was
  measured (`worker_peak_mb`, `app_peak_mb`, `transcription_speed`).

Details: [components](../reference/components.md), [measurements](../performance/meeting-spike.md),
[ADR 0005](../adr/0005-optional-components-are-downloaded.md), [0006](../adr/0006-utility-process-for-transcription.md),
[0007](../adr/0007-llama-server-for-notes.md).
