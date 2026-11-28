// Folio — optional features and the components they download. Static: the app never downloads anything that is not listed here.
// Every file has a pinned address and a SHA-256 checked before it is used. Pure data plus pure helpers, tested in Node.

const HF = (repo, rev, file) => `https://huggingface.co/${repo}/resolve/${rev}/${file}`;
const NPM = (pkg, v) => `https://registry.npmjs.org/${pkg}/-/${pkg}-${v}.tgz`;
const LLAMA = (tag, asset) => `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-${asset}`;
const PARAKEET = ['csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8', 'ed5d745623472f97cfc2e6c2916ee248798fc5a8'];
const QWEN = ['unsloth/Qwen3-1.7B-GGUF', 'd7f544eead698dbd1f15126ef60b45a1e1933222'];
const WHISPER = ['csukuangfj/sherpa-onnx-whisper-turbo', '2ca6ff69fc878651b770880507669577ac41c2ff'];
const LLAMA_TAG = 'b12550';
const DUCK = (p, v = '2.0.1-r.1') => `https://registry.npmjs.org/@duckdb/${p}/-/${p}-${v}.tgz`;

/** which files of a llama.cpp release the notes engine needs: the server and the libraries it loads */
export function keepLlamaFile(name) {
  const base = name.split('/').pop();
  if (/^llama-server(\.exe)?$/.test(base)) return true;
  if (/-impl\.(dll|so)/.test(base)) return /^(lib)?llama-server-impl\./.test(base);
  return /\.dll$/i.test(base) || /\.so(\.\d+)*$/.test(base);
}

/**
 * kind: runtime (native code), vad, asr, llm. peakRamMB is measured, not guessed (docs/performance/meeting-spike.md).
 * files: one list for every platform, or `platforms` with a list per `${process.platform}-${process.arch}`.
 * A file with `unpack` is an archive: tgz or zip, `into` a folder of the component, `strip` leading folders, `keep` a filter.
 */
