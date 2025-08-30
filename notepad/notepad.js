// Rich Text Notepad Application with Quill
class RichNotepad {
  constructor() {
    this.quill = null;
    this.init();
  }

  init() {
    // Initialize Quill editor
    this.quill = new Quill('#editor', {
      theme: 'snow',
      placeholder: 'Start typing your notes here...',
      modules: {
        toolbar: {
          container: [
            [{ header: [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ color: [] }, { background: [] }],
            [{ list: 'ordered' }, { list: 'bullet' }],
            [{ align: [] }],
            ['blockquote', 'code-block'],
            ['link'],
            ['clean'],
            ['copy-button', 'export-button', 'import-button']
          ],
          handlers: {
            'copy-button': this.copyContent.bind(this)
          }
        }
      }
    });

    // Add custom buttons to toolbar
    this.addCustomButtons();

    // Auto-focus the editor
    this.quill.focus();

    // Setup auto-save
    this.setupAutoSave();

    // Load saved content
    this.loadSavedContent();

    // Setup keyboard shortcuts
    this.setupKeyboardShortcuts();
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
        console.log('Could not load saved content');
      }
    }
  }

  addCustomButtons() {
    const toolbarContainer = document.querySelector('.ql-toolbar');

    // Copy button
    const copyButton = document.createElement('button');
    copyButton.innerHTML = '📋';
    copyButton.title = 'Copy all content';
    copyButton.type = 'button';
    copyButton.className = 'ql-copy-button';
    copyButton.addEventListener('click', () => this.copyContent());
    toolbarContainer.appendChild(copyButton);

    // Export button
    const exportButton = document.createElement('button');
    exportButton.innerHTML = '💾';
    exportButton.title = 'Export notes to file';
    exportButton.type = 'button';
    exportButton.className = 'ql-export-button';
    exportButton.addEventListener('click', () => this.exportNotes());
    toolbarContainer.appendChild(exportButton);

    // Import button
    const importButton = document.createElement('button');
    importButton.innerHTML = '📁';
    importButton.title = 'Import notes from file';
    importButton.type = 'button';
    importButton.className = 'ql-import-button';
    importButton.addEventListener('click', () => this.importNotes());
    toolbarContainer.appendChild(importButton);

    // Hidden file input for import
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.md,.markdown,.txt,.html';
    fileInput.style.display = 'none';
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
    copyButton.style.background = '#10b981';

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
        console.log('File content preview:', content.substring(0, 200));
        console.log('File has newlines:', content.includes('\n'));

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
    console.log('Input markdown:', markdown.substring(0, 200));
    console.log('Has newlines:', markdown.includes('\n'));
    console.log('Number of lines:', markdown.split('\n').length);

    let html = markdown;

    // If the content appears to be all on one line, try to add some structure
    if (!html.includes('\n') && html.length > 100) {
      console.log('Detected single line content, trying to split...');
      // This might be a file that lost its line breaks
      // Try to split on common patterns and add line breaks
      html = html.replace(/([.!?])\s+([A-Z])/g, '$1\n\n$2'); // Sentence breaks
      html = html.replace(/([a-z])([A-Z][a-z])/g, '$1\n$2'); // CamelCase breaks
      console.log('After splitting:', html.substring(0, 200));
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

    console.log('After markdown processing:', html.substring(0, 200));

    // Handle paragraph creation more carefully
    if (html.includes('\n')) {
      // Split into paragraphs by double newlines first
      const doubleParagraphs = html.split(/\n\s*\n/);

      if (doubleParagraphs.length > 1) {
        // We have proper paragraph breaks
        html = doubleParagraphs
          .map((para) => {
            para = para.trim();
            if (!para) return '';

            // Don't wrap headers, lists, blockquotes, or code blocks in paragraphs
            if (para.match(/^<(h[123]|ul|ol|li|blockquote|pre)/)) {
              return para;
            }

            // Convert single newlines within paragraphs to <br>
            para = para.replace(/\n/g, '<br>');

            return `<p>${para}</p>`;
          })
          .filter((p) => p)
          .join('\n');
      } else {
        // Only single newlines, treat each line as a paragraph
        const lines = html.split('\n').filter((line) => line.trim());
        html = lines
          .map((line) => {
            line = line.trim();
            if (!line) return '';

            // Don't wrap headers, lists, blockquotes, or code blocks in paragraphs
            if (line.match(/^<(h[123]|ul|ol|li|blockquote|pre)/)) {
              return line;
            }

            return `<p>${line}</p>`;
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

  setupSaveShortcut() {
    // Override Ctrl+S (or Cmd+S on Mac) to export notes
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); // Prevent browser's save dialog
        this.exportNotes(); // Call our export function instead
      }
    });
  }

  showExportFeedback() {
    const exportButton = document.querySelector('.ql-export-button');
    const originalText = exportButton.innerHTML;
    exportButton.innerHTML = '✅';
    exportButton.style.background = '#10b981';

    setTimeout(() => {
      exportButton.innerHTML = originalText;
      exportButton.style.background = '';
    }, 1000);
  }

  showImportFeedback() {
    const importButton = document.querySelector('.ql-import-button');
    const originalText = importButton.innerHTML;
    importButton.innerHTML = '✅';
    importButton.style.background = '#10b981';

    setTimeout(() => {
      importButton.innerHTML = originalText;
      importButton.style.background = '';
    }, 1000);
  }

  setupKeyboardShortcuts() {
    // Handle Ctrl+S (Windows/Linux) or Cmd+S (Mac) to export notes
    document.addEventListener('keydown', (e) => {
      // Check for Ctrl+S (Windows/Linux) or Cmd+S (Mac)
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault(); // Prevent browser's default save dialog
        this.exportNotes();
        return false;
      }
    });
  }
}

// Initialize the rich notepad when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new RichNotepad();
});
