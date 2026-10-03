/** Page view with the live markup overlay. */
import { store, emit, on, pageAnnots, commit } from '../core/store.js';
import { renderPage, textRuns } from '../core/render.js';
import { visualSize } from '../core/geometry.js';
import { h, uid, toast } from '../core/util.js';

let host, canvas, overlay, wrap, label, editor;
let renderToken = 0;
let cssW = 0, cssH = 0, vw = 0, vh = 0;
let sel = null;         // selected annotation
let drag = null;        // active drag state
let scale = 1;          // css px per PDF point
let runs = [];          // editable text lines on the current page
let runsKey = null;

export function readerView() {
  canvas = h('canvas');
  overlay = h('canvas', { class: 'overlay' });
  label = h('div', { class: 'page-label' });
  wrap = h('div', { class: 'page-wrap' }, canvas, overlay, label);
  host = h('div', { class: 'pageview' }, wrap);
  bindOverlay();
  render();
  return host;
}

function pageMeta() {
  const m = store.pageSizes[store.page] || { w: 612, h: 792, rotation: 0 };
  return { ...m, ...visualSize(m.w, m.h, m.rotation) };
}

export async function render() {
  if (!store.pdf || !canvas) return;
  const token = ++renderToken;
  const meta = pageMeta();
  vw = meta.w; vh = meta.h;
  scale = store.zoom;
  const dims = await renderPage(store.pdf, store.page, store.zoom, canvas);
  if (token !== renderToken) return;
  cssW = dims.cssWidth; cssH = dims.cssHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.floor(cssW * dpr);
  overlay.height = Math.floor(cssH * dpr);
  overlay.style.width = cssW + 'px';
  overlay.style.height = cssH + 'px';
  label.textContent = `Page ${store.page + 1} of ${store.pageCount}`;
  wrap.classList.toggle('select-mode', store.draw === 'select');
  paint();
  loadRuns(token);
}

async function loadRuns(token) {
  const key = store.page + ':' + (store.bytes?.length ?? 0);
  if (key === runsKey) return;
  try {
    const found = await textRuns(store.pdf, store.page);
    if (token !== renderToken) return;
    runs = found;
    runsKey = key;
  } catch { runs = []; }
}

const FONT_FOR = (family, bold) => {
  const f = /serif/.test(family) && !/sans/.test(family) ? 'Times' : /mono/.test(family) ? 'Courier' : 'Helvetica';
  return f === 'Times' ? (bold ? 'Times-Bold' : 'Times-Roman') : bold ? `${f}-Bold` : f;
};

/** Most common colour in a thin ring just outside the box = the page background. */
function sampleBackground(box) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const k = canvas.width / vw;
  const tally = new Map();
  const grab = (x, y) => {
    const px = Math.round(x * k); const py = Math.round(y * k);
    if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return;
    const d = ctx.getImageData(px, py, 1, 1).data;
    const key = ((d[0] >> 3) << 10) | ((d[1] >> 3) << 5) | (d[2] >> 3);
    const e = tally.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += d[0]; e.g += d[1]; e.b += d[2];
    tally.set(key, e);
  };
  const m = 2.5;
  for (let t = 0; t <= 1; t += 0.05) {
    grab(box.x - m, box.y + box.h * t); grab(box.x + box.w + m, box.y + box.h * t);
    grab(box.x + box.w * t, box.y - m); grab(box.x + box.w * t, box.y + box.h + m);
  }
  let best = null;
  for (const e of tally.values()) if (!best || e.n > best.n) best = e;
  if (!best) return [255, 255, 255];
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

/** The pixel inside the box that differs most from the background is the ink colour. */
function sampleInk(box, bg) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const k = canvas.width / vw;
  const x0 = Math.max(0, Math.floor(box.x * k)); const y0 = Math.max(0, Math.floor(box.y * k));
  const w = Math.max(1, Math.min(canvas.width - x0, Math.ceil(box.w * k)));
  const h = Math.max(1, Math.min(canvas.height - y0, Math.ceil(box.h * k)));
  const d = ctx.getImageData(x0, y0, w, h).data;
  let far = 0; let pick = [0, 0, 0];
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
    if (dist > far) { far = dist; pick = [d[i], d[i + 1], d[i + 2]]; }
  }
  return far < 90 ? [0, 0, 0] : pick;
}

const toHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');

/* ---------------- overlay painting ---------------- */

export function paint() {
  if (!overlay) return;
  const ctx = overlay.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0); // draw in PDF points
  ctx.clearRect(0, 0, vw, vh);
  const list = store.annots[store.page] || [];
  for (const a of list) drawAnnot(ctx, a);
  if (drag?.preview) drawAnnot(ctx, drag.preview);
  if (sel) outline(ctx, sel);
}

function drawAnnot(ctx, a) {
  ctx.save();
  ctx.globalAlpha = a.opacity ?? 1;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineJoin = ctx.lineCap = 'round';
  if (a.type === 'ink' || a.type === 'highlight') {
    ctx.lineWidth = a.type === 'highlight' ? (a.width || 14) : (a.width || 3);
    if (a.type === 'highlight') { ctx.globalAlpha = (a.opacity ?? 0.4); ctx.globalCompositeOperation = 'multiply'; }
    ctx.beginPath();
    (a.points || []).forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    if ((a.points || []).length === 1) ctx.arc(a.points[0][0], a.points[0][1], ctx.lineWidth / 2, 0, 7);
    ctx.stroke();
  } else if (a.type === 'line' || a.type === 'arrow') {
    ctx.lineWidth = a.width || 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x2, a.y2); ctx.stroke();
    if (a.type === 'arrow') {
      const ang = Math.atan2(a.y2 - a.y, a.x2 - a.x);
      const len = 6 + (a.width || 2) * 2.4;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        ctx.moveTo(a.x2, a.y2);
        ctx.lineTo(a.x2 - len * Math.cos(ang + s * 0.42), a.y2 - len * Math.sin(ang + s * 0.42));
      }
      ctx.stroke();
    }
  } else if (a.type === 'rect' || a.type === 'redact') {
    ctx.lineWidth = a.width || 2;
    if (a.type === 'redact') { ctx.fillStyle = '#000'; ctx.globalAlpha = 1; ctx.fillRect(a.x, a.y, a.w, a.h); }
    else if (a.fill) ctx.fillRect(a.x, a.y, a.w, a.h);
    else ctx.strokeRect(a.x, a.y, a.w, a.h);
  } else if (a.type === 'ellipse') {
    ctx.lineWidth = a.width || 2;
    ctx.beginPath();
    ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, 7);
    a.fill ? ctx.fill() : ctx.stroke();
  } else if (a.type === 'text' || a.type === 'note') {
    const size = a.size || 14;
    const lines = String(a.text || '').split('\n');
    if (a.type === 'note') {
      const wpad = a.w || 160;
      const hpad = a.h || lines.length * size * 1.25 + 12;
      ctx.fillStyle = '#ffeda1'; ctx.strokeStyle = '#d9b333'; ctx.lineWidth = 0.75;
      ctx.fillRect(a.x, a.y, wpad, hpad); ctx.strokeRect(a.x, a.y, wpad, hpad);
      ctx.fillStyle = '#26220d';
    }
    ctx.font = `${size}px ${/Times/.test(a.font) ? 'Times, serif' : /Courier/.test(a.font) ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif'}`;
    ctx.textBaseline = 'alphabetic';
    lines.forEach((l, i) => ctx.fillText(l, a.x + (a.type === 'note' ? 6 : 0), a.y + size * (0.85 + i * 1.25) + (a.type === 'note' ? 6 : 0)));
  } else if (a.type === 'replace') {
    ctx.fillStyle = a.bg || '#fff';
    ctx.fillRect(a.x - 1.4, a.y - 1.4, a.w + 2.8, a.h + 2.8);
    ctx.fillStyle = a.color;
    const size = a.size || 12;
    ctx.font = `${/Bold/.test(a.font) ? 'bold ' : ''}${size}px ${/Times/.test(a.font) ? 'Times, serif' : /Courier/.test(a.font) ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif'}`;
    String(a.text || '').split('\n').forEach((l, i) => ctx.fillText(l, a.x, a.y + size * 0.82 + i * size * 1.2));
  } else if (a.type === 'field') {
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(80,140,255,.14)';
    ctx.strokeStyle = '#4a9eff';
    ctx.lineWidth = 1.2;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.strokeRect(a.x, a.y, a.w, a.h);
    ctx.setLineDash([]);
    ctx.fillStyle = '#2f6fcf';
    ctx.font = '9px Helvetica, Arial, sans-serif';
    const kind = a.fieldType === 'check' ? '☐' : a.fieldType === 'dropdown' ? '▾' : '▭';
    ctx.fillText(`${kind} ${a.name || a.fieldType}`, a.x + 3, a.y + Math.min(a.h - 3, 11));
  } else if (a.type === 'image' || a.type === 'signature') {
    const img = imageFor(a.data);
    if (img?.complete) ctx.drawImage(img, a.x, a.y, a.w, a.h);
  }
  ctx.restore();
}

