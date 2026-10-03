/** Text search across the document, and OCR for scanned pages. */
import { store } from '../../core/store.js';
import { h, toast, busy, tick, download, parseRanges } from '../../core/util.js';
import { pageText, rasterize, canvasToBlob } from '../../core/render.js';
import { reload } from '../../core/app.js';
import { commit, emit } from '../../core/store.js';
import { recognizePages, languages, LANG_NAMES } from '../../core/ocr.js';
import { head, field, textInput, select, button, divider, note, checkbox } from './common.js';

const state = { query: '', ocrRange: '', ocrLang: 'eng', ocrDpi: 200, replaceDoc: true };



export default {
  id: 'text',
  label: 'Text & OCR',
  group: 'Edit',
  icon: '⌕',
  render() {
    const results = h('div', { class: 'hint' }, 'Search to see matches.');

    async function search() {
      if (!state.query.trim()) return;
      const job = busy('Searching…');
      try {
        results.textContent = '';
        const list = h('div', { class: 'list' });
        let hits = 0;
        const needle = state.query.toLowerCase();
        for (let i = 0; i < store.pageCount; i++) {
          job.set(`Page ${i + 1}…`, i / store.pageCount);
          const text = (await pageText(store.pdf, i)).replace(/\s+/g, ' ');
          let from = 0;
          const low = text.toLowerCase();
          while (true) {
            const at = low.indexOf(needle, from);
            if (at < 0) break;
            hits++;
            const snippet = text.slice(Math.max(0, at - 40), at + needle.length + 40);
            list.append(h('div', {
              class: 'row', style: { cursor: 'pointer' },
              onclick: () => { store.page = i; store.view = 'read'; emit('view'); },
            }, h('span', { class: 'chip' }, 'p' + (i + 1)), h('span', {}, '…' + snippet + '…')));
            from = at + needle.length;
            if (hits > 200) break;
          }
          if (hits > 200) break;
          await tick();
        }
        results.append(hits ? list : h('div', {}, 'No matches.'));
        toast(`${hits} match${hits === 1 ? '' : 'es'}`, hits ? 'ok' : '');
      } finally { job.done(); }
    }

    const langField = h('div', { class: 'field' }, h('label', {}, 'Language'), h('div', { class: 'hint' }, 'Loading…'));
    languages().then((list) => {
      langField.textContent = '';
      langField.append(h('label', {}, 'Language'),
        select(list.map((l) => [l, LANG_NAMES[l] || l]), state.ocrLang, (v) => { state.ocrLang = v; }));
    });

    return h('div', {},
      ...head('Text & OCR', null),
      h('h3', {}, 'Find'),
      field('Search this document', textInput(state.query, (v) => { state.query = v; }, {
        placeholder: 'text to find', onkeydown: (e) => { if (e.key === 'Enter') search(); },
      })),
      button('Search', search),
      h('div', { style: { height: '8px' } }),
      results,
      divider(),

      h('h3', {}, 'OCR'),
      note('Reads text off scanned pages and lays an invisible, searchable text layer over the image. '
        + 'Runs entirely on this machine — nothing is uploaded.'),
      langField,
      field('Pages (blank = all)', textInput(state.ocrRange, (v) => { state.ocrRange = v; }, { placeholder: '1-4' })),
      field('Scan resolution', select([['150', '150 dpi — faster'], ['200', '200 dpi — recommended'], ['300', '300 dpi — most accurate']], String(state.ocrDpi), (v) => { state.ocrDpi = +v; })),
      checkbox('Replace the open document with the searchable version', state.replaceDoc, (v) => { state.replaceDoc = v; }),
      button('Run OCR', async () => {
        const pages = state.ocrRange ? parseRanges(state.ocrRange, store.pageCount) : [...Array(store.pageCount).keys()];
        if (!pages.length) return toast('That range does not match any pages.', 'err');
        const job = busy('Starting the OCR engine…');
        try {
          const { bytes } = await recognizePages(store.pdf, pages, {
            lang: state.ocrLang,
            dpi: state.ocrDpi,
            onProgress: ({ label, value }) => job.set(label, value),
          });
          if (state.replaceDoc) {
            store.bytes = bytes;
            store.annots = {};
            await reload();
            commit('ocr');
            toast('OCR finished — the document is now searchable.', 'ok');
          } else {
            download(bytes, (store.fileName || 'document').replace(/\.pdf$/i, '') + '-ocr.pdf');
            toast('OCR finished.', 'ok');
          }
        } catch (err) {
          console.error(err);
          toast('OCR failed: ' + (err.message || err), 'err');
        } finally { job.done(); }
      }, 'btn primary wide'),
      note('The OCR engine and its training data ship inside the application — nothing is fetched from the internet. '
        + 'To add a language, drop its .traineddata.gz file into the ocr/lang folder next to the app.'),
      note('OCR replaces the page with the scanned image plus a hidden text layer, so the page looks the same but is searchable.'),
    );
  },
};
