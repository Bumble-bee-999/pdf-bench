/** Compare the open document against a second PDF. */
import { store } from '../../core/store.js';
import { h, toast, busy, pickFiles, readAsBytes, download } from '../../core/util.js';
import { compareDocuments } from '../../core/compare.js';
import { canvasToBlob } from '../../core/render.js';
import { fromRasterPages } from '../../core/pdfops.js';
import { composed } from '../../core/app.js';
import { head, button, divider, note } from './common.js';

let last = null; // { name, result }

function showPage(p, nameB) {
  const close = () => host.remove();
  const col = (title, canvas) => h('div', { style: { flex: '1', minWidth: '0' } },
    h('div', { class: 'hint', style: { marginBottom: '4px' } }, title),
    h('div', { style: { background: '#fff', lineHeight: 0 } }, canvas));
  const clone = (c) => { const n = document.createElement('canvas'); n.width = c.width; n.height = c.height; n.getContext('2d').drawImage(c, 0, 0); n.style.width = '100%'; n.style.height = 'auto'; return n; };

  const lines = (items, sign, colour) => items.slice(0, 40).map((t) => h('div', { style: { color: colour, fontFamily: 'ui-monospace, monospace', fontSize: '11.5px', padding: '1px 0' } }, `${sign} ${t}`));
  const host = h('div', { class: 'veil', onclick: (e) => { if (e.target === host) close(); } },
    h('div', { class: 'modal', style: { width: 'min(1180px, 96vw)', maxHeight: '92vh', overflow: 'auto' } },
      h('h3', {}, `Page ${p.index + 1} — ${p.status}`),
      p.images
        ? h('div', { style: { display: 'flex', gap: '10px' } },
          col('Open document', clone(p.images.a)), col(nameB || 'Comparison file', clone(p.images.b)), col('Differences in red', clone(p.images.diff)))
        : h('p', { class: 'hint' }, p.status === 'added' ? 'This page exists only in the comparison file.' : 'This page exists only in the open document.'),
      (p.added.length || p.removed.length)
        ? h('div', { style: { marginTop: '12px' } },
          h('div', { class: 'hint' }, `${p.removed.length} line(s) removed · ${p.added.length} line(s) added`),
          ...lines(p.removed, '−', '#e0624a'), ...lines(p.added, '+', '#4caf6d'))
        : null,
      h('div', { class: 'actions' }, h('button', { class: 'btn primary', onclick: close }, 'Close'))));
  document.body.append(host);
}

export default {
  id: 'compare',
  label: 'Compare',
  group: 'Document',
  icon: '⇋',
  render() {
    const out = h('div', {});

    const draw = () => {
      out.textContent = '';
      if (!last) return;
      const { result, name } = last;
      out.append(h('p', { class: 'sub' },
        `${result.changedPages} of ${Math.max(result.pagesA, result.pagesB)} page(s) differ from “${name}”`
        + (result.pagesA !== result.pagesB ? ` (${result.pagesA} vs ${result.pagesB} pages)` : '')));
      const list = h('div', { class: 'list' });
      result.pages.forEach((p) => {
        const label = p.status === 'same' ? 'identical'
          : p.status === 'changed' ? `${(p.fraction * 100).toFixed(2)}% changed · +${p.added.length} −${p.removed.length} lines`
            : p.status === 'added' ? 'only in comparison file' : 'only in open document';
        list.append(h('div', {
          class: 'row', style: { cursor: p.status === 'same' ? 'default' : 'pointer', opacity: p.status === 'same' ? 0.55 : 1 },
          onclick: () => { if (p.status !== 'same') showPage(p, name); },
        }, h('span', { class: 'chip' }, 'p' + (p.index + 1)), h('span', { style: { flex: '1' } }, label)));
      });
      out.append(list, h('div', { style: { height: '8px' } }),
        button('Save a report of the differences (PDF)', async () => {
          const changed = result.pages.filter((p) => p.images);
          if (!changed.length) return toast('Nothing differs, so there is nothing to report.', 'ok');
          const job = busy('Building the report…');
          try {
            const items = [];
            for (const p of changed) {
              const blob = await canvasToBlob(p.images.diff, 'image/jpeg', 0.88);
              items.push({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', width: p.images.diff.width, height: p.images.diff.height });
            }
            download(await fromRasterPages(items), (store.fileName || 'document').replace(/\.pdf$/i, '') + '-differences.pdf');
          } finally { job.done(); }
        }));
    };
    draw();

    return h('div', {},
      ...head('Compare', 'See what changed between this document and another version.'),
      note('The open document is treated as the original. Pending markup and form values are included, so you can check an edit before saving it.'),
      h('div', { style: { height: '8px' } }),
      button('Choose a PDF to compare against…', async () => {
        const [file] = await pickFiles({ accept: 'application/pdf' });
        if (!file) return;
        const job = busy('Reading ' + file.name + '…');
        try {
          const other = await readAsBytes(file);
          const mine = await composed({ flattenForm: false });
          const result = await compareDocuments(mine, other, { onProgress: (label, v) => job.set(label, v) });
          last = { name: file.name, result };
          draw();
          toast(result.changedPages ? `${result.changedPages} page(s) differ.` : 'The documents are identical.', result.changedPages ? '' : 'ok');
        } catch (err) {
          console.error(err);
          toast('Could not compare: ' + (err.message || err), 'err');
        } finally { job.done(); }
      }, 'btn primary wide'),
      divider(),
      out,
      divider(),
      note('Pages are compared as images at 80 dpi, so tiny anti-aliasing differences are ignored, and as text by line. '
        + 'A page counts as changed if either one differs.'),
    );
  },
};
