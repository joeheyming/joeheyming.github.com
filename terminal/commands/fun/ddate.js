// ddate — Discordian date (port of BSD ddate(1))
//
// Reference: the Principia Discordia, BSD 4.4 ddate(1).
// 5 seasons × 73 days = 365 days. St. Tib's Day (Feb 29) is "outside" the
// calendar — neither in any season nor on the 5-day weekday cycle.

const DDATE_HELP = `Usage: ddate [+FORMAT] [DAY MONTH YEAR]
Print the Discordian date (Erisian calendar).

  +FORMAT     date format (see FORMAT below); default: full sentence
  DAY MONTH YEAR   render the Discordian date for the given Gregorian date
  --help      display this help and exit

FORMAT specifiers:
  %A   full weekday (Sweetmorn, Boomtime, Pungenday, Prickle-Prickle, Setting Orange)
  %a   short weekday (SM, BT, PD, PP, SO)
  %B   full season (Chaos, Discord, Confusion, Bureaucracy, The Aftermath)
  %b   short season (Chs, Dsc, Cfn, Bcy, Afm)
  %d   day of season (1..73)
  %e   ordinal day of season (e.g. 1st, 23rd)
  %Y   YOLD (Year of Our Lady of Discord) — Gregorian + 1166
  %H   holyday name, if today is one (Mungday, Chaoflux, …); else empty
  %N   On St. Tib's Day, halt all subsequent format processing
  %t   tab
  %n   newline
  %.   percent sign

Today is Sweetmorn, the 1st day of Chaos in the YOLD ${new Date().getFullYear() + 1166}.
`;

const SEASONS = ['Chaos', 'Discord', 'Confusion', 'Bureaucracy', 'The Aftermath'];
const SEASONS_SHORT = ['Chs', 'Dsc', 'Cfn', 'Bcy', 'Afm'];
const WEEKDAYS = ['Sweetmorn', 'Boomtime', 'Pungenday', 'Prickle-Prickle', 'Setting Orange'];
const WEEKDAYS_SHORT = ['SM', 'BT', 'PD', 'PP', 'SO'];

