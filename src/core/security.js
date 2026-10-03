/**
 * Document security.
 *
 * Three separate things live here, and they protect against different threats:
 *
 *  1. ENCRYPTION — AES-256 password protection and permission flags on the
 *     output file. This is real cryptography: without the password the bytes
 *     cannot be read. Permission flags are *not* cryptography — every viewer
 *     is asked to honour them and a determined one need not. That is a
 *     limitation of the PDF format itself, not of this program.
 *
 *  2. SANITISING — stripping the active content that makes PDFs a malware
 *     vector: embedded JavaScript, auto-run actions, launch/URI actions and
 *     attached files. Useful both for files you receive and files you send.
 *
 *  3. TRUE REDACTION — a black box drawn over text still has the text
 *     underneath it, and anyone can copy it out. Real redaction rasterises the
 *     page so the covered pixels are the only thing that survives.
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from '@cantoo/pdf-lib';
import { open, save } from './pdfops.js';
import { rasterize, canvasToBlob } from './render.js';
import { tick } from './util.js';

export const CIPHERS = ['AES-256', 'AES-128'];

export const DEFAULT_PERMISSIONS = {
  printing: 'highResolution',
  modifying: false,
  copying: false,
  annotating: false,
  fillingForms: true,
  contentAccessibility: true,
  documentAssembly: false,
};

/**
 * Encrypt a document. An owner password alone restricts what viewers allow;
 * a user password is what actually stops the file being opened at all.
 */
export async function encrypt(bytes, {
  userPassword = '', ownerPassword = '', permissions = DEFAULT_PERMISSIONS, algorithm = 'AES-256',
} = {}) {
  if (!userPassword && !ownerPassword) throw new Error('Set at least one password.');
  const doc = await open(bytes);
  doc.encrypt({
    userPassword: userPassword || undefined,
    ownerPassword: ownerPassword || userPassword,
    permissions,
    algorithm,
  });
  return save(doc);
}

/** Remove encryption from a document you can already open. */
export async function decrypt(bytes, password) {
  const doc = await open(bytes, password);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(doc, doc.getPageIndices());
  pages.forEach((p) => out.addPage(p));
  try {
    out.setTitle(doc.getTitle() || '');
    out.setAuthor(doc.getAuthor() || '');
  } catch { /* malformed info dict */ }
  out.setProducer('PDF Bench');
  return save(out);
}

/* ---------------- active-content inspection + removal ---------------- */

const RISK_KEYS = {
  JavaScript: 'Embedded JavaScript',
  JS: 'Embedded JavaScript',
  Launch: 'Launch action (can start a program)',
  OpenAction: 'Auto-run action on open',
  AA: 'Additional actions (run on page/field events)',
  EmbeddedFiles: 'Attached files',
  EmbeddedFile: 'Attached files',
  RichMedia: 'Embedded rich media / Flash',
  Movie: 'Embedded movie',
  Sound: 'Embedded sound',
  GoToR: 'Action that opens another file',
  SubmitForm: 'Form submission to a remote server',
  ImportData: 'Action that imports external data',
  URI: 'Link to an external address',
};

