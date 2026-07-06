# Wordle Solver Strategies

This document describes the scoring and elimination strategies used by the wordle-finder,
the tradeoffs involved, and ideas for future improvement. The goal of every strategy is to
**minimize the average number of guesses** needed to find the hidden word.

## Benchmark Summary

| Configuration                   | Avg Guesses | Success (≤6) | Max | Notes                                                                     |
| ------------------------------- | ----------- | ------------ | --- | ------------------------------------------------------------------------- |
| Baseline (before optimizations) | 4.07        | 95.5%        | 10  | Full dictionary as solution space                                         |
| Entropy + solution-space fix    | 3.55        | 100%         | 6   | wordleAnswers as solution space, out-of-set guessing, simulation bugfixes |
| Above + fixed opener "salet"    | 3.40        | 100%         | 5   | Precomputed strong first guess                                            |

Tested against all 2,309 official Wordle answers.

---

## Current Strategies

### 1. Pattern Entropy (primary strategy)

**File:** `filter.js` — `addPatternEntropyScore`, `calculateEntropyFast`

Based on the 3Blue1Brown information-theory approach. For every candidate guess, we
simulate what feedback pattern Wordle would give against _each_ possible remaining solution.
There are 3^5 = 243 possible patterns (each of the 5 positions can be green, yellow, or
gray). We then compute Shannon entropy:

```
H = −Σ p(pattern) × log₂(p(pattern))
```

Higher entropy means the guess, on average, eliminates more of the solution space. A guess
that splits solutions into many equally-sized buckets has high entropy; a guess that puts
most solutions into one bucket has low entropy.

We also track **expected remaining words** after each guess:

```
E[remaining] = Σ p(pattern) × count(pattern)
```

**Why it works:** Entropy is the mathematically optimal single-step measure of information
gain. It directly answers "how much do I learn, on average, by making this guess?"

**Tradeoff:** Entropy is a _greedy, one-step_ metric. It maximizes information for _this_
guess but doesn't consider what happens in subsequent guesses. A slightly lower-entropy
guess might lead to a better game tree overall.

### 2. Popularity / Combined Score

**File:** `filter.js` — `getPopularityScore`, `getCombinedScore`

Pure entropy ignores the fact that some words are more likely to be the answer. The
popularity score uses a **sigmoid function** on word frequency rank (from the Google 10k
word list) to produce a 0–1 score. Known Wordle answers get a +0.3 bonus.

The combined score blends entropy with popularity:

```
combinedScore = entropy × (1 + 0.15 × popularityScore)
```

Common words get up to a **15% boost** to their entropy score.

**Why it works:** Wordle answers tend to be common English words. Guessing a common word
that also has high entropy gives you a chance of being _right_ while still gaining good
information if you're wrong.

**Tradeoff:** The 15% weight is hand-tuned. Too much popularity bias sacrifices information
gain. Too little and you waste guesses on obscure words that are unlikely to be the answer.
A Bayesian approach (see Future Ideas) would handle this more rigorously.

### 3. Letter Frequency Score (legacy strategy)

**File:** `filter.js` — `addLetterStats`, `addMatchStats`, `addFrequencyScore`

For each remaining word, count how often each of its letters appears across all remaining
matches. A word's frequency score is the sum of its letters' occurrence counts.

Example: if 'e' appears in 400 remaining words and 'a' in 350, then "crane" gets points
for containing both.

**Why it works:** It's a fast heuristic that favors words whose letters are common in the
remaining pool, making them good for elimination. It was the original scoring method before
entropy was added.

**Tradeoff:** It doesn't consider _positions_ or _combinations_. Two words with the same
letters score identically even if one produces far more informative feedback patterns. It
also doesn't account for repeated letters. Entropy strictly dominates this strategy for
accuracy, but frequency scoring is cheaper to compute and serves as a fallback/tiebreaker
and a pre-filter for entropy (the top-300 pool is selected by frequency score when there
are too many candidates to score for entropy).

### 4. Bigram (Letter-Pair) Statistics

**File:** `filter.js` — `addBiLetterStats`, `addBiMaxStats`

Counts adjacent letter pairs (bigrams) across remaining words. Currently used only for the
"Letter Counts" display tab; the commented-out code in `addMatchStats` suggests it was
once considered as a scoring factor.

**Why it exists:** Bigram frequency captures positional structure that single-letter
frequency misses. "TH" at the start of a word is much more common than "HT".

**Tradeoff:** Not currently used for scoring. Could add value as a tiebreaker or in a more
sophisticated frequency model, but entropy already captures positional information more
precisely.

### 5. Narrowed Solution Space

**File:** `filter.js` — `addPatternEntropyScore` (solution-space filtering)

