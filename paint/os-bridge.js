// HeymingOS embed integration for Paint.
//
// Thin adapter: builds the project / PNG payloads, then hands the
// postMessage protocol + menu-grow + notify-forward off to the shared
// `/os-embed.js` bridge so the dance isn't reimplemented per app.

import { serializeProject } from './project.js';
import { flattenToCanvas } from './layers.js';
import { createOSEmbed } from '/os-embed.js';

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

  const embed = createOSEmbed({
    app: 'paint',
    fileTypes: ['.paintproj', 'image/*'],
    title: 'Open in Paint',
    onOpenFile: ({ content, fileName }) => {
      if (!content) return;
      const nameLC = (fileName || '').toLowerCase();
      const isProject =
        nameLC.endsWith('.paintproj') ||
        (typeof content === 'string' && content.trimStart().startsWith('{'));

      if (isProject) {
        try {
          const parsed = typeof content === 'string' ? JSON.parse(content) : content;
          loadProjectData(parsed).catch((err) =>
            embed.notify(`Couldn't open project: ${err.message}`, { kind: 'error' })
          );
        } catch {
          embed.notify("That doesn't look like a valid project file.", { kind: 'error' });
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
      img.onerror = () =>
        embed.notify("Couldn't load that image.", { kind: 'error' });
      img.src = src;
    }
  });

  if (!embed.isEmbedded) return;

  const fileList = document.getElementById('file-menu-list');
  if (!fileList) return;
  const openComputerBtn = fileList.querySelector('[data-file="open-computer"]');

  embed.installSaveMenu(
    fileList,
    [
      {
        label: 'Paint project (.paintproj)',
        suggestedName: 'untitled.paintproj',
        save: () => {
          const { w, h } = getDims();
          const data = serializeProject(state, w, h);
          return JSON.stringify(data);
        }
      },
      {
        label: 'PNG image',
        suggestedName: 'untitled.png',
        save: () => {
          const { w, h } = getDims();
          const flat = flattenToCanvas(state.layers, state.bgColor, w, h, { transparentBg: true });
          return flat.toDataURL('image/png');
        }
      }
    ],
    {
      openInsertAfter: openComputerBtn instanceof HTMLElement ? openComputerBtn : undefined,
      closeMenu: closeFileMenu
    }
  );
}
