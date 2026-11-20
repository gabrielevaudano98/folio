# How Folio keeps your files safe

Apple's guidance for dependable apps comes down to: never lose what the person made, and recover by yourself when
something goes wrong. Folio does it in five ways.

1. **Opening a file never rewrites it.** Each format has a parser and a serializer that give back the same bytes for an
   untouched document (`test/formats.test.mjs`). Editing one part changes only that part.
2. **Writes are atomic.** The new text goes to a hidden file next to the note, is flushed to disk, then replaces the
   note in one rename. If another program keeps the note locked, the save fails with a message and the old file stays. After a crash or a power cut the note has its old text or its new text, never half
   ([ADR 0008](../adr/0008-atomic-writes.md)). The same holds for settings and meeting notes.
3. **Deleting goes to the system trash**, and Folio keeps a private copy for Undo during the session.
4. **AI edits are visible and undoable.** Every change an assistant makes is highlighted in the open document with a
   one-click Undo. `edit_note` is an exact find-and-replace, so the rest of the text keeps its formatting; `write_note`
   replaces the whole note.
5. **Folio recovers.** A window that crashes is reloaded with its tabs. A meeting recording is kept in a work file
   until its note is written; if Folio closes first, Settings offers to save it.

What Folio cannot protect against: another program changing the folder at the same instant as Folio checks a path
(see `SECURITY.md`), and a disk that is full (the write fails with a message and the old text stays).
