// cal — print a month or year calendar (BSD-style)
//
// Usage:
//   cal                   current month, with today highlighted
//   cal MONTH YEAR        specific month
//   cal YEAR              full 12-month grid for that year
//   cal -y / --year       full 12-month grid for current year
//   cal -3                previous / current / next month side-by-side
//   cal -m / --monday     start the week on Monday (default Sunday)
//   cal -h / --no-highlight  don't highlight today

const CAL_HELP = `Usage: cal [-3] [-y] [-m] [-h] [[MONTH] YEAR]
Display a calendar.

  -3                  show previous, current, and next month
  -y, --year          show the entire year
  -m, --monday        start week on Monday (default: Sunday)
  -h, --no-highlight  do not highlight today
  --help              this help

Examples:
  cal                cal -3            cal 1970
  cal 6 2024         cal -y            cal --monday 12 2099
`;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
];

const HEADER_SUNDAY = 'Su Mo Tu We Th Fr Sa';
const HEADER_MONDAY = 'Mo Tu We Th Fr Sa Su';
const ROW_WIDTH = 20; // 7 columns × 2 chars + 6 gap chars
const COL_GUTTER = '  ';

const ANSI_REVERSE_ON = '\x1b[7m';
const ANSI_REVERSE_OFF = '\x1b[27m';

function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

function daysInMonth(year, monthIdx) {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (monthIdx === 1 && isLeapYear(year)) return 29;
  return lengths[monthIdx];
}

/** First weekday of `monthIdx` in `year`. 0 = Sunday … 6 = Saturday. */
function firstWeekday(year, monthIdx) {
  return new Date(year, monthIdx, 1).getDay();
}

/**
 * Render a single month as an array of equal-width strings (one per line).
 * @param {number} year
 * @param {number} monthIdx 0..11
 * @param {{ today: { y: number, m: number, d: number } | null, mondayStart: boolean, highlight: boolean }} opts
 */
function renderMonth(year, monthIdx, opts) {
  const lines = [];
  const title = `${MONTH_NAMES[monthIdx]} ${year}`;
  const titlePadLeft = Math.max(0, Math.floor((ROW_WIDTH - title.length) / 2));
  lines.push(
    ' '.repeat(titlePadLeft) + title + ' '.repeat(ROW_WIDTH - titlePadLeft - title.length)
  );
  lines.push(opts.mondayStart ? HEADER_MONDAY : HEADER_SUNDAY);

  let leadBlanks = firstWeekday(year, monthIdx);
  if (opts.mondayStart) leadBlanks = (leadBlanks + 6) % 7;

  const cells = [];
  for (let i = 0; i < leadBlanks; i++) cells.push('  ');
  const last = daysInMonth(year, monthIdx);
  for (let day = 1; day <= last; day++) {
    const dayStr = day.toString().padStart(2, ' ');
    const isToday =
      opts.highlight &&
      opts.today &&
      opts.today.y === year &&
      opts.today.m === monthIdx &&
      opts.today.d === day;
    cells.push(isToday ? `${ANSI_REVERSE_ON}${dayStr}${ANSI_REVERSE_OFF}` : dayStr);
  }
  while (cells.length % 7 !== 0) cells.push('  ');

  for (let i = 0; i < cells.length; i += 7) {
    lines.push(cells.slice(i, i + 7).join(' '));
  }

  // Pad to a consistent 8-line block (title + header + up to 6 weeks).
  while (lines.length < 8) lines.push(' '.repeat(ROW_WIDTH));

  return lines;
}

/** Side-by-side render of N month-blocks. */
function joinMonthsSideBySide(monthBlocks) {
  const height = monthBlocks[0].length;
  const out = [];
  for (let row = 0; row < height; row++) {
    out.push(monthBlocks.map((block) => block[row]).join(COL_GUTTER));
  }
  return out;
}

function renderYear(year, opts) {
  const out = [];
  const yearLabel = String(year);
  const totalWidth = ROW_WIDTH * 3 + COL_GUTTER.length * 2;
  const yearPad = Math.max(0, Math.floor((totalWidth - yearLabel.length) / 2));
  out.push(' '.repeat(yearPad) + yearLabel);
  out.push('');
  for (let row = 0; row < 4; row++) {
    const blocks = [];
    for (let col = 0; col < 3; col++) {
      blocks.push(renderMonth(year, row * 3 + col, opts));
    }
    out.push(...joinMonthsSideBySide(blocks));
    out.push('');
  }
  return out.join('\n');
}

function calHandler(_terminal, args) {
  let showYear = false;
  let show3 = false;
  let mondayStart = false;
  let highlight = true;
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help') return { stdout: CAL_HELP, stderr: '', exitCode: 0 };
    if (a === '-y' || a === '--year') {
      showYear = true;
      continue;
    }
    if (a === '-3') {
      show3 = true;
      continue;
    }
    if (a === '-m' || a === '--monday') {
      mondayStart = true;
      continue;
    }
    if (a === '-h' || a === '--no-highlight') {
      highlight = false;
      continue;
    }
    if (a.startsWith('-') && a !== '-') {
      return {
        stdout: '',
        stderr: `cal: unrecognized option '${a}'\nTry 'cal --help' for more information.\n`,
        exitCode: 2
      };
    }
    positional.push(a);
  }

  const now = new Date();
  const todayInfo = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  const opts = { today: todayInfo, mondayStart, highlight };

  let year = todayInfo.y;
  let monthIdx = todayInfo.m;

  if (positional.length === 1) {
    const n = parseInt(positional[0], 10);
    if (!Number.isFinite(n) || n < 1 || n > 9999) {
      return { stdout: '', stderr: `cal: '${positional[0]}' is not a valid year\n`, exitCode: 1 };
    }
    year = n;
    showYear = true;
  } else if (positional.length === 2) {
    const m = parseInt(positional[0], 10);
    const y = parseInt(positional[1], 10);
    if (!Number.isFinite(m) || m < 1 || m > 12) {
      return {
        stdout: '',
        stderr: `cal: '${positional[0]}' is not a valid month\n`,
        exitCode: 1
      };
    }
    if (!Number.isFinite(y) || y < 1 || y > 9999) {
      return { stdout: '', stderr: `cal: '${positional[1]}' is not a valid year\n`, exitCode: 1 };
    }
    year = y;
    monthIdx = m - 1;
  } else if (positional.length > 2) {
    return { stdout: '', stderr: 'cal: too many arguments\n', exitCode: 2 };
  }

  if (showYear) {
    return { stdout: renderYear(year, opts) + '\n', stderr: '', exitCode: 0 };
  }

  if (show3) {
    let prevMonth = monthIdx - 1;
    let prevYear = year;
    if (prevMonth < 0) {
      prevMonth = 11;
      prevYear -= 1;
    }
    let nextMonth = monthIdx + 1;
    let nextYear = year;
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    const blocks = [
      renderMonth(prevYear, prevMonth, opts),
      renderMonth(year, monthIdx, opts),
      renderMonth(nextYear, nextMonth, opts)
    ];
    return { stdout: joinMonthsSideBySide(blocks).join('\n') + '\n', stderr: '', exitCode: 0 };
  }

  const lines = renderMonth(year, monthIdx, opts);
  return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
}

export default {
  name: 'cal',
  handler: calHandler,
  description: 'display a calendar (-3 / -y / -m / -h, [MONTH] YEAR)',
  category: 'System'
};
