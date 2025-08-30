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
            ['copy-button']
          ],
          handlers: {
            'copy-button': this.copyContent.bind(this)
          }
        }
      }
    });

    // Add custom copy button to toolbar
    this.addCopyButton();

    // Auto-focus the editor
    this.quill.focus();

    // Setup auto-save
    this.setupAutoSave();

    // Load saved content
    this.loadSavedContent();
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

  addCopyButton() {
    // Add custom copy button to the toolbar
    const toolbar = this.quill.getModule('toolbar');
    const copyButton = document.createElement('button');
    copyButton.innerHTML = '📋';
    copyButton.title = 'Copy all content';
    copyButton.type = 'button';
    copyButton.className = 'ql-copy-button';

    copyButton.addEventListener('click', () => {
      this.copyContent();
    });

    // Add button to toolbar
    const toolbarContainer = document.querySelector('.ql-toolbar');
    toolbarContainer.appendChild(copyButton);
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
}

// Initialize the rich notepad when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new RichNotepad();
});
