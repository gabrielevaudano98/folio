# Publish a release

1. Bump the version in `package.json` and in `SERVER_INFO` in `src/main/mcp-tools.js`; add the changes to `README.md`.
2. Open a pull request, wait for CI (tests on Linux, packaging on Windows and macOS) and merge it.
3. Tag the merge commit and push the tag:
   ```sh
   git tag v1.2.4 && git push origin v1.2.4
   ```
4. The **Release** workflow (`.github/workflows/release.yml`) tests again, builds the Windows installer, the portable exe
   and the macOS DMG and ZIP, and publishes them as a GitHub release with notes.

Running the workflow by hand (`workflow_dispatch`) also publishes a release for the version in `package.json`; use it
only to republish a version.
