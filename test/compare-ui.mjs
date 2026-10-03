import { launch } from './browser.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const fixture = readFileSync(new URL('./fixture.pdf', import.meta.url));
const b = await launch();
const p = await b.newPage({ viewport: { width: 1500, height: 940 } });
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await p.waitForFunction(() => !!window.PDFBench);
const load = (b64) => p.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await window.PDFBench.openBytes(bytes, 'fixture.pdf');
}, b64);
await load(fixture.toString('base64'));

// Build a revised copy on disk to feed the file chooser.
const revised = await p.evaluate(async () => {
  const { store, ops } = window.PDFBench;
  const { textRuns } = await import('/src/core/render.js');
  const t = (await textRuns(store.pdf, 1)).find((r) => /Fixture page 2/.test(r.str));
  const out = await ops.burnAnnotations(store.bytes, {
    1: [{ type: 'replace', x: t.x, y: t.y, w: t.w, h: t.h, text: 'Fixture page 2 — REVISED', orig: t.str, size: t.size, font: 'Helvetica-Bold', bg: '#ffffff', color: '#b03020' },
        { type: 'rect', color: '#3d8bd4', width: 3, x: 300, y: 300, w: 200, h: 120 }],
  });
  let s = ''; for (const c of out) s += String.fromCharCode(c); return btoa(s);
});
writeFileSync('/tmp/revised.pdf', Buffer.from(revised, 'base64'));

await p.evaluate(() => { const s = window.PDFBench.store; s.tool = 'compare'; window.PDFBench.drawPanel(); });
await p.waitForTimeout(300);
const [chooser] = await Promise.all([p.waitForEvent('filechooser'), p.click('text=Choose a PDF to compare against…')]);
await chooser.setFiles('/tmp/revised.pdf');
await p.waitForSelector('.list .row', { timeout: 20000 });
await p.waitForTimeout(500);
const rows = await p.$$eval('.list .row', (r) => r.map((n) => n.textContent.trim()));
console.log('rows:', JSON.stringify(rows));
await p.screenshot({ path: 'test/shot-compare-panel.png' });
await p.click('.list .row:nth-child(2)');
await p.waitForSelector('.modal canvas', { timeout: 5000 });
await p.waitForTimeout(400);
await p.screenshot({ path: 'test/shot-compare-modal.png' });
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no page errors');
const ok = rows.length === 4 && /identical/.test(rows[0]) && /changed/.test(rows[1]) && /identical/.test(rows[2]);
console.log(ok ? 'compare UI works ✓' : 'compare UI FAILED');
await b.close();
process.exit(ok && !errors.length ? 0 : 1);
