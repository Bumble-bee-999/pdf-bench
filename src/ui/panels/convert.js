/** Conversion in and out of PDF, plus size reduction. */
import { store, commit } from '../../core/store.js';
import { h, toast, busy, download, pickFiles, readAsBytes, bytesLabel, tick, parseRanges } from '../../core/util.js';
import { apply, ops, composed, reload } from '../../core/app.js';
import { rasterize, canvasToBlob, pageText } from '../../core/render.js';
import { head, field, select, slider, button, divider, note, textInput } from './common.js';

const state = {
  imgFormat: 'image/png', imgDpi: 150, imgRange: '', jpegQuality: 0.85,
  compressDpi: 120, compressQuality: 0.6, compressMode: 'raster',
  importFit: 'letter',
};

async function exportImages() {
  if (!store.pdf) return;
  const job = busy('Rendering pages…');
  try {
    const { default: JSZip } = await import('jszip');
    const zip = new JSZip();
    const pages = state.imgRange ? parseRanges(state.imgRange, store.pageCount) : [...Array(store.pageCount).keys()];
    const ext = state.imgFormat === 'image/png' ? 'png' : 'jpg';
    const base = (store.fileName || 'document').replace(/\.pdf$/i, '');
    for (let n = 0; n < pages.length; n++) {
      const i = pages[n];
      job.set(`Page ${i + 1} of ${store.pageCount}…`, n / pages.length);
      const canvas = await rasterize(store.pdf, i, state.imgDpi);
      const blob = await canvasToBlob(canvas, state.imgFormat, state.jpegQuality);
      zip.file(`${base}-p${String(i + 1).padStart(3, '0')}.${ext}`, blob);
      canvas.width = canvas.height = 0;
      await tick();
    }
    if (pages.length === 1) {
      const canvas = await rasterize(store.pdf, pages[0], state.imgDpi);
      const blob = await canvasToBlob(canvas, state.imgFormat, state.jpegQuality);
      download(blob, `${base}-p${pages[0] + 1}.${ext}`, state.imgFormat);
    } else {
      const out = await zip.generateAsync({ type: 'blob' });
      download(out, `${base}-images.zip`, 'application/zip');
    }
    toast(`Exported ${pages.length} image${pages.length === 1 ? '' : 's'}.`, 'ok');
  } catch (err) {
    toast(err.message || 'Export failed.', 'err');
  } finally { job.done(); }
}

/** Re-encode every page as an image at a lower resolution. Lossy but very effective. */
export async function rasterCompress(dpi, quality, onProgress) {
  const items = [];
  for (let i = 0; i < store.pageCount; i++) {
    onProgress?.(i / store.pageCount, i);
    const canvas = await rasterize(store.pdf, i, dpi);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    const meta = store.pageSizes[i];
    items.push({
      bytes: new Uint8Array(await blob.arrayBuffer()),
      mime: 'image/jpeg',
      width: meta.rotation % 180 ? meta.h : meta.w,
      height: meta.rotation % 180 ? meta.w : meta.h,
    });
    canvas.width = canvas.height = 0;
    await tick();
  }
  return ops.fromRasterPages(items);
}

