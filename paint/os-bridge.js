// HeymingOS embed integration for Paint. Owns the postMessage listener and the
// "Save to OS" / "Open from OS" file-menu items that only show up when the app
// is running inside the OS shell.

import { serializeProject } from './project.js';
import { flattenToCanvas } from './layers.js';

function isInOS() {
  try { return window.parent !== window; } catch { return false; }
}

function sendToOS(message) {
  window.parent.postMessage({ type: 'iframe-message', message }, '*');
}

/**
 * @param {{
 *   state: any,
 *   getDims: () => { w: number, h: number },
 *   activeCtx: () => CanvasRenderingContext2D,
 *   pushUndo: (label?: string) => void,
 *   refreshLayerPanel: () => void,
 *   closeFileMenu: () => void,
 *   loadProjectData: (data: any) => Promise<void>,
 * }} deps
 */
export function installOSBridge(deps) {
  const { state, getDims, activeCtx, pushUndo, refreshLayerPanel, closeFileMenu, loadProjectData } = deps;

  const saveProjectToOS = () => {
    const { w, h } = getDims();
    const data = serializeProject(state, w, h);
    sendToOS({ type: 'saveAs', content: JSON.stringify(data), suggestedName: 'untitled.paintproj' });
  };

  const savePNGToOS = () => {
    const { w, h } = getDims();
    const flat = flattenToCanvas(state.layers, state.bgColor, w, h, { transparentBg: true });
    sendToOS({ type: 'saveAs', content: flat.toDataURL('image/png'), suggestedName: 'untitled.png' });
  };

  const openFromOS = () => {
    sendToOS({ type: 'openFileDialog', fileTypes: ['.paintproj', 'image/*'], title: 'Open in Paint' });
  };

  const handleOSMessage = (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type !== 'openFile') return;

    const { content, fileName } = data;
    if (!content) return;

    const nameLC = (fileName || '').toLowerCase();
    const isProject = nameLC.endsWith('.paintproj') ||
      (typeof content === 'string' && content.trimStart().startsWith('{'));

    if (isProject) {
      try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;
        loadProjectData(parsed).catch((err) => alert('Could not open project: ' + err.message));
      } catch {
        alert('Could not parse project file');
      }
      return;
    }

    const src = typeof content === 'string' ? content : URL.createObjectURL(new Blob([content]));
    const img = new Image();
    img.onload = () => {
      pushUndo('Open from OS');
      activeCtx().drawImage(img, 0, 0);
      if (!src.startsWith('data:')) URL.revokeObjectURL(src);
      refreshLayerPanel();
    };
    img.onerror = () => alert('Could not load image from OS');
    img.src = src;
  };

  window.addEventListener('message', handleOSMessage);
  if (!isInOS()) return;

  const fileList = document.getElementById('file-menu-list');
  if (!fileList) return;

  const openComputerBtn = fileList.querySelector('[data-file="open-computer"]');
  if (openComputerBtn) {
    const btnOpenOS = document.createElement('button');
    btnOpenOS.className = 'action-menu-item';
    btnOpenOS.textContent = 'Open from OS…';
    btnOpenOS.addEventListener('click', () => { closeFileMenu(); openFromOS(); });
    openComputerBtn.after(btnOpenOS);
  }

  const sep = document.createElement('div');
  sep.className = 'action-menu-sep';

  const saveToOSItem = document.createElement('div');
  saveToOSItem.className = 'action-menu-item has-submenu';
  saveToOSItem.setAttribute('role', 'menuitem');
  saveToOSItem.setAttribute('aria-haspopup', 'true');
  saveToOSItem.textContent = 'Save to OS';

  const osSubmenu = document.createElement('div');
  osSubmenu.className = 'action-submenu';
  osSubmenu.setAttribute('role', 'menu');

  const btnProjOS = document.createElement('button');
  btnProjOS.className = 'action-menu-item';
  btnProjOS.textContent = 'Paint project (.paintproj)';
  btnProjOS.addEventListener('click', () => { closeFileMenu(); saveProjectToOS(); });

  const btnPNGOS = document.createElement('button');
  btnPNGOS.className = 'action-menu-item';
  btnPNGOS.textContent = 'PNG image';
  btnPNGOS.addEventListener('click', () => { closeFileMenu(); savePNGToOS(); });

  osSubmenu.append(btnProjOS, btnPNGOS);
  saveToOSItem.appendChild(osSubmenu);
  fileList.append(sep, saveToOSItem);
}
