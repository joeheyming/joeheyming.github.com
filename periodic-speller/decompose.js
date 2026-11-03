'use strict';

import { bySymbol } from './elements.js';

function longestSymbolLength() {
  var max = 1;
  for (var key in bySymbol) {
    if (Object.prototype.hasOwnProperty.call(bySymbol, key) && key.length > max) {
      max = key.length;
    }
  }
  return max;
}

/**
 * Try to decompose `word` into a sequence of element symbols using backtracking.
 * Prefers the longest symbol at each step (two-letter elements, or a longer
 * custom chord such as Rt) so the result uses fewer tiles.
 * Returns an array of element objects, or null if no full decomposition exists.
 */
export function decompose(word) {
  var lower = word.toLowerCase();
  var memo = {};
  var maxLen = longestSymbolLength();

  function solve(i) {
    if (i === lower.length) return [];
    if (i in memo) return memo[i];

    var limit = Math.min(maxLen, lower.length - i);
    for (var len = limit; len >= 1; len--) {
      var slice = lower.slice(i, i + len);
      if (bySymbol[slice]) {
        var rest = solve(i + len);
        if (rest !== null) {
          memo[i] = [bySymbol[slice]].concat(rest);
          return memo[i];
        }
      }
    }

    memo[i] = null;
    return null;
  }

  return solve(0);
}

/**
 * Best-effort breakdown: greedily match what we can, mark unmatched letters.
 * Returns an array of objects: either element objects or { unmatched: 'x' }.
 */
export function bestEffort(word) {
  var lower = word.toLowerCase();
  var result = [];
  var i = 0;
  var maxLen = longestSymbolLength();

  while (i < lower.length) {
    var matched = false;
    var limit = Math.min(maxLen, lower.length - i);
    for (var len = limit; len >= 1; len--) {
      var slice = lower.slice(i, i + len);
      if (bySymbol[slice]) {
        result.push(bySymbol[slice]);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      result.push({ unmatched: lower[i] });
      i++;
    }
  }

  return result;
}

/**
 * Decompose a single word, returning an array of element/unmatched items.
 * Uses full backtracking first; falls back to best-effort greedy.
 */
export function decomposeWord(word) {
  var cleaned = word.replace(/[^a-zA-Z]/g, '');
  if (!cleaned) return [];
  var result = decompose(cleaned);
  if (result) return result;
  return bestEffort(cleaned);
}

/**
 * Parse input into an array of words, each word is an array of element/unmatched items.
 * Spaces and newlines are treated as word separators.
 */
export function parseInput(text) {
  var words = text.split(/\s+/).filter(function (w) {
    return w.length > 0;
  });
  return words
    .map(function (w) {
      return decomposeWord(w);
    })
    .filter(function (items) {
      return items.length > 0;
    });
}