const imgCache = new Map();
function imageFor(dataUrl) {
  if (!imgCache.has(dataUrl)) {
    const img = new Image();
    img.onload = () => paint();
    img.src = dataUrl;
    imgCache.set(dataUrl, img);
  }
  return imgCache.get(dataUrl);
}

function bbox(a) {
  if (a.type === 'ink' || a.type === 'highlight') {
    const xs = a.points.map((p) => p[0]); const ys = a.points.map((p) => p[1]);
    const pad = (a.width || 3) / 2 + 2;
    return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  }
  if (a.type === 'line' || a.type === 'arrow') {
    return { x: Math.min(a.x, a.x2) - 4, y: Math.min(a.y, a.y2) - 4, w: Math.abs(a.x2 - a.x) + 8, h: Math.abs(a.y2 - a.y) + 8 };
  }
  if (a.type === 'text') {
    const size = a.size || 14;
    const lines = String(a.text || ' ').split('\n');
    return { x: a.x - 2, y: a.y - 2, w: Math.max(40, size * 0.55 * Math.max(...lines.map((l) => l.length))) + 4, h: lines.length * size * 1.25 + 4 };
  }
  if (a.type === 'note') {
    const size = a.size || 14;
    const lines = String(a.text || ' ').split('\n');
    return { x: a.x, y: a.y, w: a.w || 160, h: a.h || lines.length * size * 1.25 + 12 };
  }
  if (a.type === 'replace') return { x: a.x - 1.4, y: a.y - 1.4, w: a.w + 2.8, h: a.h + 2.8 };
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}

function outline(ctx, a) {
  const b = bbox(a);
  ctx.save();
  ctx.strokeStyle = '#4a9eff';
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([4 / scale, 3 / scale]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  ctx.fillStyle = '#4a9eff';
  const s = 7 / scale;
  ctx.fillRect(b.x + b.w - s / 2, b.y + b.h - s / 2, s, s);
  ctx.restore();
}

function hit(x, y) {
  const list = store.annots[store.page] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const b = bbox(list[i]);
    if (x >= b.x - 3 && x <= b.x + b.w + 3 && y >= b.y - 3 && y <= b.y + b.h + 3) return list[i];
  }
  return null;
}

/* ---------------- interaction ---------------- */

function pt(e) {
  const r = overlay.getBoundingClientRect();
  return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
}

