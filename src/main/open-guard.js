// Folio — which workspace files may be handed to the system's default app ("Open" on an attached file).
// A folder that came from somewhere else (a download, a shared drive, a git clone) can hold anything under `.asset/`, and
// opening a program, script or macro document would run it. Only the document and media types below are opened (a list of
// what is allowed, not of what is refused, so a type nobody thought of stays closed); everything else, and a file with
// no extension, is refused. Macro-enabled Office files (docm, xlsm, pptm) are not on the list.
import path from 'node:path';

const OPENABLE = new Set([
  // documents
  'pdf', 'doc', 'docx', 'dot', 'dotx', 'xls', 'xlsx', 'xltx', 'ppt', 'pptx', 'potx', 'ppsx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'epub',
  // pictures
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico', 'tif', 'tiff', 'heic',
  // audio and video
  'mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'ogv',
]);

/** true when the file is a document or media file that is safe to open with the system's default app */
export function mayOpenWithSystem(file) {
  // Windows drops spaces and dots at the end of a name ("setup.exe ." runs as setup.exe); the last extension decides
  const base = path.basename(String(file || '')).replace(/[ .]+$/, '');
  return OPENABLE.has(path.extname(base).slice(1).toLowerCase());
}
