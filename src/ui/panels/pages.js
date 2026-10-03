/** Page operations: select, rotate, delete, extract, duplicate, insert, split, merge. */
import { store, emit } from '../../core/store.js';
import { h, parseRanges, download, toast, busy, pickFiles, readAsBytes, tick } from '../../core/util.js';
import { apply, ops } from '../../core/app.js';
import { selectAll, clearSelection, build as rebuildGrid } from '../organizer.js';
import { head, field, textInput, select, button, divider, note } from './common.js';

const state = { splitRanges: '1-', splitEvery: 1, insertAt: 1, mergeFit: 'letter' };

function targets() {
  const sel = [...store.selected].sort((a, b) => a - b);
  return sel.length ? sel : [store.page];
}

function orderAfterRemoval(indices) {
  const order = [];
  for (let i = 0; i < store.pageCount; i++) if (!indices.includes(i)) order.push(i);
  return order;
}

export default {
  id: 'pages',
  label: 'Organise pages',
  group: 'Document',
  icon: '▤',
  render() {
    const count = () => (store.selected.size ? `${store.selected.size} selected` : `page ${store.page + 1}`);
    const info = h('p', { class: 'sub' }, `${store.pageCount} pages — acting on ${count()}`);
    const off = emit && null;
    void off;

    const panel = h('div', {},
      ...head('Organise pages', null), info,
      h('div', { class: 'btn-row' },
        button('Select all', () => selectAll(), 'btn sm'),
        button('Clear', () => clearSelection(), 'btn sm')),
      divider(),

      h('div', { class: 'btn-row' },
        button('⟲ Rotate left', () => apply((b) => ops.rotatePages(b, targets(), -90), 'rotate', { busyLabel: 'Rotating…' }), 'btn'),
        button('⟳ Rotate right', () => apply((b) => ops.rotatePages(b, targets(), 90), 'rotate', { busyLabel: 'Rotating…' }), 'btn')),
      h('div', { class: 'btn-row', style: { marginTop: '6px' } },
        button('Duplicate', async () => {
          const t = targets();
          const map = [];
          for (let i = 0; i < store.pageCount; i++) { map.push(i); if (t.includes(i)) map.push(i); }
          await apply((b) => ops.duplicatePages(b, t), 'duplicate', { pageMap: map, busyLabel: 'Duplicating…' });
        }, 'btn'),
        button('Delete', async () => {
          const t = targets();
          if (t.length >= store.pageCount) return toast('You cannot delete every page.', 'err');
          const map = orderAfterRemoval(t);
          await apply((b) => ops.deletePages(b, t), 'delete pages', { pageMap: map, busyLabel: 'Deleting…' });
          clearSelection();
        }, 'btn')),
      h('div', { class: 'btn-row', style: { marginTop: '6px' } },
        button('Extract to new file', async () => {
          const t = targets();
          const job = busy('Extracting…');
          try {
            const bytes = await ops.extractPages(store.bytes, t);
            download(bytes, (store.fileName || 'document').replace(/\.pdf$/i, '') + `-p${t[0] + 1}.pdf`);
            toast(`Extracted ${t.length} page${t.length === 1 ? '' : 's'}.`, 'ok');
          } finally { job.done(); }
        }, 'btn wide')),
      divider(),

      field('Insert a blank page before page',
        h('div', { class: 'field inline' },
          h('input', { type: 'number', min: 1, value: state.insertAt, oninput: (e) => { state.insertAt = +e.target.value; } }),
          button('Insert', async () => {
            const at = Math.max(0, Math.min(store.pageCount, state.insertAt - 1));
            const map = [];
            for (let i = 0; i < store.pageCount; i++) { if (i === at) map.push(-1); map.push(i); }
            if (at >= store.pageCount) map.push(-1);
            await apply((b) => ops.insertBlank(b, at), 'insert page', { pageMap: map, busyLabel: 'Inserting…' });
          }, 'btn'))),
      divider(),

      h('h3', {}, 'Merge in'),
      note('Append other PDFs, or PNG/JPEG images, to the end of this document.'),
      field('Image page size', select([['letter', 'Fit to Letter'], ['a4', 'Fit to A4'], ['exact', 'Match image size']], state.mergeFit, (v) => { state.mergeFit = v; })),
      button('Choose files to append…', async () => {
        const files = await pickFiles({ accept: 'application/pdf,image/png,image/jpeg', multiple: true });
        if (!files.length) return;
        const incoming = [];
        for (const f of files) {
          const bytes = await readAsBytes(f);
          incoming.push(/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)
            ? { kind: 'pdf', bytes }
            : { kind: 'image', bytes, mime: f.type, fit: state.mergeFit });
        }
        await apply((b) => ops.mergeInto(b, incoming), 'merge', { busyLabel: 'Merging…' });
        rebuildGrid();
      }),
      divider(),

      h('h3', {}, 'Split'),
      field('Save these pages as a separate file', textInput(state.splitRanges, (v) => { state.splitRanges = v; }, { placeholder: 'e.g. 1-3, 8, 12-' }),
        'Ranges are 1-based. Leave the end blank for “to the end”.'),
      button('Save range as new PDF', async () => {
        const idx = parseRanges(state.splitRanges, store.pageCount);
        if (!idx.length) return toast('That range does not match any pages.', 'err');
        const job = busy('Splitting…');
        try {
          const bytes = await ops.extractPages(store.bytes, idx);
          download(bytes, (store.fileName || 'document').replace(/\.pdf$/i, '') + '-split.pdf');
        } finally { job.done(); }
      }),
      h('div', { style: { height: '8px' } }),
      field('Burst into chunks of', h('div', { class: 'field inline' },
        h('input', { type: 'number', min: 1, value: state.splitEvery, oninput: (e) => { state.splitEvery = Math.max(1, +e.target.value); } }),
        h('span', { class: 'hint' }, 'pages'))),
      button('Burst into a ZIP', async () => {
        const job = busy('Splitting…');
        try {
          const { default: JSZip } = await import('jszip');
          const zip = new JSZip();
          const step = state.splitEvery;
          const base = (store.fileName || 'document').replace(/\.pdf$/i, '');
          for (let start = 0, n = 1; start < store.pageCount; start += step, n++) {
            const idx = [];
            for (let i = start; i < Math.min(start + step, store.pageCount); i++) idx.push(i);
            job.set(`Part ${n}…`, start / store.pageCount);
            const bytes = await ops.extractPages(store.bytes, idx);
            zip.file(`${base}-part${String(n).padStart(2, '0')}.pdf`, bytes);
            await tick();
          }
          const blob = await zip.generateAsync({ type: 'blob' });
          download(blob, base + '-split.zip', 'application/zip');
        } finally { job.done(); }
      }),
      divider(),
      note('Tip: drag a thumbnail onto another to reorder, and double-click one to open that page.'),
    );
    return panel;
  },
};
