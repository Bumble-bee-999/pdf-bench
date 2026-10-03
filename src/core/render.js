/** pdf.js integration: document loading, page + thumbnail rasterisation. */
import './polyfills.js';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from './pdf-worker.js?worker&url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/** Load a PDF for viewing. Bytes are copied because pdf.js transfers them. */
export async function loadDoc(bytes) {
  const task = pdfjs.getDocument({
    data: bytes.slice(0),
    disableAutoFetch: true,
    isEvalSupported: false,
    useSystemFonts: true,
  });
  return task.promise;
}

/** Render one page onto a canvas at `scale` (1 = 72dpi). */
export async function renderPage(pdf, index, scale, canvas) {
  const page = await pdf.getPage(index + 1);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vp = page.getViewport({ scale: scale * dpr });
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  canvas.style.width = Math.floor(vp.width / dpr) + 'px';
  canvas.style.height = Math.floor(vp.height / dpr) + 'px';
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return { cssWidth: vp.width / dpr, cssHeight: vp.height / dpr };
}

/** Render a page to an offscreen canvas at a target DPI (for export/OCR). */
export async function rasterize(pdf, index, dpi = 150) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(vp.width));
  canvas.height = Math.max(1, Math.round(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

/** Collect unrotated page sizes + rotation for every page. */
export async function readPageSizes(pdf) {
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const vp = page.getViewport({ scale: 1, rotation: 0 });
    out.push({ w: vp.width, h: vp.height, rotation: page.rotate || 0 });
    page.cleanup();
  }
  return out;
}

/** Plain-text extraction for one page, with rough line breaks preserved. */
export async function pageText(pdf, index) {
  const page = await pdf.getPage(index + 1);
  const tc = await page.getTextContent();
  let out = '';
  let lastY = null;
  for (const item of tc.items) {
    if (!('str' in item)) continue;
    const y = item.transform[5];
    if (lastY != null && Math.abs(y - lastY) > 2) out += '\n';
    else if (out && !out.endsWith(' ') && !out.endsWith('\n')) out += '';
    out += item.str;
    if (item.hasEOL) out += '\n';
    lastY = y;
  }
  page.cleanup();
  return out;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.82) {
  return new Promise((res) => canvas.toBlob(res, type, quality));
}

/**
 * Text runs for one page, in the same visual coordinate space the markup
 * layer uses (points, origin top-left, page rotation already applied).
 *
 * Adjacent runs that share a font, size and baseline are merged into a single
 * "line segment", which is what a person means by clicking on a line of text.
 * Text that is not horizontal on screen (sideways text on a rotated page, or
 * text set at an angle) is left out: it cannot be edited with a flat overlay.
 */
export async function textRuns(pdf, index) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const raw = [];
  for (const it of tc.items) {
    if (!('str' in it) || !it.str.trim()) continue;
    const m = pdfjs.Util.transform(vp.transform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (size < 2 || Math.abs(m[1]) > 0.02 * size || m[0] <= 0) continue; // not horizontal
    let bold = false;
    try {
      const font = page.commonObjs.get(it.fontName);
      bold = !!font?.bold || /bold|black|heavy/i.test(font?.name || '');
    } catch { /* font object not resolved yet */ }
    raw.push({
      str: it.str,
      x: m[4],
      baseline: m[5],
      size,
      w: Math.abs(it.width) * (vp.scale || 1),
      fontName: it.fontName,
      family: tc.styles?.[it.fontName]?.fontFamily || 'sans-serif',
      bold,
    });
  }
  page.cleanup();

  raw.sort((a, b) => (Math.abs(a.baseline - b.baseline) < a.size * 0.3 ? a.x - b.x : a.baseline - b.baseline));
  const lines = [];
  for (const r of raw) {
    const last = lines[lines.length - 1];
    const sameLine = last && last.fontName === r.fontName
      && Math.abs(last.baseline - r.baseline) < r.size * 0.3
      && Math.abs(last.size - r.size) < 0.6
      && r.x - (last.x + last.w) < r.size * 0.9 && r.x >= last.x - 1;
    if (sameLine) {
      const gap = r.x - (last.x + last.w);
      last.str += (gap > r.size * 0.12 && !/\s$/.test(last.str) && !/^\s/.test(r.str) ? ' ' : '') + r.str;
      last.w = r.x + r.w - last.x;
    } else {
      lines.push({ ...r });
    }
  }
  return lines.map((l) => ({
    ...l,
    y: l.baseline - l.size * 0.82,
    h: l.size * 1.08,
    str: l.str.replace(/\s+$/, ''),
  }));
}

/** Where each form widget appears on screen, in visual points (top-left origin). */
export async function widgetRects(pdf, index) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale: 1 });
  const annotations = await page.getAnnotations();
  page.cleanup();
  return annotations
    .filter((a) => a.subtype === 'Widget' && a.rect)
    .map((a) => {
      const [x1, y1, x2, y2] = a.rect;
      const [ma, mb, mc, md, me, mf] = vp.transform;
      const at = (x, y) => [ma * x + mc * y + me, mb * x + md * y + mf];
      const p1 = at(x1, y1);
      const p2 = at(x2, y2);
      return {
        name: a.fieldName,
        x: Math.min(p1[0], p2[0]), y: Math.min(p1[1], p2[1]),
        w: Math.abs(p2[0] - p1[0]), h: Math.abs(p2[1] - p1[1]),
      };
    });
}
