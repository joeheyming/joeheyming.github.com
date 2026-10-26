/* Hand-drawn tile faces. Flowers share a pink frame and seasons a blue one,
 * because any flower matches any flower and any season matches any season.
 */

const FONT = "Palatino, 'Songti SC', 'PingFang SC', serif";

/**
 * @param {string} inner
 */
function svg(inner) {
  return `<svg viewBox="0 0 60 78" aria-hidden="true">${inner}</svg>`;
}

/**
 * @param {string} char
 * @param {number} y
 * @param {number} size
 * @param {string} fill
 */
function glyph(char, y, size, fill) {
  return `<text x="30" y="${y}" text-anchor="middle" font-size="${size}" font-family="${FONT}" fill="${fill}">${char}</text>`;
}

const DOTS = {
  1: [[30, 39]],
  2: [
    [18, 24],
    [42, 54]
  ],
  3: [
    [18, 22],
    [30, 39],
    [42, 56]
  ],
  4: [
    [18, 24],
    [42, 24],
    [18, 54],
    [42, 54]
  ],
  5: [
    [18, 22],
    [42, 22],
    [30, 39],
    [18, 56],
    [42, 56]
  ],
  6: [
    [18, 20],
    [42, 20],
    [18, 39],
    [42, 39],
    [18, 58],
    [42, 58]
  ],
  7: [
    [18, 20],
    [42, 20],
    [18, 39],
    [30, 39],
    [42, 39],
    [18, 58],
    [42, 58]
  ],
  8: [
    [18, 20],
    [30, 20],
    [42, 20],
    [18, 39],
    [42, 39],
    [18, 58],
    [30, 58],
    [42, 58]
  ],
  9: [
    [18, 20],
    [30, 20],
    [42, 20],
    [18, 39],
    [30, 39],
    [42, 39],
    [18, 58],
    [30, 58],
    [42, 58]
  ]
};

/**
 * @param {number} rank
 */
function dotsFace(rank) {
  if (rank === 1) {
    return svg(
      `<circle cx="30" cy="39" r="16" fill="none" stroke="#1d4ed8" stroke-width="3"/>
       <circle cx="30" cy="39" r="9" fill="#dc2626"/>`
    );
  }
  const spots = DOTS[rank] || [];
  const circles = spots
    .map(([x, y]) => {
      const center = x === 30 && y === 39;
      const red = center && (rank === 3 || rank === 5 || rank === 7 || rank === 9);
      return `<circle cx="${x}" cy="${y}" r="5.2" fill="${red ? '#dc2626' : '#1d4ed8'}"/>`;
    })
    .join('');
  return svg(circles);
}

const BIRD = svg(
  `<ellipse cx="34" cy="46" rx="11" ry="15" fill="#166534"/>
   <circle cx="24" cy="34" r="8" fill="#15803d"/>
   <circle cx="21" cy="32" r="1.7" fill="#fff"/>
   <path d="M16 34 L7 30 L16 39 Z" fill="#f59e0b"/>
   <path d="M32 40 Q46 26 50 38 Q40 42 34 50 Z" fill="#22c55e"/>
   <path d="M30 58 Q22 70 16 72" fill="none" stroke="#14532d" stroke-width="2"/>`
);

/**
 * @param {number} rank
 */
function bambooFace(rank) {
  if (rank === 1) return BIRD;
  const cols = rank === 2 || rank === 4 ? 2 : 3;
  const rows = Math.ceil(rank / cols);
  const gapX = 16;
  const gapY = 64 / rows;
  const stickH = Math.max(12, Math.min(28, gapY - 6));
  let i = 0;
  let marks = '';
  for (let row = 0; row < rows; row++) {
    const count = Math.min(cols, rank - i);
    const origin = 30 - ((count - 1) * gapX) / 2;
    for (let col = 0; col < count; col++) {
      const red = (count === 3 && col === 1) || (rank === 5 && i === 2);
      const x = origin + col * gapX - 3;
      const y = 10 + row * gapY;
      const color = red ? '#dc2626' : '#15803d';
      marks += `<rect x="${x}" y="${y}" width="6" height="${stickH}" rx="3" fill="${color}"/>`;
      marks += `<rect x="${x}" y="${
        y + stickH / 2 - 1
      }" width="6" height="2" fill="#052e16" opacity="0.35"/>`;
      i += 1;
    }
  }
  return svg(marks);
}

