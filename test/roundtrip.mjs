/** Burns markup into the file, reopens the result, and screenshots it.
 *  Confirms the visual→user-space transform survives a save/reload. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
const fixture = readFileSync(new URL('./fixture.pdf', import.meta.url));
const b = await launch();
const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
p.on('pageerror', (e) => console.log('[pageerror]', String(e)));
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.PDFBench);
await p.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await window.PDFBench.openBytes(bytes, 'fixture.pdf');
}, fixture.toString('base64'));

await p.evaluate(async () => {
  const { store, ops } = window.PDFBench;
  const annots = {
    0: [
      { type: 'ink', color: '#d2503a', width: 3, opacity: 1, points: [[100, 100], [200, 160], [300, 120]] },
      { type: 'highlight', color: '#f2e14c', width: 16, opacity: .4, points: [[60, 300], [400, 300]] },
      { type: 'text', color: '#111111', size: 18, font: 'Helvetica', x: 80, y: 400, text: 'Reviewed by hand' },
      { type: 'note', color: '#26220d', size: 12, font: 'Helvetica', x: 320, y: 430, w: 170, h: 60, text: 'Check this figure' },
      { type: 'rect', color: '#3d8bd4', width: 2, x: 60, y: 500, w: 200, h: 80 },
      { type: 'ellipse', color: '#7a5cd0', width: 2, x: 300, y: 500, w: 120, h: 80 },
      { type: 'arrow', color: '#d2503a', width: 2, x: 100, y: 620, x2: 260, y2: 660 },
      { type: 'redact', color: '#000000', x: 60, y: 700, w: 180, h: 24 },
    ],
    2: [
      { type: 'text', color: '#c23b2c', size: 20, font: 'Helvetica', x: 90, y: 120, text: 'Rotated page markup' },
      { type: 'rect', color: '#2c8a55', width: 3, x: 80, y: 200, w: 300, h: 100 },
      { type: 'ink', color: '#3d8bd4', width: 4, opacity: 1, points: [[500, 300], [600, 380], [700, 300]] },
    ],
  };
  const burned = await ops.burnAnnotations(store.bytes, annots);
  await window.PDFBench.openBytes(burned, 'burned.pdf');
  store.view = 'read'; store.page = 0; window.PDFBench.drawWork();
});
await p.waitForTimeout(1200);
await p.screenshot({ path: 'test/shot-burned-p1.png' });
await p.evaluate(() => { window.PDFBench.store.page = 2; window.PDFBench.render(); });
await p.waitForTimeout(1200);
await p.screenshot({ path: 'test/shot-burned-p3.png' });
await b.close();
console.log('round-trip screenshots written');
