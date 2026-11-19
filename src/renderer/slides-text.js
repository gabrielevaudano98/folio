// Folio — editing the text of a box or shape right on the slide (P3).
// A lean TipTap editor works on the object's Markdown body, so bold, lists, headings and links stay plain Markdown.
// Box-level typography (font, size, colour, alignment) lives in attributes and is written by the format bar.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Highlight from '@tiptap/extension-highlight';

export function startTextEdit({ el, body, onChange, onEnd, onLink, barSelector = '.sl-fmtbar' }) {
  el.innerHTML = ''; el.dataset.editing = '1'; el.classList.add('is-editing');
  let timer, ended = false;
  const editor = new Editor({
    element: el,
    extensions: [StarterKit.configure({ link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener' } }, codeBlock: false }), Markdown.configure({ markedOptions: { gfm: true } }), Highlight],
    content: body, contentType: 'markdown', autofocus: 'end',
    editorProps: { attributes: { class: 'sl-prose', spellcheck: 'true', 'aria-label': 'Slide text. Escape to finish.' } },
    onUpdate: () => { clearTimeout(timer); timer = setTimeout(() => onChange(editor.getMarkdown()), 180); },
    onTransaction: () => bar?.dispatchEvent(new CustomEvent('sl-text-state')),
  });
  const bar = document.querySelector(barSelector);
  const flush = () => { clearTimeout(timer); onChange(editor.getMarkdown()); };
  function end() {
    if (ended) return; ended = true;
    flush(); el.removeEventListener('focusout', onOut); el.removeEventListener('keydown', onKey, true);
    editor.destroy(); delete el.dataset.editing; el.classList.remove('is-editing'); onEnd();
  }
  function onOut(e) { const to = e.relatedTarget; if (to && (el.contains(to) || to.closest?.(barSelector) || to.closest?.('#menu'))) return; setTimeout(() => { if (!el.contains(document.activeElement) && !document.activeElement?.closest?.(barSelector)) end(); }, 0); }
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(); } }
  el.addEventListener('focusout', onOut); el.addEventListener('keydown', onKey, true);

  const run = (cmd) => {
    const c = editor.chain().focus();
    switch (cmd) {
      case 'bold': return c.toggleBold().run();
      case 'italic': return c.toggleItalic().run();
      case 'underline': return c.toggleUnderline().run();
      case 'strike': return c.toggleStrike().run();
      case 'highlight': return c.toggleHighlight().run();
      case 'bullet': return c.toggleBulletList().run();
      case 'ordered': return c.toggleOrderedList().run();
      case 'quote': return c.toggleBlockquote().run();
      case 'p': return c.setParagraph().run();
      case 'h1': return c.setHeading({ level: 1 }).run();
      case 'h2': return c.setHeading({ level: 2 }).run();
      case 'h3': return c.setHeading({ level: 3 }).run();
      case 'clear': return c.unsetAllMarks().clearNodes().run();
      case 'link': {
        const prev = editor.getAttributes('link').href || '';
        return Promise.resolve(onLink?.(prev)).then((href) => {
          if (href == null) return;
          const ch = editor.chain().focus().extendMarkRange('link');
          if (!href) ch.unsetLink().run(); else ch.setLink({ href }).run();
        });
      }
    }
  };
  const active = (name, attrs) => editor.isActive(name, attrs);
  return { editor, end, run, active, flush };
}
