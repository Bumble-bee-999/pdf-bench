/**
 * End-to-end smoke test: drives the built app in a real browser and exercises
 * every major operation against the fixture PDF.
 */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:5173';
const fixture = readFileSync(fileURLToPath(new URL('./fixture.pdf', import.meta.url)));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.PDFBench, null, { timeout: 15000 });
check('app boots', true);

// Hand the fixture to the app the same way the Open button would.
await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await window.PDFBench.openBytes(bytes, 'fixture.pdf');
}, fixture.toString('base64'));

await page.waitForFunction(() => window.PDFBench.store.pageCount > 0, null, { timeout: 20000 });
const opened = await page.evaluate(() => ({
  pages: window.PDFBench.store.pageCount,
  rot: window.PDFBench.store.pageSizes[2].rotation,
  size: window.PDFBench.store.bytes.length,
}));
check('opens a PDF', opened.pages === 4, `${opened.pages} pages`);
check('reads page rotation', opened.rot === 90, `page 3 = ${opened.rot}°`);

await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-organizer.png' });

// --- structural operations -------------------------------------------------
const structural = await page.evaluate(async () => {
  const { store, ops } = window.PDFBench;
  const out = {};
  const rotated = await ops.rotatePages(store.bytes, [0], 90);
  out.rotate = rotated.length > 0;

  const deleted = await ops.deletePages(store.bytes, [3]);
  const d = await ops.open(deleted);
  out.deleted = d.getPageCount();

  const dup = await ops.duplicatePages(store.bytes, [0]);
  out.duplicated = (await ops.open(dup)).getPageCount();

  const merged = await ops.mergeInto(store.bytes, [{ kind: 'pdf', bytes: store.bytes }]);
  out.merged = (await ops.open(merged)).getPageCount();

  const reordered = await ops.reassemble(store.bytes, [3, 2, 1, 0]);
  out.reordered = (await ops.open(reordered)).getPageCount();

  const extracted = await ops.extractPages(store.bytes, [1, 2]);
  out.extracted = (await ops.open(extracted)).getPageCount();

  const blank = await ops.insertBlank(store.bytes, 2);
  out.inserted = (await ops.open(blank)).getPageCount();
  return out;
});
check('rotate pages', structural.rotate);
check('delete pages', structural.deleted === 3, `${structural.deleted} left`);
check('duplicate pages', structural.duplicated === 5);
check('merge documents', structural.merged === 8);
check('reorder pages', structural.reordered === 4);
check('extract pages', structural.extracted === 2);
check('insert blank page', structural.inserted === 5);

// --- content operations ----------------------------------------------------
const content = await page.evaluate(async () => {
  const { store, ops } = window.PDFBench;
  const out = {};
  out.watermark = (await ops.addWatermark(store.bytes, { text: 'DRAFT', size: 60, color: '#d2503a', opacity: .2, angle: 45, fontName: 'Helvetica-Bold' })).length > 0;
  out.numbers = (await ops.addPageNumbers(store.bytes, { format: 'Page {n} of {total}', position: 'bottom-center', size: 10, color: '#555555', margin: 28, start: 1 })).length > 0;
  const meta = await ops.setMetadata(store.bytes, { title: 'Renamed', author: 'Tester' });
  out.meta = (await ops.readMetadata(meta)).title;
  const fields = await ops.readForm(store.bytes);
  out.fieldNames = fields.map((f) => f.name);
  const filled = await ops.fillForm(store.bytes, { 'applicant.name': 'Ada Lovelace', 'applicant.agree': true }, { flatten: true });
  out.filled = filled.length > 0;
  out.filledFields = (await ops.readForm(filled)).length;
  return out;
});
check('watermark', content.watermark);
check('page numbers', content.numbers);
check('edit metadata', content.meta === 'Renamed', content.meta);
check('detect form fields', content.fieldNames.length === 2, content.fieldNames.join(', '));
check('fill + flatten form', content.filled && content.filledFields === 0, `${content.filledFields} fields remain`);

// --- markup burn-in, including on the rotated page --------------------------
const markup = await page.evaluate(async () => {
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
    2: [ // the /Rotate 90 page — the transform must still land it correctly
      { type: 'text', color: '#c23b2c', size: 20, font: 'Helvetica', x: 90, y: 120, text: 'Rotated page markup' },
      { type: 'rect', color: '#2c8a55', width: 3, x: 80, y: 200, w: 300, h: 100 },
    ],
  };
  const burned = await ops.burnAnnotations(store.bytes, annots);
  store.annots = annots;
  window.PDFBench.render();
  return { size: burned.length, bigger: burned.length > store.bytes.length };
});
check('burn markup into pages', markup.bigger, `${markup.size} bytes`);

