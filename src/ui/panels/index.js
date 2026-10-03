import pages from './pages.js';
import markup from './markup.js';
import fillsign from './fillsign.js';
import text from './text.js';
import document_ from './document.js';
import convert from './convert.js';
import security from './security.js';
import compare from './compare.js';

export const PANELS = [pages, document_, compare, markup, fillsign, text, convert, security];
export const byId = Object.fromEntries(PANELS.map((p) => [p.id, p]));
