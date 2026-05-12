/** @param {new () => object} FileManager */
export function applyFileManagerNav(FileManager) {
  Object.assign(FileManager.prototype, {
    _generateSidebar() {
      // Generate Quick Access items from config
      const quickAccess = this.cfg.getQuickAccess
        ? this.cfg.getQuickAccess()
        : [
            { name: '🏠 Home', path: this.cfg.HOME },
            { name: '🖥️ Desktop', path: `${this.cfg.HOME}/Desktop` },
            { name: '📄 Documents', path: `${this.cfg.HOME}/Documents` },
            { name: '⬇️ Downloads', path: `${this.cfg.HOME}/Downloads` },
            { name: '🖼️ Pictures', path: `${this.cfg.HOME}/Pictures` },
            { name: '🎵 Music', path: `${this.cfg.HOME}/Music` },
            { name: '🎬 Videos', path: `${this.cfg.HOME}/Videos` }
          ];

      const section = document.getElementById('quick-access-section');
      if (!section) return;

      // Keep the h3, add items after
      const items = quickAccess
        .map((item) => `<div class="sidebar-item" data-path="${item.path}">${item.name}</div>`)
        .join('');

      section.innerHTML = `<h3>Quick Access</h3>${items}`;
    },

    async navigateTo(path) {
      try {
        const item = await this.fs.getItem(path);
        if (!item || item.type !== 'directory') {
          console.error('Not a directory:', path);
          return;
        }

        this.currentPath = path;

        // Update history
        if (this.historyIndex < this.history.length - 1) {
          this.history = this.history.slice(0, this.historyIndex + 1);
        }
        if (this.history[this.historyIndex] !== path) {
          this.history.push(path);
          this.historyIndex = this.history.length - 1;
        }

        this.selectedItems.clear();
        await this.renderFiles();
        this.updatePathBar();
        this.updateSidebar();
        this.updateNavigationButtons();
      } catch (error) {
        console.error('Navigation error:', error);
      }
    },

    goBack() {
      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.navigateTo(this.history[this.historyIndex]);
      }
    },

    goForward() {
      if (this.historyIndex < this.history.length - 1) {
        this.historyIndex++;
        this.navigateTo(this.history[this.historyIndex]);
      }
    },

    goUp() {
      const parent = this.fs.getParentPath(this.currentPath);
      if (parent) {
        this.navigateTo(parent);
      }
    },

    refresh() {
      this.renderFiles();
    },

    updatePathBar() {
      const pathBar = document.getElementById('current-path');
      if (!pathBar) return;

      const segments = this.currentPath.split('/').filter(Boolean);
      const atRoot = segments.length === 0;
      const sep = '<span class="breadcrumb-separator" aria-hidden="true">›</span>';

      const chunks = [];
      const pathAttr = (p) => this.escapeHtml(p);

      if (atRoot) {
        chunks.push(
          '<span class="breadcrumb-segment active" data-path="/" aria-current="page" tabindex="-1" aria-label="Home">🏠</span>'
        );
      } else {
        chunks.push(
          '<span class="breadcrumb-segment" data-path="/" role="button" tabindex="0" aria-label="Go to folder root">🏠</span>'
        );
      }

      let currentPath = '';
      segments.forEach((segment, index) => {
        currentPath += '/' + segment;
        const isLast = index === segments.length - 1;
        const segEsc = this.escapeHtml(segment);
        const pAttr = pathAttr(currentPath);
        chunks.push(sep);
        if (isLast) {
          chunks.push(
            `<span class="breadcrumb-segment active" data-path="${pAttr}" aria-current="page" tabindex="-1">${segEsc}</span>`
          );
        } else {
          chunks.push(
            `<span class="breadcrumb-segment" data-path="${pAttr}" role="button" tabindex="0" aria-label="${this.escapeHtml(
              `Open folder ${currentPath}`
            )}">${segEsc}</span>`
          );
        }
      });

      pathBar.innerHTML = chunks.join('');

      pathBar.querySelectorAll('.breadcrumb-segment').forEach((seg) => {
        if (seg.getAttribute('aria-current') === 'page') return;
        const go = () => {
          const path = seg.dataset.path;
          if (path && path !== this.currentPath) {
            void this.navigateTo(path);
          }
        };
        seg.addEventListener('click', go);
        seg.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            go();
          }
        });
      });
    },

    updateSidebar() {
      document.querySelectorAll('.sidebar-item').forEach((item) => {
        item.classList.toggle('active', item.dataset.path === this.currentPath);
      });
    },

    updateNavigationButtons() {
      document.getElementById('btn-back').disabled = this.historyIndex <= 0;
      document.getElementById('btn-forward').disabled =
        this.historyIndex >= this.history.length - 1;
      document.getElementById('btn-up').disabled = this.currentPath === '/';
    },

    updateStatusBar(itemCount, showParent) {
      const visible = itemCount + (showParent ? 1 : 0);
      document.getElementById('item-count').textContent = `${visible} item${
        visible !== 1 ? 's' : ''
      }`;

      const selectedCount = this.selectedItems.size;
      const selectedEl = document.getElementById('selected-info');
      if (selectedCount > 0) {
        selectedEl.textContent = `${selectedCount} selected`;
        selectedEl.setAttribute('aria-hidden', 'false');
      } else {
        selectedEl.textContent = '';
        selectedEl.setAttribute('aria-hidden', 'true');
      }
    },

    async openItem(path) {
      const item = await this.fs.getItem(path);
      if (!item) return;

      if (item.type === 'directory') {
        this.navigateTo(path);
      } else {
        this.previewFile(item);
      }
    },

    async navigateWithArrows(key, shiftKey) {
      const fileItems = Array.from(document.querySelectorAll('.file-item'));
      if (fileItems.length === 0) return;

      // Find currently selected item
      let currentIndex = -1;
      const lastSelected = [...this.selectedItems].pop();
      if (lastSelected) {
        currentIndex = fileItems.findIndex((el) => el.dataset.path === lastSelected);
      }

      // If nothing selected, select first item
      if (currentIndex === -1) {
        const firstPath = fileItems[0]?.dataset.path;
        if (firstPath) {
          this.selectedItems.clear();
          this.selectedItems.add(firstPath);
          await this.renderFiles();
          const firstEl = document.querySelector(`[data-path="${CSS.escape(firstPath)}"]`);
          firstEl?.scrollIntoView({ block: 'nearest' });
          firstEl?.focus({ preventScroll: true });
        }
        return;
      }

      // Calculate next index based on view mode and key
      let nextIndex = currentIndex;
      const isGridView = !this.isListView;

      if (isGridView) {
        // Grid view: calculate columns
        const container = document.getElementById('file-list');
        const containerWidth = container?.offsetWidth || 600;
        const itemWidth = 116; // Approximate item width with gap
        const columns = Math.max(1, Math.floor(containerWidth / itemWidth));

        switch (key) {
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, fileItems.length - 1);
            break;
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
          case 'ArrowDown':
            nextIndex = Math.min(currentIndex + columns, fileItems.length - 1);
            break;
          case 'ArrowUp':
            nextIndex = Math.max(currentIndex - columns, 0);
            break;
        }
      } else {
        // List view: simple up/down
        switch (key) {
          case 'ArrowDown':
          case 'ArrowRight':
            nextIndex = Math.min(currentIndex + 1, fileItems.length - 1);
            break;
          case 'ArrowUp':
          case 'ArrowLeft':
            nextIndex = Math.max(currentIndex - 1, 0);
            break;
        }
      }

      if (nextIndex === currentIndex) return;

      const nextPath = fileItems[nextIndex]?.dataset.path;
      if (!nextPath) return;

      if (shiftKey) {
        // Shift+Arrow: extend selection
        this.selectedItems.add(nextPath);
      } else {
        // Arrow only: move selection
        this.selectedItems.clear();
        this.selectedItems.add(nextPath);
      }

      await this.renderFiles();
      const nextEl = document.querySelector(`[data-path="${CSS.escape(nextPath)}"]`);
      nextEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      nextEl?.focus({ preventScroll: true });
    }
  });
}
