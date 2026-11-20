// Folio — templates (D9). A template is a page in the Templates/ folder (or one of the starters below); applying it
// fills its variables and, when it is put into an existing page, merges its properties and inserts its body.
// Variables (Obsidian core Templates syntax, plus a few): {{title}} {{date}} {{date:YYYY-MM-DD}} {{time}} {{time:HH:mm}}
// {{datetime}} {{yesterday}} {{tomorrow}} {{weekday}} {{cursor}}. Anything else in {{…}} (Folio's live values) is left alone.
// Pure: runs in Node tests.
import { parseProps, setProp } from './page-props.js';

export const TEMPLATE_DIR = 'Templates';
export const DAILY = 'Daily note';
export const CURSOR = '⁣FOLIO-CURSOR⁣';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const pad = (n, w = 2) => String(n).padStart(w, '0');
/** moment.js tokens used by Obsidian templates: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a, [literal] */
export function formatDate(d, fmt = 'YYYY-MM-DD') {
  const tok = { YYYY: d.getFullYear(), YY: pad(d.getFullYear() % 100), MMMM: MONTHS[d.getMonth()], MMM: MONTHS[d.getMonth()].slice(0, 3), MM: pad(d.getMonth() + 1), M: d.getMonth() + 1,
    DD: pad(d.getDate()), D: d.getDate(), dddd: DAYS[d.getDay()], ddd: DAYS[d.getDay()].slice(0, 3), HH: pad(d.getHours()), H: d.getHours(), hh: pad(d.getHours() % 12 || 12), h: d.getHours() % 12 || 12,
    mm: pad(d.getMinutes()), ss: pad(d.getSeconds()), A: d.getHours() < 12 ? 'AM' : 'PM', a: d.getHours() < 12 ? 'am' : 'pm' };
  return fmt.replace(/\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|dddd|ddd|DD|D|HH|H|hh|h|mm|ss|A|a/g, (m, lit) => (lit != null ? lit : String(tok[m])));
}
const shift = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** fill the variables; {{cursor}} becomes CURSOR so the editor can put the caret there */
export function fillTemplate(text, { title = 'Untitled', now = new Date() } = {}) {
  return String(text).replace(/\{\{\s*([a-z]+)(?:\s*:\s*([^}]*?))?\s*\}\}/gi, (all, name, fmt) => {
    switch (name.toLowerCase()) {
      case 'title': return title;
      case 'date': return formatDate(now, fmt || 'YYYY-MM-DD');
      case 'time': return formatDate(now, fmt || 'HH:mm');
      case 'datetime': return formatDate(now, fmt || 'YYYY-MM-DD HH:mm');
      case 'yesterday': return formatDate(shift(now, -1), fmt || 'YYYY-MM-DD');
      case 'tomorrow': return formatDate(shift(now, 1), fmt || 'YYYY-MM-DD');
      case 'weekday': return formatDate(now, fmt || 'dddd');
      case 'cursor': return CURSOR;
      default: return all;
    }
  });
}

