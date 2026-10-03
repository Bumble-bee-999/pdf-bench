/**
 * Central document state + undo/redo history.
 *
 * Single source of truth is `bytes` (the current PDF) plus `annots`
 * (vector markup not yet burned into the file). Every structural
 * operation produces new bytes and pushes a history snapshot.
 */
const listeners = new Map();

export const store = {
  fileName: null,
  bytes: null,          // Uint8Array of the current PDF
  pdf: null,            // pdf.js document proxy
  pageCount: 0,
  pageSizes: [],        // [{w,h,rotation}] in PDF points, unrotated box + /Rotate
  annots: {},           // { [pageIndex]: Annotation[] }
  formValues: {},       // { [fieldName]: value }
  selected: new Set(),  // selected page indices (organizer)
  view: 'organize',     // 'organize' | 'read'
  tool: 'pages',        // active tool id
  draw: 'select',       // active markup tool
  page: 0,              // current page in reader view
  zoom: 1.1,
  dirty: false,
  style: { color: '#d2503a', width: 3, opacity: 1, size: 14, font: 'Helvetica' },
  signature: null,      // dataURL of the saved signature
  history: [],
  hIndex: -1,
};

export function on(evt, fn) {
  if (!listeners.has(evt)) listeners.set(evt, new Set());
  listeners.get(evt).add(fn);
  return () => listeners.get(evt).delete(fn);
}

export function emit(evt, payload) {
  (listeners.get(evt) || []).forEach((fn) => fn(payload));
  if (evt !== '*') emit('*', { evt, payload });
}

export function snapshot() {
  return {
    bytes: store.bytes,
    annots: JSON.parse(JSON.stringify(store.annots)),
    formValues: { ...store.formValues },
    fileName: store.fileName,
  };
}

/** Push the current state onto the history stack (call AFTER mutating). */
export function commit(label = 'edit') {
  store.history = store.history.slice(0, store.hIndex + 1);
  store.history.push({ ...snapshot(), label });
  if (store.history.length > 40) store.history.shift();
  store.hIndex = store.history.length - 1;
  store.dirty = store.hIndex > 0;
  emit('history');
}

export function canUndo() { return store.hIndex > 0; }
export function canRedo() { return store.hIndex < store.history.length - 1; }

function restore(entry) {
  store.bytes = entry.bytes;
  store.annots = JSON.parse(JSON.stringify(entry.annots));
  store.formValues = { ...entry.formValues };
  store.fileName = entry.fileName;
}

export async function undo(reload) {
  if (!canUndo()) return;
  store.hIndex--;
  restore(store.history[store.hIndex]);
  store.dirty = store.hIndex > 0;
  await reload();
  emit('history');
}

export async function redo(reload) {
  if (!canRedo()) return;
  store.hIndex++;
  restore(store.history[store.hIndex]);
  store.dirty = true;
  await reload();
  emit('history');
}

export function resetHistory() {
  store.history = [];
  store.hIndex = -1;
  store.dirty = false;
}

export function pageAnnots(i) {
  if (!store.annots[i]) store.annots[i] = [];
  return store.annots[i];
}

export function annotCount() {
  return Object.values(store.annots).reduce((n, a) => n + a.length, 0);
}

/** Remap annotations when pages are reordered/removed. `map` is newIndex -> oldIndex. */
export function remapAnnots(map) {
  const next = {};
  map.forEach((oldIdx, newIdx) => {
    if (store.annots[oldIdx]?.length) next[newIdx] = store.annots[oldIdx];
  });
  store.annots = next;
}
