// Folio — the two tools only the chat has. Everything else comes from the MCP tool table (src/main/mcp-tools.js).
import { z } from 'zod';

const rw = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
export const CHAT_TOOLS = [
  { name: 'create_folder', title: 'Create folder', write: true, annotations: rw,
    description: 'Create a folder (and any missing parent folders) inside the workspace.',
    input: { path: z.string().describe('Relative folder path, e.g. "projects/2027"') } },
  { name: 'delete_path', title: 'Delete', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Move a note or a whole folder to the Trash. The person is always asked first. Prefer this over emptying a note.',
    input: { path: z.string(), reason: z.string().optional().describe('Why, shown to the person') } },
];

/** deps: { mkdir(rel), trash(rel) -> {token}, onTrashed?(rel, token) } */
export async function runChatTool(name, a, deps) {
  if (name === 'create_folder') { await deps.mkdir(a.path); return `Created folder ${a.path}`; }
  if (name === 'delete_path') { const r = await deps.trash(a.path); await deps.onTrashed?.(a.path, r.token); return `Moved ${a.path} to the Trash`; }
  throw new Error(`Unknown tool ${name}`);
}
