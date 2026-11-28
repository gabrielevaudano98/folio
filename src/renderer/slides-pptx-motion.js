// Folio — transitions and animations as PowerPoint XML (p:transition, p:timing), written into the package
// after pptxgenjs, and read back on import. Objects are found by name: `!!id` for placed objects (the name
// PowerPoint's Morph matches on) and `folio-body` for the slide text.
import { TRANSITIONS, EFFECTS, buildSteps, parseTransition, parseAnim, withFragments, FRAGMENTS } from './slides-motion.js';

const DIR = { l: 'l', r: 'r', u: 'u', d: 'd' };
/** a slide transition element (and auto-advance) */
export function transitionXml(t, advanceSec = null) {
  const tr = parseTransition(t || 'none');
  const adv = advanceSec != null ? ` advTm="${Math.round(advanceSec * 1000)}"` : '';
  if (tr.name === 'none') return adv ? `<p:transition${adv}/>` : '';
  const spd = tr.duration < 0.45 ? 'fast' : tr.duration < 0.9 ? 'med' : 'slow';
  const [kind, opt] = (TRANSITIONS[tr.name][1] || 'fade').split(':');
  let inner;
  switch (kind) {
    case 'fade': inner = opt === 'thruBlk' ? '<p:fade thruBlk="1"/>' : '<p:fade/>'; break;
    case 'push': case 'wipe': case 'cover': case 'pull': inner = `<p:${kind} dir="${DIR[opt] || 'l'}"/>`; break;
    case 'zoom': inner = opt === 'out' ? '<p:zoom dir="out"/>' : '<p:zoom/>'; break;
    case 'split': inner = '<p:split orient="vert" dir="out"/>'; break;
    case 'wheel': inner = '<p:wheel spokes="1"/>'; break;
    case 'blinds': inner = '<p:blinds dir="horz"/>'; break;
    case 'circle': inner = '<p:circle/>'; break;
    case 'dissolve': inner = '<p:dissolve/>'; break;
    case 'morph':
      return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p159="http://schemas.microsoft.com/office/powerpoint/2015/09/main" Requires="p159"><p:transition spd="slow"${adv}><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition spd="slow"${adv}><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>`;
    default: inner = '<p:fade/>';
  }
  return `<p:transition spd="${spd}"${adv}>${inner}</p:transition>`;
}

const FLY = { left: [8, '0-#ppt_w/2', '#ppt_x', 'ppt_x'], right: [2, '1+#ppt_w/2', '#ppt_x', 'ppt_x'], up: [4, '1+#ppt_h/2', '#ppt_y', 'ppt_y'], down: [1, '0-#ppt_h/2', '#ppt_y', 'ppt_y'] };
const CLASS = { entrance: 'entr', exit: 'exit', emphasis: 'emph', path: 'path' };

/** the timing tree for a slide's animations; spids: target → [{ spid, paras, pick? }] (pick: [first, last] paragraph ranges to build, one per click) */
export function timingXml(anims, spids, { W = 1280, H = 720 } = {}) {
  const usable = anims.filter((a) => spids[a.target]?.length);
  if (!usable.length) return '';
  let id = 2; const nid = () => ++id;
  const count = (s) => (s.pick ? s.pick.length : Math.max(1, s.paras));
  const parts = (a) => (a.by === 'paragraph' ? spids[a.target].reduce((n, s) => n + count(s), 0) : 1);
  const steps = buildSteps(usable, parts);
  const bld = new Map();
  const tgt = (a) => {
    // the shape (and paragraph) an effect targets: by=paragraph counts paragraphs across the target's shapes
    if (a.part == null) return spids[a.target].map((s) => ({ spid: s.spid, txt: '' }));
    let k = a.part; for (const s of spids[a.target]) { const n = count(s); if (k < n) { const [st, end] = s.pick ? s.pick[k] : [k, k]; bld.set(s.spid, 'p'); return [{ spid: s.spid, txt: `<p:txEl><p:pRg st="${st}" end="${end}"/></p:txEl>` }]; } k -= n; }
    return [];
  };
  const cBhvr = (dur, t, attr = '', extra = '') => `<p:cBhvr${extra}><p:cTn id="${nid()}" dur="${dur}" fill="hold"/><p:tgtEl><p:spTgt spid="${t.spid}">${t.txt}</p:spTgt></p:tgtEl>${attr ? `<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst>` : ''}</p:cBhvr>`;
  const vis = (t, val, delay = 0) => `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="${t.spid}">${t.txt}</p:spTgt></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
  const tween = (t, dur, attr, from, to) => `<p:anim calcmode="lin" valueType="num">${cBhvr(dur, t, attr, ' additive="base"')}<p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
  const fade = (t, dur, dir) => `<p:animEffect transition="${dir}" filter="fade">${cBhvr(dur, t)}</p:animEffect>`;
  const behaviours = (a, t) => {
    const dur = Math.round(a.duration * 1000); const e = a.effect; const k = a.kind;
    if (k === 'entrance') {
      if (e === 'appear') return vis(t, 'visible');
      if (e.startsWith('fly-in')) { const f = FLY[e.split('-').pop()]; return vis(t, 'visible') + tween(t, dur, f[3], f[1], f[2]); }
      if (e === 'zoom-in' || e === 'grow-in' || e === 'spin-in') return vis(t, 'visible') + tween(t, dur, 'ppt_w', '0', '#ppt_w') + tween(t, dur, 'ppt_h', '0', '#ppt_h') + fade(t, dur, 'in');
      if (e === 'wipe-in') return vis(t, 'visible') + `<p:animEffect transition="in" filter="wipe(left)">${cBhvr(dur, t)}</p:animEffect>`;
      if (e === 'float-in') return vis(t, 'visible') + fade(t, dur, 'in') + tween(t, dur, 'ppt_y', '#ppt_y+.1', '#ppt_y');
      return vis(t, 'visible') + fade(t, dur, 'in');
    }
    if (k === 'exit') {
      const hide = vis(t, 'hidden', Math.max(0, dur - 1));
      if (e === 'disappear') return vis(t, 'hidden');
      if (e.startsWith('fly-out')) { const f = FLY[e.split('-').pop()]; return tween(t, dur, f[3], f[2], f[1]) + hide; }
      if (e === 'zoom-out') return tween(t, dur, 'ppt_w', '#ppt_w', '0') + tween(t, dur, 'ppt_h', '#ppt_h', '0') + fade(t, dur, 'out') + hide;
      if (e === 'wipe-out') return `<p:animEffect transition="out" filter="wipe(right)">${cBhvr(dur, t)}</p:animEffect>` + hide;
      return fade(t, dur, 'out') + hide;
    }
    if (k === 'emphasis') {
      if (e === 'spin') return `<p:animRot by="21600000">${cBhvr(dur, t, 'r')}</p:animRot>`;
      if (e === 'teeter' || e === 'shake') return `<p:animRot by="300000">${cBhvr(Math.round(dur / 4), t, 'r', ' autoRev="1" repeatCount="2000"')}</p:animRot>`;
      if (e === 'flash') return `<p:animEffect transition="out" filter="fade">${cBhvr(Math.round(dur / 2), t, '', ' autoRev="1"')}</p:animEffect>`;
      const by = e === 'grow' ? 125000 : 112000;
      return `<p:animScale><p:cBhvr${e === 'pulse' ? ' autoRev="1"' : ''}><p:cTn id="${nid()}" dur="${e === 'pulse' ? Math.round(dur / 2) : dur}" fill="hold"/><p:tgtEl><p:spTgt spid="${t.spid}">${t.txt}</p:spTgt></p:tgtEl></p:cBhvr><p:by x="${by}" y="${by}"/></p:animScale>`;
    }
    // motion path, in fractions of the slide
    const p = a.path || { 'path-left': [-200, 0], 'path-right': [200, 0], 'path-up': [0, -150], 'path-down': [0, 150], 'path-arc': [240, 0] }[e] || [0, 0];
    const fx = (v) => Math.round((v / W) * 10000) / 10000, fy = (v) => Math.round((v / H) * 10000) / 10000;
    const path = e === 'path-arc' ? `M 0 0 C ${fx(p[0] / 4)} ${fy(-160)} ${fx((p[0] * 3) / 4)} ${fy(-160)} ${fx(p[0])} 0 E` : `M 0 0 L ${fx(p[0])} ${fy(p[1])} E`;
    return `<p:animMotion origin="layout" path="${path}" pathEditMode="relative" ptsTypes="">${cBhvr(dur, t, 'ppt_x</p:attrName><p:attrName>ppt_y')}</p:animMotion>`;
  };
  const stepXml = steps.map((st) => {
    const effects = st.map(({ anim, start }, n) => {
      const ts = tgt(anim); if (!ts.length) return '';
      const preset = EFFECTS[anim.effect][2] || (anim.kind === 'path' ? 0 : 10);
      const sub = anim.effect.startsWith('fly') ? FLY[anim.effect.split('-').pop()][0] : 0;
      const node = n === 0 ? 'clickEffect' : anim.trigger === 'after' ? 'afterEffect' : 'withEffect';
      const rep = anim.repeat === Infinity ? ' repeatCount="indefinite"' : anim.repeat > 1 ? ` repeatCount="${anim.repeat * 1000}"` : '';
      for (const t of ts) if (!bld.has(t.spid)) bld.set(t.spid, '');
      return `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="${Math.round(start * 1000)}"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${nid()}" presetID="${preset}" presetClass="${CLASS[anim.kind]}" presetSubtype="${sub}" fill="hold"${rep} grpId="0" nodeType="${node}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${ts.map((t) => behaviours(anim, t)).join('')}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`;
    }).join('');
    return `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:par>`;
  }).join('');
  const bldLst = [...bld].map(([spid, how]) => `<p:bldP spid="${spid}" grpId="0"${how === 'p' ? ' build="p"' : ''} animBg="1"/>`).join('');
  return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${stepXml}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${bldLst ? `<p:bldLst>${bldLst}</p:bldLst>` : ''}</p:timing>`;
}

/** shapes of a slide part, by name: `!!id` → id, `folio-body` → body */
export function shapeIndex(xml) {
  const map = {};
  for (const m of xml.matchAll(/<p:(sp|pic|cxnSp|graphicFrame)>([\s\S]*?)<\/p:\1>/g)) {
    const c = m[2].match(/<p:cNvPr id="(\d+)" name="([^"]*)"/); if (!c) continue;
    const name = c[2].replace(/&amp;/g, '&');
    const key = name === 'folio-body' ? 'body' : name.startsWith('!!') ? name.slice(2) : null; if (!key) continue;
    (map[key] ||= []).push({ spid: c[1], paras: (m[2].match(/<a:p>|<a:p\s/g) || []).length });
  }
  return map;
}

