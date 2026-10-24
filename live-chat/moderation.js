/**
 * Live-chat moderation shared by the client and Apps Script.
 * Apps Script (`apps-script.local.gs`) mirrors these rules — keep them in sync.
 *
 * Guidelines, from the live Messages / Quarantine tabs:
 * - Reject slurs. Fold leet, extra letters, and spaced-out letters first.
 *   `Nigeria` and `peacock` stay allowed. The bare word `niger` does not.
 * - Mask ordinary swears so the message still posts.
 * - Reject suicide bait (`kys`), "kill yourself", "feeding tube", and `scalp`.
 * - Reject sexual solicitation and genital nicknames (`goon`, `dildo`, `cock`
 *   outside peacock/cocktail/cockatoo/cockatiel).
 * - Reject spam: no letters or digits, a 14-character run of a non-space
 *   character, or a message that is 90% one character. Letters are any
 *   script, so an Arabic note is not spam. Space padding is not a run.
 *   Messages over 130 characters are rejected separately as too long — that
 *   was the copypasta and thesaurus-threat band in chat. Posts are longer
 *   on purpose (quotes, requests, shared loops) and do not use that cap.
 */

const LEET = {
  0: 'o',
  1: 'i',
  3: 'e',
  4: 'a',
  5: 's',
  7: 't',
  9: 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '|': 'i'
};

const LEET_CLASSES = {
  a: '[a4@]',
  b: '[b8]',
  c: '[ck]',
  e: '[e3]',
  g: '[g9]',
  i: '[i1!|]',
  o: '[o0]',
  s: '[s5$]',
  t: '[t7]',
  u: '[uv]'
};

const MASK_ROOTS = [
  'asshole',
  'retard',
  'bitch',
  'whore',
  'slut',
  'cunt',
  'fuck',
  'fuvk',
  'shit',
  'amk'
];
const MASK_SUFFIXES = new Set(['', 's', 'es', 'ed', 'ing', 'in', 'er', 'ers', 'y', 'ies']);
const MASK_SUFFIX_RE = '(?:s|es|ed|ing|in|er|ers|y|ies)?';

/** @type {RegExp[]|null} */
let maskPatterns = null;

/**
 * @param {string} raw
 * @returns {string}
 */
function foldLetters(raw) {
  // Trailing digits are nick suffixes (`nigger123`), not leet. A `1` or `3`
  // in the middle still maps (`n1gg3r`, `nig0er`).
  const lower = String(raw || '')
    .toLowerCase()
    .replace(/\d+$/g, '');
  let out = '';
  for (let i = 0; i < lower.length; i++) {
    const ch = lower.charAt(i);
    const mapped = LEET[ch];
    if (mapped) out += mapped;
    else if (ch >= 'a' && ch <= 'z') out += ch;
  }
  return out;
}

/**
 * Collapse runs of 3+ so `goooooooon` matches `goon` and `niggger` matches `nigger`.
 * @param {string} folded
 */
function collapseRuns(folded) {
  return folded.replace(/([a-z])\1{2,}/g, '$1$1');
}

/**
 * @param {string} raw
 */
function foldMatch(raw) {
  return collapseRuns(foldLetters(raw));
}

/**
 * @param {string} text
 * @returns {string}
 */