Instead of computing entropy against the full ~14,855 dictionary matches, we compute it
against `matched ∩ wordleAnswers` — only the words that are actually possible Wordle
answers. The answer is always drawn from the official 2,309-word answer list, so
non-answer words are noise in the entropy calculation.

**Why it works:** Computing entropy against the true solution space gives more accurate
information measures. A guess might split the full dictionary well but poorly distinguish
between actual answers.

**Tradeoff:** This assumes we know the answer list. For a variant where the answer could be
any valid word, we'd need to use the full dictionary. In practice, every Wordle answer comes
from the known set.

### 6. Out-of-Set Guessing (removed from the helper UI)

**File:** `filter.js` — `addPatternEntropyScore`

Historically, when the solution pool was small, the solver scored **all 2,309
wordleAnswers** as potential guesses — not just the remaining matches — to surface
"discriminator" guesses: words that aren't possible answers but whose feedback pattern
uniquely identifies the correct answer.

Classic example: if the remaining words are `light, might, night, sight, tight`, guessing
one of those only eliminates one word at a time (the other four produce identical feedback).
An out-of-set word that tests the distinguishing first letters — like `psalm` (tests p, s)
or `month` (tests m, n, t) — can narrow it down much faster.

**Why it was removed from the helper:** In the "Help me solve wordle" flow, users type
in their green/yellow/gray constraints and reasonably expect the Best Guess tab to only
suggest words consistent with those constraints. Surfacing an out-of-set discriminator
(e.g. suggesting `alter` when the user has locked position 1 to Q) was confusing enough
that it read as a bug. The scorer now always draws candidates from the filtered `matched`
set, matching hard-mode behavior.

The auto-play / benchmark code paths still exist and can be extended later if we want to
expose an "advanced / discriminator" mode; for now, all UI strategies score matched only.

### 7. Constraint Tracking

**File:** `filter.js` — `filterDictionary`; `playWords.js` / `benchmark.js` — `simulateGame`

After each guess, Wordle feedback is decomposed into three constraint types:

- **Green (spots):** Letter is correct at this exact position
- **Yellow (notSpots):** Letter is in the word but not at this position
- **Gray (excluded):** Letter is not in the word at all — _unless_ it appears in a
  green/yellow position, in which case a position-specific notSpot is recorded instead
  (indicating no _additional_ instances of this letter)

`filterDictionary` applies all accumulated constraints to the full word list, producing the
set of remaining matches.

**Key bugfix (April 2025):** The simulation previously skipped feedback processing for
positions where a _previous_ guess had found a green. This meant constraints from letters
guessed at those positions were silently lost, causing infinite loops. The fix: only skip
positions that are green in the _current_ guess.

---

## Performance Caps and Heuristics

### The 300-Word Scoring Cap

When more than 300 words remain, only the top 300 by frequency score are evaluated for
entropy. This is a **performance concession**: scoring 300 words against thousands of
solutions is O(300 × N), which completes in milliseconds. Scoring all candidates would be
O(N²), which freezes the browser on the first guess (14,855² ≈ 220M operations).

**Impact:** The first guess is suboptimal because the true best guess might not be in the
top 300 by frequency. Using a precomputed starting word like "salet" bypasses this
limitation.

### Sorting and Tiebreakers

When two guesses have the same combined score:

1. **Prefer valid solutions** — a word that could be the answer is better than one that
   can't, all else equal
2. **Prefer fewer expected remaining words** — more aggressive elimination wins ties

---

## Future Improvement Ideas

### Near-Term (incremental, could measure with the existing benchmark)

