'use strict';

import { bySymbol } from './elements.js';

/**
 * Try to decompose `word` into a sequence of element symbols using backtracking.
 * Prefers two-letter matches to produce fewer, more interesting tiles.
 * Returns an array of element objects, or null if no full decomposition exists.
 */
export function decompose(word) {
  var lower = word.toLowerCase();
  var memo = {};

  function solve(i) {
    if (i === lower.length) return [];
    if (i in memo) return memo[i];

    // Try two-letter symbol first
    if (i + 1 < lower.length) {
      var two = lower.slice(i, i + 2);
      if (bySymbol[two]) {
        var rest2 = solve(i + 2);
        if (rest2 !== null) {
          memo[i] = [bySymbol[two]].concat(rest2);
          return memo[i];
        }
      }
    }

    // Try single-letter symbol
    var one = lower[i];
    if (bySymbol[one]) {
      var rest1 = solve(i + 1);
      if (rest1 !== null) {
        memo[i] = [bySymbol[one]].concat(rest1);
        return memo[i];
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

  while (i < lower.length) {
    if (i + 1 < lower.length) {
      var two = lower.slice(i, i + 2);
      if (bySymbol[two]) {
        result.push(bySymbol[two]);
        i += 2;
        continue;
      }
    }
    var one = lower[i];
    if (bySymbol[one]) {
      result.push(bySymbol[one]);
    } else {
      result.push({ unmatched: lower[i] });
    }
    i++;
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
