/**
 * All document mutations. Every exported operation takes PDF bytes and
 * returns new PDF bytes, so undo/redo is just keeping the old array.
 */
import {
  PDFDocument, StandardFonts, degrees, rgb, PageSizes, LineCapStyle, PDFName, PDFDict, PDFArray,
} from '@cantoo/pdf-lib';
import { hexToRgb01 } from './util.js';
import { placeBox, placePoint, visualSize, normRot } from './geometry.js';

export const SAVE_OPTS = { useObjectStreams: true, addDefaultPage: false };

export async function open(bytes, password) {
  return PDFDocument.load(bytes, {
    password,
    ignoreEncryption: !password,
    updateMetadata: false,
    throwOnInvalidObject: false,
  });
}

/** True when the file is encrypted and needs a password to be read. */
export async function needsPassword(bytes) {
  try {
    await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    return false;
  } catch (err) {
    return /encrypt|password/i.test(String(err && err.message));
  }
}

export async function save(doc) {
  return doc.save(SAVE_OPTS);
}

/** Copy document-level metadata from one doc to another. */
function carryMeta(from, to) {
  try {
    to.setTitle(from.getTitle() || '');
    to.setAuthor(from.getAuthor() || '');
    to.setSubject(from.getSubject() || '');
    to.setKeywords((from.getKeywords() || '').split(/[,;]\s*/).filter(Boolean));
    to.setCreator(from.getCreator() || 'PDF Bench');
    to.setProducer('PDF Bench');
  } catch { /* some documents have malformed info dictionaries */ }
}

/** Build a new document containing `order` (array of source page indices). */
export async function reassemble(bytes, order) {
  const src = await open(bytes);
  const out = await PDFDocument.create();
  carryMeta(src, out);
  const pages = await out.copyPages(src, order);
  pages.forEach((p) => out.addPage(p));
  return save(out);
}

export async function rotatePages(bytes, indices, delta) {
  const doc = await open(bytes);
  const pages = doc.getPages();
  indices.forEach((i) => {
    const p = pages[i];
    if (!p) return;
    p.setRotation(degrees(normRot(p.getRotation().angle + delta)));
  });
  return save(doc);
}

export async function deletePages(bytes, indices) {
  const doc = await open(bytes);
  const keep = [];
  for (let i = 0; i < doc.getPageCount(); i++) if (!indices.includes(i)) keep.push(i);
  if (!keep.length) throw new Error('A document must keep at least one page.');
  return reassemble(bytes, keep);
}

export async function extractPages(bytes, indices) {
  return reassemble(bytes, indices);
}

export async function duplicatePages(bytes, indices) {
  const doc = await open(bytes);
  const order = [];
  for (let i = 0; i < doc.getPageCount(); i++) {
    order.push(i);
    if (indices.includes(i)) order.push(i);
  }
  return reassemble(bytes, order);
}

export async function insertBlank(bytes, at, size = 'match') {
  const doc = await open(bytes);
  const pages = doc.getPages();
  let dims = PageSizes.Letter;
  if (size === 'match' && pages[Math.max(0, at - 1)]) {
    const ref = pages[Math.max(0, at - 1)];
    dims = [ref.getWidth(), ref.getHeight()];
  } else if (Array.isArray(size)) dims = size;
  doc.insertPage(Math.min(at, doc.getPageCount()), dims);
  return save(doc);
}

