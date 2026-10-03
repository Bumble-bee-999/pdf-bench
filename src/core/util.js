/** Small shared helpers: DOM building, formatting, files, toasts. */

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v);
  }
  kids.flat().forEach((k) => { if (k != null && k !== false) el.append(k.nodeType ? k : document.createTextNode(k)); });
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function bytesLabel(n) {
  if (n == null) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

export function download(data, name, type = 'application/pdf') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function pickFiles({ accept = 'application/pdf', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple, style: { display: 'none' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

export function readAsBytes(file) {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

/** Parse "1-3,7,10-" into a sorted array of zero-based page indices. */
export function parseRanges(text, pageCount) {
  const out = new Set();
  for (const part of String(text || '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(\d+)?\s*(-)?\s*(\d+)?$/);
    if (!m) continue;
    const [, a, dash, b] = m;
    if (dash) {
      const from = a ? Math.max(1, +a) : 1;
      const to = b ? Math.min(pageCount, +b) : pageCount;
      for (let i = from; i <= to; i++) out.add(i - 1);
    } else if (a) {
      const i = +a;
      if (i >= 1 && i <= pageCount) out.add(i - 1);
    }
  }
  return [...out].sort((x, y) => x - y);
}

export function hexToRgb01(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '#000000');
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 };
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ---------- toast + busy overlay ---------- */
let toastHost;
export function toast(msg, kind = '') {
  if (!toastHost) { toastHost = h('div', { class: 'toasts' }); document.body.append(toastHost); }
  const el = h('div', { class: 'toast ' + kind }, msg);
  toastHost.append(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

let veil, busyText, busyBar, busyDepth = 0;
export function busy(label = 'Working…') {
  busyDepth++;
  if (!veil) {
    busyText = h('div', {}, label);
    busyBar = h('i');
    veil = h('div', { class: 'veil' },
      h('div', { class: 'busy' }, h('div', { class: 'spin' }),
        h('div', {}, busyText, h('div', { class: 'bar' }, busyBar))));
    document.body.append(veil);
  }
  busyText.textContent = label;
  busyBar.style.width = '0%';
  return {
    set(label, pct) {
      if (label) busyText.textContent = label;
      if (pct != null) busyBar.style.width = Math.max(0, Math.min(100, pct * 100)) + '%';
    },
    done() {
      busyDepth = Math.max(0, busyDepth - 1);
      if (busyDepth === 0 && veil) { veil.remove(); veil = null; }
    },
  };
}

/** Let the browser paint between heavy steps. */
export const tick = () => new Promise((r) => setTimeout(r, 0));

export function confirmDialog(title, body, okLabel = 'Continue') {
  return new Promise((resolve) => {
    const close = (v) => { host.remove(); resolve(v); };
    const host = h('div', { class: 'veil', onclick: (e) => { if (e.target === host) close(false); } },
      h('div', { class: 'modal' },
        h('h3', {}, title),
        h('p', { class: 'hint' }, body),
        h('div', { class: 'actions' },
          h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
          h('button', { class: 'btn primary', onclick: () => close(true) }, okLabel))));
    document.body.append(host);
  });
}
