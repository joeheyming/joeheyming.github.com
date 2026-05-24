const STATUS_TEXT_BASE = 'min-w-0 flex-1 break-words text-right empty:hidden text-xs sm:text-sm';

/** @param {HTMLElement} el */
export function setStatus(el, text, isError = false) {
  const s = typeof text === 'string' ? text.trim() : String(text);
  el.textContent = s;
  el.className = isError ? `${STATUS_TEXT_BASE} text-danger` : `${STATUS_TEXT_BASE} text-text-3`;
}
