/**
 * pdf.js worker entry point.
 *
 * The worker runs in its own global scope, so the polyfills the main thread
 * installs are not visible here — they have to be loaded again before the
 * worker body runs.
 */
import './polyfills.js';
import 'pdfjs-dist/build/pdf.worker.min.mjs';
