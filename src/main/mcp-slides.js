// Folio MCP — slide tools: structure, placed objects, motion, links, accessibility text, notes and design ideas.
// Slides are addressed by number (1 = the first slide that is not a master), objects by #id.
import { z } from 'zod';
import { parseDeck, splitSlides, joinDeck, parseFrontmatter, setDirective, setNotes, setGlobal } from '../renderer/slides-core.js';
import { scanObjects, setObjectAttrs, removeObject, addObject, nextId, geometry, setObjectBody, KINDS } from '../renderer/slides-objects.js';
import { setAnimations, parseAnim, EFFECTS, TRANSITIONS, parseTransition } from '../renderer/slides-motion.js';
import { designIdeas } from '../renderer/slides-designer.js';

const ro = { readOnlyHint: true, openWorldHint: false };
const rw = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const path = z.string().describe('Path of a .slides.md deck');
const slide = z.number().int().min(1).describe('Slide number (1 = first slide, masters not counted)');
const id = z.string().describe('Object id without the #');

export const SLIDE_TOOLS = [
  { name: 'list_slides', title: 'List slides', write: false, annotations: ro,
    description: 'List the slides of a deck: number, title, layout, section, hidden, transition, number of placed objects and animations, and whether it has speaker notes.',
    input: { path } },
  { name: 'list_slide_objects', title: 'List slide objects', write: false, annotations: ro,
    description: 'List the placed objects on a slide with id, kind, geometry in px (the slide is 1280×720 for 16:9), attributes, text and link. Use the ids with the other slide tools.',
    input: { path, slide } },
  { name: 'add_object', title: 'Add slide object', write: true, annotations: rw,
    description: `Place an object on a slide at x, y, w, h (px). kind: ${KINDS.join(', ')}. attrs are slides-md attributes (fill, stroke, border, radius, size, color, font, align, valign, type for shapes, name for icons, link, …). text is Markdown for boxes and shapes. For an image use kind=image with attrs.src. Returns the new id.`,
    input: { path, slide, kind: z.enum([...KINDS, 'image']), x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().min(0), text: z.string().optional(), attrs: z.record(z.string(), z.union([z.string(), z.number()])).optional(), id: id.optional() } },
  { name: 'move_object', title: 'Move or resize slide object', write: true, annotations: rw,
    description: 'Change the position, size or rotation of an object (px, degrees). Give only what changes.',
    input: { path, slide, id, x: z.number().optional(), y: z.number().optional(), w: z.number().optional(), h: z.number().optional(), rotate: z.number().optional() } },
  { name: 'restyle_object', title: 'Restyle slide object', write: true, annotations: rw,
    description: 'Set or remove attributes of an object: a value sets it, null removes it. Also sets its Markdown text when text is given.',
    input: { path, slide, id, attrs: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(), text: z.string().optional() } },
  { name: 'remove_object', title: 'Remove slide object', write: true, annotations: { ...rw, destructiveHint: true },
    description: 'Remove an object from a slide, with any animation of it.',
    input: { path, slide, id } },
  { name: 'set_animations', title: 'Set slide animations', write: true, annotations: rw,
    description: `Replace the build order of a slide. Each line: target (#id or body), effect, then trigger (click, with, after), duration (0.5s), delay=, repeat=, by=paragraph. Effects: ${Object.keys(EFFECTS).join(', ')}. An empty list removes all animations.`,
    input: { path, slide, animations: z.array(z.string()) } },
  { name: 'set_transition', title: 'Set slide transition', write: true, annotations: rw,
    description: `Set the transition into a slide, or for every slide with slide omitted. Name and optional duration, e.g. "push-left 0.6s"; "none" removes it. Names: ${Object.keys(TRANSITIONS).join(', ')}. Morph moves objects with the same id between consecutive slides.`,
    input: { path, slide: slide.optional(), transition: z.string() } },
  { name: 'rewrite_links', title: 'Rewrite slide links', write: true, annotations: rw,
    description: 'Change every object link= in a deck from one target to another (e.g. "slide:4" to "slide:6", or an old web address). Returns how many changed.',
    input: { path, from: z.string(), to: z.string().nullable().describe('null removes the links') } },
  { name: 'set_alt_text', title: 'Set picture description', write: true, annotations: rw,
    description: 'Set the alternative text read by screen readers for a picture, icon, chart or diagram object. Write what the picture shows and why it matters, in one or two sentences.',
    input: { path, slide, id, alt: z.string() } },
  { name: 'set_speaker_notes', title: 'Set speaker notes', write: true, annotations: rw,
    description: 'Replace the speaker notes of a slide (plain text, paragraphs separated by blank lines).',
    input: { path, slide, notes: z.string() } },
  { name: 'get_design_ideas', title: 'Get design ideas', write: false, annotations: ro,
    description: 'Suggest layouts for a slide from its content (the same ideas the Designer pane shows). Returns idea ids and labels; apply one with apply_design_idea.',
    input: { path, slide } },
  { name: 'apply_design_idea', title: 'Apply design idea', write: true, annotations: rw,
    description: 'Replace a slide with one of the layouts from get_design_ideas. Its text is kept.',
    input: { path, slide, idea: z.string() } },
];

