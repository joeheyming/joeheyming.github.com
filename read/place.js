/**
 * First block whose top sits on the current page. Falls back to the
 * last block that starts at or above the page when the page is past
 * the final paragraph.
 * @param {number[]} tops
 * @param {number} scrollTop
 * @param {number} viewHeight
 */
export function blockIndexOnPage(tops, scrollTop, viewHeight) {
  if (!tops.length) return -1;
  const bottom = scrollTop + Math.max(0, viewHeight);
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] >= scrollTop - 1 && tops[i] < bottom - 8) return i;
  }
  let last = 0;
  for (let i = 0; i < tops.length; i += 1) {
    if (tops[i] <= scrollTop + 1) last = i;
  }
  return last;
}
