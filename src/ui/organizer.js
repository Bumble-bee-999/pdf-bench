/** Page organiser: thumbnail grid with multi-select and drag reordering. */
import { store, emit } from '../core/store.js';
import { renderPage } from '../core/render.js';
import { h } from '../core/util.js';
import { apply, ops } from '../core/app.js';

let grid;
let lastClicked = null;
let renderSeq = 0;

export function organizerView() {
  grid = h('div', { class: 'grid' });
  build();
  return grid;
}

export function build() {
  if (!grid) return;
  grid.textContent = '';
  const seq = ++renderSeq;
  for (let i = 0; i < store.pageCount; i++) grid.append(thumbCard(i, seq));
  queueThumbs(seq);
}

function thumbCard(i, seq) {
  const canvas = h('canvas', { 'data-page': i });
  const card = h('div', {
    class: 'thumb' + (store.selected.has(i) ? ' sel' : ''),
    draggable: true,
    'data-page': i,
    onclick: (e) => toggle(i, e),
    ondblclick: () => { store.page = i; store.view = 'read'; emit('view'); },
  },
    h('div', { class: 'pick' }, store.selected.has(i) ? '✓' : ''),
    canvas,
    h('div', { class: 'n' }, `${i + 1}`));

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', String(i));
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const from = +e.dataTransfer.getData('text/plain');
    if (Number.isNaN(from) || from === i) return;
    await movePage(from, i);
  });
  void seq;
  return card;
}

async function queueThumbs(seq) {
  for (let i = 0; i < store.pageCount; i++) {
    if (seq !== renderSeq || !store.pdf) return;
    const canvas = grid.querySelector(`canvas[data-page="${i}"]`);
    if (!canvas) continue;
    const meta = store.pageSizes[i] || { w: 612, h: 792 };
    const scale = 150 / Math.max(meta.w, 1);
    try { await renderPage(store.pdf, i, Math.min(scale, 0.5), canvas); } catch { /* page failed to render */ }
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
  }
}

function toggle(i, e) {
  if (e.shiftKey && lastClicked != null) {
    const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
    for (let k = a; k <= b; k++) store.selected.add(k);
  } else if (e.ctrlKey || e.metaKey) {
    store.selected.has(i) ? store.selected.delete(i) : store.selected.add(i);
  } else {
    const only = store.selected.size === 1 && store.selected.has(i);
    store.selected.clear();
    if (!only) store.selected.add(i);
  }
  lastClicked = i;
  refreshSelection();
  emit('selection');
}

export function refreshSelection() {
  if (!grid) return;
  [...grid.children].forEach((card, i) => {
    card.classList.toggle('sel', store.selected.has(i));
    const pick = card.querySelector('.pick');
    if (pick) pick.textContent = store.selected.has(i) ? '✓' : '';
  });
}

export async function movePage(from, to) {
  const order = [...Array(store.pageCount).keys()];
  order.splice(to, 0, order.splice(from, 1)[0]);
  await apply((b) => ops.reassemble(b, order), 'reorder', { pageMap: order, busyLabel: 'Reordering…' });
  store.selected.clear();
  emit('selection');
}

export function selectAll() {
  for (let i = 0; i < store.pageCount; i++) store.selected.add(i);
  refreshSelection();
  emit('selection');
}

export function clearSelection() {
  store.selected.clear();
  refreshSelection();
  emit('selection');
}
