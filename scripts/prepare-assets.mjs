/**
 * Copies the OCR engine and its language data into public/ so the app works
 * with no network access at all. Run automatically before dev and build.
 */
import { cp, mkdir, readdir, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'public', 'ocr');
const nm = join(root, 'node_modules');

await mkdir(join(out, 'core'), { recursive: true });
await mkdir(join(out, 'lang'), { recursive: true });

// 1. The worker script tesseract.js spawns.
await cp(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'));

// 2. The WebAssembly cores. Only the SIMD builds are kept — every browser and
//    Electron version this app targets supports SIMD, and the fallbacks double
//    the install size.
const coreSrc = join(nm, 'tesseract.js-core');
for (const name of await readdir(coreSrc)) {
  // createWorker(lang, 1) picks an LSTM build and prefers relaxed SIMD where
  // the engine supports it. Shipping those two covers every target; the plain
  // and non-LSTM builds would add ~30 MB for nothing.
  if (!/^tesseract-core-(relaxedsimd-)?simd-lstm\.(js|wasm|wasm\.js)$/.test(name)
    && !/^tesseract-core-relaxedsimd-lstm\.(js|wasm|wasm\.js)$/.test(name)) continue;
  await cp(join(coreSrc, name), join(out, 'core', name));
}

// 3. Language data. Anything installed as @tesseract.js-data/<lang> is bundled;
//    users can also drop extra .traineddata.gz files into public/ocr/lang.
const dataRoot = join(nm, '@tesseract.js-data');
const langs = [];
if (existsSync(dataRoot)) {
  for (const lang of await readdir(dataRoot)) {
    // Smallest usable variant first: the integer model is a quarter of the
    // size of the float one and barely less accurate on document scans.
    for (const variant of ['4.0.0_fast_int', '4.0.0_best_int', '4.0.0']) {
      const file = join(dataRoot, lang, variant, `${lang}.traineddata.gz`);
      if (existsSync(file)) {
        await cp(file, join(out, 'lang', `${lang}.traineddata.gz`));
        langs.push(lang);
        break;
      }
    }
  }
}
for (const name of await readdir(join(out, 'lang')).catch(() => [])) {
  const m = /^([a-z_]+)\.traineddata(\.gz)?$/.exec(name);
  if (m && !langs.includes(m[1])) langs.push(m[1]);
}

await writeFile(join(out, 'lang', 'manifest.json'), JSON.stringify({ languages: langs.sort() }, null, 2));

let total = 0;
async function walk(dir) {
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) await walk(p);
    else total += (await stat(p)).size;
  }
}
await walk(out);
console.log(`OCR assets ready: ${langs.join(', ') || 'none'} — ${(total / 1048576).toFixed(1)} MB`);