/** Day-5 holydays (one per season) and Day-50 fluxes. */
const HOLYDAYS = {
  '0:5': 'Mungday',
  '1:5': 'Mojoday',
  '2:5': 'Syaday',
  '3:5': 'Zaraday',
  '4:5': 'Maladay',
  '0:50': 'Chaoflux',
  '1:50': 'Discoflux',
  '2:50': 'Confuflux',
  '3:50': 'Bureflux',
  '4:50': 'Afflux'
};

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function ordinal(n) {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Compute Discordian date for a given Gregorian date.
 * @param {Date} d
 * @returns {{ tibsDay: boolean, year: number, season?: number, day?: number, weekday?: number, holyday?: string }}
 */
function gregToDiscordian(d) {
  const gregYear = d.getFullYear();
  const yold = gregYear + 1166;
  const month = d.getMonth(); // 0-based
  const day = d.getDate();

  // Day-of-year, 1-based.
  const startOfYear = Date.UTC(gregYear, 0, 1);
  const today = Date.UTC(gregYear, month, day);
  const dayOfYear = Math.round((today - startOfYear) / 86400000) + 1;

  if (isLeapYear(gregYear) && month === 1 && day === 29) {
    return { tibsDay: true, year: yold };
  }

  // After Feb 29 in a leap year, shift back by 1 so we still get a 1..365 day-of-year
  // for the Discordian calculation (St. Tib's Day is "outside" the calendar).
  let dDay = dayOfYear;
  if (isLeapYear(gregYear) && (month > 1 || (month === 1 && day === 29))) {
    dDay = dayOfYear - 1;
  }

  const seasonIdx = Math.floor((dDay - 1) / 73);
  const dayInSeason = ((dDay - 1) % 73) + 1;
  const weekdayIdx = (dDay - 1) % 5;
  const holyday = HOLYDAYS[`${seasonIdx}:${dayInSeason}`] || '';

  return {
    tibsDay: false,
    year: yold,
    season: seasonIdx,
    day: dayInSeason,
    weekday: weekdayIdx,
    holyday
  };
}

function formatDdate(disc, fmt) {
  if (disc.tibsDay) {
    // %N halts further formatting on St. Tib's Day. We don't fully implement
    // every BSD format edge case; we honor %N by short-circuiting after.
    let out = '';
    for (let i = 0; i < fmt.length; i++) {
      const c = fmt[i];
      if (c !== '%') {
        out += c;
        continue;
      }
      const next = fmt[++i] || '';
      if (next === 'N') return out + "St. Tib's Day, YOLD " + disc.year;
      if (next === 'Y') out += String(disc.year);
      else if (next === 't') out += '\t';
      else if (next === 'n') out += '\n';
      else if (next === '.') out += '%';
      else out += '%' + next;
    }
    return out + " (St. Tib's Day, YOLD " + disc.year + ')';
  }

  let out = '';
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      continue;
    }
    const next = fmt[++i] || '';
    switch (next) {
      case 'A':
        out += WEEKDAYS[disc.weekday];
        break;
      case 'a':
        out += WEEKDAYS_SHORT[disc.weekday];
        break;
      case 'B':
        out += SEASONS[disc.season];
        break;
      case 'b':
        out += SEASONS_SHORT[disc.season];
        break;
      case 'd':
        out += String(disc.day);
        break;
      case 'e':
        out += ordinal(disc.day);
        break;
      case 'Y':
        out += String(disc.year);
        break;
      case 'H':
        out += disc.holyday;
        break;
      case 'N':
        // On non-Tib's days, %N expands to nothing (no halt).
        break;
      case 't':
        out += '\t';
        break;
      case 'n':
        out += '\n';
        break;
      case '.':
        out += '%';
        break;
      default:
        out += '%' + next;
        break;
    }
  }
  return out;
}

function defaultRender(disc) {
  if (disc.tibsDay) {
    return `Today is St. Tib's Day, in the YOLD ${disc.year}.`;
  }
  const base = `Today is ${WEEKDAYS[disc.weekday]}, the ${ordinal(disc.day)} day of ${
    SEASONS[disc.season]
  } in the YOLD ${disc.year}.`;
  return disc.holyday ? `${base}\nCelebrate ${disc.holyday}!` : base;
}

function ddateHandler(_terminal, args) {
  if (args.includes('--help')) {
    return { stdout: DDATE_HELP, stderr: '', exitCode: 0 };
  }

  let format = null;
  const positional = [];
  for (const a of args) {
    if (a.startsWith('+')) {
      format = a.slice(1);
      continue;
    }
    positional.push(a);
  }

  let date = new Date();
  if (positional.length === 3) {
    const day = parseInt(positional[0], 10);
    const month = parseInt(positional[1], 10);
    const year = parseInt(positional[2], 10);
    if (
      !Number.isFinite(day) ||
      !Number.isFinite(month) ||
      !Number.isFinite(year) ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31
    ) {
      return { stdout: '', stderr: 'ddate: bad date\n', exitCode: 1 };
    }
    date = new Date(year, month - 1, day);
  } else if (positional.length !== 0) {
    return {
      stdout: '',
      stderr: 'ddate: usage: ddate [+FORMAT] [DAY MONTH YEAR]\n',
      exitCode: 2
    };
  }

  const disc = gregToDiscordian(date);
  const out = format !== null ? formatDdate(disc, format) : defaultRender(disc);
  return { stdout: out + '\n', stderr: '', exitCode: 0 };
}

export default {
  name: 'ddate',
  handler: ddateHandler,
  description: 'print the Discordian date (Erisian calendar; +FORMAT, DAY MONTH YEAR)',
  category: 'Fun Stuff'
};
