/** Tests for text editing, form-field creation and document comparison. */
import { launch } from './browser.mjs';
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:5173';
const fixture = readFileSync(new URL('./fixture.pdf', import.meta.url));
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
};

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 940 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.PDFBench);
await page.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await window.PDFBench.openBytes(bytes, 'fixture.pdf');
}, fixture.toString('base64'));
await page.waitForFunction(() => window.PDFBench.store.pageCount === 4);

// ---- 1. text runs ---------------------------------------------------------
const runs = await page.evaluate(async () => {
  const { textRuns } = await import('/src/core/render.js');
  const { store } = window.PDFBench;
  const up = await textRuns(store.pdf, 0);
  const rotated = await textRuns(store.pdf, 2);
  return { up, rotatedCount: rotated.length };
});
const title = runs.up.find((r) => /Fixture page 1/.test(r.str));
const body = runs.up.find((r) => /quick brown fox/.test(r.str));
check('finds the title as one editable line', !!title, title ? `"${title.str}" at ${title.x.toFixed(0)},${title.y.toFixed(0)} size ${title.size.toFixed(0)}` : '');
check('title size matches the 26pt it was set in', title && Math.abs(title.size - 26) < 1.5);
check('title is detected as bold', title && title.bold === true);
check('merges a sentence into a single line', body && body.str.startsWith('The quick brown fox jumps over the lazy dog.'), body?.str.slice(0, 50));
check('skips sideways text on a rotated page', runs.rotatedCount === 0, `${runs.rotatedCount} runs`);

// ---- 2. text replacement ---------------------------------------------------
const edit = await page.evaluate(async (t) => {
  const { store, ops } = window.PDFBench;
  const { pageText } = await import('/src/core/render.js');
  const annots = {
    0: [{
      type: 'replace', x: t.x, y: t.y, w: t.w, h: t.h, text: 'Edited title', orig: t.str,
      size: t.size, font: 'Helvetica-Bold', bg: '#ffffff', color: '#0a2a6b',
    }],
  };
  const burned = await ops.burnAnnotations(store.bytes, annots);
  store.annots = annots;
  await window.PDFBench.openBytes(burned, 'edited.pdf');
  return { text: await pageText(window.PDFBench.store.pdf, 0), bytes: burned.length };
}, title);
check('new text is present in the saved file', /Edited title/.test(edit.text));
check('original text is still underneath (documented limitation)', /Fixture page 1/.test(edit.text),
  'covered but not removed — Security → True redaction destroys it');

await page.evaluate(() => { const s = window.PDFBench.store; s.view = 'read'; s.page = 0; window.PDFBench.drawWork(); });
await page.waitForTimeout(1100);
await page.screenshot({ path: 'test/shot-edit.png', clip: { x: 360, y: 50, width: 700, height: 240 } });

// ---- 3. form fields, upright and rotated -----------------------------------
await page.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await window.PDFBench.openBytes(bytes, 'fixture.pdf');
}, fixture.toString('base64'));
await page.waitForFunction(() => window.PDFBench.store.fileName === 'fixture.pdf');

const fields = await page.evaluate(async () => {
  const { store, ops } = window.PDFBench;
  const annots = {
    0: [
      { type: 'field', fieldType: 'text', name: 'site.contact', x: 60, y: 200, w: 240, h: 24 },
      { type: 'field', fieldType: 'text', name: 'site.notes', multiline: true, x: 60, y: 240, w: 240, h: 70 },
      { type: 'field', fieldType: 'check', name: 'safety.ok', x: 60, y: 330, w: 16, h: 16 },
      { type: 'field', fieldType: 'dropdown', name: 'unit.type', options: ['UNIMIX', 'SOLIDMIX', 'ESYS'], x: 60, y: 370, w: 160, h: 24 },
      { type: 'field', fieldType: 'text', name: 'site.contact', x: 320, y: 200, w: 120, h: 24 }, // duplicate name
    ],
    2: [{ type: 'field', fieldType: 'text', name: 'rotated.field', x: 100, y: 300, w: 260, h: 30 }],
  };
  const burned = await ops.burnAnnotations(store.bytes, annots);
  const read = await ops.readForm(burned);
  const filled = await ops.fillForm(burned, { 'site.contact': 'Dana Ortiz', 'safety.ok': true, 'unit.type': 'ESYS' }, { flatten: false });
  const back = await ops.readForm(filled);
  store.annots = {};
  await window.PDFBench.openBytes(burned, 'with-fields.pdf');
  return { names: read.map((f) => f.name), types: read.map((f) => f.type), back };
});
const has = (n) => fields.names.includes(n);
check('creates text, checkbox and dropdown fields', has('site.contact') && has('site.notes') && has('safety.ok') && has('unit.type'), fields.names.join(', '));
check('duplicate names are made unique', has('site.contact_2'));
check('creates a field on the rotated page', has('rotated.field'));
check('field types are correct', fields.types.includes('PDFCheckBox') && fields.types.includes('PDFDropdown') && fields.types.includes('PDFTextField'));
const get = (n) => fields.back.find((f) => f.name === n);
check('created fields can be filled in', get('site.contact')?.value === 'Dana Ortiz' && get('safety.ok')?.value === true && get('unit.type')?.value === 'ESYS');