export default {
  id: 'convert',
  label: 'Convert & compress',
  group: 'Output',
  icon: '⇄',
  render() {
    const sizeNow = h('span', {}, bytesLabel(store.bytes?.length));

    return h('div', {},
      ...head('Convert & compress', null),

      h('h3', {}, 'PDF → images'),
      field('Format', select([['image/png', 'PNG (lossless)'], ['image/jpeg', 'JPEG (smaller)']], state.imgFormat, (v) => { state.imgFormat = v; })),
      slider('Resolution', state.imgDpi, 72, 400, 6, (v) => { state.imgDpi = v; }, (v) => v + ' dpi'),
      field('Pages (blank = all)', textInput(state.imgRange, (v) => { state.imgRange = v; }, { placeholder: '1-4, 9' })),
      button('Export images', exportImages),
      divider(),

      h('h3', {}, 'Images → PDF'),
      field('Page size', select([['letter', 'Letter'], ['a4', 'A4'], ['exact', 'Match each image']], state.importFit, (v) => { state.importFit = v; })),
      button('Choose images…', async () => {
        const files = await pickFiles({ accept: 'image/png,image/jpeg', multiple: true });
        if (!files.length) return;
        const job = busy('Building PDF…');
        try {
          const items = [];
          for (const f of files) items.push({ bytes: await readAsBytes(f), mime: f.type });
          const bytes = await ops.imagesToPdf(items, state.importFit);
          download(bytes, 'images.pdf');
          toast(`Built a ${items.length}-page PDF.`, 'ok');
        } catch (err) { toast(err.message, 'err'); } finally { job.done(); }
      }),
      note('PNG and JPEG are supported directly. Other formats (HEIC, TIFF, WebP) need converting first.'),
      divider(),

      h('h3', {}, 'PDF → text'),
      button('Extract all text', async () => {
        const job = busy('Extracting text…');
        try {
          let out = '';
          for (let i = 0; i < store.pageCount; i++) {
            job.set(`Page ${i + 1}…`, i / store.pageCount);
            out += `\n\n===== Page ${i + 1} =====\n` + await pageText(store.pdf, i);
            await tick();
          }
          download(new Blob([out.trim()], { type: 'text/plain' }),
            (store.fileName || 'document').replace(/\.pdf$/i, '') + '.txt', 'text/plain');
          toast('Text extracted.', 'ok');
        } finally { job.done(); }
      }),
      note('Scanned pages hold no text layer — run OCR first, under Text & OCR.'),
      divider(),

      h('h3', {}, 'Reduce file size'),
      h('p', { class: 'sub' }, ['Current size: ', sizeNow]),
      field('Method', select([
        ['resave', 'Re-save — lossless, tidies the file structure'],
        ['raster', 'Rasterise — much smaller, but text stops being selectable'],
      ], state.compressMode, (v) => { state.compressMode = v; })),
      slider('Rasterise at', state.compressDpi, 72, 300, 6, (v) => { state.compressDpi = v; }, (v) => v + ' dpi'),
      slider('JPEG quality', state.compressQuality, 0.3, 0.95, 0.05, (v) => { state.compressQuality = v; }, (v) => Math.round(v * 100) + '%'),
      button('Compress', async () => {
        const before = store.bytes.length;
        if (state.compressMode === 'resave') {
          await apply(async (b) => {
            const doc = await ops.open(b);
            return doc.save({ useObjectStreams: true });
          }, 'compress', { busyLabel: 'Re-saving…' });
        } else {
          const job = busy('Rasterising…');
          try {
            const bytes = await rasterCompress(state.compressDpi, state.compressQuality, (p, i) => job.set(`Page ${i + 1}…`, p));
            store.bytes = bytes;
            await reload();
            commit('compress');
          } finally { job.done(); }
        }
        const after = store.bytes.length;
        sizeNow.textContent = bytesLabel(after);
        const pct = Math.round((1 - after / before) * 100);
        toast(pct > 0 ? `${bytesLabel(before)} → ${bytesLabel(after)} (${pct}% smaller)` : `No saving: ${bytesLabel(after)}`, pct > 0 ? 'ok' : '');
      }, 'btn primary wide'),
      divider(),

      h('h3', {}, 'Flat copy'),
      note('Save a copy with all markup and form values burned in — nothing left editable.'),
      button('Save flattened copy', async () => {
        const job = busy('Flattening…');
        try {
          const bytes = await composed({ flattenForm: true });
          download(bytes, (store.fileName || 'document').replace(/\.pdf$/i, '') + '-flat.pdf');
        } finally { job.done(); }
      }),
    );
  },
};