function bindOverlay() {
  // The browser's default action for a press is to move focus to the clicked
  // element, which would immediately blur an editor opened by that same press
  // and discard it. Suppress it, and commit any open editor explicitly instead.
  overlay.addEventListener('mousedown', (e) => e.preventDefault());

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (editor) editor.blur();
    overlay.setPointerCapture(e.pointerId);
    const p = pt(e);
    const tool = store.draw;
    const st = store.style;

    if (tool === 'select') {
      const target = hit(p.x, p.y);
      sel = target;
      if (target) {
        const b = bbox(target);
        const onHandle = Math.abs(p.x - (b.x + b.w)) < 8 / scale && Math.abs(p.y - (b.y + b.h)) < 8 / scale;
        drag = { mode: onHandle ? 'resize' : 'move', a: target, start: p, orig: JSON.parse(JSON.stringify(target)) };
      }
      paint();
      emit('annot-select', sel);
      return;
    }

    const base = { id: uid(), color: st.color, opacity: st.opacity, width: st.width };
    if (tool === 'edittext') {
      const line = runs.find((r) => p.x >= r.x - 2 && p.x <= r.x + r.w + 2 && p.y >= r.y - 2 && p.y <= r.y + r.h + 2);
      if (!line) { toast('No editable text here. Click directly on a line of text.', 'err'); return; }
      const box = { x: line.x, y: line.y, w: line.w, h: line.h };
      const bg = sampleBackground(box);
      const ink = sampleInk(box, bg);
      const a = {
        ...base, type: 'replace', x: line.x, y: line.y, w: line.w, h: line.h,
        text: line.str, orig: line.str, size: line.size, font: FONT_FOR(line.family, line.bold),
        bg: toHex(bg), color: toHex(ink), opacity: 1,
      };
      pageAnnots(store.page).push(a);
      sel = a;
      paint();
      openEditor(a);
      return;
    }
    if (tool === 'field-text' || tool === 'field-dropdown') {
      const a = {
        id: uid(), type: 'field', fieldType: tool === 'field-text' ? 'text' : 'dropdown',
        name: store.fieldName || '', options: [...(store.fieldOptions || [])], multiline: !!store.fieldMultiline,
        x: p.x, y: p.y, w: 0, h: 0,
      };
      drag = { mode: 'box', a, start: p };
      pageAnnots(store.page).push(a);
      return;
    }
    if (tool === 'field-check') {
      const a = { id: uid(), type: 'field', fieldType: 'check', name: store.fieldName || '', x: p.x - 7, y: p.y - 7, w: 14, h: 14 };
      pageAnnots(store.page).push(a);
      sel = a;
      commitLater();
      paint();
      return;
    }
    if (tool === 'pen' || tool === 'highlighter') {
      const a = { ...base, type: tool === 'pen' ? 'ink' : 'highlight', points: [[p.x, p.y]] };
      if (tool === 'highlighter') { a.width = Math.max(8, st.width * 4); a.opacity = 0.4; }
      drag = { mode: 'draw', a };
      pageAnnots(store.page).push(a);
    } else if (['rect', 'ellipse', 'redact'].includes(tool)) {
      const a = { ...base, type: tool, x: p.x, y: p.y, w: 0, h: 0, fill: tool === 'redact' };
      drag = { mode: 'box', a, start: p };
      pageAnnots(store.page).push(a);
    } else if (tool === 'line' || tool === 'arrow') {
      const a = { ...base, type: tool, x: p.x, y: p.y, x2: p.x, y2: p.y };
      drag = { mode: 'line', a, start: p };
      pageAnnots(store.page).push(a);
    } else if (tool === 'text' || tool === 'note') {
      const a = { ...base, type: tool, x: p.x, y: p.y, text: '', size: st.size, font: st.font };
      if (tool === 'note') { a.w = 170; a.h = 70; a.color = '#26220d'; }
      pageAnnots(store.page).push(a);
      sel = a;
      paint();
      openEditor(a);
      commitLater();
    } else if (tool === 'signature') {
      if (!store.signature) { toast('Create a signature first, in Fill & Sign.', 'err'); return; }
      const wpt = 150;
      const img = imageFor(store.signature);
      const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0.4;
      const a = { ...base, type: 'signature', data: store.signature, x: p.x, y: p.y, w: wpt, h: wpt * ratio, opacity: 1 };
      pageAnnots(store.page).push(a);
      sel = a;
      store.draw = 'select';
      emit('tool-changed');
      commitLater();
    } else if (tool === 'stamp' && store.stampImage) {
      const img = imageFor(store.stampImage);
      const ratio = img.naturalHeight && img.naturalWidth ? img.naturalHeight / img.naturalWidth : 1;
      const a = { ...base, type: 'image', data: store.stampImage, x: p.x, y: p.y, w: 140, h: 140 * ratio, opacity: 1 };
      pageAnnots(store.page).push(a);
      sel = a;
      commitLater();
    }
    paint();
  });

  overlay.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const p = pt(e);
    const a = drag.a;
    if (drag.mode === 'draw') {
      const last = a.points[a.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) > 0.6) a.points.push([p.x, p.y]);
    } else if (drag.mode === 'box') {
      a.x = Math.min(drag.start.x, p.x); a.y = Math.min(drag.start.y, p.y);
      a.w = Math.abs(p.x - drag.start.x); a.h = Math.abs(p.y - drag.start.y);
    } else if (drag.mode === 'line') {
      a.x2 = p.x; a.y2 = p.y;
    } else if (drag.mode === 'move') {
      const dx = p.x - drag.start.x; const dy = p.y - drag.start.y;
      const o = drag.orig;
      if (a.points) a.points = o.points.map(([x, y]) => [x + dx, y + dy]);
      else { a.x = o.x + dx; a.y = o.y + dy; if (o.x2 != null) { a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; } }
    } else if (drag.mode === 'resize') {
      const o = drag.orig;
      if (a.w != null) { a.w = Math.max(6, p.x - o.x); a.h = Math.max(6, p.y - o.y); }
      else if (a.size != null) { a.size = Math.max(6, o.size + (p.y - drag.start.y) * 0.6); }
    }
    paint();
  });

  const end = () => {
    if (!drag) return;
    const a = drag.a;
    if (drag.mode === 'box' && (a.w < 2 || a.h < 2)) removeAnnot(a);
    if (drag.mode === 'line' && Math.hypot(a.x2 - a.x, a.y2 - a.y) < 2) removeAnnot(a);
    drag = null;
    commitLater();
    paint();
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);

  overlay.addEventListener('dblclick', (e) => {
    const p = pt(e);
    const target = hit(p.x, p.y);
    if (target && (target.type === 'text' || target.type === 'note' || target.type === 'replace')) { sel = target; openEditor(target); }
  });
}

