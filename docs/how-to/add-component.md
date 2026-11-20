# Add or update a downloadable component

Components are the files an optional feature downloads (models, native runtimes). They are listed only in
`src/main/features/catalog.js`.

1. Pick a **pinned** address: a Hugging Face commit (`/resolve/<sha>/`), an npm version tarball or a GitHub release tag.
   Never `main` or `latest`: a test refuses them.
2. Get the size and SHA-256 of each file. Hugging Face shows the SHA-256 of large files in
   `https://huggingface.co/api/models/<repo>/tree/<sha>`; otherwise download it and run `sha256sum`.
3. Add the entry: `kind` (`runtime`, `vad`, `asr`, `llm`), `name`, `version`, `license`, `licenseUrl`, `attribution`
   (say what was changed, for CC-BY), `files` or `platforms` per `process.platform-process.arch`, and for archives
   `unpack`, `into`, `strip`, `keep`.
4. Measure the model's memory peak and set `peakRamMB` (see [measure performance](measure-performance.md)). It must stay
   below the feature's `budget.workerMB`.
5. To make it the default, put its id in the feature's `required` or `notes` list and the old one in `alternatives`.
6. Run `node test/features.test.mjs` and `node scripts/docs-reference.mjs`, then install it from Settings in a dev build
   to check the hashes against the real downloads.