const FM = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
/** a filled template as front matter and body; the body loses the leading blank lines */
export function splitTemplate(text) { const m = FM.exec(text); return { fm: m ? m[0] : '', body: (m ? text.slice(m[0].length) : text).replace(/^\s*\n/, '') }; }
/** a template going into a page that already exists: its title heading would repeat the page's, so it is left out */
export const intoPage = (body) => body.replace(/^# [^\n]*\n+/, '');

/** merge a template's properties into a page's front matter: new keys are added, lists and tags are joined */
export function mergeProps(pageFm, templateFm) {
  let out = pageFm;
  for (const p of parseProps(templateFm).props) {
    if (p.readOnly) continue;
    const cur = parseProps(out).props.find((x) => x.key === p.key);
    if (!cur) out = setProp(out, p.key, p.value, p.type);
    else if (Array.isArray(cur.value) && Array.isArray(p.value)) {
      const join = [...cur.value, ...p.value.filter((v) => !cur.value.some((c) => String(c).toLowerCase() === String(v).toLowerCase()))];
      if (join.length !== cur.value.length) out = setProp(out, p.key, join, cur.type);
    }
  }
  return out;
}

/** a template button: ```template-button``` with `label:`, `template:` and `where: above|below` lines */
export function parseButton(src) {
  const get = (k) => new RegExp(`^\\s*${k}\\s*:\\s*(.+?)\\s*$`, 'im').exec(src)?.[1]?.replace(/^["']|["']$/g, '');
  const template = get('template') || '';
  return { label: get('label') || (template ? `New ${template}` : 'Insert template'), template, where: /^above$/i.test(get('where') || '') ? 'above' : 'below' };
}
export const buttonSource = ({ label, template, where = 'below' }) => `\`\`\`template-button\nlabel: ${label}\ntemplate: ${template}${where === 'above' ? '\nwhere: above' : ''}\n\`\`\``;

/* ---------- starters: shown when Templates/ has no page of the same name ---------- */
export const STARTERS = [
  { name: DAILY, desc: 'The page a day link opens', text: `---
tags: [daily]
---
# {{date:dddd D MMMM YYYY}}

[[{{yesterday}}|← Yesterday]] · [[{{tomorrow}}|Tomorrow →]]

## Focus

- [ ] {{cursor}}Top priority

## Notes

## Done today
` },
  { name: 'Meeting notes', desc: 'Attendees, agenda, decisions, actions', text: `---
tags: [meeting]
date: {{date}}
attendees: []
---
# {{title}}

> [!info] {{date:D MMMM YYYY}}, {{time}}

## Agenda

1. {{cursor}}First topic

## Notes

## Decisions

- What was decided, and why

## Actions

- [ ] Owner: task, by date
` },
  { name: 'Decision log', desc: 'One decision: context, options, outcome (ADR)', text: `---
tags: [decision]
date: {{date}}
status: Proposed
deciders: []
---
# {{title}}

[status:: Proposed]

## Context

{{cursor}}

## Options

| Option | Pros | Cons |
| --- | --- | --- |
| A |  |  |
| B |  |  |

## Decision

## Consequences
` },
  { name: 'Project brief', desc: 'Problem, goals, scope, milestones, risks', text: `---
tags: [project]
owner: ""
start: {{date}}
status: Not started
---
# {{title}}

[status:: Not started]

## Problem

{{cursor}}

## Goals

- A measurable outcome

## Non-goals

- What this will not do

## Scope and milestones

| Milestone | Date | Owner |
| --- | --- | --- |
|  |  |  |

## Risks

> [!warning] What could stop this

## Links
` },
  { name: 'Status report', desc: 'Weekly progress for stakeholders', text: `---
tags: [status]
week: {{date}}
---
# {{title}}

**Week of {{date:D MMMM YYYY}}** · [status:: In progress]

## Summary

{{cursor}}

## Done

- What shipped

## Next

- What comes next

## Risks and blockers

| Risk | Impact | Owner | Action |
| --- | --- | --- | --- |
|  |  |  |  |

## Asks
` },
  { name: 'Review tracker', desc: 'Items to review, with owner and status', text: `---
tags: [review]
---
# {{title}}

| Item | Owner | Due | Status |
| --- | --- | --- | --- |
| {{cursor}} |  | {{tomorrow}} | [status:: Not started] |

## Checklist

- [ ] Content checked
- [ ] Figures checked
- [ ] Sign-off
` },
];

/** the templates on offer: pages in Templates/ first, then starters whose name is not taken */
export function listTemplates(files) {
  const mine = files.filter((f) => new RegExp(`^${TEMPLATE_DIR}/[^/]+\\.(md|markdown)$`, 'i').test(f) && !/\.(slides|board|sheet)\.md$/i.test(f))
    .map((f) => ({ name: f.split('/').pop().replace(/\.(md|markdown)$/i, ''), path: f }));
  const taken = new Set(mine.map((t) => t.name.toLowerCase()));
  return [...mine.sort((a, b) => a.name.localeCompare(b.name)), ...STARTERS.filter((s) => !taken.has(s.name.toLowerCase())).map((s) => ({ ...s, starter: true }))];
}