function joinSingleLetterRuns(text) {
  const tokens = String(text || '').split(/(\s+)/);
  const isLetter = (token) => /^[A-Za-z]$/.test(token);
  const isSpace = (token) => /^\s+$/.test(token);
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isLetter(tokens[i])) {
      out.push(tokens[i]);
      i += 1;
      continue;
    }
    let j = i;
    let letters = '';
    while (j < tokens.length && isLetter(tokens[j])) {
      letters += tokens[j];
      const next = j + 1;
      if (next + 1 < tokens.length && isSpace(tokens[next]) && isLetter(tokens[next + 1])) {
        j = next + 1;
      } else {
        j += 1;
        break;
      }
    }
    if (letters.length >= 3) {
      out.push(letters);
      i = j;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out.join('');
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function matchForms(text) {
  const raw = String(text || '');
  /** @type {string[]} */
  const forms = [foldMatch(raw)];
  for (const token of raw.split(/\s+/)) {
    if (token) forms.push(foldMatch(token));
  }
  const joined = joinSingleLetterRuns(raw);
  if (joined !== raw) forms.push(foldMatch(joined));
  return forms;
}

/**
 * @param {string} folded
 */
function isSlurFolded(folded) {
  if (!folded) return false;
  if (/n+i+g{2,}(?:er|ers|a|ah|as|s|z)?(?![a-z])/.test(folded)) return true;
  if (/(?:^|[^a-z])nig+o*er(?![a-z])/.test(folded)) return true;
  if (/ng{2,}(?:er|ers|a|ah|as)/.test(folded)) return true;
  if (/f+a+g{2,}/.test(folded)) return true;
  if (folded === 'fag' || folded === 'fags') return true;
  if (/(?:^|[^a-z])honk(?:y|ey|ies)(?![a-z])/.test(folded)) return true;
  return false;
}

/**
 * @param {string} text
 */
function isSlurText(text) {
  if (/n\*{4,}/i.test(text)) return true;
  return matchForms(text).some(isSlurFolded);
}

/**
 * @param {string} folded
 */
function hasCock(folded) {
  const stripped = folded.replace(/peacocks?|cocktails?|cockatoos?|cockatiels?/g, '');
  return stripped.includes('cock');
}

/**
 * @param {string} folded
 */
function isSexualFolded(folded) {
  if (!folded) return false;
  if (hasCock(folded)) return true;
  if (/pussy|dildos?|penis|cocksuck|jelq|cumshots?/.test(folded)) return true;
  if (/(?:^|[^a-z])dicks?(?![a-z])/.test(folded)) return true;
  if (/(?:^|[^a-z])goon(?:er|ing|in|s)?(?![a-z])/.test(folded)) return true;
  if (/raper/.test(folded)) return true;
  if (/bumbum/.test(folded)) return true;
  if (/(?:^|[^a-z])dih(?![a-z])/.test(folded)) return true;
  return false;
}

/**
 * Tokens and spaced-letter runs only. The whole string folded together turns "go on" into "goon".
 * @param {string} text
 */
function isSexualText(text) {
  const raw = String(text || '');
  if (/\bf+u*c*k+\w*\s+(?:ur|your|yo)\s+(?:moms?|mums?|mother)\b/i.test(raw)) return true;
  /** @type {string[]} */
  const forms = [];
  for (const token of raw.split(/\s+/)) {
    if (token) forms.push(foldMatch(token));
  }
  const joined = joinSingleLetterRuns(raw);
  if (joined !== raw) forms.push(foldMatch(joined));
  return forms.some(isSexualFolded);
}

/**
 * @param {string} text
 */
function isThreatText(text) {
  const raw = String(text || '').toLowerCase();
  const joined = joinSingleLetterRuns(raw).toLowerCase();
  const hay = `${raw}\n${joined}`;
  if (/(?:^|[^a-z])kys(?![a-z])/.test(hay) || /(?:^|[^a-z])kms(?![a-z])/.test(hay)) return true;
  if (/kill\s+(?:yo)?ur\s*self/.test(raw)) return true;
  if (/feeding\s+tube/.test(raw)) return true;
  if (/(?:^|[^a-z])scalp(?:ing|ed|s)?(?![a-z])/.test(raw)) return true;
  return false;
}

/**
 * @param {string} text
 */
function isSpamMessage(text) {
  const raw = String(text || '');
  if (/(\S)\1{13,}/iu.test(raw)) return true;
  const compact = raw.replace(/\s+/g, '');
  if (compact.length >= 10) {
    /** @type {Record<string, number>} */
    const counts = {};
    const lower = compact.toLowerCase();
    let max = 0;
    for (let i = 0; i < lower.length; i++) {
      const ch = lower.charAt(i);
      counts[ch] = (counts[ch] || 0) + 1;
      if (counts[ch] > max) max = counts[ch];
    }
    if (max / compact.length >= 0.9) return true;
  }
  if (!/[\p{L}\p{N}]/u.test(raw)) return true;
  return false;
}

/**
 * @param {string} text
 * @param {'nick'|'message'} kind
 * @returns {'slur'|'sexual'|'threat'|'spam'|null}
 */
export function classifyChatText(text, kind) {
  const raw = String(text || '');
  if (isSlurText(raw)) return 'slur';
  if (isThreatText(raw)) return 'threat';
  if (isSexualText(raw)) return 'sexual';
  if (kind === 'message' && isSpamMessage(raw)) return 'spam';
  return null;
}

/**
 * @param {string} word
 */
function maskWord(word) {
  let stars = '';
  for (let i = 1; i < word.length; i++) stars += '*';
  return word.charAt(0) + stars;
}

/**
 * @param {string} root
 */
function leetPattern(root) {
  let out = '';
  for (let i = 0; i < root.length; i++) {
    const ch = root.charAt(i);
    out += LEET_CLASSES[ch] || ch;
  }
  return out;
}

function getMaskPatterns() {
  if (maskPatterns) return maskPatterns;
  maskPatterns = MASK_ROOTS.map(
    (root) => new RegExp(`\\b(${leetPattern(root)})${MASK_SUFFIX_RE}\\b`, 'gi')
  );
  return maskPatterns;
}

/**
 * @param {string} folded
 * @returns {{ root: string, suffix: string }|null}
 */
function maskRootHit(folded) {
  for (const root of MASK_ROOTS) {
    if (!folded.startsWith(root)) continue;
    const suffix = folded.slice(root.length);
    if (MASK_SUFFIXES.has(suffix)) return { root, suffix };
  }
  return null;
}

/**
 * @param {string} letters
 * @returns {string|null}
 */
function maskLetters(letters) {
  const folded = foldLetters(letters);
  const hit = maskRootHit(folded);
  if (hit) return maskWord(letters.slice(0, hit.root.length)) + letters.slice(hit.root.length);
  const at = folded.indexOf('asshole');
  if (at < 0) return null;
  const root = 'asshole';
  return (
    letters.slice(0, at) +
    maskWord(letters.slice(at, at + root.length)) +
    letters.slice(at + root.length)
  );
}

/**
 * @param {string} text
 */
function maskSpacedLetterRuns(text) {
  const tokens = String(text || '').split(/(\s+)/);
  const isLetter = (token) => /^[A-Za-z]$/.test(token);
  const isSpace = (token) => /^\s+$/.test(token);
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < tokens.length) {
    if (!isLetter(tokens[i])) {
      out.push(tokens[i]);
      i += 1;
      continue;
    }
    let j = i;
    let letters = '';
    while (j < tokens.length && isLetter(tokens[j])) {
      letters += tokens[j];
      const next = j + 1;
      if (next + 1 < tokens.length && isSpace(tokens[next]) && isLetter(tokens[next + 1])) {
        j = next + 1;
      } else {
        j += 1;
        break;
      }
    }
    const masked = letters.length >= 3 ? maskLetters(letters) : null;
    if (masked) {
      out.push(masked);
      i = j;
    } else {
      out.push(tokens[i]);
      i += 1;
    }
  }
  return out.join('');
}

/**
 * @param {string} text
 */
function maskObfuscatedTokens(text) {
  return String(text || '')
    .split(/(\s+)/)
    .map((token) => {
      if (!token || /^\s+$/.test(token) || token.includes('*')) return token;
      const letters = token.replace(/[^A-Za-z]/g, '');
      if (!letters) return token;
      const masked = maskLetters(letters);
      return masked || token;
    })
    .join('');
}

/**
 * Mask ordinary swears. Slurs are rejected by `classifyChatText` and are not masked.
 * @param {string} raw
 * @returns {string}
 */
export function maskProfanity(raw) {
  let text = String(raw || '');
  for (const re of getMaskPatterns()) {
    re.lastIndex = 0;
    text = text.replace(re, (match, root) => maskWord(root) + match.slice(root.length));
  }
  text = maskSpacedLetterRuns(text);
  text = maskObfuscatedTokens(text);
  return text;
}
