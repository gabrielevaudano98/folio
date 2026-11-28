# 0011. Detect calls from Windows' microphone consent store

- Status: Accepted
- Date: 2026-11-26

## Context and problem

Recording needs a click, and people forget it. Notion starts a note when it sees a meeting. Folio has no calendar access and
no native code, and must not listen to the microphone to find out whether a call is happening.

## Options considered

- Read the calendar: needs accounts and permissions, and misses ad-hoc calls.
- Open the microphone and listen: invasive, and it would hold the device other apps want.
- A native module watching the audio sessions (WASAPI): precise, but a per-platform build and signing cost.
- Read the registry keys where Windows records which app opened the microphone and when (`ConsentStore\microphone`).

## Decision

Poll `reg query` on the consent store every 4 seconds, only when the person turned **Offer to record when a call starts** on.
An app other than Folio holding the microphone for 8 seconds is one call (one notification, a call ends after 30 seconds
without the microphone). The notification starts nothing by itself; the click does.

## Consequences

- No native code, no permission prompt, no audio touched; a `reg.exe` run every 4 seconds only while the setting is on.
- It sees any app using the microphone, so a dictation tool or voice recorder also triggers it. The setting is off by default for that reason.
- Relies on a Windows key that is documented only by use; if the layout changes the watcher finds nothing and stays quiet.
- Windows only. Pure parsing and the once-per-call rule are tested on any platform (`test/mic-watch.test.mjs`); the real effect needs a call on Windows.
