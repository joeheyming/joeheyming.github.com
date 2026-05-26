// Rich Text Notepad Application with Quill

// Debug logging helper
function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.log('[Notepad]', ...args);
  }
}

class RichNotepad {
  constructor() {
    this.quill = null;
    this.currentFilePath = null;
    this.currentFileName = null;
    this.init();
  }

  init() {
    // Initialize Quill editor
    this.quill = new Quill('#editor', {
      theme: 'snow',
      placeholder: 'Start typing your notes here...',
      modules: {
        // The copy / export / import / save buttons are appended in
        // addCustomButtons() below — declaring them here as custom
        // toolbar format names made Quill render empty placeholder
        // buttons (it has no icons for unknown format names) which
        // showed up as the three blank squares on the right.
        toolbar: {
          container: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ color: [] }, { background: [] }],
            [{ list: 'ordered' }, { list: 'bullet' }],
            [{ align: [] }],
            ['blockquote', 'code-block'],
            ['link'],
            ['clean']
          ]
        }
      }
    });

    // Add custom buttons to toolbar
    this.addCustomButtons();
    this.enhanceToolbarAccessibility();

    // Auto-focus the editor
    this.quill.focus();

    // Setup auto-save
    this.setupAutoSave();

    // Load saved content
    this.loadSavedContent();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();

    // Listen for file open messages from parent (OS)
    this.setupMessageListener();
  }

  /**
   * OS may send string (legacy `content`) or ArrayBuffer from FileSystemDB.getContentForApp (git/binary files).
   */
  normalizeOpenFileContent(content) {
    if (content == null) {
      return '';
    }
    if (typeof content === 'string') {
      return content;
    }
    if (content instanceof ArrayBuffer) {
      if (content.byteLength === 0) {
        return '';
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(content));
    }
    if (ArrayBuffer.isView(content)) {
      const u8 = new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
      if (u8.byteLength === 0) {
        return '';
      }
      return new TextDecoder('utf-8', { fatal: false }).decode(u8);
    }
    return String(content);
  }

  setupMessageListener() {
    window.addEventListener('message', (e) => {
      const data = e.data;
      if (data.type === 'openFile') {
        this.loadFileContent(data.content, data.fileName, data.path);
      } else if (data.type === 'fileSaved') {
        // Update current file info after Save As
        this.currentFilePath = data.path;
        this.currentFileName = data.fileName;
        document.title = `${data.fileName} - Notepad 📝`;

        this.showNotification(`💾 Saved: ${data.fileName}`, 'success');
      }
    });
  }

  loadFileContent(content, fileName, path) {
    this.currentFilePath = path;
    this.currentFileName = fileName;

    // Update document title
    if (fileName) {
      document.title = `${fileName} - Notepad 📝`;
    }

    const text = this.normalizeOpenFileContent(content);

    // Determine how to load based on file extension
    const ext = (fileName || '').split('.').pop().toLowerCase();

    if (ext === 'md' || ext === 'markdown') {
      // Convert markdown to HTML
      const htmlContent = this.markdownToHtml(text);
      this.quill.root.innerHTML = htmlContent;
    } else if (ext === 'html') {
      this.quill.root.innerHTML = text;
    } else {
      // Plain text - preserve line breaks
      const lines = text.split('\n');
      const htmlContent = lines
        .map((line) => (line ? `<p>${this.escapeHtml(line)}</p>` : '<p><br></p>'))
        .join('');
      this.quill.root.innerHTML = htmlContent;
    }

    // Show feedback
    this.showOpenFeedback(fileName);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showOpenFeedback(fileName) {
    this.showNotification(`📂 Opened: ${fileName}`, 'success');
  }

  showNotification(message, type = 'info') {
    // Prefer the shared HOSDL notify helper when present; it wires the
    // toast into brand tokens, the .hos-notify component, and reduced-motion
    // preferences automatically.
    if (window.HOS && typeof window.HOS.notify === 'function') {
      window.HOS.notify(message, { tone: type, duration: 2000 });
      return;
    }

    // Fallback (legacy / shell-less). Read brand tokens directly so colors
    // still match the rest of the OS.
    const tones = {
      info: 'var(--accent-primary-bg)',
      success: 'var(--success)',
      error: 'var(--danger)'
    };

    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 60px;
      right: 20px;
      background: ${tones[type] || tones.info};
      color: var(--text-on-accent);
      padding: 12px 20px;
      border-radius: 10px;
      font-family: var(--font-ui);
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;

    // Add animation keyframes if not already added
    if (!document.getElementById('notepad-animations')) {
      const style = document.createElement('style');
      style.id = 'notepad-animations';
      style.textContent = `
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.animation = 'slideIn 0.3s ease reverse';
      setTimeout(() => notification.remove(), 300);
    }, 2000);
  }

  saveToFilesystem() {
    if (!this.currentFilePath) {
      this.showNotification('❌ No file path set. Use File Manager to open a file first.', 'error');
      return;
    }

    // Check if we're inside the OS
    const isInOS = window.self !== window.top;
    if (!isInOS) {
      this.showNotification('❌ Save to filesystem only works inside Heyming OS', 'error');
      return;
    }

    // Get content as plain text
    const content = this.quill.getText();

    // Send save request to parent OS
    window.parent.postMessage(
      {
        type: 'iframe-message',
        message: {
          type: 'saveFile',
          path: this.currentFilePath,
          content: content,
          fileName: this.currentFileName
        }
      },
      '*'
    );

    this.showNotification(`💾 Saved: ${this.currentFileName}`, 'success');
  }

  saveAs() {
    // Check if we're inside the OS
    const isInOS = window.self !== window.top;
    if (!isInOS) {
      this.showNotification('❌ Save As only works inside Heyming OS', 'error');
      return;
    }

    // Get content as plain text
    const content = this.quill.getText();

    // Suggest a filename based on current file or content
    let suggestedName = this.currentFileName || 'untitled.txt';
    if (!this.currentFileName) {
      // Try to derive name from first line of content
      const firstLine = content.split('\n')[0].trim();
      if (firstLine && firstLine.length < 30) {
        suggestedName =
          firstLine
            .replace(/[^a-zA-Z0-9\s-]/g, '')
            .trim()
            .replace(/\s+/g, '-') + '.txt';
      }
    }

    // Send Save As request to parent OS
    window.parent.postMessage(
      {
        type: 'iframe-message',
        message: {
          type: 'saveAs',
          content: content,
          suggestedName: suggestedName
        }
      },
      '*'
    );
  }

  setupAutoSave() {
    // Save content on text change
    this.quill.on('text-change', () => {
      const content = this.quill.getContents();
      localStorage.setItem('notepad-rich-content', JSON.stringify(content));
    });
  }

  loadSavedContent() {
    const savedContent = localStorage.getItem('notepad-rich-content');
    if (savedContent) {
      try {
        const content = JSON.parse(savedContent);
        this.quill.setContents(content);
      } catch (e) {
        debug('Could not load saved content');
      }
    }
    // Live-update when the chat assistant writes notepad-rich-content from
    // another same-origin context (storage events fire in other windows/iframes).
    window.addEventListener('storage', (e) => {
      if (e.key !== 'notepad-rich-content' || e.newValue === null) return;
      try {
        const content = JSON.parse(e.newValue);
        this.quill.setContents(content);
      } catch (_) {
        // ignore malformed deltas
      }
    });
  }

  enhanceToolbarAccessibility() {
    const toolbar = document.querySelector('.ql-toolbar');
    if (!toolbar) return;

    const quillLabels = {
      'ql-bold': 'Bold',
      'ql-italic': 'Italic',
      'ql-underline': 'Underline',
      'ql-strike': 'Strikethrough',
      'ql-blockquote': 'Blockquote',
      'ql-code-block': 'Code block',
      'ql-link': 'Insert link',
      'ql-clean': 'Clear formatting',
      'ql-list': 'List',
      'ql-indent': 'Indent',
      'ql-direction': 'Text direction',
      'ql-script': 'Script',
      'ql-copy-button': 'Copy all content',
      'ql-export-button': 'Export notes',
      'ql-import-button': 'Import notes',
      'ql-save-button': 'Save',
      'ql-save-as-button': 'Save as'
    };

    toolbar.querySelectorAll('button').forEach((btn) => {
      if (btn.getAttribute('aria-label')) return;
      if (btn.classList.contains('ql-list')) {
        btn.setAttribute('aria-label', btn.value === 'ordered' ? 'Numbered list' : 'Bullet list');
        return;
      }
      for (const cls of btn.classList) {
        if (quillLabels[cls]) {
          btn.setAttribute('aria-label', quillLabels[cls]);
          return;
        }
      }
      const title = btn.getAttribute('title');
      if (title) btn.setAttribute('aria-label', title);
    });

    const pickerLabels = {
      'ql-header': 'Heading level',
      'ql-font': 'Font',
      'ql-size': 'Text size',
      'ql-color': 'Text color',
      'ql-background': 'Background color',
      'ql-align': 'Text alignment'
    };

    toolbar.querySelectorAll('.ql-picker-label').forEach((label) => {
      if (label.getAttribute('aria-label')) return;
      const picker = label.closest('.ql-picker');
      if (!picker) return;
      for (const cls of picker.classList) {
        if (pickerLabels[cls]) {
          label.setAttribute('aria-label', pickerLabels[cls]);
          return;
        }
      }
    });
  }

  addCustomButtons() {
    const toolbarContainer = document.querySelector('.ql-toolbar');

    // Copy button
    const copyButton = document.createElement('button');
    copyButton.innerHTML = '📋';
    copyButton.title = 'Copy all content';
    copyButton.setAttribute('aria-label', 'Copy all content');
    copyButton.type = 'button';
    copyButton.className = 'ql-copy-button';
    copyButton.addEventListener('click', () => this.copyContent());
    toolbarContainer.appendChild(copyButton);

    const isInOS = window.self !== window.top;

    if (isInOS) {
      // OS Mode: Show Save and Save As buttons

      // Save button (Ctrl+S) - quick save to current file or Save As if no file
      const saveButton = document.createElement('button');
      saveButton.innerHTML = '💾';
      saveButton.title = 'Save (Ctrl+S)';
      saveButton.setAttribute('aria-label', 'Save');
      saveButton.type = 'button';
      saveButton.className = 'ql-save-button';
      saveButton.addEventListener('click', () => this.quickSave());
      toolbarContainer.appendChild(saveButton);

      // Save As button
      const saveAsButton = document.createElement('button');
      saveAsButton.innerHTML = '📂';
      saveAsButton.title = 'Save As...';
      saveAsButton.setAttribute('aria-label', 'Save as');
      saveAsButton.type = 'button';
      saveAsButton.className = 'ql-save-as-button';
      saveAsButton.addEventListener('click', () => this.saveAs());
      toolbarContainer.appendChild(saveAsButton);
    } else {
      // Standalone Mode: Show export/import buttons

      // Export button
      const exportButton = document.createElement('button');
      exportButton.innerHTML = '💾';
      exportButton.title = 'Export notes to file';
      exportButton.setAttribute('aria-label', 'Export notes');
      exportButton.type = 'button';
      exportButton.className = 'ql-export-button';
      exportButton.addEventListener('click', () => this.exportNotes());
      toolbarContainer.appendChild(exportButton);

      // Import button
      const importButton = document.createElement('button');
      importButton.innerHTML = '📁';
      importButton.title = 'Import notes from file';
      importButton.setAttribute('aria-label', 'Import notes');
      importButton.type = 'button';
      importButton.className = 'ql-import-button';
      importButton.addEventListener('click', () => this.importNotes());
      toolbarContainer.appendChild(importButton);
    }

    // Hidden file input for import
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.md,.markdown,.txt,.html';
    fileInput.style.display = 'none';
    fileInput.setAttribute('aria-label', 'Import notes file');
    fileInput.addEventListener('change', (e) => this.handleFileImport(e));
    document.body.appendChild(fileInput);
    this.fileInput = fileInput;
  }

  async copyContent() {
    try {
      // Get plain text content
      const text = this.quill.getText();

      // Copy to clipboard
      await navigator.clipboard.writeText(text);

      // Show feedback
      this.showCopyFeedback();
    } catch (err) {
      console.error('Failed to copy content: ', err);
      // Fallback for older browsers
      this.fallbackCopy();
    }
  }

  fallbackCopy() {
    // Fallback method for older browsers
    const text = this.quill.getText();
    const textArea = document.createElement('textarea');
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    this.showCopyFeedback();
  }

  showCopyFeedback() {
    // Show temporary feedback
    const copyButton = document.querySelector('.ql-copy-button');
    const originalText = copyButton.innerHTML;
    copyButton.innerHTML = '✅';
    copyButton.style.background = 'var(--success)';

    setTimeout(() => {
      copyButton.innerHTML = originalText;
      copyButton.style.background = '';
    }, 1000);
  }

  async exportNotes() {
    try {
      const htmlContent = this.quill.root.innerHTML;
      const markdownContent = this.htmlToMarkdown(htmlContent);

      // Check if File System Access API is supported
      if ('showSaveFilePicker' in window) {
        // Use modern File System Access API
        const defaultFilename = `notes-${new Date().toISOString().split('T')[0]}.md`;

        const fileHandle = await window.showSaveFilePicker({
          suggestedName: defaultFilename,
          types: [
            {
              description: 'Markdown files',
              accept: { 'text/markdown': ['.md'] }
            }
          ]
        });

        const writable = await fileHandle.createWritable();
        await writable.write(markdownContent);
        await writable.close();

        this.showExportFeedback();
      } else {
        // Fallback for browsers without File System Access API
        const defaultFilename = `notes-${new Date().toISOString().split('T')[0]}.md`;
        const dataBlob = new Blob([markdownContent], { type: 'text/markdown' });

        const link = document.createElement('a');
        link.href = URL.createObjectURL(dataBlob);
        link.download = defaultFilename;
        link.click();

        this.showExportFeedback();
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled the save dialog
        return;
      }
      console.error('Export failed:', err);
      alert('Export failed. Please try again.');
    }
  }

  htmlToMarkdown(html) {
    // Simple HTML to Markdown converter
    let markdown = html;

    // First, normalize whitespace within HTML tags
    markdown = markdown.replace(/>\s+</g, '><');

    // Headers (no extra newlines after)
    markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n');
    markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n');
    markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n');

    // Bold and italic
    markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

    // Underline (markdown doesn't have native underline, use HTML)
    markdown = markdown.replace(/<u[^>]*>(.*?)<\/u>/gi, '<u>$1</u>');

    // Strikethrough
    markdown = markdown.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~');
    markdown = markdown.replace(/<strike[^>]*>(.*?)<\/strike>/gi, '~~$1~~');

    // Links
    markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

    // Code blocks (before inline code)
    markdown = markdown.replace(/<pre[^>]*><code[^>]*>(.*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
    markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

    // Blockquotes
    markdown = markdown.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n');

    // Lists - handle them more carefully
    markdown = markdown.replace(/<ul[^>]*>(.*?)<\/ul>/gi, (match, content) => {
      const items = content.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
      return '\n' + items;
    });

    markdown = markdown.replace(/<ol[^>]*>(.*?)<\/ol>/gi, (match, content) => {
      let counter = 1;
      const items = content.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${counter++}. $1\n`);
      return '\n' + items;
    });

    // Paragraphs - just add single newline
    markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n');

    // Line breaks - convert to single newline
    markdown = markdown.replace(/<br[^>]*\/?>/gi, '\n');

    // Remove remaining HTML tags
    markdown = markdown.replace(/<[^>]*>/g, '');

    // Clean up whitespace more aggressively
    markdown = markdown.replace(/[ \t]+/g, ' '); // Multiple spaces/tabs to single space
    markdown = markdown.replace(/\n[ \t]+/g, '\n'); // Remove leading whitespace on lines
    markdown = markdown.replace(/[ \t]+\n/g, '\n'); // Remove trailing whitespace on lines
    markdown = markdown.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive newlines
    markdown = markdown.trim();

    return markdown;
  }

  importNotes() {
    this.fileInput.click();
  }

  handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let content = e.target.result;

        // Normalize line endings (handle Windows \r\n, Mac \r, Unix \n)
        content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Debug: log the first 200 characters to see what we're working with
        debug('File content preview:', content.substring(0, 200));
        debug('File has newlines:', content.includes('\n'));

        if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
          const htmlContent = this.markdownToHtml(content);
          this.quill.root.innerHTML = htmlContent;
        } else if (file.name.endsWith('.html')) {
          this.quill.root.innerHTML = content;
        } else if (file.name.endsWith('.txt')) {
          // For plain text, preserve line breaks
          const lines = content.split('\n');
          const htmlContent = lines
            .map((line) => (line ? `<p>${line}</p>` : '<p><br></p>'))
            .join('');
          this.quill.root.innerHTML = htmlContent;
        }

        this.showImportFeedback();
      } catch (err) {
        console.error('Import failed:', err);
        alert('Import failed. Please check the file format.');
      }
    };

    reader.readAsText(file);
    event.target.value = ''; // Reset file input
  }

  markdownToHtml(markdown) {
    // Simple Markdown to HTML converter
    debug('Input markdown:', markdown.substring(0, 200));
    debug('Has newlines:', markdown.includes('\n'));
    debug('Number of lines:', markdown.split('\n').length);

    let html = markdown;

    // If the content appears to be all on one line, try to add some structure
    if (!html.includes('\n') && html.length > 100) {
      debug('Detected single line content, trying to split...');
      // This might be a file that lost its line breaks
      // Try to split on common patterns and add line breaks
      html = html.replace(/([.!?])\s+([A-Z])/g, '$1\n\n$2'); // Sentence breaks
      html = html.replace(/([a-z])([A-Z][a-z])/g, '$1\n$2'); // CamelCase breaks
      debug('After splitting:', html.substring(0, 200));
    }

    // Code blocks first (to protect them from other processing)
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold and italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Strikethrough
    html = html.replace(/~~(.*?)~~/g, '<s>$1</s>');

    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // Blockquotes
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Lists - handle them better
    html = html.replace(/^- (.*)$/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>(?:\n<li>.*<\/li>)*)/gim, '<ul>$1</ul>');

    debug('After markdown processing:', html.substring(0, 200));

    // Handle paragraph creation more carefully
    if (html.includes('\n')) {
      // Split into paragraphs by double newlines first
      const doubleParagraphs = html.split(/\n\s*\n/);

      if (doubleParagraphs.length > 1) {
        // We have proper paragraph breaks
        html = doubleParagraphs
          .map((para) => {
            const trimmed = para.trim();
            if (!trimmed) return '';

            // Don't wrap headers, lists, blockquotes, or code blocks in paragraphs
            if (trimmed.match(/^<(h[123]|ul|ol|li|blockquote|pre)/)) {
              return trimmed;
            }

            // Convert single newlines within paragraphs to <br>
            const content = trimmed.replace(/\n/g, '<br>');

            return `<p>${content}</p>`;
          })
          .filter((p) => p)
          .join('\n');
      } else {
        // Only single newlines, treat each line as a paragraph
        const lines = html.split('\n').filter((line) => line.trim());
        html = lines
          .map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return '';

            // Don't wrap headers, lists, blockquotes, or code blocks in paragraphs
            if (trimmed.match(/^<(h[123]|ul|ol|li|blockquote|pre)/)) {
              return trimmed;
            }

            return `<p>${trimmed}</p>`;
          })
          .filter((p) => p)
          .join('');
      }
    } else {
      // No newlines at all, wrap the whole thing in a paragraph
      if (!html.match(/^<(h[123]|ul|ol|li|blockquote|pre)/)) {
        html = `<p>${html}</p>`;
      }
    }

    return html;
  }

  showExportFeedback() {
    const exportButton = document.querySelector('.ql-export-button');
    const originalText = exportButton.innerHTML;
    exportButton.innerHTML = '✅';
    exportButton.style.background = 'var(--success)';

    setTimeout(() => {
      exportButton.innerHTML = originalText;
      exportButton.style.background = '';
    }, 1000);
  }

  showImportFeedback() {
    const importButton = document.querySelector('.ql-import-button');
    const originalText = importButton.innerHTML;
    importButton.innerHTML = '✅';
    importButton.style.background = 'var(--success)';

    setTimeout(() => {
      importButton.innerHTML = originalText;
      importButton.style.background = '';
    }, 1000);
  }

  setupKeyboardShortcuts() {
    const isInOS = window.self !== window.top;

    // Handle Ctrl+S (Windows/Linux) or Cmd+S (Mac)
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); // Prevent browser's default save dialog
        if (isInOS) {
          this.quickSave();
        } else {
          this.exportNotes();
        }
        return false;
      }
    });
  }

  /**
   * Quick save - saves to current file or shows Save As if no file open
   */
  quickSave() {
    if (this.currentFilePath) {
      // Save to current file
      this.saveToFilesystem();
    } else {
      // No file open, show Save As
      this.saveAs();
    }
  }
}

// Initialize the rich notepad when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new RichNotepad();
});
