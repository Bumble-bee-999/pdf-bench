/**
 * Document comparison.
 *
 * Two independent signals, because each one misses things the other catches:
 *  - a pixel diff, which sees everything visible (a moved logo, a changed
 *    figure in a scanned page) but cannot say *what* changed;
 *  - a text diff by line, which says exactly what was added or removed but is
 *    blind to anything that is not text.
 */
import { loadDoc, rasterize, pageText } from './render.js';
import { tick } from './util.js';

/** Longest-common-subsequence diff over lines. Capped so huge pages stay fast. */
export function lineDiff(a, b) {
  const clean = (t) => String(t || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const A = clean(a).slice(0, 1500);
  const B = clean(b).slice(0, 1500);
  const n = A.length; const m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const removed = []; const added = [];
  let i = 0; let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) removed.push(A[i++]);
    else added.push(B[j++]);
  }
  while (i < n) removed.push(A[i++]);
  while (j < m) added.push(B[j++]);
  return { added, removed };
}

function toImageData(source, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  return { canvas: c, data: ctx.getImageData(0, 0, w, h) };
}

/** Diff one pair of rasterised pages. Returns the changed fraction and a diff image. */
export function pixelDiff(canvasA, canvasB, threshold = 48) {
  const w = canvasA.width; const h = canvasA.height;
  const A = toImageData(canvasA, w, h);
  const B = toImageData(canvasB, w, h);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const a = A.data.data; const b = B.data.data; const o = img.data;
  let changed = 0;
  for (let i = 0; i < a.length; i += 4) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > threshold) {
      changed++;
      o[i] = 220; o[i + 1] = 40; o[i + 2] = 40; o[i + 3] = 255;
    } else {
      // Unchanged areas are shown as a faint ghost of the original.
      const g = 255 - (255 - (a[i] + a[i + 1] + a[i + 2]) / 3) * 0.28;
      o[i] = o[i + 1] = o[i + 2] = g; o[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return { fraction: changed / (w * h), canvas: out, a: A.canvas, b: B.canvas };
}

/**
 * Compare two documents page by page.
 * `onProgress(label, 0..1)` is optional.
 */
export async function compareDocuments(bytesA, bytesB, { dpi = 80, onProgress } = {}) {
  const docA = await loadDoc(bytesA);
  const docB = await loadDoc(bytesB);
  const total = Math.max(docA.numPages, docB.numPages);
  const pages = [];

  for (let i = 0; i < total; i++) {
    onProgress?.(`Comparing page ${i + 1} of ${total}…`, i / total);
    if (i >= docA.numPages) { pages.push({ index: i, status: 'added', fraction: 1, added: [], removed: [] }); continue; }
    if (i >= docB.numPages) { pages.push({ index: i, status: 'removed', fraction: 1, added: [], removed: [] }); continue; }

    const [ca, cb] = [await rasterize(docA, i, dpi), await rasterize(docB, i, dpi)];
    const px = pixelDiff(ca, cb);
    const [ta, tb] = [await pageText(docA, i), await pageText(docB, i)];
    const text = lineDiff(ta, tb);
    // Ignore sub-pixel anti-aliasing noise: under 0.02% of the page is "same".
    const changed = px.fraction > 0.0002 || text.added.length || text.removed.length;
    pages.push({
      index: i,
      status: changed ? 'changed' : 'same',
      fraction: px.fraction,
      added: text.added,
      removed: text.removed,
      images: changed ? { a: px.a, b: px.b, diff: px.canvas } : null,
    });
    ca.width = ca.height = cb.width = cb.height = 0;
    await tick();
  }
  try { docA.destroy?.(); docB.destroy?.(); } catch { /* already released */ }
  return {
    pages,
    pagesA: docA.numPages,
    pagesB: docB.numPages,
    changedPages: pages.filter((p) => p.status !== 'same').length,
  };
}
