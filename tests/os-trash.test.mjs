import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FileOperationService } from '../os/FileOperationService.js';
import {
  TRASH_PATH,
  allPathsInTrash,
  isProtectedTrashRoot,
  isTrashPath,
  restorePathForName
} from '../os/trash.js';

function memoryFs() {
  /** @type {Map<string, { type: string, path: string, parentPath: string | null, content?: string }>} */
  const store = new Map();
  store.set('/', { type: 'directory', path: '/', parentPath: null });
  store.set('/home', { type: 'directory', path: '/home', parentPath: '/' });
  store.set('/home/user', { type: 'directory', path: '/home/user', parentPath: '/home' });
  store.set('/home/user/Desktop', {
    type: 'directory',
    path: '/home/user/Desktop',
    parentPath: '/home/user'
  });

  const parentOf = (path) => {
    if (path === '/') return null;
    const i = path.lastIndexOf('/');
    return i === 0 ? '/' : path.slice(0, i);
  };

  return {
    store,
    getFileName(path) {
      return path.split('/').pop();
    },
    joinPath(dir, name) {
      return `${dir.replace(/\/$/, '')}/${name}`;
    },
    getParentPath: parentOf,
    async getItem(path) {
      return store.get(path) || null;
    },
    async mkdir(path) {
      store.set(path, { type: 'directory', path, parentPath: parentOf(path) });
    },
    async getUniquePath(path) {
      if (!store.has(path)) return path;
      let i = 1;
      while (store.has(`${path} ${i}`)) i += 1;
      return `${path} ${i}`;
    },
    async listDirectory(path) {
      return [...store.values()].filter((item) => item.parentPath === path);
    },
    async moveItem(from, to) {
      const item = store.get(from);
      if (!item) throw new Error(`missing ${from}`);
      store.delete(from);
      store.set(to, { ...item, path: to, parentPath: parentOf(to) });
    },
    async deleteItem(path) {
      store.delete(path);
    },
    async createFile(path, content) {
      store.set(path, {
        type: 'file',
        path,
        parentPath: parentOf(path),
        content
      });
    }
  };
}

describe('trash helpers', () => {
  it('detects trash paths', () => {
    assert.equal(isTrashPath('/Trash'), true);
    assert.equal(isTrashPath('/Trash/note.txt'), true);
    assert.equal(isTrashPath('/home/user/Desktop/a'), false);
    assert.equal(isProtectedTrashRoot('/Trash'), true);
    assert.equal(allPathsInTrash(['/Trash/a', '/Trash/b']), true);
    assert.equal(restorePathForName('a.txt', '/home/user/Desktop'), '/home/user/Desktop/a.txt');
  });
});

describe('FileOperationService trash', () => {
  it('moves desktop files into /Trash instead of deleting them', async () => {
    const fs = memoryFs();
    await fs.createFile('/home/user/Desktop/song.txt', 'hi');
    const result = await FileOperationService.delete(fs, ['/home/user/Desktop/song.txt'], {
      confirm: true,
      confirmFn: async () => true
    });
    assert.equal(result.success, true);
    assert.equal(result.permanent, false);
    assert.equal(await fs.getItem('/home/user/Desktop/song.txt'), null);
    assert.ok(await fs.getItem(`${TRASH_PATH}/song.txt`));
  });

  it('permanently deletes items already in Trash', async () => {
    const fs = memoryFs();
    await FileOperationService.ensureTrash(fs);
    await fs.createFile(`${TRASH_PATH}/gone.txt`, 'x');
    const result = await FileOperationService.delete(fs, [`${TRASH_PATH}/gone.txt`], {
      confirmFn: async () => true
    });
    assert.equal(result.permanent, true);
    assert.equal(await fs.getItem(`${TRASH_PATH}/gone.txt`), null);
  });

  it('restores from Trash onto the desktop', async () => {
    const fs = memoryFs();
    await FileOperationService.ensureTrash(fs);
    await fs.createFile(`${TRASH_PATH}/back.txt`, 'ok');
    const result = await FileOperationService.restore(
      fs,
      [`${TRASH_PATH}/back.txt`],
      '/home/user/Desktop'
    );
    assert.equal(result.success, true);
    assert.ok(await fs.getItem('/home/user/Desktop/back.txt'));
  });

  it('empties Trash after confirm', async () => {
    const fs = memoryFs();
    await FileOperationService.ensureTrash(fs);
    await fs.createFile(`${TRASH_PATH}/a.txt`, 'a');
    const result = await FileOperationService.emptyTrash(fs, { confirmFn: async () => true });
    assert.equal(result.success, true);
    assert.equal((await fs.listDirectory(TRASH_PATH)).length, 0);
  });
});
