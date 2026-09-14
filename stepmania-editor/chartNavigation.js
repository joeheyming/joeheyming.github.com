const DIFFICULTY_ORDER = ['Beginner', 'Easy', 'Medium', 'Hard', 'Challenge', 'Edit'];

/**
 * Match ScreenEdit's F5/F6 chart navigation: only charts of the current
 * StepsType participate, ordered by difficulty, and the ends do not wrap.
 *
 * @param {Array<{type?: string, difficulty?: string, rating?: number}>} charts
 * @param {number} currentIndex
 * @param {-1|1} direction
 * @returns {number}
 */
export function adjacentChartIndex(charts, currentIndex, direction) {
  const current = charts[currentIndex];
  if (!current) return currentIndex;

  const candidates = charts
    .map((chart, index) => ({ chart, index }))
    .filter(({ chart }) => chart.type === current.type)
    .sort((a, b) => {
      const difficulty = difficultyRank(a.chart.difficulty) - difficultyRank(b.chart.difficulty);
      if (difficulty !== 0) return difficulty;
      const meter = Number(a.chart.rating || 0) - Number(b.chart.rating || 0);
      return meter || a.index - b.index;
    });

  const position = candidates.findIndex(({ index }) => index === currentIndex);
  const target = candidates[position + direction];
  return target ? target.index : currentIndex;
}

function difficultyRank(difficulty) {
  const rank = DIFFICULTY_ORDER.indexOf(difficulty);
  return rank < 0 ? DIFFICULTY_ORDER.length : rank;
}