/** Walk every object in the file and report what active content it contains. */
export async function inspect(bytes, password) {
  const doc = await open(bytes, password);
  const found = new Map();
  const note = (key, extra) => {
    const label = RISK_KEYS[key];
    if (!label) return;
    const entry = found.get(label) || { label, count: 0, samples: [] };
    entry.count++;
    if (extra && entry.samples.length < 4 && !entry.samples.includes(extra)) entry.samples.push(extra);
    found.set(label, entry);
  };

  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    for (const [k, v] of obj.entries()) {
      const key = k.asString().replace(/^\//, '');
      if (key === 'URI') {
        note('URI', typeof v?.asString === 'function' ? String(v.asString()).slice(0, 90) : undefined);
      } else if (RISK_KEYS[key]) {
        note(key);
      }
    }
    const s = obj.get(PDFName.of('S'));
    if (s && typeof s.asString === 'function') note(s.asString().replace(/^\//, ''));
  }

  const stats = {
    pages: doc.getPageCount(),
    encrypted: !!doc.context.trailerInfo?.Encrypt,
    risks: [...found.values()].sort((a, b) => b.count - a.count),
  };
  return stats;
}

/**
 * Strip active content. Returns { bytes, removed:[labels] }.
 * Structural content (text, images, vectors, links to pages) is untouched.
 */
export async function sanitize(bytes, password, opts = {}) {
  const {
    javascript = true, actions = true, attachments = true, media = true, externalLinks = false, metadata = false,
  } = opts;
  const doc = await open(bytes, password);
  const removed = new Set();
  const ctx = doc.context;

  const dropFromDict = (dict, key, label) => {
    if (dict instanceof PDFDict && dict.has(PDFName.of(key))) {
      dict.delete(PDFName.of(key));
      removed.add(label);
    }
  };

  // Catalog-level auto-run and name trees.
  const cat = doc.catalog;
  if (actions) {
    dropFromDict(cat, 'OpenAction', 'Auto-run action on open');
    dropFromDict(cat, 'AA', 'Additional actions');
  }
  const names = cat.lookupMaybe?.(PDFName.of('Names'), PDFDict);
  if (names) {
    if (javascript) dropFromDict(names, 'JavaScript', 'Embedded JavaScript');
    if (attachments) dropFromDict(names, 'EmbeddedFiles', 'Attached files');
  }
  if (attachments) dropFromDict(cat, 'AF', 'Attached files');
  if (javascript && cat.has(PDFName.of('AcroForm'))) {
    const af = cat.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
    if (af) dropFromDict(af, 'XFA', 'XFA form (can carry scripts)');
  }

  // Every indirect object: annotations, page actions, field actions.
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    if (javascript) {
      dropFromDict(obj, 'JS', 'Embedded JavaScript');
      dropFromDict(obj, 'JavaScript', 'Embedded JavaScript');
    }
    if (actions) {
      dropFromDict(obj, 'AA', 'Additional actions');
      const sub = obj.get(PDFName.of('S'));
      const kind = sub && typeof sub.asString === 'function' ? sub.asString().replace(/^\//, '') : '';
      if (['Launch', 'SubmitForm', 'ImportData', 'GoToR', 'Movie', 'Sound', 'RichMediaExecute'].includes(kind)) {
        obj.delete(PDFName.of('S'));
        obj.delete(PDFName.of('F'));
        obj.delete(PDFName.of('Win'));
        removed.add(RISK_KEYS[kind] || 'Risky action');
      }
      if (kind === 'JavaScript' && javascript) {
        obj.delete(PDFName.of('S'));
        removed.add('Embedded JavaScript');
      }
    }
    if (externalLinks) {
      const sub = obj.get(PDFName.of('S'));
      const kind = sub && typeof sub.asString === 'function' ? sub.asString().replace(/^\//, '') : '';
      if (kind === 'URI') {
        obj.delete(PDFName.of('URI'));
        obj.delete(PDFName.of('S'));
        removed.add('External links');
      }
    }
    if (media) {
      dropFromDict(obj, 'RichMedia', 'Embedded rich media');
      dropFromDict(obj, 'Movie', 'Embedded movie');
      dropFromDict(obj, 'Sound', 'Embedded sound');
    }
    if (attachments) {
      const type = obj.get(PDFName.of('Subtype'));
      const t = type && typeof type.asString === 'function' ? type.asString() : '';
      if (t === '/FileAttachment') { dropFromDict(obj, 'FS', 'Attached files'); removed.add('Attached files'); }
    }
  }

  // Drop annotation subtypes that only exist to carry active content.
  if (media || attachments) {
    for (const page of doc.getPages()) {
      const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
      if (!annots) continue;
      for (let i = annots.size() - 1; i >= 0; i--) {
        const a = annots.lookup(i, PDFDict);
        const st = a?.get(PDFName.of('Subtype'));
        const name = st && typeof st.asString === 'function' ? st.asString() : '';
        if ((media && ['/RichMedia', '/Movie', '/Screen', '/Sound'].includes(name))
          || (attachments && name === '/FileAttachment')) {
          annots.remove(i);
          removed.add(name === '/FileAttachment' ? 'Attached files' : 'Embedded rich media');
        }
      }
    }
  }

  if (metadata) {
    dropFromDict(cat, 'Metadata', 'XMP metadata');
    try {
      doc.setTitle(''); doc.setAuthor(''); doc.setSubject('');
      doc.setKeywords([]); doc.setCreator('PDF Bench');
      removed.add('Document metadata');
    } catch { /* malformed info dict */ }
  }
  doc.setProducer('PDF Bench');

  return { bytes: await save(doc), removed: [...removed] };
}

/**
 * Replace chosen pages with flat images of themselves; every other page is
 * copied across untouched, text and all. This is what makes a redaction or a
 * text edit permanent: once a page is an image, whatever was covered on it no
 * longer exists anywhere in the file.
 *
 * `pdf` must be the pdf.js document for exactly these `bytes`.
 */
export async function rasterizePages(bytes, pdf, sizes, indices, { dpi = 200, quality = 0.9, onProgress } = {}) {
  const targets = new Set(indices);
  const src = await open(bytes);
  const out = await PDFDocument.create();
  try {
    out.setTitle(src.getTitle() || '');
    out.setAuthor(src.getAuthor() || '');
  } catch { /* malformed info dictionary */ }
  out.setProducer('PDF Bench');

  const total = src.getPageCount();
  let done = 0;
  for (let i = 0; i < total; i++) {
    if (!targets.has(i)) {
      const [copied] = await out.copyPages(src, [i]);
      out.addPage(copied);
      continue;
    }
    onProgress?.(`Flattening page ${i + 1}…`, done / targets.size);
    const canvas = await rasterize(pdf, i, dpi);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    const image = await out.embedJpg(new Uint8Array(await blob.arrayBuffer()));
    // The image already has the page's rotation baked in, so the new page is
    // sized to what the reader sees and carries no /Rotate of its own.
    const m = sizes[i];
    const sideways = (m.rotation || 0) % 180 !== 0;
    const w = sideways ? m.h : m.w;
    const h = sideways ? m.w : m.h;
    const page = out.addPage([w, h]);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
    canvas.width = canvas.height = 0;
    done++;
    await tick();
  }
  return save(out);
}

/* ---------------- integrity ---------------- */

export async function sha256(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice(0).buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Rough password strength meter, purely advisory. */
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: 'empty' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^\w]/.test(pw)) pool += 33;
  const bits = pw.length * Math.log2(pool || 1);
  const label = bits < 40 ? 'weak' : bits < 60 ? 'fair' : bits < 80 ? 'strong' : 'very strong';
  return { score: Math.min(1, bits / 90), bits: Math.round(bits), label };
}

export { PDFRef };
