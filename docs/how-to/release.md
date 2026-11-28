# Publish a release

1. Bump the version in `package.json` only (`npm version <x.y.z> --no-git-tag-version` also updates `package-lock.json`). The MCP server reads it from there at build time, and `test/mcp-gating.test.mjs` checks that it matches. Update `README.md` when the release adds or changes features.
2. Open a pull request and wait for CI. On a pull request only the tests run; packaging for Windows, macOS and Linux runs after
   the merge to `main`.
3. Merge it. A push to `main` that changes `package.json` starts the **Release** workflow
   (`.github/workflows/release.yml`): it tests again, builds the Windows installer, the portable exe, the macOS DMG and ZIP, the Linux AppImage,
   and publishes them as a GitHub release tagged `v<version>` with `gh release create` (preinstalled on GitHub runners,
   needs only `GITHUB_TOKEN`; no third-party publish action). The notes are the fixed download text followed by notes
   generated from the merged pull requests. If the release for that version already exists (a later change to
   `package.json` that kept the version, such as a dependency bump), the workflow leaves it unchanged. Do not push the
   tag yourself: a tag push starts the same workflow a second time.

## What an update needs

The in-app updater ([updates](../explanation/updates.md)) reads `latest.yml` (Windows) and `latest-mac.yml` (macOS) and the
`.blockmap` files from the release. electron-builder writes them next to the installers because `build.publish` in
`package.json` points at this repository, and the workflow uploads `release/latest*.yml` and `release/*.blockmap`. Do not
remove them from the release or rename the installers by hand: the yml files list the file names and SHA-512 sums.

Running the workflow by hand (`workflow_dispatch`) publishes the version in `package.json`; if that release exists it
uploads with `gh release upload --clobber`, which replaces assets with the same name and keeps the notes and any other
assets (delete an obsolete asset by hand). Use it only to republish a version.
