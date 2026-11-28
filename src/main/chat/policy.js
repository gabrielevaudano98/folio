// Folio — what the chat may do on its own. Pure: tested in test/chat-policy.test.mjs.
//   classify(tool, args, ctx) -> { decision: 'auto' | 'ask' | 'deny', reason, remember }
// 'remember' says the person may allow this kind of step for the rest of the chat; a delete never can be remembered.
// Paths outside the folder, hidden paths and other file types are not decided here: notes.resolve() refuses them for
// every tool, whatever the person approves.

/** @param {{name:string,write?:boolean,annotations?:{destructiveHint?:boolean}}} tool
 *  @param {{allowWrite:boolean, exists:(p:string)=>Promise<boolean>, moves:number, allowOverwrites:boolean}} ctx */
export async function classify(tool, args, ctx) {
  if (!tool.write) return { decision: 'auto' };
  if (!ctx.allowWrite) return { decision: 'deny', reason: 'Folio is set to read-only for AI. Turn on "Let AI edit notes" to let the chat change files.' };
  switch (tool.name) {
    case 'delete_path': return { decision: 'ask', reason: 'Move to the Trash', remember: false };
    case 'restore_version': return ctx.allowOverwrites ? { decision: 'auto' } : { decision: 'ask', reason: 'Replace the note with an older version', remember: true };
    case 'write_note': {
      if (!(await ctx.exists(args.path))) return { decision: 'auto' }; // creating
      return ctx.allowOverwrites ? { decision: 'auto' } : { decision: 'ask', reason: 'Replace the whole note', remember: true };
    }
    case 'replace_section': return ctx.allowOverwrites ? { decision: 'auto' } : { decision: 'ask', reason: 'Replace a section', remember: true };
    case 'move_note': return ctx.moves >= 2 ? { decision: 'ask', reason: 'Move several files in one go', remember: false } : { decision: 'auto' };
    default: return { decision: 'auto' };
  }
}
