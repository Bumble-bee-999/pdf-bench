/**
 * PDF Bench — application shell.
 *
 * Everything happens in this process: no upload, no server, no telemetry.
 */
import './core/polyfills.js';
import { store, on, emit, undo, redo, canUndo, canRedo } from './core/store.js';
import { h, $, toast, bytesLabel, pickFiles, readAsBytes, busy } from './core/util.js';
import { loadBytes, reload, exportPdf, ops, makePermanent } from './core/app.js';
import { readerView, render as renderPage, closeEditor, selected as selectedAnnot, removeAnnot } from './ui/reader.js';
import { organizerView, build as buildGrid } from './ui/organizer.js';
import { PANELS, byId } from './ui/panels/index.js';
import { needsPassword } from './core/pdfops.js';

const app = document.getElementById('app');
let workHost, panelHost, statusHost, docLabel, undoBtn, redoBtn, viewBtns, mainEl;

/* ---------------- shell ---------------- */

function build() {
  docLabel = h('span', { class: 'docname' });
  undoBtn = h('button', { class: 'btn ghost sm', title: 'Undo (Ctrl+Z)', onclick: () => undo(reload) }, '↶');
  redoBtn = h('button', { class: 'btn ghost sm', title: 'Redo (Ctrl+Y)', onclick: () => redo(reload) }, '↷');

  const topbar = h('div', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'mark' }, 'B'), 'PDF Bench'),
    h('button', { class: 'btn sm', onclick: openDialog }, 'Open'),
    h('button', { class: 'btn sm primary', onclick: () => exportPdf() }, 'Save as…'),
    undoBtn, redoBtn,
    docLabel,
    h('div', { class: 'spacer' }),
    zoomControls(),
    h('button', {
      class: 'btn ghost sm', title: 'Light / dark',
      onclick: () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.dataset.theme = next;
        try { localStorage.setItem('pdfbench.theme', next); } catch {}
      },
    }, '◐'));

  const rail = h('div', { class: 'rail' });
  const groups = [...new Set(PANELS.map((p) => p.group))];
  groups.forEach((g) => {
    const box = h('div', { class: 'rail-group' }, h('h4', {}, g));
    PANELS.filter((p) => p.group === g).forEach((p) => {
      box.append(h('button', {
        class: 'rail-item' + (store.tool === p.id ? ' active' : ''),
        'data-tool': p.id,
        onclick: () => selectTool(p.id),
      }, h('span', { class: 'ico' }, p.icon), p.label));
    });
    rail.append(box);
  });

  workHost = h('div', { class: 'work' });
  panelHost = h('div', { class: 'panel' });
  mainEl = h('div', { class: 'main' }, rail, workHost, panelHost);
  statusHost = h('div', { class: 'status' });

  app.append(h('div', { class: 'shell' }, topbar, mainEl, statusHost));
  drawStatus();
  drawWork();
  drawPanel();
}

function zoomControls() {
  viewBtns = h('div', { class: 'btn-row' },
    h('button', { class: 'btn ghost sm', 'data-view': 'organize', onclick: () => setView('organize') }, 'Pages'),
    h('button', { class: 'btn ghost sm', 'data-view': 'read', onclick: () => setView('read') }, 'Read'));
  return h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } },
    viewBtns,
    h('button', { class: 'btn ghost sm', title: 'Zoom out', onclick: () => zoom(-0.15) }, '−'),
    h('button', { class: 'btn ghost sm', title: 'Zoom in', onclick: () => zoom(0.15) }, '+'),
    h('button', { class: 'btn ghost sm', title: 'Fit width', onclick: fitWidth }, 'Fit'));
}

function zoom(delta) {
  store.zoom = Math.max(0.2, Math.min(5, store.zoom + delta));
  renderPage();
  drawStatus();
}

function fitWidth() {
  const meta = store.pageSizes[store.page];
  if (!meta) return;
  const vw = meta.rotation % 180 ? meta.h : meta.w;
  store.zoom = Math.max(0.2, (workHost.clientWidth - 60) / vw);
  renderPage();
  drawStatus();
}

