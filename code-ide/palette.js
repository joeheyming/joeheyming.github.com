/**
 * Quick-open file palette (Ctrl/Cmd+P) and the helper that walks the
 * filesystem to gather all file paths under the project root. Mixed into
 * `CodeIDE.prototype` so it can call `this.fs` / `this.openPath`.
 */

export const paletteMethods = {
  async openQuickOpen() {
    if (document.querySelector('.palette')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'palette-backdrop';
    const palette = document.createElement('div');
    palette.className = 'palette';
    palette.innerHTML = `<input placeholder="Go to file…" autofocus /><div class="results"></div>`;
    document.body.append(backdrop, palette);

    const input = palette.querySelector('input');
    const results = palette.querySelector('.results');

    const allFiles = await this.collectAllFiles();
    let active = 0;
    let visible = allFiles;

    const close = () => {
      backdrop.remove();
      palette.remove();
    };

    const render = () => {
      results.innerHTML = '';
      visible.slice(0, 50).forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'row' + (i === active ? ' active' : '');
        row.innerHTML = `<span>${this.fs.baseName(f)}</span><span class="path">${f}</span>`;
        row.addEventListener('click', () => {
          close();
          this.openPath(f);
        });
        results.appendChild(row);
      });
    };
    render();

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      visible = q ? allFiles.filter((f) => f.toLowerCase().includes(q)) : allFiles;
      active = 0;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        close();
      } else if (e.key === 'ArrowDown') {
        active = Math.min(active + 1, visible.length - 1);
        render();
      } else if (e.key === 'ArrowUp') {
        active = Math.max(active - 1, 0);
        render();
      } else if (e.key === 'Enter') {
        const target = visible[active];
        if (target) {
          close();
          this.openPath(target);
        }
      }
    });
    backdrop.addEventListener('click', close);
    input.focus();
  },

  async collectAllFiles() {
    const out = [];
    const queue = [this.fs.root || '/'];
    let safety = 1000;
    while (queue.length && safety-- > 0) {
      const dir = queue.shift();
      let items;
      try {
        items = await this.fs.listDir(dir);
      } catch {
        continue;
      }
      for (const item of items) {
        if (item.isDirectory) queue.push(item.path);
        else out.push(item.path);
      }
    }
    return out.sort();
  }
};
