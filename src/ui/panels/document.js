/** Document-level extras: metadata, watermarks, page numbers, headers. */
import { store } from '../../core/store.js';
import { h, toast, parseRanges } from '../../core/util.js';
import { apply, ops } from '../../core/app.js';
import { head, field, textInput, select, slider, swatches, button, divider, note, checkbox } from './common.js';
import { FONT_NAMES } from '../../core/pdfops.js';

const wm = { text: 'CONFIDENTIAL', size: 60, color: '#d2503a', opacity: 0.18, angle: 45, font: 'Helvetica-Bold', range: '' };
const pn = { format: 'Page {n} of {total}', position: 'bottom-center', size: 10, color: '#555555', margin: 28, start: 1, skipFirst: false, font: 'Helvetica' };

export default {
  id: 'document',
  label: 'Document',
  group: 'Document',
  icon: '☰',
  render() {
    const meta = { title: '', author: '', subject: '', keywords: '', creator: '' };
    const inputs = {};
    const metaBlock = h('div', {}, h('p', { class: 'hint' }, 'Reading properties…'));

    ops.readMetadata(store.bytes).then((m) => {
      Object.assign(meta, m);
      metaBlock.textContent = '';
      [['title', 'Title'], ['author', 'Author'], ['subject', 'Subject'], ['keywords', 'Keywords'], ['creator', 'Creator']]
        .forEach(([key, label]) => {
          inputs[key] = textInput(meta[key] || '', (v) => { meta[key] = v; });
          metaBlock.append(field(label, inputs[key]));
        });
      metaBlock.append(h('p', { class: 'hint' }, `Producer: ${m.producer || '—'} · ${m.pageCount} pages`));
    });

    return h('div', {},
      ...head('Document', null),
      h('h3', {}, 'Properties'),
      metaBlock,
      button('Save properties', () => apply((b) => ops.setMetadata(b, meta), 'metadata', { busyLabel: 'Saving…' })),
      divider(),

      h('h3', {}, 'Watermark'),
      field('Text', textInput(wm.text, (v) => { wm.text = v; })),
      field('Font', select(FONT_NAMES, wm.font, (v) => { wm.font = v; })),
      field('Colour', swatches(wm.color, (c) => { wm.color = c; })),
      slider('Size', wm.size, 12, 160, 2, (v) => { wm.size = v; }, (v) => v + ' pt'),
      slider('Opacity', wm.opacity, 0.03, 1, 0.01, (v) => { wm.opacity = v; }, (v) => Math.round(v * 100) + '%'),
      slider('Angle', wm.angle, -90, 90, 5, (v) => { wm.angle = v; }, (v) => v + '°'),
      field('Pages (blank = all)', textInput(wm.range, (v) => { wm.range = v; }, { placeholder: '1-3, 7' })),
      button('Apply watermark', () => {
        const pages = wm.range ? parseRanges(wm.range, store.pageCount) : null;
        return apply((b) => ops.addWatermark(b, { ...wm, fontName: wm.font, pages }), 'watermark', { busyLabel: 'Watermarking…' });
      }, 'btn primary wide'),
      divider(),

      h('h3', {}, 'Page numbers'),
      field('Format', textInput(pn.format, (v) => { pn.format = v; }), 'Use {n} for the number and {total} for the page count.'),
      field('Position', select([
        ['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'],
        ['top-center', 'Top centre'], ['top-right', 'Top right'], ['top-left', 'Top left'],
      ], pn.position, (v) => { pn.position = v; })),
      field('Font', select(FONT_NAMES, pn.font, (v) => { pn.font = v; })),
      field('Colour', swatches(pn.color, (c) => { pn.color = c; })),
      slider('Size', pn.size, 6, 24, 1, (v) => { pn.size = v; }, (v) => v + ' pt'),
      slider('Margin', pn.margin, 8, 90, 2, (v) => { pn.margin = v; }, (v) => v + ' pt'),
      h('div', { class: 'field inline' },
        h('label', {}, 'Start numbering at'),
        h('input', { type: 'number', value: pn.start, min: 0, oninput: (e) => { pn.start = +e.target.value; } })),
      checkbox('Skip the first page (cover)', pn.skipFirst, (v) => { pn.skipFirst = v; }),
      button('Add page numbers', () => {
        if (!/\{n\}|\{total\}/.test(pn.format)) toast('Tip: include {n} so the number appears.');
        return apply((b) => ops.addPageNumbers(b, { ...pn, fontName: pn.font }), 'page numbers', { busyLabel: 'Numbering…' });
      }, 'btn primary wide'),
      divider(),
      note('Watermarks and page numbers are written straight into the page content, so every viewer shows them.'),
    );
  },
};