function setView(v) {
  store.view = v;
  closeEditor();
  drawWork();
  drawStatus();
}

function selectTool(id) {
  store.tool = id;
  document.querySelectorAll('.rail-item').forEach((n) => n.classList.toggle('active', n.dataset.tool === id));
  const panel = byId[id];
  if (panel?.needsReader && store.view !== 'read') setView('read');
  if (id === 'pages' && store.view !== 'organize') setView('organize');
  drawPanel();
}

/* ---------------- regions ---------------- */

function drawWork() {
  workHost.textContent = '';
  if (!store.pdf) { workHost.append(emptyState()); return; }
  workHost.append(store.view === 'read' ? readerView() : organizerView());
  viewBtns?.querySelectorAll('button').forEach((b) => b.classList.toggle('primary', b.dataset.view === store.view));
}

function drawPanel() {
  panelHost.textContent = '';
  if (!store.pdf) {
    panelHost.append(h('h3', {}, 'No document'), h('p', { class: 'sub' }, 'Open a PDF to begin.'),
      h('div', { class: 'divider' }),
      h('p', { class: 'hint' }, 'You can also build a new PDF from images: open any PDF first, then use Convert & compress.'));
    return;
  }
  try {
    panelHost.append(byId[store.tool].render());
  } catch (err) {
    console.error(err);
    panelHost.append(h('p', { class: 'hint' }, 'That panel failed to load: ' + err.message));
  }
}

function drawStatus() {
  statusHost.textContent = '';
  const bits = store.pdf
    ? [`${store.pageCount} pages`, `${Math.round(store.zoom * 100)}%`, bytesLabel(store.bytes?.length),
      store.selected.size ? `${store.selected.size} selected` : null,
      store.dirty ? 'unsaved changes' : 'saved']
    : ['Ready'];
  bits.filter(Boolean).forEach((b, i) => {
    if (i) statusHost.append(h('span', { class: 'sep' }, '·'));
    statusHost.append(h('span', {}, b));
  });
  statusHost.append(h('div', { class: 'spacer', style: { flex: '1' } }));
  statusHost.append(h('span', {}, 'Everything stays on this device'));
  if (docLabel) {
    docLabel.textContent = store.fileName || '';
    if (store.dirty) docLabel.append(h('span', { class: 'dirty' }, ' •'));
  }
  if (undoBtn) undoBtn.disabled = !canUndo();
  if (redoBtn) redoBtn.disabled = !canRedo();
}

function emptyState() {
  const zone = h('div', { class: 'dropzone' },
    h('h2', {}, 'Open a PDF'),
    h('p', {}, 'Drag a file here, or choose one. Nothing leaves this device — the file is opened in memory and never uploaded.'),
    h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
      h('button', { class: 'btn primary', onclick: openDialog }, 'Choose a PDF'),
      h('button', { class: 'btn', onclick: buildFromImages }, 'Build one from images')),
    h('div', { class: 'feature-grid' },
      ...['Merge, split, reorder, rotate', 'Highlight, draw, add text and notes',
        'Fill forms and sign', 'Watermarks and page numbers',
        'AES-256 encryption and permissions', 'Strip scripts and attachments',
        'True redaction that removes content', 'OCR scanned pages',
        'Export to images or plain text', 'Compress large files']
        .map((t) => h('div', {}, '· ' + t))));

  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('hot'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, () => zone.classList.remove('hot')));
  return h('div', { class: 'empty' }, h('div', { class: 'inner' }, zone));
}

/* ---------------- file entry points ---------------- */

async function openDialog() {
  if (window.bench?.openFile) {
    const res = await window.bench.openFile();
    if (res?.canceled || !res) return;
    if (res.error) return toast(res.error, 'err');
    await openBytes(new Uint8Array(res.data), res.name);
    return;
  }
  const [file] = await pickFiles({ accept: 'application/pdf' });
  if (file) await openBytes(await readAsBytes(file), file.name);
}

