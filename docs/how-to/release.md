# Publish a release

1. Bump the version in `package.json` and in `SERVER_INFO` in `src/main/mcp-tools.js`; add the changes to `README.md`.
2. Open a pull request and wait for CI. On a pull request only the tests run; packaging for Windows and macOS runs after
   the merge to `main`.
3. Merge it. A push to `main` that changes `package.json` starts the **Release** workflow
   (`.github/workflows/release.yml`): it tests again, builds the Windows installer, the portable exe and the macOS DMG and
   ZIP, and publishes them as a GitHub release tagged `v<version>`. Do not push the tag yourself: a tag push starts the
   same workflow a second time.

Running the workflow by hand (`workflow_dispatch`) also publishes a release for the version in `package.json`; use it
only to republish a version.