/** the shapes of a slide part by their exact name, in document order */
export function shapesByName(xml) {
  const map = {};
  for (const m of xml.matchAll(/<p:(sp|pic|cxnSp|graphicFrame)>([\s\S]*?)<\/p:\1>/g)) {
    const c = m[2].match(/<p:cNvPr id="(\d+)" name="([^"]*)"/); if (!c) continue;
    (map[c[2].replace(/&amp;/g, '&')] ||= []).push({ spid: c[1], paras: (m[2].match(/<a:p>|<a:p\s/g) || []).length });
  }
  return map;
}
/**
 * fragmented list items ({ name, ranges } per text frame, in the order the frames were written) as the target of one
 * paragraph build: the k-th frame called X is the k-th shape called X
 */
export function fragmentTargets(xml, fragments) {
  const byName = shapesByName(xml); const seen = {}; const out = [];
  for (const f of fragments || []) { const k = (seen[f.name] = (seen[f.name] ?? -1) + 1); const sh = byName[f.name]?.[k]; if (sh && f.ranges.length) out.push({ spid: sh.spid, paras: sh.paras, pick: f.ranges.filter(([a, b]) => a <= b && b < sh.paras) }); }
  return out.filter((t) => t.pick.length);
}

/** write transitions and animations into the slide parts of a package (a JSZip) */
export async function writeMotion(zip, slides, { W, H } = {}) {
  for (const { n, transition, advance, animations, fragments } of slides) {
    const name = `ppt/slides/slide${n}.xml`; const f = zip.file(name); if (!f) continue;
    let xml = await f.async('string');
    const adv = advance != null ? parseFloat(advance) : null;
    const tr = transitionXml(transition, Number.isFinite(adv) ? adv : null);
    const spids = shapeIndex(xml); const frag = fragmentTargets(xml, fragments);
    if (frag.length) spids[FRAGMENTS] = frag;
    const builds = withFragments(animations, frag.length);
    const tm = builds.length ? timingXml(builds, spids, { W, H }) : '';
    if (!tr && !tm) continue;
    xml = xml.replace(/<p:transition[\s\S]*?(<\/p:transition>|\/>)|<p:timing>[\s\S]*?<\/p:timing>/g, '');
    xml = xml.replace(/(<\/p:clrMapOvr>)/, `$1${tr}${tm}`);
    zip.file(name, xml);
  }
}