const NUMERALS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * @param {number} rank
 */
function characterFace(rank) {
  const numeral = rank === 1 || rank === 5 || rank === 9 ? '#dc2626' : '#1a1a1a';
  return svg(`${glyph(NUMERALS[rank] || '', 42, 28, numeral)}${glyph('萬', 66, 16, '#dc2626')}`);
}

const WINDS = ['', '東', '南', '西', '北'];
const WIND_COLOR = ['', '#1a1a1a', '#15803d', '#dc2626', '#1d4ed8'];
const DRAGONS = ['', '中', '發', ''];
const DRAGON_COLOR = ['', '#dc2626', '#15803d', '#1d4ed8'];

/**
 * @param {number} rank
 */
function windFace(rank) {
  return svg(glyph(WINDS[rank] || '', 50, 36, WIND_COLOR[rank] || '#1a1a1a'));
}

/**
 * @param {number} rank
 */
function dragonFace(rank) {
  if (rank === 3) {
    return svg(
      `<rect x="16" y="20" width="28" height="40" rx="3" fill="none" stroke="#1d4ed8" stroke-width="3"/>`
    );
  }
  return svg(glyph(DRAGONS[rank] || '', 50, 36, DRAGON_COLOR[rank] || '#1a1a1a'));
}

/**
 * @param {string} color
 * @param {string} label
 * @param {string} picture
 */
function groupFace(color, label, picture) {
  return svg(
    `<rect x="3" y="3" width="54" height="72" rx="5" fill="none" stroke="${color}" stroke-width="3"/>
     ${picture}
     <text x="48" y="14" text-anchor="middle" font-size="9" font-family="${FONT}" fill="${color}">${label}</text>`
  );
}

const FLOWER_ART = [
  '',
  `<circle cx="30" cy="42" r="4" fill="#fbcfe8"/>
   <circle cx="30" cy="32" r="6" fill="#ec4899"/>
   <circle cx="39" cy="38" r="6" fill="#f472b6"/>
   <circle cx="36" cy="48" r="6" fill="#db2777"/>
   <circle cx="24" cy="48" r="6" fill="#f472b6"/>
   <circle cx="21" cy="38" r="6" fill="#ec4899"/>`,
  `<path d="M30 58 Q18 40 22 28" fill="none" stroke="#7c3aed" stroke-width="2"/>
   <ellipse cx="24" cy="30" rx="6" ry="10" fill="#c4b5fd" transform="rotate(-20 24 30)"/>
   <ellipse cx="34" cy="34" rx="5" ry="11" fill="#a78bfa" transform="rotate(15 34 34)"/>
   <ellipse cx="28" cy="46" rx="5" ry="9" fill="#ddd6fe" transform="rotate(-8 28 46)"/>`,
  `<circle cx="30" cy="42" r="5" fill="#fbbf24"/>
   <g fill="#f59e0b">
     <ellipse cx="30" cy="28" rx="4" ry="8"/>
     <ellipse cx="30" cy="56" rx="4" ry="8"/>
     <ellipse cx="16" cy="42" rx="8" ry="4"/>
     <ellipse cx="44" cy="42" rx="8" ry="4"/>
     <ellipse cx="20" cy="32" rx="4" ry="8" transform="rotate(-40 20 32)"/>
     <ellipse cx="40" cy="32" rx="4" ry="8" transform="rotate(40 40 32)"/>
     <ellipse cx="20" cy="52" rx="4" ry="8" transform="rotate(40 20 52)"/>
     <ellipse cx="40" cy="52" rx="4" ry="8" transform="rotate(-40 40 52)"/>
   </g>`,
  `<path d="M30 58 Q30 40 22 30" fill="none" stroke="#166534" stroke-width="2"/>
   <ellipse cx="20" cy="28" rx="6" ry="3" fill="#22c55e" transform="rotate(-30 20 28)"/>
   <ellipse cx="32" cy="34" rx="7" ry="3" fill="#16a34a" transform="rotate(20 32 34)"/>
   <ellipse cx="26" cy="44" rx="6" ry="3" fill="#4ade80" transform="rotate(-10 26 44)"/>`
];

