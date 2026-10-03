/** Document lifecycle: load, mutate, reload, export. Panels talk to this. */
import { store, emit, commit, resetHistory, remapAnnots } from './store.js';
import { loadDoc, readPageSizes } from './render.js';
import * as ops from './pdfops.js';
import { busy, toast, download, bytesLabel } from './util.js';
import { rasterizePages } from './security.js';

/** Rebuild the pdf.js view of `store.bytes`. */
export async function reload() {
  if (!store.bytes) {
    store.pdf = null; store.pageCount = 0; store.pageSizes = [];
    emit('doc');
    return;
  }
  try { store.pdf?.destroy?.(); } catch {}
  store.pdf = await loadDoc(store.bytes);
  store.pageCount = store.pdf.numPages;
  store.pageSizes = await readPageSizes(store.pdf);
  if (store.page >= store.pageCount) store.page = Math.max(0, store.pageCount - 1);
  emit('doc');
}

export async function loadBytes(bytes, name, { password } = {}) {
  const job = busy('Opening ' + name + '…');
  try {
    // Normalise through pdf-lib so later operations always start from a
    // well-formed file (and so encrypted input is decrypted once, up front).
    const doc = await ops.open(bytes, password);
    store.bytes = await ops.save(doc);
    store.fileName = name;
    store.annots = {};
    store.formValues = {};
    store.selected.clear();
    store.page = 0;
    resetHistory();
    await reload();
    commit('open');
    emit('opened');
    toast(`${name} — ${store.pageCount} page${store.pageCount === 1 ? '' : 's'}, ${bytesLabel(store.bytes.length)}`, 'ok');
  } finally { job.done(); }
}

/** Run a mutation that returns new bytes, then commit + reload. */
export async function apply(fn, label = 'edit', { pageMap = null, busyLabel = 'Working…' } = {}) {
  const job = busy(busyLabel);
  try {
    const next = await fn(store.bytes);
    if (!next) return false;
    store.bytes = next instanceof Uint8Array ? next : new Uint8Array(next);
    if (pageMap) remapAnnots(pageMap);
    await reload();
    commit(label);
    emit('changed', label);
    return true;
  } catch (err) {
    console.error(err);
    toast(err.message || 'That operation failed.', 'err');
    return false;
  } finally { job.done(); }
}

/** Bytes with pending markup burned in and form values applied. */
export async function composed({ flattenForm = false } = {}) {
  let bytes = store.bytes;
  if (Object.keys(store.formValues).length) {
    bytes = await ops.fillForm(bytes, store.formValues, { flatten: flattenForm });
  }
  bytes = await ops.burnAnnotations(bytes, store.annots);
  return bytes;
}

/** Bake pending markup into the document itself (no longer editable). */
export async function bake(label = 'flatten markup') {
  const ok = await apply(async () => composed({ flattenForm: true }), label, { busyLabel: 'Flattening…' });
  if (ok) { store.annots = {}; store.formValues = {}; commit(label); emit('doc'); }
  return ok;
}

/** Pages that carry edited text or redaction boxes, from pending markup. */
export function sensitivePages() {
  return Object.entries(store.annots)
    .filter(([, list]) => list.some((a) => a.type === 'replace' || a.type === 'redact'))
    .map(([i]) => +i)
    .sort((a, b) => a - b);
}

/**
 * Burn all pending markup in and flatten the affected pages to images so that
 * covered text is genuinely gone. By default only pages with edited text or
 * redaction boxes are flattened; the rest keep their selectable text.
 */
export async function makePermanent({ dpi = 200, all = false } = {}) {
  const hot = sensitivePages();
  const job = busy('Burning in…');
  try {
    store.bytes = await composed({ flattenForm: true });
    store.annots = {};
    store.formValues = {};
    await reload();
    const targets = all ? [...Array(store.pageCount).keys()] : hot;
    if (targets.length) {
      store.bytes = await rasterizePages(store.bytes, store.pdf, store.pageSizes, targets, {
        dpi, onProgress: (label, v) => job.set(label, v),
      });
      await reload();
    }
    commit('make permanent');
    emit('changed', 'make permanent');
    return { pages: targets.length };
  } catch (err) {
    console.error(err);
    toast(err.message || 'That operation failed.', 'err');
    return null;
  } finally { job.done(); }
}

export async function exportPdf(name) {
  const job = busy('Preparing file…');
  try {
    const bytes = await composed({ flattenForm: false });
    const out = name || (store.fileName || 'document.pdf').replace(/\.pdf$/i, '') + '-edited.pdf';
    if (window.bench?.saveFile) {
      const res = await window.bench.saveFile(out, bytes);
      if (res?.ok) toast('Saved to ' + res.path, 'ok');
      else if (!res?.canceled) toast('Save failed: ' + (res?.error || 'unknown error'), 'err');
    } else {
      download(bytes, out);
      toast('Saved ' + out, 'ok');
    }
  } catch (err) {
    console.error(err);
    toast(err.message || 'Export failed.', 'err');
  } finally { job.done(); }
}

export { ops };
