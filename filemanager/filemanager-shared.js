function debug(...args) {
  if (window.parent?.HeymingOS?.Config?.DEBUG) {
    console.log('[FileManager]', ...args);
  }
}

function escapeHtmlAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

export { debug, escapeHtmlAttr, escapeHtmlText };
