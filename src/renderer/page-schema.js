// Folio — the page schema: the TipTap extensions that define what a page can hold and how it reads and writes Markdown.
// Pure (no DOM at import), so the format tests and the editor share exactly the same Markdown behaviour.
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskList, TaskItem } from '@tiptap/extension-list';
import Image from '@tiptap/extension-image';
import Highlight from '@tiptap/extension-highlight';
import CodeBlock from '@tiptap/extension-code-block';

/* Markdown the editor cannot hold without loss. It is shown drawn, edited as source, and written back byte for byte. */
export const FolioRaw = Node.create({
  name: 'folioRaw',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() { return { source: { default: '' } }; },
  parseHTML() { return [{ tag: 'div[data-folio-raw]', getAttrs: (el) => ({ source: el.getAttribute('data-source') || '' }) }]; },
  renderHTML({ node }) { return ['div', { 'data-folio-raw': '', 'data-source': node.attrs.source }]; },
  renderMarkdown(node) { return node.attrs?.source ?? ''; },
});

export function pageExtensions({ codeBlock = CodeBlock, image = Image.configure({ inline: false, allowBase64: true }), raw = FolioRaw, link = {} } = {}) {
  return [
    StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener' }, ...link }, codeBlock: false }),
    codeBlock,
    TableKit.configure({ table: { resizable: false } }),
    TaskList, TaskItem.configure({ nested: true }),
    image,
    Highlight,
    raw,
  ];
}