const where = await page.evaluate(async () => {
  const { widgetRects } = await import('/src/core/render.js');
  const { store } = window.PDFBench;
  return { up: await widgetRects(store.pdf, 0), rot: await widgetRects(store.pdf, 2) };
});
const near = (r, e) => r && ['x', 'y', 'w', 'h'].every((k) => Math.abs(r[k] - e[k]) < 1.5);
const find = (list, n) => list.find((r) => r.name === n);
check('text field lands where it was drawn (upright page)', near(find(where.up, 'site.contact'), { x: 60, y: 200, w: 240, h: 24 }), JSON.stringify(find(where.up, 'site.contact')));
check('multiline field lands where it was drawn', near(find(where.up, 'site.notes'), { x: 60, y: 240, w: 240, h: 70 }));
check('checkbox lands where it was drawn', near(find(where.up, 'safety.ok'), { x: 60, y: 330, w: 16, h: 16 }));
check('dropdown lands where it was drawn', near(find(where.up, 'unit.type'), { x: 60, y: 370, w: 160, h: 24 }));
check('field lands where it was drawn on a ROTATED page', near(find(where.rot, 'rotated.field'), { x: 100, y: 300, w: 260, h: 30 }), JSON.stringify(find(where.rot, 'rotated.field')));

await page.evaluate(() => { const s = window.PDFBench.store; s.view = 'read'; s.page = 2; window.PDFBench.drawWork(); });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'test/shot-fields-rotated.png', clip: { x: 220, y: 50, width: 940, height: 700 } });

// ---- 4. comparison --------------------------------------------------------
const cmp = await page.evaluate(async (b64) => {
  const bin = atob(b64); const original = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) original[i] = bin.charCodeAt(i);
  const { ops } = window.PDFBench;
  const { compareDocuments, lineDiff } = await import('/src/core/compare.js');
  const { textRuns, loadDoc } = await import('/src/core/render.js');
  const doc = await loadDoc(original);
  const t = (await textRuns(doc, 1)).find((r) => /Fixture page 2/.test(r.str));
  const revised = await ops.burnAnnotations(original, {
    1: [{ type: 'replace', x: t.x, y: t.y, w: t.w, h: t.h, text: 'Fixture page 2 REVISED', orig: t.str, size: t.size, font: 'Helvetica-Bold', bg: '#ffffff', color: '#1a1a33' }],
  });
  const same = await compareDocuments(original, original, { dpi: 60 });
  const diff = await compareDocuments(original, revised, { dpi: 60 });
  const shorter = await compareDocuments(original, await ops.deletePages(original, [3]), { dpi: 60 });
  return {
    sameChanged: same.changedPages,
    changed: diff.pages.map((p) => p.status),
    added: diff.pages[1].added, removed: diff.pages[1].removed,
    pct: diff.pages[1].fraction,
    hasImages: !!diff.pages[1].images,
    shorter: shorter.pages.map((p) => p.status),
    lines: lineDiff('a\nb\nc', 'a\nc\nd'),
  };
}, fixture.toString('base64'));
check('identical documents report no differences', cmp.sameChanged === 0);
check('only the edited page is flagged', JSON.stringify(cmp.changed) === JSON.stringify(['same', 'changed', 'same', 'same']), cmp.changed.join(', '));
check('text diff reports the added text', cmp.added.some((l) => /REVISED/.test(l)), `+${JSON.stringify(cmp.added)}`);
// A covered line is still in the file, so a text diff cannot see it go. That is
// the reason "make permanent" exists; the pixel diff is what catches the swap.
check('covered text is not reported as removed (hidden text remains)', cmp.removed.length === 0, `−${JSON.stringify(cmp.removed)}`);
check('pixel diff measures the change', cmp.pct > 0.0002 && cmp.pct < 0.05 && cmp.hasImages, `${(cmp.pct * 100).toFixed(3)}% of the page`);
check('a removed page is reported', cmp.shorter[3] === 'removed', cmp.shorter.join(', '));
check('line diff is correct', JSON.stringify(cmp.lines) === JSON.stringify({ added: ['d'], removed: ['b'] }));