async function load(notes, p) {
  const text = await notes.read(p);
  const fm = parseFrontmatter(text); const chunks = splitSlides(fm.body); const deck = parseDeck(text);
  const at = (n) => { const s = deck.slides.find((x) => !x.master && x.number === n); if (!s) throw new Error(`There is no slide ${n}. The deck has ${deck.slides.filter((x) => !x.master).length} slides.`); return s; };
  const save = async (list) => notes.write(p, joinDeck(fm.raw, list));
  return { text, fm, chunks, deck, at, save };
}
const objOf = (chunk, oid) => { const o = scanObjects(chunk).find((x) => x.id === oid); if (!o) throw new Error(`No object #${oid} on this slide. Use list_slide_objects to see the ids.`); return o; };
const num = (v) => Math.round(v * 10) / 10;

export async function runSlideTool(notes, name, a, wrote) {
  if (!/\.slides\.md$/i.test(a.path)) throw new Error('Slide tools work on .slides.md decks.');
  const d = await load(notes, a.path);
  const edit = async (n, fn, verb) => { const s = d.at(n); const list = d.chunks.slice(); list[s.index] = fn(list[s.index], s); return wrote(await d.save(list), verb); };
  switch (name) {
    case 'list_slides':
      return d.deck.slides.filter((s) => !s.master).map((s) => ({ number: s.number, title: s.title || '', layout: s.layout || 'default', section: s.section, hidden: s.hidden, transition: s.transition ?? d.deck.global.transition ?? null, objects: (s.objects || []).length, animations: s.animations.length, notes: !!s.notes }));
    case 'list_slide_objects': {
      const s = d.at(a.slide);
      return { slide: s.number, width: d.deck.width, height: d.deck.height, objects: (s.objects || []).map((o, i) => { const g = geometry(o); return { id: o.id || null, index: i, kind: o.kind, x: num(g.x), y: num(g.y), w: num(g.w), h: num(g.h), rotate: g.rotate || 0, attrs: o.attrs, text: o.body?.trim() || (o.alt ?? undefined), link: o.attrs.link || null }; }) };
    }
    case 'add_object': {
      let newId = a.id;
      const r = await edit(a.slide, (c) => {
        newId = newId || nextId(c, a.kind === 'image' ? 'image' : a.kind);
        if (scanObjects(c).some((o) => o.id === newId)) throw new Error(`#${newId} is already used on this slide.`);
        const at = { ...(a.attrs || {}) }; const src = at.src; delete at.src;
        const q = (v) => (/[\s"{}]/.test(String(v)) ? `"${String(v).replace(/"/g, "'")}"` : String(v));
        const attrs = Object.entries(at).map(([k, v]) => `${k}=${q(v)}`).join(' ');
        const geo = `x=${num(a.x)} y=${num(a.y)} w=${num(a.w)} h=${num(a.h)}`;
        if (a.kind === 'image') { if (!src) throw new Error('An image needs attrs.src.'); return addObject(c, `![${(a.text || '').replace(/[[\]]/g, '')}](${src}){#${newId} ${geo}${attrs ? ' ' + attrs : ''}}`); }
        const body = a.text?.trim();
        return addObject(c, body && !['line', 'icon', 'media', 'path', 'zoom'].includes(a.kind) ? `::: ${a.kind} #${newId} ${geo}${attrs ? ' ' + attrs : ''}\n${body}\n:::` : `::: ${a.kind} #${newId} ${geo}${attrs ? ' ' + attrs : ''} :::`);
      }, 'Added an object to');
      return `${r} (#${newId})`;
    }
    case 'move_object': return edit(a.slide, (c) => { objOf(c, a.id); const p = {}; for (const k of ['x', 'y', 'w', 'h', 'rotate']) if (a[k] != null) p[k] = num(a[k]); return setObjectAttrs(c, a.id, p); }, 'Moved an object in');
    case 'restyle_object': return edit(a.slide, (c) => { objOf(c, a.id); let t = a.attrs ? setObjectAttrs(c, a.id, a.attrs) : c; if (a.text != null) t = setObjectBody(t, a.id, a.text); return t; }, 'Restyled an object in');
    case 'remove_object': return edit(a.slide, (c, s) => { objOf(c, a.id); const t = removeObject(c, a.id); const left = s.animations.filter((x) => x.target !== a.id); return left.length !== s.animations.length ? setAnimations(t, left) : t; }, 'Removed an object from');
    case 'set_animations': return edit(a.slide, (c, s) => {
      const list = a.animations.map((line) => { const x = parseAnim(line); if (x.target !== 'body' && !(s.objects || []).some((o) => o.id === x.target)) throw new Error(`No object #${x.target} on slide ${a.slide}.`); if (x.extra.some((w) => w.startsWith('effect:'))) throw new Error(`Unknown effect in "${line}".`); return x; });
      return setAnimations(c, list);
    }, 'Set the animations of');
    case 'set_transition': {
      const t = parseTransition(a.transition); const val = t.name === 'none' ? null : a.transition.trim();
      if (a.transition.trim().split(/\s+/)[0] !== 'none' && !TRANSITIONS[a.transition.trim().split(/\s+/)[0]]) throw new Error(`Unknown transition. Use one of: ${Object.keys(TRANSITIONS).join(', ')}.`);
      if (a.slide) return edit(a.slide, (c) => setDirective(c, 'transition', val ?? (d.deck.global.transition ? 'none' : null)), 'Set the transition of');
      return wrote(await notes.write(a.path, joinDeck(setGlobal(d.fm.raw, 'transition', val), d.chunks.map((c) => setDirective(c, 'transition', null)))), 'Set the transition of every slide in');
    }
    case 'rewrite_links': {
      let changed = 0;
      const list = d.chunks.map((c) => { let t = c; for (const o of scanObjects(c)) if (o.attrs.link === a.from && o.id) { t = setObjectAttrs(t, o.id, { link: a.to }); changed++; } return t; });
      if (!changed) return `No links to ${a.from} in ${a.path}.`;
      await wrote(await d.save(list), 'Rewrote links in'); return `Changed ${changed} link${changed === 1 ? '' : 's'} in ${a.path}.`;
    }
    case 'set_alt_text': return edit(a.slide, (c) => { const o = objOf(c, a.id); if (o.kind === 'image') { const lines = c.split('\n'); lines[o.open] = lines[o.open].replace(/^(\s*)!\[[^\]]*\]/, `$1![${a.alt.replace(/[[\]\n]/g, ' ')}]`); return lines.join('\n'); } return setObjectAttrs(c, a.id, { alt: a.alt.replace(/\n/g, ' ') }); }, 'Described a picture in');
    case 'set_speaker_notes': return edit(a.slide, (c) => setNotes(c, a.notes), 'Set the speaker notes of');
    case 'get_design_ideas': { const s = d.at(a.slide); return designIdeas(d.chunks[s.index], { width: d.deck.width, height: d.deck.height }).map((x) => ({ idea: x.id, label: x.label })); }
    case 'apply_design_idea': return edit(a.slide, (c) => { const idea = designIdeas(c, { width: d.deck.width, height: d.deck.height }).find((x) => x.id === a.idea); if (!idea) throw new Error('That idea is not available for this slide. Call get_design_ideas again.'); return idea.chunk; }, 'Applied a design idea to');
    default: throw new Error(`Unknown tool ${name}`);
  }
}