/** Append other PDFs (and/or images) to the current document. */
export async function mergeInto(bytes, incoming) {
  const doc = bytes ? await open(bytes) : await PDFDocument.create();
  for (const item of incoming) {
    if (item.kind === 'pdf') {
      const src = await open(item.bytes);
      const pages = await doc.copyPages(src, src.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
    } else {
      await addImagePage(doc, item.bytes, item.mime, item.fit);
    }
  }
  return save(doc);
}

export async function embedImage(doc, bytes, mime) {
  if (/png/i.test(mime)) return doc.embedPng(bytes);
  if (/jpe?g/i.test(mime)) return doc.embedJpg(bytes);
  throw new Error('Only PNG and JPEG images can be embedded directly.');
}

export async function addImagePage(doc, bytes, mime, fit = 'letter') {
  const img = await embedImage(doc, bytes, mime);
  if (fit === 'exact') {
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    return page;
  }
  const [pw, ph] = fit === 'a4' ? PageSizes.A4 : PageSizes.Letter;
  const margin = 24;
  const scale = Math.min((pw - margin * 2) / img.width, (ph - margin * 2) / img.height);
  const w = img.width * scale;
  const hgt = img.height * scale;
  const page = doc.addPage([pw, ph]);
  page.drawImage(img, { x: (pw - w) / 2, y: (ph - hgt) / 2, width: w, height: hgt });
  return page;
}

export async function imagesToPdf(items, fit = 'letter') {
  const doc = await PDFDocument.create();
  doc.setProducer('PDF Bench');
  for (const it of items) await addImagePage(doc, it.bytes, it.mime, fit);
  return save(doc);
}

/* ---------------- text-bearing extras ---------------- */

const FONTS = {
  Helvetica: StandardFonts.Helvetica,
  'Helvetica-Bold': StandardFonts.HelveticaBold,
  'Times-Roman': StandardFonts.TimesRoman,
  'Times-Bold': StandardFonts.TimesRomanBold,
  Courier: StandardFonts.Courier,
  'Courier-Bold': StandardFonts.CourierBold,
};
export const FONT_NAMES = Object.keys(FONTS);

/** The 14 standard fonts are WinAnsi-only; swap anything they cannot encode. */
export function sanitize(text) {
  return String(text ?? '')
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
}

async function fontFor(doc, name, cache) {
  const key = FONTS[name] ? name : 'Helvetica';
  if (!cache[key]) cache[key] = await doc.embedFont(FONTS[key]);
  return cache[key];
}

export async function addPageNumbers(bytes, opts) {
  const { format = '{n}', position = 'bottom-center', size = 10, color = '#444444',
    margin = 28, start = 1, skipFirst = false, fontName = 'Helvetica' } = opts;
  const doc = await open(bytes);
  const cache = {};
  const font = await fontFor(doc, fontName, cache);
  const pages = doc.getPages();
  const total = pages.length;
  const c = hexToRgb01(color);
  pages.forEach((page, i) => {
    if (skipFirst && i === 0) return;
    const label = sanitize(format.replace(/\{n\}/g, String(i + start)).replace(/\{total\}/g, String(total)));
    const rot = normRot(page.getRotation().angle);
    const w = page.getWidth();
    const hh = page.getHeight();
    const vis = visualSize(w, hh, rot);
    const tw = font.widthOfTextAtSize(label, size);
    const [vpos, hpos] = position.split('-');
    const vx = hpos === 'left' ? margin : hpos === 'right' ? vis.w - margin - tw : (vis.w - tw) / 2;
    const vy = vpos === 'top' ? margin : vis.h - margin;
    const at = placePoint(vx, vy, w, hh, rot);
    page.drawText(label, { x: at.x, y: at.y, size, font, color: rgb(c.r, c.g, c.b), rotate: degrees(at.rotate) });
  });
  return save(doc);
}

export async function addWatermark(bytes, opts) {
  const { text = 'DRAFT', size = 60, color = '#d2503a', opacity = 0.18, angle = 45,
    fontName = 'Helvetica-Bold', pages: only = null, behind = false } = opts;
  const doc = await open(bytes);
  const cache = {};
  const font = await fontFor(doc, fontName, cache);
  const c = hexToRgb01(color);
  const label = sanitize(text);
  doc.getPages().forEach((page, i) => {
    if (only && !only.includes(i)) return;
    const w = page.getWidth();
    const hh = page.getHeight();
    const tw = font.widthOfTextAtSize(label, size);
    const rad = (angle * Math.PI) / 180;
    const x = w / 2 - (tw / 2) * Math.cos(rad) + (size / 3) * Math.sin(rad);
    const y = hh / 2 - (tw / 2) * Math.sin(rad) - (size / 3) * Math.cos(rad);
    page.drawText(label, {
      x, y, size, font, opacity, rotate: degrees(angle), color: rgb(c.r, c.g, c.b),
      blendMode: behind ? 'Multiply' : undefined,
    });
  });
  return save(doc);
}

export async function setMetadata(bytes, meta) {
  const doc = await open(bytes);
  if (meta.title != null) doc.setTitle(sanitize(meta.title));
  if (meta.author != null) doc.setAuthor(sanitize(meta.author));
  if (meta.subject != null) doc.setSubject(sanitize(meta.subject));
  if (meta.keywords != null) doc.setKeywords(sanitize(meta.keywords).split(/[,;]\s*/).filter(Boolean));
  if (meta.creator != null) doc.setCreator(sanitize(meta.creator));
  doc.setProducer('PDF Bench');
  doc.setModificationDate(new Date());
  return save(doc);
}

export async function readMetadata(bytes) {
  const doc = await open(bytes);
  const safe = (fn) => { try { return fn() || ''; } catch { return ''; } };
  return {
    title: safe(() => doc.getTitle()),
    author: safe(() => doc.getAuthor()),
    subject: safe(() => doc.getSubject()),
    keywords: safe(() => (doc.getKeywords() || '')),
    creator: safe(() => doc.getCreator()),
    producer: safe(() => doc.getProducer()),
    pageCount: doc.getPageCount(),
  };
}

/* ---------------- forms ---------------- */

export async function readForm(bytes) {
  const doc = await open(bytes);
  let form;
  try { form = doc.getForm(); } catch { return []; }
  const out = [];
  for (const f of form.getFields()) {
    const type = f.constructor.name;
    const entry = { name: f.getName(), type, value: '', options: null, readOnly: false };
    try { entry.readOnly = f.isReadOnly(); } catch {}
    try {
      if (type === 'PDFTextField') entry.value = f.getText() || '';
      else if (type === 'PDFCheckBox') entry.value = f.isChecked();
      else if (type === 'PDFRadioGroup') { entry.value = f.getSelected() || ''; entry.options = f.getOptions(); }
      else if (type === 'PDFDropdown') { entry.value = (f.getSelected() || [])[0] || ''; entry.options = f.getOptions(); }
      else if (type === 'PDFOptionList') { entry.value = (f.getSelected() || [])[0] || ''; entry.options = f.getOptions(); }
    } catch {}
    out.push(entry);
  }
  return out;
}

export async function fillForm(bytes, values, { flatten = false } = {}) {
  const doc = await open(bytes);
  const form = doc.getForm();
  for (const [name, value] of Object.entries(values)) {
    let field;
    try { field = form.getField(name); } catch { continue; }
    const type = field.constructor.name;
    try {
      if (type === 'PDFTextField') field.setText(sanitize(value));
      else if (type === 'PDFCheckBox') value ? field.check() : field.uncheck();
      else if (type === 'PDFRadioGroup' && value) field.select(value);
      else if (type === 'PDFDropdown' && value) field.select(value);
      else if (type === 'PDFOptionList' && value) field.select(value);
    } catch { /* value not valid for this field — leave it alone */ }
  }
  if (flatten) {
    const helv = await doc.embedFont(StandardFonts.Helvetica);
    try { form.updateFieldAppearances(helv); } catch {}
    try { form.flatten(); } catch {}
  }
  return save(doc);
}

/* ---------------- markup burn-in ---------------- */

/**
 * Burn vector annotations into the page content streams.
 * `annots` is { pageIndex: Annotation[] } in visual coordinates.
 */
export async function burnAnnotations(bytes, annots) {
  const entries = Object.entries(annots).filter(([, list]) => list && list.length);
  if (!entries.length) return bytes;
  const doc = await open(bytes);
  const pages = doc.getPages();
  const cache = {};
  const imageCache = new Map();
  const newFields = [];

  for (const [pageIdx, list] of entries) {
    const page = pages[+pageIdx];
    if (!page) continue;
    const w = page.getWidth();
    const hh = page.getHeight();
    const rot = normRot(page.getRotation().angle);

    for (const a of list) {
      const c = hexToRgb01(a.color);
      const col = rgb(c.r, c.g, c.b);
      const op = a.opacity ?? 1;

      if (a.type === 'ink' || a.type === 'highlight') {
        const pts = a.points || [];
        const thickness = a.type === 'highlight' ? (a.width || 14) : (a.width || 3);
        for (let i = 1; i < pts.length; i++) {
          const p0 = placePoint(pts[i - 1][0], pts[i - 1][1], w, hh, rot);
          const p1 = placePoint(pts[i][0], pts[i][1], w, hh, rot);
          page.drawLine({
            start: { x: p0.x, y: p0.y }, end: { x: p1.x, y: p1.y },
            thickness, color: col, opacity: op, lineCap: LineCapStyle.Round,
            blendMode: a.type === 'highlight' ? 'Multiply' : undefined,
          });
        }
        if (pts.length === 1) {
          const p0 = placePoint(pts[0][0], pts[0][1], w, hh, rot);
          page.drawCircle({ x: p0.x, y: p0.y, size: thickness / 2, color: col, opacity: op });
        }
      } else if (a.type === 'line' || a.type === 'arrow') {
        const p0 = placePoint(a.x, a.y, w, hh, rot);
        const p1 = placePoint(a.x2, a.y2, w, hh, rot);
        page.drawLine({ start: p0, end: p1, thickness: a.width || 2, color: col, opacity: op, lineCap: LineCapStyle.Round });
        if (a.type === 'arrow') {
          const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
          const len = 6 + (a.width || 2) * 2.4;
          for (const s of [-1, 1]) {
            page.drawLine({
              start: p1,
              end: { x: p1.x - len * Math.cos(ang + s * 0.42), y: p1.y - len * Math.sin(ang + s * 0.42) },
              thickness: a.width || 2, color: col, opacity: op, lineCap: LineCapStyle.Round,
            });
          }
        }
      } else if (a.type === 'rect' || a.type === 'redact' || a.type === 'box') {
        const b = placeBox(a.x, a.y, a.w, a.h, w, hh, rot);
        const filled = a.type === 'redact' || a.fill;
        page.drawRectangle({
          x: b.x, y: b.y, width: b.width, height: b.height, rotate: degrees(b.rotate),
          borderColor: filled ? undefined : col,
          borderWidth: filled ? 0 : (a.width || 2),
          color: filled ? (a.type === 'redact' ? rgb(0, 0, 0) : col) : undefined,
          opacity: filled ? (a.type === 'redact' ? 1 : op) : undefined,
          borderOpacity: filled ? undefined : op,
        });
      } else if (a.type === 'ellipse') {
        const b = placeBox(a.x, a.y, a.w, a.h, w, hh, rot);
        const cx = b.x + (b.rotate === 0 || b.rotate === 180 ? b.width / 2 : 0);
        // Ellipses are drawn from their centre; recompute via the box centre.
        const centre = placeBox(a.x + a.w / 2, a.y + a.h / 2, 0, 0, w, hh, rot);
        page.drawEllipse({
          x: centre.x, y: centre.y,
          xScale: (rot % 180 ? a.h : a.w) / 2,
          yScale: (rot % 180 ? a.w : a.h) / 2,
          borderColor: a.fill ? undefined : col, borderWidth: a.fill ? 0 : (a.width || 2),
          color: a.fill ? col : undefined, opacity: a.fill ? op : undefined, borderOpacity: op,
        });
        void cx;
      } else if (a.type === 'text' || a.type === 'note') {
        const font = await fontFor(doc, a.font || 'Helvetica', cache);
        const size = a.size || 14;
        const lines = sanitize(a.text || '').split('\n');
        if (a.type === 'note') {
          const padding = 6;
          const boxW = a.w || Math.max(...lines.map((l) => font.widthOfTextAtSize(l, size))) + padding * 2;
          const boxH = a.h || lines.length * size * 1.25 + padding * 2;
          const b = placeBox(a.x, a.y, boxW, boxH, w, hh, rot);
          page.drawRectangle({
            x: b.x, y: b.y, width: b.width, height: b.height, rotate: degrees(b.rotate),
            color: rgb(1, 0.93, 0.6), borderColor: rgb(0.85, 0.7, 0.2), borderWidth: 0.75, opacity: 0.95,
          });
        }
        lines.forEach((line, li) => {
          const baseY = a.y + size * (0.85 + li * 1.25) + (a.type === 'note' ? 6 : 0);
          const at = placePoint(a.x + (a.type === 'note' ? 6 : 0), baseY, w, hh, rot);
          page.drawText(line, {
            x: at.x, y: at.y, size, font, opacity: op,
            color: a.type === 'note' ? rgb(0.15, 0.13, 0.05) : col,
            rotate: degrees(at.rotate),
          });
        });
      } else if (a.type === 'replace') {
        // Cover the original line with a patch of the page's own background
        // colour, then set the new text where the old text was.
        const bg = hexToRgb01(a.bg || '#ffffff');
        const pad = 1.4;
        const b = placeBox(a.x - pad, a.y - pad, a.w + pad * 2, a.h + pad * 2, w, hh, rot);
        page.drawRectangle({
          x: b.x, y: b.y, width: b.width, height: b.height, rotate: degrees(b.rotate),
          color: rgb(bg.r, bg.g, bg.b), borderWidth: 0,
        });
        const font = await fontFor(doc, a.font || 'Helvetica', cache);
        const size = a.size || 12;
        sanitize(a.text || '').split('\n').forEach((line, li) => {
          if (!line) return;
          const at = placePoint(a.x, a.y + size * 0.82 + li * size * 1.2, w, hh, rot);
          page.drawText(line, {
            x: at.x, y: at.y, size, font, color: col, rotate: degrees(at.rotate),
          });
        });
      } else if (a.type === 'field') {
        newFields.push({ a, page, w, hh, rot });
      } else if (a.type === 'image' || a.type === 'signature') {
        let img = imageCache.get(a.data);
        if (!img) {
          const raw = dataUrlToBytes(a.data);
          img = /png/i.test(a.data.slice(0, 24)) ? await doc.embedPng(raw) : await doc.embedJpg(raw);
          imageCache.set(a.data, img);
        }
        const b = placeBox(a.x, a.y, a.w, a.h, w, hh, rot);
        page.drawImage(img, {
          x: b.x, y: b.y, width: b.width, height: b.height,
          rotate: degrees(b.rotate), opacity: op,
        });
      }
    }
  }
  if (newFields.length) addFormFields(doc, newFields);
  return save(doc);
}

/** Create real, fillable AcroForm fields from placed field annotations. */
function addFormFields(doc, items) {
  const form = doc.getForm();
  const taken = new Set(form.getFields().map((f) => f.getName()));
  const unique = (wanted) => {
    const base = String(wanted || 'field').trim().replace(/\s+/g, '_') || 'field';
    let name = base;
    let n = 1;
    while (taken.has(name)) name = `${base}_${++n}`;
    taken.add(name);
    return name;
  };

  for (const { a, page, w, hh, rot } of items) {
    // pdf-lib rotates a widget's rectangle itself, using the same anchor and
    // rotation convention as drawRectangle, so the shared placement helper is
    // what puts it where it was drawn — even on a page with /Rotate set.
    const b = placeBox(a.x, a.y, a.w, a.h, w, hh, rot);
    const opts = {
      x: b.x, y: b.y, width: Math.max(4, b.width), height: Math.max(4, b.height),
      rotate: degrees(b.rotate),
      borderWidth: 1, borderColor: rgb(0.35, 0.38, 0.45), backgroundColor: rgb(0.96, 0.97, 1),
    };
    try {
      if (a.fieldType === 'check') {
        const f = form.createCheckBox(unique(a.name || 'checkbox'));
        f.addToPage(page, opts);
      } else if (a.fieldType === 'dropdown') {
        const f = form.createDropdown(unique(a.name || 'dropdown'));
        const choices = (a.options || []).map((o) => sanitize(o)).filter(Boolean);
        f.addOptions(choices.length ? choices : ['Option 1']);
        f.addToPage(page, opts);
      } else {
        const f = form.createTextField(unique(a.name || 'text'));
        if (a.multiline) f.enableMultiline();
        f.addToPage(page, { ...opts, textColor: rgb(0.05, 0.05, 0.1) });
      }
    } catch (err) {
      console.warn('Could not create a form field:', err);
    }
  }
}

export function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(',')[1];
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Rebuild a PDF from rasterised page images (used by compress + true redaction). */
export async function fromRasterPages(items) {
  const doc = await PDFDocument.create();
  doc.setProducer('PDF Bench');
  for (const it of items) {
    const img = /png/i.test(it.mime) ? await doc.embedPng(it.bytes) : await doc.embedJpg(it.bytes);
    const page = doc.addPage([it.width, it.height]);
    page.drawImage(img, { x: 0, y: 0, width: it.width, height: it.height });
  }
  return save(doc);
}