**Precomputed opening sequence.** Compute the optimal first 1–2 guesses offline. "salet"
reduces the average from 3.55 to 3.40 — a 4% improvement for zero runtime cost. A
precomputed second guess (conditioned on the first guess's pattern) would save even more.

**Expand the scoring pool.** Increase `maxWordsToScore` from 300 to, say, 1000 when
`wordleAnswers` is available (score all 2,309 answers as candidates from the start). This
would make the first auto-selected guess near-optimal at the cost of ~3× slower initial
computation.

**Raise the out-of-set threshold.** Currently, full-vocabulary guessing activates at ≤20
solutions. Raising this to 50 or 100 would improve mid-game play. The computational cost
scales linearly: 2309 × 100 = ~230k operations, still fast.

**Adaptive popularity weight.** The 0.15 popularity weight is constant. Early in the game,
pure entropy should dominate (we haven't narrowed the field yet). Late in the game, when
only a few solutions remain and you might guess right, prefer likely answers more heavily.

**Letter-position frequency.** Instead of overall letter frequency for the pre-filter,
weight by position. 'S' at position 0 is far more common than 'S' at position 3 in
5-letter English words. This would produce a better top-300 pre-filter.

### Medium-Term (new strategies)

**Minimax (worst-case optimization).** Instead of maximizing _expected_ information
(entropy), minimize the _worst-case_ partition size. This guarantees the solver never takes
more than N guesses. Entropy is optimal on average but can have bad worst cases; minimax
sacrifices average performance for a hard upper bound.

Formula: instead of `−Σ p log p`, minimize `max(partition sizes)`.

**Multi-step lookahead (tree search).** Entropy is greedy — it optimizes one step at a
time. A 2-step lookahead would, for each candidate guess, simulate every possible feedback
pattern, then for each resulting reduced solution set, find the best second guess and
compute the combined information. This is like a chess engine thinking two moves ahead.

Complexity: O(candidates × 243 × candidates × solutions) per evaluated guess. Feasible
with pruning for small solution sets, very expensive otherwise.

**Expected game length minimization.** Instead of maximizing information per guess, directly
minimize the expected total number of guesses to solve. This is the "true" objective. It
can be computed exactly via dynamic programming on the game tree (see decision tree below)
but is exponentially expensive. Approximate versions using sampling or beam search could
work.

### Longer-Term (architectural changes)

**Full precomputed decision tree.** Build the entire game tree offline: for every possible
game state (remaining solution set), precompute the optimal guess. At runtime, just look
up the answer. This gives provably optimal play.

- The best known Wordle decision trees average ~3.42 guesses and solve every word in ≤5.
- Storage: a few MB of lookup data (the tree is sparse).
- Downside: loses the "live computation" aspect that makes the tool educational. Could be
  offered as an optional "perfect play" mode.

**Bayesian word probability.** Instead of treating all remaining solutions as equally
likely, weight them by real-world frequency. A word like "crane" is far more likely to be
today's answer than "whelk." Bayesian scoring replaces Shannon entropy with
KL-divergence or expected posterior entropy, integrating the prior probability of each
word.

This is different from the current popularity bonus: the current approach boosts the
_guess_ score of common words, while Bayesian scoring changes the _probability weights_
inside the entropy calculation itself. The Bayesian approach is more principled.

**Partition quality beyond entropy.** Entropy measures the _average_ information. But two
guesses with identical entropy can have very different partition structures. Consider:

- Guess A: splits 100 words into 50 groups of 2 (entropy = 5.64 bits)
- Guess B: splits 100 words into 1 group of 51 and 49 groups of 1 (entropy ≈ 5.36 bits)

Entropy prefers A, but B actually _solves_ 49 words immediately (the singleton groups).
Metrics like **expected solve probability** or **partition variance** could complement
entropy.

**Hard Mode support.** Wordle's hard mode requires every guess to use all known green and
yellow letters. The helper already restricts candidates to `matched` for every strategy,
so it is effectively hard-mode compatible today. A future toggle could re-enable
out-of-set discriminators as an "advanced / discriminator" mode — likely shifting toward
minimax to avoid worst-case traps.

**WebAssembly / Web Workers.** Move the entropy computation to WASM or a background
worker. This would allow scoring all 2,309+ candidates without blocking the UI, removing
the need for the 300-word cap entirely.

---

## Strategy Comparison

| Strategy               | Strengths                               | Weaknesses                             |
| ---------------------- | --------------------------------------- | -------------------------------------- |
| Pattern Entropy        | Mathematically optimal single-step      | Greedy; ignores future moves; O(N²)    |
| Frequency Score        | Fast; good pre-filter                   | Ignores position and pattern structure |
| Popularity Boost       | Matches real Wordle answer distribution | Hand-tuned weight; not Bayesian        |
| Out-of-Set Guessing    | Breaks through similar-word clusters    | Only active for small solution sets    |
| Minimax (future)       | Guarantees worst-case bound             | Sacrifices average-case performance    |
| Lookahead (future)     | Considers multi-step consequences       | Exponentially expensive                |
| Decision Tree (future) | Provably optimal                        | Requires offline precomputation        |

---

## Files

| File               | Role                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `filter.js`        | Entropy computation, pattern matching, constraint filtering, all scoring |
| `playWords.js`     | Interactive play UI, auto-play, benchmark simulation                     |
| `scorer.js`        | Renders score tabs in the helper UI                                      |
| `wordFrequency.js` | Word frequency ranks, official Wordle answer list                        |
| `words.js`         | Full ~14,855 word dictionary                                             |
| `benchmark.js`     | Node.js CLI benchmark harness (not used by the browser app)              |
| `index.js`         | App initialization, mode switching                                       |