/* ---------- import ---------- */
const PT_TRANS = { fade: 'fade', push: 'push', wipe: 'wipe', cover: 'cover', pull: 'uncover', split: 'split', zoom: 'zoom', circle: 'iris', wheel: 'clock', blinds: 'blinds', dissolve: 'dissolve', morph: 'morph', random: 'fade' };
const DIRS = { l: 'left', r: 'right', u: 'up', d: 'down' };
/** a slide part's transition as a Folio transition value */
export function readTransition(xml) {
  const m = xml.match(/<p:transition\b([^>]*)>([\s\S]*?)<\/p:transition>/) || xml.match(/<p:transition\b([^>]*)\/>/);
  if (!m) return { transition: null, advance: null };
  const adv = (m[1].match(/advTm="(\d+)"/) || [])[1];
  const inner = m[2] || ''; const morph = /p159:morph/.test(xml.slice(Math.max(0, m.index - 600), m.index + m[0].length));
  const el = inner.match(/<(?:p|p14|p159):(\w+)\b([^>]*)/);
  let name = morph ? 'morph' : el ? PT_TRANS[el[1]] || 'fade' : null;
  if (name && ['push', 'wipe', 'cover', 'uncover'].includes(name)) { const d = DIRS[(el[2].match(/dir="(\w)/) || [])[1]] || 'left'; name = name === 'cover' || name === 'uncover' ? `${name}-${d === 'right' ? 'right' : 'left'}` : `${name}-${d}`; }
  if (name === 'fade' && /thruBlk="(1|true)"/.test(el?.[2] || '')) name = 'fade-black';
  if (name === 'zoom' && /dir="out"/.test(el?.[2] || '')) name = 'zoom-out';
  const spd = (m[1].match(/spd="(\w+)"/) || [])[1]; const dur = (m[1].match(/p14:dur="(\d+)"/) || [])[1];
  const sec = dur ? +dur / 1000 : { fast: 0.3, med: 0.5, slow: 1 }[spd] ?? 0.5;
  return { transition: name ? `${name}${sec !== 0.5 ? ' ' + (sec < 1 ? Math.round(sec * 1000) + 'ms' : sec + 's') : ''}` : null, advance: adv ? `${+adv / 1000}s` : null };
}
const PRESET_IN = { 1: 'appear', 10: 'fade-in', 53: 'zoom-in', 23: 'zoom-in', 31: 'grow-in', 22: 'wipe-in', 42: 'float-in', 26: 'bounce-in', 47: 'fade-in' };
const PRESET_OUT = { 1: 'disappear', 10: 'fade-out', 53: 'zoom-out', 23: 'zoom-out', 22: 'wipe-out' };
const PRESET_EM = { 8: 'spin', 6: 'grow', 26: 'pulse', 32: 'teeter', 35: 'flash' };
const SUB_FLY = { 8: 'left', 2: 'right', 4: 'up', 1: 'down' };
/** a slide part's animations as `animate:` values, given shape id → Folio target */
export function readAnimations(xml, targetOf) {
  const out = [];
  const t = xml.match(/<p:timing>[\s\S]*<\/p:timing>/); if (!t) return out;
  const re = /<p:cTn\b([^>]*presetClass="(\w+)"[^>]*)>([\s\S]*?)<p:spTgt spid="(\d+)"/g; let m;
  while ((m = re.exec(t[0]))) {
    const at = m[1]; const cls = m[2]; const id = +(at.match(/presetID="(\d+)"/) || [])[1]; const sub = +(at.match(/presetSubtype="(\d+)"/) || [])[1];
    const node = (at.match(/nodeType="(\w+)"/) || [])[1];
    const target = targetOf(m[4]); if (!target) continue;
    let effect = cls === 'entr' ? (id === 2 ? `fly-in-${SUB_FLY[sub] || 'up'}` : PRESET_IN[id] || 'fade-in') : cls === 'exit' ? (id === 2 ? `fly-out-${SUB_FLY[sub] || 'down'}` : PRESET_OUT[id] || 'fade-out') : cls === 'emph' ? PRESET_EM[id] || 'pulse' : 'path-right';
    if (!EFFECTS[effect]) effect = 'fade-in';
    // the effect's own block runs to the next effect: its longest timed child is the duration
    const rest = t[0].slice(m.index); const skip = m[1].length + 8; const nextAt = rest.slice(skip).search(/presetClass="/); const seg = nextAt > 0 ? rest.slice(0, nextAt + skip) : rest;
    const durs = [...seg.matchAll(/dur="(\d+)"/g)].map((x) => +x[1]).filter((x) => x > 1);
    const dur = durs.length ? Math.max(...durs) * (/autoRev="1"/.test(seg) ? 2 : 1) : 0;
    const before = t[0].slice(Math.max(0, m.index - 400), m.index); const conds = [...before.matchAll(/<p:cond delay="(\d+)"\/>/g)];
    const delay = conds.length ? +conds[conds.length - 1][1] : 0;
    const words = [target === 'body' ? 'body' : `#${target}`, effect];
    if (node === 'withEffect') words.push('with'); else if (node === 'afterEffect') words.push('after');
    const a = parseAnim(words.join(' '));
    if (dur && dur > 1 && Math.abs(dur / 1000 - a.duration) > 0.01) words.push(dur < 1000 ? `${dur}ms` : `${dur / 1000}s`);
    if (delay > 0 && node === 'withEffect') words.push(`delay=${delay < 1000 ? delay + 'ms' : delay / 1000 + 's'}`);
    if (t[0].slice(m.index + m[0].length, m.index + m[0].length + 12).includes('<p:txEl>')) { if (out.some((x) => x.startsWith(words[0] + ' ') && x.includes('by=paragraph'))) continue; words.push('by=paragraph'); }
    out.push(words.join(' '));
    re.lastIndex = m.index + m[0].length;
  }
  return out;
}
