# Third-party components

PDF Bench is MIT licensed. It is built on the following open-source projects,
each under its own licence. Full licence texts ship inside `node_modules` and
are reproduced in the packaged application.

| Component | Purpose | Licence |
| --- | --- | --- |
| [`@cantoo/pdf-lib`](https://github.com/cantoo-scribe/pdf-lib) | Reading and writing PDF structure, forms, encryption | MIT |
| [`pdfjs-dist`](https://github.com/mozilla/pdf.js) (Mozilla) | Rendering pages and extracting text | Apache-2.0 |
| [`tesseract.js`](https://github.com/naptha/tesseract.js) + `tesseract.js-core` | OCR engine (WebAssembly build of Tesseract) | Apache-2.0 |
| [`@tesseract.js-data/*`](https://github.com/naptha/tessdata) | OCR language models | Apache-2.0 |
| [`jszip`](https://stuk.github.io/jszip/) | Building ZIP archives for batch export | MIT or GPLv3 |
| [`electron`](https://electronjs.org) | Desktop shell | MIT |
| [`vite`](https://vitejs.dev) | Build tooling (development only) | MIT |

No component is used in a way that requires you to open-source your own
changes, and none of them phones home in this configuration.
