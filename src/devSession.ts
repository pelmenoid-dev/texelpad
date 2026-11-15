import { captureProject, defaultProjectUI } from './project';
import type { ProjectUI } from './project';
import type { Studio } from './studio';
declare global {
  interface Window {
    __workshopUI?: ProjectUI;
    __workshop?: Studio;
  }
}

// Capture before React Fast Refresh runs the previous effect's Studio.dispose().
// This stays inside the painter tab; nothing is sent to a server or another tab.
export function captureDevSession() {
  if (!import.meta.hot || !window.__workshop) return undefined;
  const ui = window.__workshopUI ?? defaultProjectUI;
  return captureProject(window.__workshop, ui);
}
if (import.meta.hot) {
  // Vite awaits storage before reloading; failures leave the unsaved-work guard active.
  import.meta.hot.on('vite:beforeFullReload', async ({
    path
  }) => {
    if (path?.endsWith('.html')) {
      const current = decodeURI(location.pathname);
      if (path !== '/index.html' && current !== path && !(current.endsWith('/') && current + 'index.html' === path)) return;
    }
    const project = captureDevSession();
    if (!project) return;
    const id = sessionStorage.getItem('pixel-workshop-dev-id') ?? `dev-${crypto.randomUUID()}`;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('pixel-workshop-handoff', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('snapshots');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const transaction = db.transaction('snapshots', 'readwrite');
        transaction.objectStore('snapshots').put(project, id);
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error);
        };
        transaction.onabort = () => {
          db.close();
          reject(transaction.error);
        };
      };
    });
    sessionStorage.setItem('pixel-workshop-dev-id', id);
    sessionStorage.setItem('pixel-workshop-handoff', id);
    // The saved snapshot keeps the original dirty flag for restoration.
    if (window.__workshop) window.__workshop.dirty = false;
  });
}
