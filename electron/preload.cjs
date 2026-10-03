/**
 * The only bridge between the sandboxed UI and the operating system.
 *
 * It exposes four functions and nothing else — no filesystem, no shell, no
 * Node. Both file functions go through a dialog the user must confirm, so the
 * page can never read or write a path of its own choosing.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bench', {
  openFile: () => ipcRenderer.invoke('file:open'),
  saveFile: (name, bytes) => ipcRenderer.invoke('file:save', name, bytes),
  info: () => ipcRenderer.invoke('app:info'),
  onOpenPath: (handler) => {
    ipcRenderer.on('open-path', (_e, payload) => handler(payload));
  },
  onMenu: (handler) => {
    ipcRenderer.on('menu', (_e, action) => handler(action));
  },
});