let commitTimer;
function commitLater() {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => { commit('markup'); emit('annots'); }, 400);
}

export function removeAnnot(a) {
  const list = store.annots[store.page] || [];
  const i = list.indexOf(a);
  if (i >= 0) list.splice(i, 1);
  if (sel === a) sel = null;
  commitLater();
  paint();
}

export function selected() { return sel; }
export function clearSelection() { sel = null; paint(); }

/** Inline text editor floating over the page. */
function openEditor(a) {
  closeEditor();
  const size = (a.size || 14) * scale;
  const isReplace = a.type === 'replace';
  editor = h('textarea', {
    style: {
      position: 'absolute', left: a.x * scale + 'px', top: a.y * scale + 'px',
      width: Math.max(isReplace ? 120 : 140, (a.w || 160) * scale + (isReplace ? 24 : 0)) + 'px',
      height: Math.max(isReplace ? 22 : 28, (a.h || (a.size || 14) * 2) * scale + (isReplace ? 4 : 0)) + 'px',
      font: `${/Bold/.test(a.font) ? 'bold ' : ''}${size}px ${/Times/.test(a.font) ? 'Times, serif' : /Courier/.test(a.font) ? 'Courier, monospace' : 'Helvetica, Arial, sans-serif'}`,
      color: a.type === 'note' ? '#26220d' : a.color,
      background: a.type === 'note' ? '#ffeda1' : isReplace ? a.bg : 'rgba(255,255,255,.92)',
      border: '1px solid #4a9eff', borderRadius: '3px', padding: '2px 4px',
      resize: 'both', zIndex: 10, lineHeight: '1.25',
    },
  });
  editor.value = a.text || '';
  wrap.append(editor);
  editor.focus();
  const sync = () => { a.text = editor.value; paint(); };
  editor.addEventListener('input', sync);
  editor.addEventListener('blur', () => {
    sync();
    // A replacement may be empty (that erases the line); one that matches the
    // original changes nothing, so it is dropped rather than left as a patch.
    if (isReplace ? a.text === a.orig : !a.text.trim()) removeAnnot(a);
    closeEditor();
    commitLater();
  });
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { editor.blur(); }
    e.stopPropagation();
  });
}

export function closeEditor() {
  if (editor) { editor.remove(); editor = null; }
}

on('doc', () => { sel = null; });