export const COMPONENTS = {
  'sherpa-runtime': {
    kind: 'runtime', name: 'Speech engine (sherpa-onnx)', version: '2.0.2', license: 'Apache-2.0',
    attribution: 'sherpa-onnx, Copyright (c) Xiaomi Corporation and contributors', licenseUrl: 'https://github.com/k2-fsa/sherpa-onnx/blob/master/LICENSE',
    platforms: {
      'win32-x64': [
        { name: 'sherpa-onnx-node.tgz', url: NPM('sherpa-onnx-node', '2.0.2'), sha256: 'dcebf1db8650a52987342accb2b9a0faba91f079ee970f90aae047202db3af57', bytes: 15082, unpack: 'tgz', into: 'node_modules/sherpa-onnx-node', strip: 1 },
        { name: 'sherpa-onnx-win-x64.tgz', url: NPM('sherpa-onnx-win-x64', '2.0.2'), sha256: 'b49c291b694277955b5a6a06dd6b0f7f328a437e0a345befd0f7454450738079', bytes: 9062542, unpack: 'tgz', into: 'node_modules/sherpa-onnx-win-x64', strip: 1 },
      ],
      'win32-arm64': [
        { name: 'sherpa-onnx-node.tgz', url: NPM('sherpa-onnx-node', '2.0.2'), sha256: 'dcebf1db8650a52987342accb2b9a0faba91f079ee970f90aae047202db3af57', bytes: 15082, unpack: 'tgz', into: 'node_modules/sherpa-onnx-node', strip: 1 },
        { name: 'sherpa-onnx-win-arm64.tgz', url: NPM('sherpa-onnx-win-arm64', '2.0.2'), sha256: '6bff8ad1f38c6de1d8652e94832001bda126aff1f257fb75b5624ae0d3817b72', bytes: 8658834, unpack: 'tgz', into: 'node_modules/sherpa-onnx-win-arm64', strip: 1 },
      ],
      'linux-x64': [
        { name: 'sherpa-onnx-node.tgz', url: NPM('sherpa-onnx-node', '2.0.2'), sha256: 'dcebf1db8650a52987342accb2b9a0faba91f079ee970f90aae047202db3af57', bytes: 15082, unpack: 'tgz', into: 'node_modules/sherpa-onnx-node', strip: 1 },
        { name: 'sherpa-onnx-linux-x64.tgz', url: NPM('sherpa-onnx-linux-x64', '2.0.2'), sha256: '09c70eb7f9d5abee48ca135dc5ed1ab33f4df765dc38d8acf9e4969365b2eea4', bytes: 11440307, unpack: 'tgz', into: 'node_modules/sherpa-onnx-linux-x64', strip: 1 },
      ],
    },
  },
  'silero-vad': {
    kind: 'vad', name: 'Voice activity detector (Silero VAD)', version: '5', license: 'MIT',
    attribution: 'Silero VAD, Copyright (c) Silero Team', licenseUrl: 'https://github.com/snakers4/silero-vad/blob/master/LICENSE',
    files: [{ name: 'silero_vad.onnx', url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx', sha256: '9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6', bytes: 643854 }],
  },
  'whisper-large-v3-turbo-int8': {
    kind: 'asr', engine: 'sherpa', modelType: 'whisper', name: 'Transcription: Whisper large-v3-turbo (int8)', version: 'turbo-int8', default: true,
    languages: ['multi'], license: 'MIT', licenseUrl: 'https://github.com/openai/whisper/blob/main/LICENSE',
    attribution: 'Whisper large-v3-turbo by OpenAI, MIT License. Changed: exported to ONNX and quantised to int8 by the sherpa-onnx project.',
    peakRamMB: 2150, maxSegmentSec: 28, threads: 2, maxTokensPerSecond: 15,
    files: [
      { name: 'encoder.int8.onnx', url: HF(...WHISPER, 'turbo-encoder.int8.onnx'), sha256: 'b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b', bytes: 674716297 },
      { name: 'decoder.int8.onnx', url: HF(...WHISPER, 'turbo-decoder.int8.onnx'), sha256: '20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547', bytes: 361080764 },
      { name: 'tokens.txt', url: HF(...WHISPER, 'turbo-tokens.txt'), sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126', bytes: 816730 },
    ],
  },
  'parakeet-tdt-0.6b-v3-int8': {
    kind: 'asr', engine: 'sherpa', modelType: 'nemo_transducer', name: 'Transcription: Parakeet TDT 0.6B v3 (int8)', version: 'v3-int8',
    languages: ['bg', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'de', 'el', 'hu', 'it', 'lv', 'lt', 'mt', 'pl', 'pt', 'ro', 'sk', 'sl', 'es', 'sv', 'ru', 'uk'],
    license: 'CC-BY-4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    attribution: 'Parakeet TDT 0.6B v3 by NVIDIA (nvidia/parakeet-tdt-0.6b-v3), CC-BY-4.0. Changed: exported to ONNX and quantised to int8 by the sherpa-onnx project.',
    peakRamMB: 1000, maxSegmentSec: 30, threads: 2,
    files: [
      { name: 'encoder.int8.onnx', url: HF(...PARAKEET, 'encoder.int8.onnx'), sha256: '1afbe69c1ffdabee94755f42e4daf1d93549131a3da11356bda84fcef0f2c479', bytes: 652282294 },
      { name: 'decoder.int8.onnx', url: HF(...PARAKEET, 'decoder.int8.onnx'), sha256: '0222a86147299d4dee90edf95b6d13827edb42ad8b7c9cf0b2582f030937c0b5', bytes: 11845274 },
      { name: 'joiner.int8.onnx', url: HF(...PARAKEET, 'joiner.int8.onnx'), sha256: 'cbd02f3696e9944970111fb439d9c3fd365a80374565f13f2b9c7007d253fc98', bytes: 6355277 },
      { name: 'tokens.txt', url: HF(...PARAKEET, 'tokens.txt'), sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d', bytes: 93939 },
    ],
  },
  'llama-server': {
    kind: 'runtime', engine: 'llamacpp', name: 'Notes engine (llama.cpp server)', version: LLAMA_TAG, license: 'MIT',
    attribution: 'llama.cpp, Copyright (c) The ggml authors', licenseUrl: 'https://github.com/ggml-org/llama.cpp/blob/master/LICENSE',
    platforms: {
      'win32-x64': [{ name: 'llama-win-cpu-x64.zip', url: LLAMA(LLAMA_TAG, 'bin-win-cpu-x64.zip'), sha256: '6c215291bfa1d8a3a149f4971fc38ed9d18212c13fdfaf9d0196d958acc15cd6', bytes: 24814219, unpack: 'zip', into: 'bin', strip: 0, keep: 'llama' }],
      'win32-arm64': [{ name: 'llama-win-cpu-arm64.zip', url: LLAMA(LLAMA_TAG, 'bin-win-cpu-arm64.zip'), sha256: '6e5a28888aaf42f09b97b3d737c016e3525fb88558cb8c1580d76d9bf9eb492b', bytes: 12995949, unpack: 'zip', into: 'bin', strip: 0, keep: 'llama' }],
      'linux-x64': [{ name: 'llama-ubuntu-x64.tar.gz', url: LLAMA(LLAMA_TAG, 'bin-ubuntu-x64.tar.gz'), sha256: 'd4948c62193469ebf1b06f6148c337a466a56da1dcd8caa6c91cdf7bc8305b48', bytes: 23012497, unpack: 'tgz', into: 'bin', strip: 1, keep: 'llama' }],
    },
  },
  'qwen3-1.7b-q4km': {
    kind: 'llm', engine: 'llamacpp', name: 'Notes: Qwen3 1.7B (Q4_K_M)', version: 'q4_k_m', default: true, license: 'Apache-2.0',
    licenseUrl: 'https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/LICENSE', attribution: 'Qwen3-1.7B by the Qwen team, Alibaba Cloud. GGUF conversion by Unsloth.',
    peakRamMB: 1700, contextTokens: 4096, threads: 4,
    files: [{ name: 'model.gguf', url: HF(...QWEN, 'Qwen3-1.7B-Q4_K_M.gguf'), sha256: 'b139949c5bd74937ad8ed8c8cf3d9ffb1e99c866c823204dc42c0d91fa181897', bytes: 1107409472 }],
  },
  /* Folio Sheets: data connectors and Python, downloaded when the person first uses them (docs/sheets/README.md) */
  duckdb: {
    kind: 'data', name: 'Data connectors (DuckDB)', version: '2.0.1-r.1', license: 'MIT',
    attribution: 'DuckDB, Copyright (c) 2018-2026 Stichting DuckDB Foundation', licenseUrl: 'https://github.com/duckdb/duckdb/blob/main/LICENSE',
    platforms: {
      'win32-x64': [
        { name: 'node-api.tgz', url: DUCK('node-api'), sha256: 'a870a0feb6d6ec4656dc44ea16b27c5acfe8f6ad8b2acc4f94a50b19b63b0134', bytes: 114627, unpack: 'tgz', into: 'node_modules/@duckdb/node-api', strip: 1 },
        { name: 'node-bindings.tgz', url: DUCK('node-bindings'), sha256: 'aef3150ceae2880d93c7519fb837e567c6ef0a3ba409323f61264a2a0fbaedb2', bytes: 14216, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings', strip: 1 },
        { name: 'node-bindings-win32-x64.tgz', url: DUCK('node-bindings-win32-x64'), sha256: '6ad3564e178fb563d91e96b3c780ce74c047a4a95846ba4c6c45185bc4323da7', bytes: 20726172, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings-win32-x64', strip: 1 },
      ],
      'win32-arm64': [
        { name: 'node-api.tgz', url: DUCK('node-api'), sha256: 'a870a0feb6d6ec4656dc44ea16b27c5acfe8f6ad8b2acc4f94a50b19b63b0134', bytes: 114627, unpack: 'tgz', into: 'node_modules/@duckdb/node-api', strip: 1 },
        { name: 'node-bindings.tgz', url: DUCK('node-bindings'), sha256: 'aef3150ceae2880d93c7519fb837e567c6ef0a3ba409323f61264a2a0fbaedb2', bytes: 14216, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings', strip: 1 },
        { name: 'node-bindings-win32-arm64.tgz', url: DUCK('node-bindings-win32-arm64'), sha256: '717b9becb87906bf113cc3facf03c853dd70f230328872e9f86ced5d176f485d', bytes: 19414053, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings-win32-arm64', strip: 1 },
      ],
      'darwin-x64': [
        { name: 'node-api.tgz', url: DUCK('node-api'), sha256: 'a870a0feb6d6ec4656dc44ea16b27c5acfe8f6ad8b2acc4f94a50b19b63b0134', bytes: 114627, unpack: 'tgz', into: 'node_modules/@duckdb/node-api', strip: 1 },
        { name: 'node-bindings.tgz', url: DUCK('node-bindings'), sha256: 'aef3150ceae2880d93c7519fb837e567c6ef0a3ba409323f61264a2a0fbaedb2', bytes: 14216, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings', strip: 1 },
        { name: 'node-bindings-darwin-x64.tgz', url: DUCK('node-bindings-darwin-x64'), sha256: '588bcc5354c6a74d51691ca3e6cc8f1abebb77503da8603c616771ec1b3131e9', bytes: 21813821, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings-darwin-x64', strip: 1 },
      ],
      'darwin-arm64': [
        { name: 'node-api.tgz', url: DUCK('node-api'), sha256: 'a870a0feb6d6ec4656dc44ea16b27c5acfe8f6ad8b2acc4f94a50b19b63b0134', bytes: 114627, unpack: 'tgz', into: 'node_modules/@duckdb/node-api', strip: 1 },
        { name: 'node-bindings.tgz', url: DUCK('node-bindings'), sha256: 'aef3150ceae2880d93c7519fb837e567c6ef0a3ba409323f61264a2a0fbaedb2', bytes: 14216, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings', strip: 1 },
        { name: 'node-bindings-darwin-arm64.tgz', url: DUCK('node-bindings-darwin-arm64'), sha256: 'bd3abea2a378faac722d74858fb89fa4f9dee23320b445f0409044bef872424e', bytes: 19779503, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings-darwin-arm64', strip: 1 },
      ],
      'linux-x64': [
        { name: 'node-api.tgz', url: DUCK('node-api'), sha256: 'a870a0feb6d6ec4656dc44ea16b27c5acfe8f6ad8b2acc4f94a50b19b63b0134', bytes: 114627, unpack: 'tgz', into: 'node_modules/@duckdb/node-api', strip: 1 },
        { name: 'node-bindings.tgz', url: DUCK('node-bindings'), sha256: 'aef3150ceae2880d93c7519fb837e567c6ef0a3ba409323f61264a2a0fbaedb2', bytes: 14216, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings', strip: 1 },
        { name: 'node-bindings-linux-x64.tgz', url: DUCK('node-bindings-linux-x64'), sha256: 'e060479ee5ed9d9fa7de33ee9985ea81833d9ada1994cfb4598ea4852119a6bf', bytes: 28487362, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings-linux-x64', strip: 1 },
      ],
      'linux-arm64': [
        { name: 'node-api.tgz', url: DUCK('node-api'), sha256: 'a870a0feb6d6ec4656dc44ea16b27c5acfe8f6ad8b2acc4f94a50b19b63b0134', bytes: 114627, unpack: 'tgz', into: 'node_modules/@duckdb/node-api', strip: 1 },
        { name: 'node-bindings.tgz', url: DUCK('node-bindings'), sha256: 'aef3150ceae2880d93c7519fb837e567c6ef0a3ba409323f61264a2a0fbaedb2', bytes: 14216, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings', strip: 1 },
        { name: 'node-bindings-linux-arm64.tgz', url: DUCK('node-bindings-linux-arm64'), sha256: '1dd419d164b0e035217173a85a79c6bfb40ffb2122368a5da4160e8b76914abb', bytes: 26641854, unpack: 'tgz', into: 'node_modules/@duckdb/node-bindings-linux-arm64', strip: 1 },
      ],
    },
  },
  pyodide: {
    kind: 'data', name: 'Python (Pyodide)', version: '314.0.8', license: 'MPL-2.0',
    attribution: 'Pyodide, Copyright (c) Pyodide contributors; CPython, Copyright (c) Python Software Foundation', licenseUrl: 'https://github.com/pyodide/pyodide/blob/main/LICENSE',
    files: [{ name: 'pyodide.tgz', url: NPM('pyodide', '314.0.8'), sha256: '9a52704e0ae5b07aaacb8e4fed9f1658e8024694a078695ea45ac79dee4cefcb', bytes: 6487361, unpack: 'tgz', into: 'pyodide', strip: 1 }],
  },
};

export const FEATURES = {
  'meeting-recorder': {
    name: 'Meeting recorder',
    description: 'Records your computer’s sound and your microphone, transcribes on this computer and writes a note in Meetings/. Nothing leaves your computer.',
    platforms: ['win32'], permissions: ['microphone', 'system-audio'],
    budget: { workerMB: 3072, appMB: 4096 },
    /** needed to record and transcribe */
    required: ['sherpa-runtime', 'silero-vad', 'whisper-large-v3-turbo-int8'],
    /** other speech models the catalog offers for the same slot (choice in Settings comes later) */
    alternatives: { asr: ['parakeet-tdt-0.6b-v3-int8'] },
    /** optional: notes written by a small local model; without them the note holds the transcript only */
    notes: ['llama-server', 'qwen3-1.7b-q4km'],
  },
  'sheets-data': {
    name: 'Sheets: data connectors and Python',
    description: 'SQL, Parquet and database files in queries (DuckDB) and Python in workbooks (Pyodide). Both run in a sandbox on this computer.',
    platforms: ['win32', 'darwin', 'linux'], permissions: [],
    budget: { workerMB: 3072, appMB: 4096 }, // the data engine's heap cap (src/main/sheets-engine.js)
    required: [], notes: [],
    optional: ['duckdb', 'pyodide'],
  },
};

/** the files of a component on this platform, or null when it has none here */
export function filesFor(id, platformKey) {
  const c = COMPONENTS[id];
  if (!c) return null;
  if (c.files) return c.files;
  return c.platforms?.[platformKey] || null;
}
/** total download size of a list of components on this platform */
export function downloadBytes(ids, platformKey) {
  return ids.reduce((n, id) => n + (filesFor(id, platformKey) || []).reduce((m, f) => m + f.bytes, 0), 0);
}
/** may this feature run here? FOLIO_FEATURES_ANY_PLATFORM lets tests run it on Linux */
export function featureSupported(featureId, platform, platformKey, env = {}) {
  const f = FEATURES[featureId];
  if (!f) return false;
  const all = [...f.required, ...f.notes];
  if (!all.every((id) => filesFor(id, platformKey))) return false;
  return f.platforms.includes(platform) || env.FOLIO_FEATURES_ANY_PLATFORM === '1';
}
/** checks a catalog for mistakes: run by the tests so a bad entry cannot ship */
export function validateCatalog(components = COMPONENTS, features = FEATURES) {
  const errors = [];
  const okName = (n) => typeof n === 'string' && /^[\w.-]+$/.test(n) && !n.startsWith('.');
  for (const [id, c] of Object.entries(components)) {
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(id)) errors.push(`${id}: bad id`);
    if (!['runtime', 'vad', 'asr', 'llm', 'data'].includes(c.kind)) errors.push(`${id}: bad kind`);
    if (!c.license || !c.attribution) errors.push(`${id}: missing license or attribution`);
    const lists = c.files ? [c.files] : Object.values(c.platforms || {});
    if (!lists.length) errors.push(`${id}: no files`);
    for (const list of lists) for (const f of list) {
      if (!okName(f.name)) errors.push(`${id}: bad file name ${f.name}`);
      if (!/^https:\/\//.test(f.url)) errors.push(`${id}: ${f.name} not https`);
      if (!/^[0-9a-f]{64}$/.test(f.sha256)) errors.push(`${id}: ${f.name} bad sha256`);
      if (!(f.bytes > 0)) errors.push(`${id}: ${f.name} bad size`);
      if (f.unpack && !['tgz', 'zip'].includes(f.unpack)) errors.push(`${id}: ${f.name} bad unpack`);
      if (f.into && (f.into.split('/').some((s) => !okName(s) && !/^@[a-z0-9][\w.-]*$/.test(s)))) errors.push(`${id}: ${f.name} bad into`);
    }
  }
  for (const [id, f] of Object.entries(features)) for (const c of [...f.required, ...f.notes, ...Object.values(f.alternatives || {}).flat()]) if (!components[c]) errors.push(`${id}: unknown component ${c}`);
  return errors;
}
