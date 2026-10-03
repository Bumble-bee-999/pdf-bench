/** Markup tools: pen, highlighter, shapes, text, notes and redaction. */
import { store, emit, annotCount } from '../../core/store.js';
import { h, toast, confirmDialog } from '../../core/util.js';
import { bake, makePermanent, sensitivePages } from '../../core/app.js';
import { selected, removeAnnot, paint, render } from '../reader.js';
import { head, field, swatches, slider, button, divider, note, select, chips } from './common.js';
import { FONT_NAMES } from '../../core/pdfops.js';

const TOOLS = [
  ['select', 'Select'], ['edittext', 'Edit text'], ['pen', 'Pen'], ['highlighter', 'Highlighter'],
  ['text', 'Text'], ['note', 'Sticky note'], ['rect', 'Rectangle'],
  ['ellipse', 'Ellipse'], ['line', 'Line'], ['arrow', 'Arrow'], ['redact', 'Redact'],
];

export default {
  id: 'markup',
  label: 'Markup',
  group: 'Edit',
  icon: '✎',
  needsReader: true,
  render() {
    const st = store.style;
    const toolRow = h('div', { class: 'chips' });
    TOOLS.forEach(([id, label]) => {
      const chip = h('button', {
        class: 'chip' + (store.draw === id ? ' on' : ''),
        onclick: () => {
          store.draw = id;
          [...toolRow.children].forEach((n) => n.classList.remove('on'));
          chip.classList.add('on');
          store.view = 'read';
          emit('view');
          render();
        },
      }, label);
      toolRow.append(chip);
    });

    const countLabel = h('p', { class: 'sub' }, `${annotCount()} markup item${annotCount() === 1 ? '' : 's'} pending`);

    return h('div', {},
      ...head('Markup', 'Drawn on top of the page and kept editable until you flatten or save.'),
      toolRow,
      note('Edit text: click a line of text on the page, then retype it. The original line is covered with a patch '
        + 'matching the page background, and the font, size and colour are matched as closely as the PDF allows.'),
      divider(),
      field('Colour', swatches(st.color, (c) => { st.color = c; const s = selected(); if (s) { s.color = c; paint(); } })),
      slider('Stroke width', st.width, 1, 24, 1, (v) => { st.width = v; const s = selected(); if (s && s.width != null) { s.width = v; paint(); } }, (v) => v + ' pt'),
      slider('Opacity', st.opacity, 0.1, 1, 0.05, (v) => { st.opacity = v; const s = selected(); if (s) { s.opacity = v; paint(); } }, (v) => Math.round(v * 100) + '%'),
      divider(),
      h('h3', {}, 'Text style'),
      field('Font', select(FONT_NAMES, st.font, (v) => { st.font = v; const s = selected(); if (s?.font) { s.font = v; paint(); } })),
      slider('Size', st.size, 6, 72, 1, (v) => { st.size = v; const s = selected(); if (s?.size) { s.size = v; paint(); } }, (v) => v + ' pt'),
      divider(),
      countLabel,
      h('div', { class: 'btn-row' },
        button('Delete selected', () => {
          const s = selected();
          if (!s) return toast('Nothing selected — switch to the Select tool and click an item.', 'err');
          removeAnnot(s);
        }, 'btn'),
        button('Clear this page', () => {
          store.annots[store.page] = [];
          paint();
          emit('annots');
        }, 'btn')),
      h('div', { style: { height: '6px' } }),
      button('Flatten markup into the page', async () => {
        if (!annotCount()) return toast('There is no markup to flatten.', 'err');
        const ok = await confirmDialog('Flatten markup?',
          'Markup becomes part of the page content. It can no longer be selected or edited, though Undo still works.', 'Flatten');
        if (ok) { await bake('flatten markup'); render(); }
      }, 'btn primary wide'),
      h('div', { style: { height: '6px' } }),
      button('Make edits permanent (remove hidden text)', async () => {
        const pages = sensitivePages();
        if (!pages.length) return toast('No edited text or redaction boxes to make permanent.', 'err');
        const ok = await confirmDialog('Make edits permanent?',
          `Page${pages.length === 1 ? '' : 's'} ${pages.map((i) => i + 1).join(', ')} will become flat images, so the text you covered `
          + 'no longer exists in the file. Those pages lose selectable text; all other pages are untouched. Undo still works.', 'Make permanent');
        if (!ok) return;
        const res = await makePermanent();
        if (res) { render(); toast(`Flattened ${res.pages} page${res.pages === 1 ? '' : 's'}.`, 'ok'); }
      }, 'btn wide'),
      divider(),
      note('Redaction boxes and edited text only cover what was there — the original text is still in the file '
        + 'and can be copied out. To remove it for good, use Security → True redaction after you finish.'),
    );
  },
};