export async function openBytes(bytes, name) {
  try {
    let password;
    if (await needsPassword(bytes)) {
      password = prompt(`“${name}” is password protected.\nEnter the password to open it:`);
      if (password == null) return;
    }
    await loadBytes(bytes, name, { password });
    store.view = 'organize';
    store.tool = 'pages';
    selectTool('pages');
    drawWork();
    drawStatus();
  } catch (err) {
    console.error(err);
    toast(err.message?.includes('password') ? 'That password was not accepted.' : (err.message || 'Could not open that file.'), 'err');
  }
}

async function buildFromImages() {
  const files = await pickFiles({ accept: 'image/png,image/jpeg', multiple: true });
  if (!files.length) return;
  const job = busy('Building a PDF…');
  try {
    const items = [];
    for (const f of files) items.push({ bytes: await readAsBytes(f), mime: f.type });
    const bytes = await ops.imagesToPdf(items, 'letter');
    job.done();
    await openBytes(bytes, 'from-images.pdf');
  } catch (err) {
    job.done();
    toast(err.message, 'err');
  }
}

/* ---------------- global wiring ---------------- */

function bindGlobals() {
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;
    if (/pdf$/i.test(file.type) || /\.pdf$/i.test(file.name)) await openBytes(await readAsBytes(file), file.name);
    else if (/^image\//.test(file.type)) {
      const bytes = await ops.imagesToPdf([{ bytes: await readAsBytes(file), mime: file.type }], 'letter');
      await openBytes(bytes, file.name.replace(/\.\w+$/, '') + '.pdf');
    } else toast('Only PDFs and PNG/JPEG images can be opened.', 'err');
  });

  window.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(reload); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); redo(reload); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); exportPdf(); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openDialog(); }
    else if (mod && e.key === '=') { e.preventDefault(); zoom(0.15); }
    else if (mod && e.key === '-') { e.preventDefault(); zoom(-0.15); }
    else if (!typing && store.pdf) {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { store.page = Math.min(store.pageCount - 1, store.page + 1); renderPage(); drawStatus(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { store.page = Math.max(0, store.page - 1); renderPage(); drawStatus(); }
      else if (e.key === 'Delete' && store.view === 'read') {
        const s = selectedAnnot();
        if (s) removeAnnot(s);
      }
    }
  });

  workHost.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 0.1 : -0.1);
  }, { passive: false });

  on('doc', () => { drawStatus(); if (store.view === 'read') renderPage(); else buildGrid(); });
  on('history', drawStatus);
  on('selection', drawStatus);
  on('changed', () => { drawPanel(); });
  on('annots', drawStatus);
  on('view', () => { drawWork(); drawStatus(); });
  on('panel-refresh', drawPanel);
  on('tool-changed', drawPanel);
  on('opened', () => { drawWork(); drawPanel(); });
}

try {
  const saved = localStorage.getItem('pdfbench.theme');
  if (saved) document.documentElement.dataset.theme = saved;
} catch {}

build();
bindGlobals();

// The desktop shell can hand us a file to open at startup, and drives the
// native menu through the same bridge.
if (window.bench?.onOpenPath) {
  window.bench.onOpenPath(async ({ name, data }) => openBytes(new Uint8Array(data), name));
}
if (window.bench?.onMenu) {
  const actions = {
    open: openDialog,
    save: () => exportPdf(),
    undo: () => undo(reload),
    redo: () => redo(reload),
    'zoom-in': () => zoom(0.15),
    'zoom-out': () => zoom(-0.15),
    fit: fitWidth,
  };
  window.bench.onMenu((action) => actions[action]?.());
}

// Exposed for the desktop shell and for automated smoke tests.
window.PDFBench = { store, openBytes, ops, makePermanent, render: renderPage, drawWork, drawPanel, drawStatus };

void $; void emit;