// ---- 4b. making edits permanent ---------------------------------------------
const perm = await page.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await window.PDFBench.openBytes(bytes, 'fixture.pdf');
  const { store, makePermanent } = window.PDFBench;
  const { textRuns, pageText } = await import('/src/core/render.js');
  const t = (await textRuns(store.pdf, 0)).find((r) => /Fixture page 1/.test(r.str));
  store.annots = { 0: [{ type: 'replace', x: t.x, y: t.y, w: t.w, h: t.h, text: 'Replaced for good', orig: t.str, size: t.size, font: 'Helvetica-Bold', bg: '#ffffff', color: '#222222' }] };
  const res = await makePermanent({ dpi: 150 });
  const sz = store.pageSizes[0];
  return {
    flattened: res.pages,
    page1: (await pageText(store.pdf, 0)).trim(),
    page2: (await pageText(store.pdf, 1)).trim(),
    pageCount: store.pageCount,
    size0: [Math.round(sz.w), Math.round(sz.h)],
    rotation2: store.pageSizes[2].rotation,
    annots: Object.keys(store.annots).length,
  };
}, fixture.toString('base64'));
check('only the edited page is flattened', perm.flattened === 1 && perm.pageCount === 4, `${perm.flattened} page(s)`);
check('the original text is gone from the file', !/Fixture page 1/.test(perm.page1) && perm.page1 === '', JSON.stringify(perm.page1.slice(0, 40)));
check('other pages keep their selectable text', /Fixture page 2/.test(perm.page2));
check('flattened page keeps its size', perm.size0[0] === 612 && perm.size0[1] === 792, perm.size0.join('×'));
check('rotated pages elsewhere are untouched', perm.rotation2 === 90);
check('pending markup is cleared after burning in', perm.annots === 0);

// ---- 5. the real UI path: click on text with the Edit-text tool -------------
await page.evaluate(async (b64) => {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  await window.PDFBench.openBytes(bytes, 'fixture.pdf');
  const s = window.PDFBench.store; s.view = 'read'; s.page = 0; s.draw = 'edittext'; s.tool = 'markup';
  window.PDFBench.drawWork(); window.PDFBench.drawPanel();
}, fixture.toString('base64'));
await page.waitForTimeout(1300);
const box = await page.locator('.page-wrap').boundingBox();
const zoom = await page.evaluate(() => window.PDFBench.store.zoom);
// the title sits at about x=60..230, y=64..92 in page points
await page.mouse.click(box.x + 120 * zoom, box.y + 78 * zoom);
await page.waitForSelector('.page-wrap textarea', { timeout: 4000 }).catch(() => null);
const opened = await page.$('.page-wrap textarea');
check('clicking text with the Edit-text tool opens an editor', !!opened);
if (opened) {
  const prefill = await opened.inputValue();
  check('editor is prefilled with the original line', /Fixture page 1/.test(prefill), prefill);
  await opened.fill('Typed in the app');
  await page.mouse.click(box.x + 400, box.y + 600); // blur
  await page.waitForTimeout(600);
  const made = await page.evaluate(() => (window.PDFBench.store.annots[0] || []).map((a) => ({ type: a.type, text: a.text, bg: a.bg, color: a.color, font: a.font })));
  check('the edit is stored as a replacement', made.length === 1 && made[0].type === 'replace' && made[0].text === 'Typed in the app', JSON.stringify(made));
  check('background colour was sampled from the page', made[0]?.bg === '#ffffff', made[0]?.bg);
  check('ink colour was sampled from the text', !!made[0]?.color, made[0]?.color);
  await page.screenshot({ path: 'test/shot-edit-ui.png', clip: { x: 360, y: 50, width: 700, height: 240 } });
}

// Text tool: the same press must leave the editor open, not discard it.
await page.evaluate(() => { const s = window.PDFBench.store; s.annots = {}; s.draw = 'text'; window.PDFBench.render(); });
await page.waitForTimeout(500);
await page.mouse.click(box.x + 200 * zoom, box.y + 500 * zoom);
await page.waitForSelector('.page-wrap textarea', { timeout: 3000 }).catch(() => null);
check('Text tool keeps its editor open after the click', !!(await page.$('.page-wrap textarea')));
const ta = await page.$('.page-wrap textarea');
if (ta) {
  await ta.fill('Typed note');
  await page.mouse.click(box.x + 500 * zoom, box.y + 700 * zoom); // click away, which also places a second text box
  await page.waitForTimeout(500);
  const texts = await page.evaluate(() => (window.PDFBench.store.annots[0] || []).map((a) => a.text));
  check('text survives clicking away', texts.includes('Typed note'), JSON.stringify(texts));
}

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
