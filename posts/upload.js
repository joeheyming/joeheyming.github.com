/**
 * Rough size of a URL-encoded Form body. Used to refuse submits that
 * would get 413 from Google Forms (no-cors can't surface that status).
 * @param {URLSearchParams} body
 * @returns {number}
 */
export function formBodyByteLength(body) {
  return new TextEncoder().encode(body.toString()).length;
}
