# Updates from GitHub releases

Folio checks the releases of [gabrielevaudano98/folio](https://github.com/gabrielevaudano98/folio/releases) for a newer
version. The code is `src/main/updater.js` (a thin layer over [electron-updater](https://www.electron.build/auto-update));
the interface is **Settings → Updates**; the pieces a release must contain are listed in [release](../how-to/release.md).

## What each build can do

There are no code-signing certificates (the maintainer cannot get them), so what an update can do depends on what the
operating system accepts from an unsigned app.

| Build | Mode | What happens |
|---|---|---|
| Windows installer (`Folio-Setup-*.exe`) | **install** | Folio finds the new release, you press *Download*, then *Restart and install*. Your notes are saved first. electron-updater checks the SHA-512 in `latest.yml` against the download. Windows does not require a signature for this, so it works unsigned (SmartScreen may still warn on a first manual install). |
| Windows portable (`Folio-Portable-*.exe`) | notify | The exe is not installed anywhere, so it cannot replace itself. Folio says a new version exists and opens its release page. |
| macOS (`.dmg`, `.zip`) | notify | macOS refuses to swap in an update that is not signed with the same Developer ID as the running app (Squirrel.Mac), and the release builds are only ad-hoc signed. Folio says a new version exists and opens its release page; you download the DMG and replace the app yourself. |
| Development run (`npm start`), `FOLIO_NO_UPDATE=1` | off | Nothing is checked. |

If a Developer ID certificate is added later, pass `installOnMac: true` to `createUpdater` in `main.js`: macOS then
downloads the `.zip` listed in `latest-mac.yml` and installs it like Windows. Notarisation is not needed for that, only
a Developer ID signature; both the signing step and the flag are needed together.

## How it behaves

- A check runs 15 seconds after start and every six hours, unless **Check for updates automatically** is off in
  Settings (`autoUpdate` in `settings.json`, on by default). It asks GitHub for `latest.yml` / `latest-mac.yml` of the
  newest release and sends nothing else; **Check now** does the same on demand. This is the only network call Folio makes
  without being asked, so it is documented in [security](security.md) and can be switched off.
- Nothing is downloaded without a click (`autoDownload` is off). A downloaded update also installs when Folio quits
  (Windows installer only).
- Every Folio release is still marked pre-alpha on GitHub, so `allowPrerelease` is on; downgrades are off.
- The release page link is built from the checked version number (`releaseUrl()`), never from text in the downloaded
  metadata.
- The window only calls `update:*` handlers declared with `h()` in `updater.js` ([IPC](../reference/ipc.md)).

## What is not tested

`test/updater.test.mjs` covers the mode of each build, the state machine against a fake electron-updater, and the safe
release URL. A real download and install needs a published release newer than the installed build, on Windows: check
it by hand after the first release made with this change (install 1.5.1 from a release that has `latest.yml`, publish a
newer one, press *Check now*). The first release that carries `latest.yml` is also the first one that can update; builds
older than that have no updater.
