/** Shared browser launcher: use CHROMIUM_PATH if set, else Playwright's own browser. */
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const SANDBOX = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export const BASE = process.env.BASE || 'http://127.0.0.1:5173';

export function launch() {
  if (process.env.CHROMIUM_PATH) return chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
  if (existsSync(SANDBOX)) return chromium.launch({ executablePath: SANDBOX });
  return chromium.launch();
}
