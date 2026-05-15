// Stock Ticker — pure formatting helpers and the per-symbol color palette.

export const PALETTE = [
  '#34d399',
  '#60a5fa',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#facc15',
  '#4ade80',
  '#f87171'
];

export function colorForIndex(i) {
  return PALETTE[i % PALETTE.length];
}

export function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] || c
  );
}

export function formatPrice(n, currency) {
  if (!Number.isFinite(n)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: currency ? 'currency' : 'decimal',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(n);
  } catch {
    return n.toFixed(2);
  }
}
