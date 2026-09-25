import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { Desktop } from '../os/Desktop.js';
import { desktopVfsItems } from '../os/desktop-layout.js';

function installDom() {
  const dom = new JSDOM('<!doctype html><div id="os-desktop"></div>', {
    url: 'https://joeheyming.github.io/os/',
    pretendToBeVisual: true
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.localStorage = dom.window.localStorage;
  Object.defineProperty(dom.window, 'innerWidth', { value: 1200, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 800, configurable: true });
  return dom;
}

function memoryFs(initial = []) {
  const store = new Map();
  const parentOf = (path) => {
    if (path === '/') return null;
    const i = path.lastIndexOf('/');
    return i === 0 ? '/' : path.slice(0, i);
  };
  for (const item of initial) {
    store.set(item.path, item);
  }
  return {
    async listDirectory(path) {
      return desktopVfsItems([...store.values()].filter((item) => item.parentPath === path));
    },
    getFileName(path) {
      return path.split('/').pop();
    },
    async getUniquePath(path) {
      return path;
    },
    async mkdir(path) {
      store.set(path, { type: 'directory', path, parentPath: parentOf(path) });
    },
    async createFile(path, content) {
      store.set(path, { type: 'file', path, parentPath: parentOf(path), content });
    },
    async getItem(path) {
      return store.get(path) || null;
    }
  };
}

describe('Desktop folders and selection', () => {
  beforeEach(() => {
    installDom();
    window.__heymingAppRegistryReady = true;
    window.AppModule = {
      getDesktopApps() {
        return [{ id: 'doom', shortName: 'DOOM', icon: '💀', system: false }];
      }
    };
    window.HeymingOS = {
      Icons: { getIconForFile: () => '📄' },
      debug() {},
      instance: { notifications: { system() {}, error() {} } }
    };
    window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
  });

  it('renders folders from the desktop VFS path', async () => {
    const desktop = new Desktop(
      () => {},
      () => {}
    );
    desktop.fs = memoryFs([
      {
        type: 'directory',
        path: '/home/user/Desktop/Projects',
        parentPath: '/home/user/Desktop'
      },
      { type: 'file', path: '/home/user/Desktop/readme.txt', parentPath: '/home/user/Desktop' }
    ]);
    desktop.desktopPath = '/home/user/Desktop';
    await desktop.init();
    const labels = [...document.querySelectorAll('.desktop-icon .label')].map(
      (el) => el.textContent
    );
    assert.ok(labels.includes('Projects'));
    assert.ok(labels.includes('readme.txt') || labels.includes('readme.t...'));
    const folder = document.querySelector('[data-item-type="directory"]');
    assert.ok(folder);
    assert.equal(folder.dataset.path, '/home/user/Desktop/Projects');
  });

  it('creates a folder then shows it after refresh', async () => {
    const desktop = new Desktop(
      () => {},
      () => {}
    );
    const fs = memoryFs();
    desktop.fs = fs;
    desktop.desktopPath = '/home/user/Desktop';
    await desktop.init();

    const created = desktop.createNewFolder();
    await Promise.resolve();
    const input = document.querySelector('.os-prompt-input');
    assert.ok(input);
    input.value = 'Inbox';
    document.querySelector('.os-prompt-ok').click();
    const result = await created;
    assert.equal(result.success, true);
    const folder = document.querySelector('[data-path="/home/user/Desktop/Inbox"]');
    assert.ok(folder);
    assert.equal(folder.dataset.itemType, 'directory');
  });

  it('selects app shortcuts the same way as files', async () => {
    const desktop = new Desktop(
      () => {},
      () => {}
    );
    desktop.fs = memoryFs();
    desktop.desktopPath = '/home/user/Desktop';
    await desktop.init();
    const appIcon = document.querySelector('[data-app-id="doom"]');
    assert.ok(appIcon);
    appIcon.click();
    assert.equal(desktop.selectedKeys.has('app:doom'), true);
    assert.ok(appIcon.classList.contains('selected'));
  });

  it('persists a layout patch onto prefs', async () => {
    const desktop = new Desktop(
      () => {},
      () => {}
    );
    desktop.fs = memoryFs();
    desktop.desktopPath = '/home/user/Desktop';
    await desktop.init();
    desktop._persistLayout({ 'app:doom': { x: 180, y: 100 } });
    const raw = JSON.parse(window.localStorage.getItem('heymingOS_prefs'));
    assert.deepEqual(raw.desktopIconLayout['app:doom'], { x: 180, y: 100 });
  });
});
