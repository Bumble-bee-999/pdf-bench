/**
 * PDF Bench — desktop shell (Electron main process).
 *
 * Security posture, deliberately strict:
 *   · The renderer is sandboxed, context-isolated, and has no Node access.
 *   · The UI is served from a custom app:// protocol, never file:// or http://.
 *   · Every outbound network request is blocked at the session level, so the
 *     application cannot phone home even if a dependency tried to. Documents
 *     never leave the machine because there is nowhere for them to go.
 *   · The renderer cannot read or write arbitrary paths. It can only ask the
 *     main process to show an Open or Save dialog; the user picks the path.
 *   · Navigation away from the app, new windows, and permission requests are
 *     all refused.
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const isDev = !app.isPackaged;
// Works in both layouts: alongside the source in development, and inside
// app.asar once packaged (Electron's fs reads through the archive).
const ROOT = path.join(__dirname, '..', 'dist');
const MAX_FILE = 512 * 1024 * 1024; // refuse absurd inputs rather than exhausting memory

const CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

// Chromium does a certain amount of background networking of its own —
// component updates, domain reliability pings, media-router discovery. None of
// it is wanted here, and switching it off at the command line means the "no
// network" claim holds for the whole process, not just for page requests.
for (const flag of [
  'disable-background-networking',
  'disable-component-update',
  'disable-domain-reliability',
  'disable-sync',
  'no-pings',
  'no-default-browser-check',
  'metrics-recording-only',
  'disable-breakpad',
  'disable-crash-reporter',
]) app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('disable-features',
  'ComponentUpdater,OptimizationHints,MediaRouter,DialMediaRouteProvider,NetworkTimeServiceQuerying,AutofillServerCommunication');

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

let mainWindow = null;
let pendingOpen = null;

/* ---------------- protocol: serve the built UI ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gz': 'application/gzip',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

function serveApp() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    // Normalise and confine: nothing outside the packaged dist directory is
    // reachable, whatever path the page asks for.
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    let file = path.normalize(path.join(ROOT, rel));
    if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
    try {
      if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      // Unknown paths fall back to the entry document (single-page app).
      file = path.join(ROOT, 'index.html');
    }
    let body;
    try {
      body = await fs.readFile(file);
    } catch (err) {
      return new Response('Not found', { status: 404 });
    }
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cache-Control': 'no-cache',
      },
    });
  });
}

/* ---------------- session hardening ---------------- */

function hardenSession(ses) {
  // No network. Anything that is not our own protocol is refused.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const ok = /^(app|devtools|blob|data):/i.test(details.url);
    if (!ok) console.warn('[blocked outbound request]', details.url.slice(0, 120));
    callback({ cancel: !ok });
  });
  ses.setPermissionRequestHandler((_wc, _perm, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.setDevicePermissionHandler(() => false);
  ses.setDisplayMediaRequestHandler(() => {});
}

/* ---------------- window ---------------- */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#14161a',
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: isDev,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (pendingOpen) { sendFile(pendingOpen); pendingOpen = null; }
    // Headless self-check used by `npm run test:desktop`: render, save a
    // screenshot, report what the shell blocked, and exit.
    if (process.env.PDFBENCH_SMOKE) {
      setTimeout(async () => {
        try {
          const image = await mainWindow.webContents.capturePage();
          await fs.writeFile(process.env.PDFBENCH_SMOKE, image.toPNG());
          console.log('[smoke] screenshot written to', process.env.PDFBENCH_SMOKE);
        } catch (err) {
          console.error('[smoke] failed:', err.message);
        }
        app.exit(0);
      }, 4000);
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.loadURL('app://bench/index.html');
}

/* ---------------- menu ---------------- */

function buildMenu() {
  const template = [
    {
      label: '&File',
      submenu: [
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu', 'open') },
        { label: 'Save as…', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu', 'save') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow?.webContents.send('menu', 'undo') },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Y', click: () => mainWindow?.webContents.send('menu', 'redo') },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: '&View',
      submenu: [
        { label: 'Zoom in', accelerator: 'CmdOrCtrl+=', click: () => mainWindow?.webContents.send('menu', 'zoom-in') },
        { label: 'Zoom out', accelerator: 'CmdOrCtrl+-', click: () => mainWindow?.webContents.send('menu', 'zoom-out') },
        { label: 'Fit width', accelerator: 'CmdOrCtrl+0', click: () => mainWindow?.webContents.send('menu', 'fit') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : []),
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About PDF Bench',
          click: () => dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: 'About PDF Bench',
            message: `PDF Bench ${app.getVersion()}`,
            detail: 'A free, open-source PDF workbench.\n\n'
              + 'Everything runs on this computer. The application has no network access '
              + 'at all — outbound requests are blocked in the shell — so documents cannot '
              + 'leave this machine.\n\nMIT licensed.',
            buttons: ['Close'],
          }),
        },
        {
          label: 'Show the installation folder',
          click: () => shell.openPath(path.dirname(app.getPath('exe'))),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------- file bridge (dialogs only) ---------------- */

async function readPdf(filePath) {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_FILE) throw new Error('That file is larger than 512 MB.');
  const data = await fs.readFile(filePath);
  return { name: path.basename(filePath), path: filePath, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
}

function sendFile(filePath) {
  readPdf(filePath)
    .then((payload) => mainWindow?.webContents.send('open-path', payload))
    .catch((err) => dialog.showErrorBox('Could not open the file', err.message));
}

ipcMain.handle('file:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a PDF',
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (res.canceled || !res.filePaths[0]) return { canceled: true };
  try { return await readPdf(res.filePaths[0]); } catch (err) { return { error: err.message }; }
});

ipcMain.handle('file:save', async (_event, suggestedName, data) => {
  if (!(data instanceof ArrayBuffer) && !ArrayBuffer.isView(data)) return { error: 'Nothing to save.' };
  const safeName = String(suggestedName || 'document.pdf').replace(/[\\/:*?"<>|]/g, '_');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Save PDF',
    defaultPath: safeName,
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  try {
    await fs.writeFile(res.filePath, Buffer.from(data));
    return { ok: true, path: res.filePath };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
}));

/* ---------------- lifecycle ---------------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const file = argv.find((a) => /\.pdf$/i.test(a));
    if (file) sendFile(file);
  });

  app.whenReady().then(() => {
    serveApp();
    hardenSession(session.defaultSession);
    buildMenu();
    createWindow();
    const file = process.argv.find((a) => /\.pdf$/i.test(a));
    if (file) pendingOpen = file;
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });

  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (mainWindow) sendFile(filePath);
    else pendingOpen = filePath;
  });

  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

  // Belt and braces: refuse navigation and popups from any web contents.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!url.startsWith('app://')) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });
}