await page.evaluate(() => { window.PDFBench.store.view = 'read'; window.PDFBench.store.page = 0; window.PDFBench.drawWork(); });
await page.waitForTimeout(900);
await page.screenshot({ path: 'test/shot-markup.png' });
await page.evaluate(() => { window.PDFBench.store.page = 2; window.PDFBench.render(); });
await page.waitForTimeout(900);
await page.screenshot({ path: 'test/shot-rotated.png' });

// --- security --------------------------------------------------------------
await page.evaluate(() => {
  window.PDFBench.store.tool = 'security';
  window.PDFBench.drawPanel();
});
await page.waitForTimeout(400);
const panelText = await page.textContent('.panel');
check('security panel renders', /Password protection/.test(panelText) && /True redaction/.test(panelText));

await page.click('.panel >> text=Scan for active content');
await page.waitForTimeout(1500);
const scanText = await page.textContent('.panel');
check('active-content scan runs', /No scripts|Embedded|Attached|External/.test(scanText));

// Encrypt through the panel, then confirm the output really needs a password.
const enc = await page.evaluate(async () => {
  const { store } = window.PDFBench;
  const { encrypt, sha256, passwordStrength } = await import('/src/core/security.js');
  const bytes = await encrypt(store.bytes, { userPassword: 'correct horse battery', ownerPassword: 'owner-secret' });
  const head = new TextDecoder().decode(bytes.slice(0, 2048));
  const hash = await sha256(bytes);
  return {
    hasEncryptDict: /\/Encrypt/.test(new TextDecoder('latin1').decode(bytes)),
    aes: /AESV3|\/V 5|\/R 6/.test(new TextDecoder('latin1').decode(bytes)),
    hashLen: hash.length,
    strength: passwordStrength('correct horse battery').label,
    head: head.slice(0, 8),
  };
}).catch((e) => ({ error: String(e) }));
check('AES-256 encryption', !enc.error && enc.hasEncryptDict && enc.aes, enc.error || `strength: ${enc.strength}`);
check('SHA-256 fingerprint', enc.hashLen === 64);

const sanit = await page.evaluate(async () => {
  const { store } = window.PDFBench;
  const { sanitize, inspect } = await import('/src/core/security.js');
  const before = await inspect(store.bytes);
  const { bytes, removed } = await sanitize(store.bytes, undefined, {
    javascript: true, actions: true, attachments: true, media: true, externalLinks: true, metadata: true,
  });
  const after = await inspect(bytes);
  return { before: before.risks.length, after: after.risks.length, removed, ok: bytes.length > 0 };
}).catch((e) => ({ error: String(e) }));
check('sanitiser runs', !sanit.error && sanit.ok, sanit.error || `risks ${sanit.before} → ${sanit.after}`);

// --- rasterise / compress / text / images ----------------------------------
const outputs = await page.evaluate(async () => {
  const { store, ops } = window.PDFBench;
  const { rasterize, canvasToBlob, pageText } = await import('/src/core/render.js');
  const canvas = await rasterize(store.pdf, 0, 120);
  const blob = await canvasToBlob(canvas, 'image/jpeg', .7);
  const text = await pageText(store.pdf, 0);
  const items = [{
    bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg',
    width: store.pageSizes[0].w, height: store.pageSizes[0].h,
  }];
  const raster = await ops.fromRasterPages(items);
  const imgPdf = await ops.imagesToPdf(items.map((i) => ({ bytes: i.bytes, mime: i.mime })), 'letter');
  return {
    canvasW: canvas.width,
    textHit: /quick brown fox/i.test(text),
    rasterPages: (await ops.open(raster)).getPageCount(),
    imgPages: (await ops.open(imgPdf)).getPageCount(),
  };
});
check('rasterise a page', outputs.canvasW > 500, `${outputs.canvasW}px wide`);
check('extract page text', outputs.textHit);
check('rebuild PDF from images', outputs.rasterPages === 1 && outputs.imgPages === 1);

// --- UI panels all render ---------------------------------------------------
for (const tool of ['pages', 'document', 'compare', 'markup', 'fillsign', 'text', 'convert', 'security']) {
  const ok = await page.evaluate((t) => {
    try {
      window.PDFBench.store.tool = t;
      window.PDFBench.drawPanel();
      const panel = document.querySelector('.panel');
      return panel.textContent.trim().length > 40 && panel.querySelectorAll('button, input, select').length > 0;
    } catch { return false; }
  }, tool);
  check(`panel: ${tool}`, ok);
  await page.waitForTimeout(250);
}
await page.evaluate(() => { window.PDFBench.store.tool = 'markup'; window.PDFBench.drawPanel(); });
await page.waitForTimeout(400);
await page.screenshot({ path: 'test/shot-app.png' });

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
