/**
 * OCR: turns scanned pages into searchable ones.
 *
 * The engine (WebAssembly) and the language data are bundled with the
 * application, under `ocr/`. Nothing is fetched at run time, which is why this
 * keeps working with the network switched off — and why the desktop build can
 * block outbound traffic outright.
 */
import { rasterize, canvasToBlob } from './render.js';
import { mergeInto } from './pdfops.js';
import { tick } from './util.js';

export const ocrBase = () => new URL('ocr/', document.baseURI).href;

export const LANG_NAMES = {
  eng: 'English', spa: 'Spanish', fra: 'French', deu: 'German', ita: 'Italian',
  por: 'Portuguese', nld: 'Dutch', pol: 'Polish', rus: 'Russian', tur: 'Turkish',
  ces: 'Czech', swe: 'Swedish', dan: 'Danish', nor: 'Norwegian', fin: 'Finnish',
  ron: 'Romanian', hun: 'Hungarian', ell: 'Greek', heb: 'Hebrew', ara: 'Arabic',
  hin: 'Hindi', jpn: 'Japanese', kor: 'Korean', chi_sim: 'Chinese (simplified)',
  chi_tra: 'Chinese (traditional)', vie: 'Vietnamese', ind: 'Indonesian',
};

let cached = null;
/** Language codes installed alongside the app. */
export async function languages() {
  if (cached) return cached;
  try {
    const res = await fetch(ocrBase() + 'lang/manifest.json');
    cached = (await res.json()).languages || ['eng'];
  } catch { cached = ['eng']; }
  return cached;
}

async function makeWorker(lang, onStatus) {
  const Tesseract = await import('tesseract.js');
  const base = ocrBase();
  return Tesseract.createWorker(lang, 1, {
    workerPath: base + 'worker.min.js',
    corePath: base + 'core',
    langPath: base + 'lang',
    gzip: true,
    workerBlobURL: false,
    logger: onStatus,
  });
}

/**
 * Recognise text on the given pages and return a new PDF where each page is
 * the scanned image with an invisible text layer over it.
 */
export async function recognizePages(pdf, pages, { lang = 'eng', dpi = 200, onProgress } = {}) {
  let worker;
  try {
    onProgress?.({ label: 'Starting the OCR engine…', value: 0 });
    worker = await makeWorker(lang, (m) => {
      if (m.status === 'recognizing text') onProgress?.({ label: `Reading text… ${Math.round(m.progress * 100)}%`, value: m.progress });
    });
    const parts = [];
    for (let n = 0; n < pages.length; n++) {
      const i = pages[n];
      onProgress?.({ label: `Page ${i + 1} (${n + 1} of ${pages.length})…`, value: n / pages.length });
      const canvas = await rasterize(pdf, i, dpi);
      const blob = await canvasToBlob(canvas, 'image/png');
      const { data } = await worker.recognize(blob, {}, { pdf: true, text: true });
      parts.push({ pdf: new Uint8Array(data.pdf), text: data.text });
      canvas.width = canvas.height = 0;
      await tick();
    }
    onProgress?.({ label: 'Assembling…', value: 0.97 });
    const merged = await mergeInto(null, parts.map((p) => ({ kind: 'pdf', bytes: p.pdf })));
    return { bytes: merged, text: parts.map((p) => p.text).join('\n\n') };
  } finally {
    try { await worker?.terminate(); } catch { /* already gone */ }
  }
}
