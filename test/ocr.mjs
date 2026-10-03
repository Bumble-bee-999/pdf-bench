/** Verifies OCR runs entirely from bundled assets, with the network cut off. */
import { launch } from './browser.mjs';
const b = await launch();
const ctx = await b.newContext();
// Block every request that is not same-origin: proves nothing is downloaded.
await ctx.route('**/*', (route) => {
  const url = route.request().url();
  if (url.startsWith('http://127.0.0.1:5173') || url.startsWith('blob:') || url.startsWith('data:')) return route.continue();
  console.log('  [blocked]', url.slice(0, 90));
  return route.abort();
});
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.PDFBench);

// Build a scan-like page: text drawn onto a canvas, wrapped as an image PDF.
await p.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 1240; c.height = 1754;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111';
  g.font = '48px Georgia, serif';
  g.fillText('Field service report', 90, 160);
  g.font = '34px Georgia, serif';
  g.fillText('Agitator seal replaced on unit 7.', 90, 260);
  g.fillText('Torque verified at 120 newton metres.', 90, 330);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const pdf = await window.PDFBench.ops.imagesToPdf([{ bytes, mime: 'image/png' }], 'letter');
  await window.PDFBench.openBytes(pdf, 'scan.pdf');
});

const before = await p.evaluate(async () => {
  const { pageText } = await import('/src/core/render.js');
  return (await pageText(window.PDFBench.store.pdf, 0)).trim();
});
console.log('text before OCR:', JSON.stringify(before.slice(0, 60)), '(expected empty)');

const t0 = Date.now();
const result = await p.evaluate(async () => {
  const { recognizePages } = await import('/src/core/ocr.js');
  const { pageText } = await import('/src/core/render.js');
  const { store } = window.PDFBench;
  const { bytes, text } = await recognizePages(store.pdf, [0], { lang: 'eng', dpi: 200 });
  await window.PDFBench.openBytes(bytes, 'scan-ocr.pdf');
  const layer = await pageText(window.PDFBench.store.pdf, 0);
  return { raw: text.trim(), layer: layer.trim() };
}, { timeout: 180000 });

console.log(`OCR took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('recognised:', JSON.stringify(result.raw.replace(/\s+/g, ' ').slice(0, 140)));
console.log('searchable layer:', JSON.stringify(result.layer.replace(/\s+/g, ' ').slice(0, 140)));
const ok = /field service report/i.test(result.raw) && /torque/i.test(result.layer);
console.log(ok ? '\nOCR works offline ✓' : '\nOCR FAILED');
await b.close();
process.exit(ok ? 0 : 1);