const SEASON_ART = [
  '',
  `<path d="M30 60 L30 34" stroke="#15803d" stroke-width="2"/>
   <ellipse cx="30" cy="30" rx="8" ry="12" fill="#4ade80"/>
   <ellipse cx="22" cy="40" rx="7" ry="4" fill="#22c55e" transform="rotate(-40 22 40)"/>`,
  `<circle cx="30" cy="40" r="10" fill="#fbbf24"/>
   <g stroke="#f59e0b" stroke-width="2">
     <path d="M30 22 V28 M30 52 V58 M14 40 H20 M40 40 H46"/>
     <path d="M18 28 L22 32 M42 28 L38 32 M18 52 L22 48 M42 52 L38 48"/>
   </g>`,
  `<path d="M30 22 C38 34 44 36 42 48 C40 58 34 62 30 62 C26 62 20 58 18 48 C16 36 22 34 30 22 Z" fill="#ea580c"/>
   <path d="M30 28 C34 38 36 42 34 50" fill="none" stroke="#9a3412" stroke-width="1.5"/>`,
  `<g stroke="#1d4ed8" stroke-width="2" fill="none">
     <path d="M30 24 V56 M14 40 H46 M19 29 L41 51 M41 29 L19 51"/>
   </g>
   <circle cx="30" cy="40" r="3" fill="#93c5fd"/>`
];

/**
 * @param {{ suit: string, rank: number, group: string | null }} face
 */
export function faceMarkup(face) {
  switch (face.suit) {
    case 'dots':
      return dotsFace(face.rank);
    case 'bamboo':
      return bambooFace(face.rank);
    case 'characters':
      return characterFace(face.rank);
    case 'wind':
      return windFace(face.rank);
    case 'dragon':
      return dragonFace(face.rank);
    case 'flower':
      return groupFace('#db2777', '花', FLOWER_ART[face.rank] || FLOWER_ART[1]);
    case 'season':
      return groupFace('#1d4ed8', '季', SEASON_ART[face.rank] || SEASON_ART[1]);
    default:
      return svg('');
  }
}

const WIND_NAME = ['', 'East', 'South', 'West', 'North'];
const DRAGON_NAME = ['', 'Red', 'Green', 'White'];
const FLOWER_NAME = ['', 'Plum', 'Orchid', 'Chrysanthemum', 'Bamboo'];
const SEASON_NAME = ['', 'Spring', 'Summer', 'Autumn', 'Winter'];

/**
 * @param {{ suit: string, rank: number, group: string | null }} face
 */
export function faceLabel(face) {
  switch (face.suit) {
    case 'wind':
      return `${WIND_NAME[face.rank] || 'Wind'} wind`;
    case 'dragon':
      return `${DRAGON_NAME[face.rank] || 'Dragon'} dragon`;
    case 'flower':
      return `${FLOWER_NAME[face.rank] || 'Flower'} flower`;
    case 'season':
      return `${SEASON_NAME[face.rank] || 'Season'} season`;
    case 'characters':
      return `Character ${face.rank}`;
    case 'bamboo':
      return `Bamboo ${face.rank}`;
    case 'dots':
      return `Dot ${face.rank}`;
    default:
      return 'Tile';
  }
}
