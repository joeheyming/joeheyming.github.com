/**
 * Events Module - Holiday definitions and date calculations
 * Contains all preset events, custom event management, and date calculation utilities
 *
 * Event name translations are in i18n/translations/{locale}.json under "events" section.
 * To add a new translation, edit the corresponding language file.
 */
import dayjs from 'dayjs';
import { localeService } from './i18n/locale-service.js';

// ============================================================================
// LOCALIZED EVENT NAME HELPER
// ============================================================================

/**
 * Get localized event label using centralized strings
 * @param {string} eventId - The event ID
 * @returns {string} The localized event label
 */
export function getLocalizedEventLabel(eventId) {
  return localeService.str(`events.${eventId}`);
}

// ============================================================================
// CATEGORY DEFINITIONS
// ============================================================================

/**
 * Category emojis - used for visual identification in dropdowns
 */
export const CATEGORY_EMOJIS = {
  seasonal: '🗓️',
  cultural: '🌍',
  religious: '🕊️',
  national: '🏛️',
  international: '🌐',
  family: '👨‍👩‍👧',
  fun: '🎈',
  custom: '⭐',
  other: '📌'
};

// ============================================================================
// DATE CALCULATION HELPERS
// ============================================================================
// Event translations are in i18n/translations/*.json under "events" section
// Use getLocalizedEventLabel(eventId) or localeService.str('events.eventId')
// ============================================================================

// Thanksgiving is the 4th Thursday of November
function getThanksgiving(year, now) {
  let date = dayjs().year(year).month(10).date(1);
  // Find first Thursday
  while (date.day() !== 4) {
    date = date.add(1, 'day');
  }
  // Add 3 weeks to get 4th Thursday
  date = date.add(3, 'week').startOf('day');

  if (date.isBefore(now)) {
    return getThanksgiving(year + 1, now);
  }

  return { date: date.toISOString(), name: `Thanksgiving ${date.year()}` };
}

// Easter calculation (Western) using Anonymous Gregorian algorithm
function getEaster(year, now) {
  const calculateEaster = (y) => {
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1; // 0-indexed
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return dayjs().year(y).month(month).date(day).startOf('day');
  };

  let date = calculateEaster(year);
  if (date.isBefore(now)) {
    date = calculateEaster(year + 1);
  }
  return { date: date.toISOString(), name: `Easter ${date.year()}` };
}

// Passover (15th of Nisan) - typically in March or April
function getPassover(year, now) {
  const passoverDates = {
    2024: { month: 3, day: 22 },
    2025: { month: 3, day: 12 },
    2026: { month: 3, day: 1 },
    2027: { month: 3, day: 21 },
    2028: { month: 3, day: 10 },
    2029: { month: 2, day: 30 },
    2030: { month: 3, day: 17 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = passoverDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Passover ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(3)
      .date(15)
      .toISOString(),
    name: `Passover ${year + 1}`
  };
}

// Rosh Hashanah (1st of Tishrei) - typically in September or October
function getRoshHashanah(year, now) {
  const roshDates = {
    2024: { month: 9, day: 2 },
    2025: { month: 8, day: 22 },
    2026: { month: 8, day: 11 },
    2027: { month: 9, day: 1 },
    2028: { month: 8, day: 20 },
    2029: { month: 8, day: 9 },
    2030: { month: 8, day: 27 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = roshDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Rosh Hashanah ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(8)
      .date(20)
      .toISOString(),
    name: `Rosh Hashanah ${year + 1}`
  };
}

// Yom Kippur (10th of Tishrei) - 9 days after Rosh Hashanah
function getYomKippur(year, now) {
  const kipDates = {
    2024: { month: 9, day: 11 },
    2025: { month: 9, day: 1 },
    2026: { month: 8, day: 20 },
    2027: { month: 9, day: 10 },
    2028: { month: 8, day: 29 },
    2029: { month: 8, day: 18 },
    2030: { month: 9, day: 6 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = kipDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Yom Kippur ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(9)
      .date(5)
      .toISOString(),
    name: `Yom Kippur ${year + 1}`
  };
}

// Hanukkah (25th of Kislev) - typically in November or December
function getHanukkah(year, now) {
  const hanukkahDates = {
    2024: { month: 11, day: 25 },
    2025: { month: 11, day: 14 },
    2026: { month: 11, day: 4 },
    2027: { month: 11, day: 24 },
    2028: { month: 11, day: 12 },
    2029: { month: 11, day: 1 },
    2030: { month: 11, day: 20 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = hanukkahDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Hanukkah ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(11)
      .date(15)
      .toISOString(),
    name: `Hanukkah ${year + 1}`
  };
}

// Lunar New Year (Chinese New Year) - varies each year
function getLunarNewYear(year, now) {
  const lunarNewYearDates = {
    2024: { month: 1, day: 10 },
    2025: { month: 0, day: 29 },
    2026: { month: 1, day: 17 },
    2027: { month: 1, day: 6 },
    2028: { month: 0, day: 26 },
    2029: { month: 1, day: 13 },
    2030: { month: 1, day: 2 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = lunarNewYearDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Lunar New Year ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(1)
      .date(1)
      .toISOString(),
    name: `Lunar New Year ${year + 1}`
  };
}

// Diwali (Festival of Lights) - varies based on Hindu calendar
function getDiwali(year, now) {
  const diwaliDates = {
    2024: { month: 10, day: 1 },
    2025: { month: 9, day: 20 },
    2026: { month: 10, day: 8 },
    2027: { month: 9, day: 29 },
    2028: { month: 9, day: 17 },
    2029: { month: 10, day: 5 },
    2030: { month: 9, day: 26 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = diwaliDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Diwali ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(10)
      .date(1)
      .toISOString(),
    name: `Diwali ${year + 1}`
  };
}

// Holi (Festival of Colors) - full moon day in Phalguna (Feb/March)
function getHoli(year, now) {
  const holiDates = {
    2024: { month: 2, day: 25 },
    2025: { month: 2, day: 14 },
    2026: { month: 2, day: 3 },
    2027: { month: 2, day: 22 },
    2028: { month: 2, day: 11 },
    2029: { month: 2, day: 1 },
    2030: { month: 2, day: 20 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = holiDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Holi ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(2)
      .date(15)
      .toISOString(),
    name: `Holi ${year + 1}`
  };
}

// Mardi Gras - 47 days before Easter
function getMardiGras(year, now) {
  const calculateEaster = (y) => {
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return dayjs().year(y).month(month).date(day).startOf('day');
  };

  let easter = calculateEaster(year);
  let mardiGras = easter.subtract(47, 'day');

  if (mardiGras.isBefore(now)) {
    easter = calculateEaster(year + 1);
    mardiGras = easter.subtract(47, 'day');
  }

  return { date: mardiGras.toISOString(), name: `Mardi Gras ${mardiGras.year()}` };
}

// Eid al-Fitr - End of Ramadan (Islamic lunar calendar)
function getEidAlFitr(year, now) {
  const eidDates = {
    2024: { month: 3, day: 10 },
    2025: { month: 2, day: 30 },
    2026: { month: 2, day: 20 },
    2027: { month: 2, day: 9 },
    2028: { month: 0, day: 29 },
    2029: { month: 0, day: 18 },
    2030: { month: 0, day: 7 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = eidDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Eid al-Fitr ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(2)
      .date(15)
      .toISOString(),
    name: `Eid al-Fitr ${year + 1}`
  };
}

// Eid al-Adha - Festival of Sacrifice (Islamic lunar calendar)
function getEidAlAdha(year, now) {
  const eidDates = {
    2024: { month: 5, day: 16 },
    2025: { month: 5, day: 6 },
    2026: { month: 4, day: 27 },
    2027: { month: 4, day: 16 },
    2028: { month: 4, day: 5 },
    2029: { month: 3, day: 24 },
    2030: { month: 3, day: 13 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = eidDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Eid al-Adha ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(4)
      .date(20)
      .toISOString(),
    name: `Eid al-Adha ${year + 1}`
  };
}

// Vesak (Buddha Day) - Full moon of Vesakha month
function getVesak(year, now) {
  const vesakDates = {
    2024: { month: 4, day: 23 },
    2025: { month: 4, day: 12 },
    2026: { month: 4, day: 31 },
    2027: { month: 4, day: 20 },
    2028: { month: 4, day: 9 },
    2029: { month: 4, day: 27 },
    2030: { month: 4, day: 17 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = vesakDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Vesak ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(4)
      .date(15)
      .toISOString(),
    name: `Vesak ${year + 1}`
  };
}

// Mid-Autumn Festival (Chinese) - 15th day of 8th lunar month
function getMidAutumn(year, now) {
  const midAutumnDates = {
    2024: { month: 8, day: 17 },
    2025: { month: 9, day: 6 },
    2026: { month: 8, day: 25 },
    2027: { month: 9, day: 15 },
    2028: { month: 9, day: 3 },
    2029: { month: 8, day: 22 },
    2030: { month: 9, day: 12 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = midAutumnDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Mid-Autumn Festival ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(8)
      .date(20)
      .toISOString(),
    name: `Mid-Autumn Festival ${year + 1}`
  };
}

// Chuseok (Korean Thanksgiving) - 15th day of 8th lunar month
function getChuseok(year, now) {
  const chuseokDates = {
    2024: { month: 8, day: 17 },
    2025: { month: 9, day: 6 },
    2026: { month: 8, day: 25 },
    2027: { month: 9, day: 15 },
    2028: { month: 9, day: 3 },
    2029: { month: 8, day: 22 },
    2030: { month: 9, day: 12 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = chuseokDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Chuseok ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(8)
      .date(20)
      .toISOString(),
    name: `Chuseok ${year + 1}`
  };
}

// Orthodox Easter - Julian calendar calculation
function getOrthodoxEaster(year, now) {
  const calculateOrthodoxEaster = (y) => {
    // Julian calendar Easter calculation
    const a = y % 4;
    const b = y % 7;
    const c = y % 19;
    const d = (19 * c + 15) % 30;
    const e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31) - 1; // 0-indexed
    const day = ((d + e + 114) % 31) + 1;
    // Convert from Julian to Gregorian (add 13 days for 20th/21st century)
    let date = dayjs().year(y).month(month).date(day).add(13, 'day').startOf('day');
    return date;
  };

  let date = calculateOrthodoxEaster(year);
  if (date.isBefore(now)) {
    date = calculateOrthodoxEaster(year + 1);
  }
  return { date: date.toISOString(), name: `Orthodox Easter ${date.year()}` };
}

// Purim (14th of Adar) - Jewish festival
function getPurim(year, now) {
  const purimDates = {
    2024: { month: 2, day: 24 },
    2025: { month: 2, day: 14 },
    2026: { month: 2, day: 3 },
    2027: { month: 2, day: 23 },
    2028: { month: 2, day: 12 },
    2029: { month: 2, day: 1 },
    2030: { month: 2, day: 19 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = purimDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Purim ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(2)
      .date(15)
      .toISOString(),
    name: `Purim ${year + 1}`
  };
}

// Sukkot (15th of Tishrei) - Feast of Tabernacles
function getSukkot(year, now) {
  const sukkotDates = {
    2024: { month: 9, day: 16 },
    2025: { month: 9, day: 6 },
    2026: { month: 8, day: 25 },
    2027: { month: 9, day: 15 },
    2028: { month: 9, day: 4 },
    2029: { month: 8, day: 23 },
    2030: { month: 9, day: 11 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = sukkotDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Sukkot ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(9)
      .date(10)
      .toISOString(),
    name: `Sukkot ${year + 1}`
  };
}

// Shavuot (6th of Sivan) - Feast of Weeks
function getShavuot(year, now) {
  const shavuotDates = {
    2024: { month: 5, day: 12 },
    2025: { month: 5, day: 1 },
    2026: { month: 4, day: 22 },
    2027: { month: 5, day: 11 },
    2028: { month: 4, day: 30 },
    2029: { month: 4, day: 19 },
    2030: { month: 5, day: 7 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = shavuotDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Shavuot ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(5)
      .date(5)
      .toISOString(),
    name: `Shavuot ${year + 1}`
  };
}

// Ganesh Chaturthi - Hindu festival for Lord Ganesha
function getGaneshChaturthi(year, now) {
  const ganeshDates = {
    2024: { month: 8, day: 7 },
    2025: { month: 7, day: 27 },
    2026: { month: 8, day: 15 },
    2027: { month: 8, day: 4 },
    2028: { month: 7, day: 24 },
    2029: { month: 8, day: 12 },
    2030: { month: 8, day: 1 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = ganeshDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Ganesh Chaturthi ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(8)
      .date(5)
      .toISOString(),
    name: `Ganesh Chaturthi ${year + 1}`
  };
}

// Navratri - 9-night Hindu festival
function getNavratri(year, now) {
  const navratriDates = {
    2024: { month: 9, day: 3 },
    2025: { month: 8, day: 22 },
    2026: { month: 9, day: 11 },
    2027: { month: 9, day: 1 },
    2028: { month: 8, day: 20 },
    2029: { month: 9, day: 8 },
    2030: { month: 8, day: 28 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = navratriDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Navratri ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(9)
      .date(1)
      .toISOString(),
    name: `Navratri ${year + 1}`
  };
}

// Raksha Bandhan - Hindu sibling celebration
function getRakshaBandhan(year, now) {
  const rakshaDates = {
    2024: { month: 7, day: 19 },
    2025: { month: 7, day: 9 },
    2026: { month: 7, day: 28 },
    2027: { month: 7, day: 17 },
    2028: { month: 7, day: 6 },
    2029: { month: 7, day: 25 },
    2030: { month: 7, day: 14 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = rakshaDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Raksha Bandhan ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(7)
      .date(15)
      .toISOString(),
    name: `Raksha Bandhan ${year + 1}`
  };
}

// Dragon Boat Festival (Duanwu) - 5th day of 5th lunar month
function getDragonBoat(year, now) {
  const dragonBoatDates = {
    2024: { month: 5, day: 10 },
    2025: { month: 4, day: 31 },
    2026: { month: 5, day: 19 },
    2027: { month: 5, day: 9 },
    2028: { month: 4, day: 28 },
    2029: { month: 5, day: 16 },
    2030: { month: 5, day: 5 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = dragonBoatDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Dragon Boat Festival ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(5)
      .date(10)
      .toISOString(),
    name: `Dragon Boat Festival ${year + 1}`
  };
}

// Tết (Vietnamese New Year) - same lunar calendar as Chinese New Year
function getTet(year, now) {
  const tetDates = {
    2024: { month: 1, day: 10 },
    2025: { month: 0, day: 29 },
    2026: { month: 1, day: 17 },
    2027: { month: 1, day: 6 },
    2028: { month: 0, day: 26 },
    2029: { month: 1, day: 13 },
    2030: { month: 1, day: 2 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = tetDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Tết ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(1)
      .date(1)
      .toISOString(),
    name: `Tết ${year + 1}`
  };
}

// Seollal (Korean New Year) - same lunar calendar
function getSeollal(year, now) {
  const seollalDates = {
    2024: { month: 1, day: 10 },
    2025: { month: 0, day: 29 },
    2026: { month: 1, day: 17 },
    2027: { month: 1, day: 6 },
    2028: { month: 0, day: 26 },
    2029: { month: 1, day: 13 },
    2030: { month: 1, day: 2 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = seollalDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Seollal ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(1)
      .date(1)
      .toISOString(),
    name: `Seollal ${year + 1}`
  };
}

// Loy Krathong (Thai Lantern Festival) - full moon of 12th Thai lunar month
function getLoyKrathong(year, now) {
  const loyKrathongDates = {
    2024: { month: 10, day: 15 },
    2025: { month: 10, day: 5 },
    2026: { month: 10, day: 24 },
    2027: { month: 10, day: 14 },
    2028: { month: 10, day: 2 },
    2029: { month: 10, day: 21 },
    2030: { month: 10, day: 10 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = loyKrathongDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Loy Krathong ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(10)
      .date(15)
      .toISOString(),
    name: `Loy Krathong ${year + 1}`
  };
}

// Mawlid (Prophet Muhammad's Birthday) - Islamic calendar
function getMawlid(year, now) {
  const mawlidDates = {
    2024: { month: 8, day: 15 },
    2025: { month: 8, day: 4 },
    2026: { month: 7, day: 25 },
    2027: { month: 7, day: 14 },
    2028: { month: 7, day: 3 },
    2029: { month: 5, day: 23 },
    2030: { month: 5, day: 12 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = mawlidDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Mawlid ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(8)
      .date(10)
      .toISOString(),
    name: `Mawlid ${year + 1}`
  };
}

// Islamic New Year (Hijri New Year) - 1st of Muharram
function getIslamicNewYear(year, now) {
  const islamicNewYearDates = {
    2024: { month: 6, day: 7 },
    2025: { month: 5, day: 26 },
    2026: { month: 5, day: 16 },
    2027: { month: 5, day: 6 },
    2028: { month: 4, day: 24 },
    2029: { month: 4, day: 13 },
    2030: { month: 4, day: 3 }
  };

  for (let y = year; y <= year + 2; y++) {
    const data = islamicNewYearDates[y];
    if (data) {
      const date = dayjs().year(y).month(data.month).date(data.day).startOf('day');
      if (!date.isBefore(now)) {
        return { date: date.toISOString(), name: `Islamic New Year ${y}` };
      }
    }
  }
  return {
    date: dayjs()
      .year(year + 1)
      .month(5)
      .date(15)
      .toISOString(),
    name: `Islamic New Year ${year + 1}`
  };
}

// Brazilian Carnival - Friday before Ash Wednesday (51 days before Easter)
function getCarnaval(year, now) {
  const calculateEaster = (y) => {
    const a = y % 19;
    const b = Math.floor(y / 100);
    const c = y % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return dayjs().year(y).month(month).date(day).startOf('day');
  };

  let easter = calculateEaster(year);
  let carnaval = easter.subtract(51, 'day'); // Friday before Ash Wednesday

  if (carnaval.isBefore(now)) {
    easter = calculateEaster(year + 1);
    carnaval = easter.subtract(51, 'day');
  }

  return { date: carnaval.toISOString(), name: `Carnaval ${carnaval.year()}` };
}

// Midsummer (Sweden) - Saturday between June 20-26
function getMidsummer(year, now) {
  const getMidsummerDate = (y) => {
    let date = dayjs().year(y).month(5).date(20);
    while (date.day() !== 6) {
      // Find Saturday
      date = date.add(1, 'day');
    }
    return date.startOf('day');
  };

  let date = getMidsummerDate(year);
  if (date.isBefore(now)) {
    date = getMidsummerDate(year + 1);
  }
  return { date: date.toISOString(), name: `Midsummer ${date.year()}` };
}

// ============================================================================
// PRESET EVENTS
// ============================================================================

/**
 * Get all preset events with dynamic year calculation
 * Events are automatically adjusted to show the next upcoming occurrence
 */
export function getPresetEvents() {
  const now = dayjs();
  const currentYear = now.year();

  const getNextOccurrence = (month, day, name) => {
    let date = dayjs().year(currentYear).month(month).date(day).startOf('day');
    if (date.isBefore(now)) {
      date = date.add(1, 'year');
    }
    return { date: date.toISOString(), name: `${name} ${date.year()}` };
  };

  // Get nth weekday of a month (e.g., 2nd Monday, 4th Thursday)
  const getNthWeekday = (year, month, weekday, n, name) => {
    let date = dayjs().year(year).month(month).date(1);
    // Find first occurrence of weekday
    while (date.day() !== weekday) {
      date = date.add(1, 'day');
    }
    // Add (n-1) weeks to get nth occurrence
    date = date.add(n - 1, 'week').startOf('day');

    if (date.isBefore(now)) {
      return getNthWeekday(year + 1, month, weekday, n, name);
    }
    return { date: date.toISOString(), name: `${name} ${date.year()}` };
  };

  // Get last weekday of a month (e.g., last Monday of May)
  const getLastWeekday = (year, month, weekday, name) => {
    let date = dayjs().year(year).month(month).endOf('month');
    while (date.day() !== weekday) {
      date = date.subtract(1, 'day');
    }
    date = date.startOf('day');

    if (date.isBefore(now)) {
      return getLastWeekday(year + 1, month, weekday, name);
    }
    return { date: date.toISOString(), name: `${name} ${date.year()}` };
  };

  return [
    // === NEW YEAR & WINTER ===
    {
      id: 'new-years',
      emoji: '🎆',
      label: "New Year's Day",
      category: 'seasonal',
      ...getNextOccurrence(0, 1, "New Year's Day")
    },
    {
      id: 'lunar-new-year',
      emoji: '🐉',
      label: 'Lunar New Year',
      category: 'cultural',
      ...getLunarNewYear(currentYear, now)
    },

    // === WINTER/SPRING HOLIDAYS ===
    {
      id: 'groundhog-day',
      emoji: '🦫',
      label: 'Groundhog Day',
      category: 'fun',
      ...getNextOccurrence(1, 2, 'Groundhog Day')
    },
    {
      id: 'valentines',
      emoji: '💕',
      label: "Valentine's Day",
      category: 'seasonal',
      ...getNextOccurrence(1, 14, "Valentine's Day")
    },
    {
      id: 'presidents-day',
      emoji: '🏛️',
      label: "Presidents' Day",
      category: 'national',
      ...getNthWeekday(currentYear, 1, 1, 3, "Presidents' Day") // 3rd Monday of Feb
    },
    {
      id: 'mardi-gras',
      emoji: '🎭',
      label: 'Mardi Gras',
      category: 'cultural',
      ...getMardiGras(currentYear, now)
    },

    // === MARCH ===
    {
      id: 'intl-womens-day',
      emoji: '♀️',
      label: "International Women's Day",
      category: 'international',
      ...getNextOccurrence(2, 8, "International Women's Day")
    },
    {
      id: 'pi-day',
      emoji: '🥧',
      label: 'Pi Day',
      category: 'fun',
      ...getNextOccurrence(2, 14, 'Pi Day')
    },
    {
      id: 'st-patricks',
      emoji: '🍀',
      label: "St. Patrick's Day",
      category: 'cultural',
      ...getNextOccurrence(2, 17, "St. Patrick's Day")
    },
    {
      id: 'spring-equinox',
      emoji: '🌸',
      label: 'Spring Equinox',
      category: 'seasonal',
      ...getNextOccurrence(2, 20, 'Spring Equinox')
    },
    {
      id: 'nowruz',
      emoji: '🌷',
      label: 'Nowruz (Persian New Year)',
      category: 'cultural',
      ...getNextOccurrence(2, 21, 'Nowruz')
    },
    {
      id: 'holi',
      emoji: '🎨',
      label: 'Holi (Festival of Colors)',
      category: 'religious',
      ...getHoli(currentYear, now)
    },

    // === APRIL ===
    {
      id: 'april-fools',
      emoji: '🃏',
      label: "April Fools' Day",
      category: 'fun',
      ...getNextOccurrence(3, 1, "April Fools' Day")
    },
    {
      id: 'passover',
      emoji: '🍷',
      label: 'Passover',
      category: 'religious',
      ...getPassover(currentYear, now)
    },
    {
      id: 'easter',
      emoji: '🐰',
      label: 'Easter',
      category: 'religious',
      ...getEaster(currentYear, now)
    },
    {
      id: 'earth-day',
      emoji: '🌍',
      label: 'Earth Day',
      category: 'international',
      ...getNextOccurrence(3, 22, 'Earth Day')
    },
    {
      id: 'arbor-day',
      emoji: '🌳',
      label: 'Arbor Day',
      category: 'international',
      ...getLastWeekday(currentYear, 3, 5, 'Arbor Day') // Last Friday of April
    },

    // === MAY ===
    {
      id: 'star-wars-day',
      emoji: '⭐',
      label: 'Star Wars Day',
      category: 'fun',
      ...getNextOccurrence(4, 4, 'Star Wars Day')
    },
    {
      id: 'cinco-de-mayo',
      emoji: '🇲🇽',
      label: 'Cinco de Mayo',
      category: 'cultural',
      ...getNextOccurrence(4, 5, 'Cinco de Mayo')
    },
    {
      id: 'mothers-day',
      emoji: '💐',
      label: "Mother's Day",
      category: 'family',
      ...getNthWeekday(currentYear, 4, 0, 2, "Mother's Day") // 2nd Sunday of May
    },
    {
      id: 'memorial-day',
      emoji: '🎖️',
      label: 'Memorial Day',
      category: 'national',
      ...getLastWeekday(currentYear, 4, 1, 'Memorial Day') // Last Monday of May
    },

    // === JUNE ===
    {
      id: 'pride-month',
      emoji: '🏳️‍🌈',
      label: 'Pride Month',
      category: 'cultural',
      ...getNextOccurrence(5, 1, 'Pride Month')
    },
    {
      id: 'world-environment-day',
      emoji: '🌱',
      label: 'World Environment Day',
      category: 'international',
      ...getNextOccurrence(5, 5, 'World Environment Day')
    },
    {
      id: 'juneteenth',
      emoji: '✊🏿',
      label: 'Juneteenth',
      category: 'national',
      ...getNextOccurrence(5, 19, 'Juneteenth')
    },
    {
      id: 'fathers-day',
      emoji: '👔',
      label: "Father's Day",
      category: 'family',
      ...getNthWeekday(currentYear, 5, 0, 3, "Father's Day") // 3rd Sunday of June
    },
    {
      id: 'summer-solstice',
      emoji: '☀️',
      label: 'Summer Solstice',
      category: 'seasonal',
      ...getNextOccurrence(5, 21, 'Summer Solstice')
    },

    // === JULY ===
    {
      id: 'canada-day',
      emoji: '🇨🇦',
      label: 'Canada Day',
      category: 'national',
      ...getNextOccurrence(6, 1, 'Canada Day')
    },
    {
      id: 'independence',
      emoji: '🇺🇸',
      label: 'Independence Day (USA)',
      category: 'national',
      ...getNextOccurrence(6, 4, 'Independence Day')
    },
    {
      id: 'bastille-day',
      emoji: '🇫🇷',
      label: 'Bastille Day',
      category: 'national',
      ...getNextOccurrence(6, 14, 'Bastille Day')
    },

    // === AUGUST ===
    {
      id: 'international-friendship-day',
      emoji: '🤝',
      label: 'International Friendship Day',
      category: 'international',
      ...getNthWeekday(currentYear, 7, 0, 1, 'International Friendship Day') // 1st Sunday of Aug
    },

    // === SEPTEMBER ===
    {
      id: 'labor-day',
      emoji: '⚒️',
      label: 'Labor Day',
      category: 'national',
      ...getNthWeekday(currentYear, 8, 1, 1, 'Labor Day') // 1st Monday of Sept
    },
    {
      id: 'autumn-equinox',
      emoji: '🍂',
      label: 'Autumn Equinox',
      category: 'seasonal',
      ...getNextOccurrence(8, 22, 'Autumn Equinox')
    },
    {
      id: 'rosh-hashanah',
      emoji: '🍎',
      label: 'Rosh Hashanah',
      category: 'religious',
      ...getRoshHashanah(currentYear, now)
    },

    // === OCTOBER ===
    {
      id: 'yom-kippur',
      emoji: '🕯️',
      label: 'Yom Kippur',
      category: 'religious',
      ...getYomKippur(currentYear, now)
    },
    {
      id: 'indigenous-peoples-day',
      emoji: '🪶',
      label: "Indigenous Peoples' Day",
      category: 'cultural',
      ...getNthWeekday(currentYear, 9, 1, 2, "Indigenous Peoples' Day") // 2nd Monday of Oct
    },
    {
      id: 'halloween',
      emoji: '🎃',
      label: 'Halloween',
      category: 'seasonal',
      ...getNextOccurrence(9, 31, 'Halloween')
    },

    // === NOVEMBER ===
    {
      id: 'day-of-the-dead',
      emoji: '💀',
      label: 'Día de los Muertos',
      category: 'cultural',
      ...getNextOccurrence(10, 1, 'Día de los Muertos')
    },
    {
      id: 'diwali',
      emoji: '🪔',
      label: 'Diwali (Festival of Lights)',
      category: 'religious',
      ...getDiwali(currentYear, now)
    },
    {
      id: 'veterans-day',
      emoji: '🎗️',
      label: 'Veterans Day',
      category: 'national',
      ...getNextOccurrence(10, 11, 'Veterans Day')
    },
    {
      id: 'thanksgiving',
      emoji: '🦃',
      label: 'Thanksgiving',
      category: 'national',
      ...getThanksgiving(currentYear, now)
    },

    // === DECEMBER ===
    {
      id: 'hanukkah',
      emoji: '🕎',
      label: 'Hanukkah',
      category: 'religious',
      ...getHanukkah(currentYear, now)
    },
    {
      id: 'winter-solstice',
      emoji: '❄️',
      label: 'Winter Solstice',
      category: 'seasonal',
      ...getNextOccurrence(11, 21, 'Winter Solstice')
    },
    {
      id: 'christmas-eve',
      emoji: '🌟',
      label: 'Christmas Eve',
      category: 'religious',
      ...getNextOccurrence(11, 24, 'Christmas Eve')
    },
    {
      id: 'christmas',
      emoji: '🎄',
      label: 'Christmas',
      category: 'religious',
      ...getNextOccurrence(11, 25, 'Christmas')
    },
    {
      id: 'kwanzaa',
      emoji: '🕯️',
      label: 'Kwanzaa',
      category: 'cultural',
      ...getNextOccurrence(11, 26, 'Kwanzaa')
    },
    {
      id: 'new-years-eve',
      emoji: '🥂',
      label: "New Year's Eve",
      category: 'seasonal',
      ...getNextOccurrence(11, 31, "New Year's Eve")
    },

    // === INTERNATIONAL HOLIDAYS ===
    {
      id: 'orthodox-christmas',
      emoji: '⛪',
      label: 'Orthodox Christmas',
      category: 'religious',
      ...getNextOccurrence(0, 7, 'Orthodox Christmas')
    },
    {
      id: 'australia-day',
      emoji: '🇦🇺',
      label: 'Australia Day',
      category: 'national',
      ...getNextOccurrence(0, 26, 'Australia Day')
    },
    {
      id: 'republic-day-india',
      emoji: '🇮🇳',
      label: 'Republic Day (India)',
      category: 'national',
      ...getNextOccurrence(0, 26, 'Republic Day')
    },
    {
      id: 'boxing-day',
      emoji: '🎁',
      label: 'Boxing Day',
      category: 'cultural',
      ...getNextOccurrence(11, 26, 'Boxing Day')
    },
    {
      id: 'anzac-day',
      emoji: '🇦🇺',
      label: 'ANZAC Day',
      category: 'national',
      ...getNextOccurrence(3, 25, 'ANZAC Day')
    },
    {
      id: 'victory-day-russia',
      emoji: '🇷🇺',
      label: 'Victory Day (Russia)',
      category: 'national',
      ...getNextOccurrence(4, 9, 'Victory Day')
    },
    {
      id: 'german-unity-day',
      emoji: '🇩🇪',
      label: 'German Unity Day',
      category: 'national',
      ...getNextOccurrence(9, 3, 'German Unity Day')
    },
    {
      id: 'oktoberfest',
      emoji: '🍺',
      label: 'Oktoberfest',
      category: 'cultural',
      ...getNextOccurrence(8, 16, 'Oktoberfest') // Starts mid-September
    },
    {
      id: 'brazil-independence',
      emoji: '🇧🇷',
      label: 'Brazil Independence Day',
      category: 'national',
      ...getNextOccurrence(8, 7, 'Brazil Independence Day')
    },
    {
      id: 'mexico-independence',
      emoji: '🇲🇽',
      label: 'Mexico Independence Day',
      category: 'national',
      ...getNextOccurrence(8, 16, 'Mexico Independence Day')
    },
    {
      id: 'africa-day',
      emoji: '🌍',
      label: 'Africa Day',
      category: 'international',
      ...getNextOccurrence(4, 25, 'Africa Day')
    },
    {
      id: 'intl-day-of-peace',
      emoji: '☮️',
      label: 'International Day of Peace',
      category: 'international',
      ...getNextOccurrence(8, 21, "Int'l Day of Peace")
    },
    {
      id: 'world-health-day',
      emoji: '🏥',
      label: 'World Health Day',
      category: 'international',
      ...getNextOccurrence(3, 7, 'World Health Day')
    },
    {
      id: 'intl-mens-day',
      emoji: '♂️',
      label: "International Men's Day",
      category: 'international',
      ...getNextOccurrence(10, 19, "International Men's Day")
    },
    {
      id: 'eid-al-fitr',
      emoji: '🌙',
      label: 'Eid al-Fitr',
      category: 'religious',
      ...getEidAlFitr(currentYear, now)
    },
    {
      id: 'eid-al-adha',
      emoji: '🐑',
      label: 'Eid al-Adha',
      category: 'religious',
      ...getEidAlAdha(currentYear, now)
    },
    {
      id: 'vesak',
      emoji: '🪷',
      label: 'Vesak (Buddha Day)',
      category: 'religious',
      ...getVesak(currentYear, now)
    },
    {
      id: 'mid-autumn',
      emoji: '🥮',
      label: 'Mid-Autumn Festival',
      category: 'cultural',
      ...getMidAutumn(currentYear, now)
    },
    {
      id: 'chuseok',
      emoji: '🇰🇷',
      label: 'Chuseok (Korean Thanksgiving)',
      category: 'cultural',
      ...getChuseok(currentYear, now)
    },
    {
      id: 'obon',
      emoji: '🏮',
      label: 'Obon Festival (Japan)',
      category: 'cultural',
      ...getNextOccurrence(7, 15, 'Obon Festival') // Traditional date
    },
    {
      id: 'orthodox-easter',
      emoji: '☦️',
      label: 'Orthodox Easter',
      category: 'religious',
      ...getOrthodoxEaster(currentYear, now)
    },

    // === ADDITIONAL JEWISH HOLIDAYS ===
    {
      id: 'purim',
      emoji: '🎭',
      label: 'Purim',
      category: 'religious',
      ...getPurim(currentYear, now)
    },
    {
      id: 'sukkot',
      emoji: '🌿',
      label: 'Sukkot',
      category: 'religious',
      ...getSukkot(currentYear, now)
    },
    {
      id: 'shavuot',
      emoji: '📜',
      label: 'Shavuot',
      category: 'religious',
      ...getShavuot(currentYear, now)
    },

    // === ADDITIONAL HINDU/INDIAN HOLIDAYS ===
    {
      id: 'ganesh-chaturthi',
      emoji: '🐘',
      label: 'Ganesh Chaturthi',
      category: 'religious',
      ...getGaneshChaturthi(currentYear, now)
    },
    {
      id: 'navratri',
      emoji: '🪘',
      label: 'Navratri',
      category: 'religious',
      ...getNavratri(currentYear, now)
    },
    {
      id: 'raksha-bandhan',
      emoji: '🧵',
      label: 'Raksha Bandhan',
      category: 'family',
      ...getRakshaBandhan(currentYear, now)
    },
    {
      id: 'pongal',
      emoji: '🍚',
      label: 'Pongal',
      category: 'cultural',
      ...getNextOccurrence(0, 14, 'Pongal')
    },
    {
      id: 'baisakhi',
      emoji: '🌾',
      label: 'Baisakhi',
      category: 'cultural',
      ...getNextOccurrence(3, 13, 'Baisakhi')
    },

    // === ADDITIONAL EAST ASIAN HOLIDAYS ===
    {
      id: 'dragon-boat',
      emoji: '🐉',
      label: 'Dragon Boat Festival',
      category: 'cultural',
      ...getDragonBoat(currentYear, now)
    },
    {
      id: 'qingming',
      emoji: '🪦',
      label: 'Qingming Festival',
      category: 'cultural',
      ...getNextOccurrence(3, 4, 'Qingming Festival')
    },
    {
      id: 'tanabata',
      emoji: '🎋',
      label: 'Tanabata',
      category: 'cultural',
      ...getNextOccurrence(6, 7, 'Tanabata')
    },
    {
      id: 'seollal',
      emoji: '🇰🇷',
      label: 'Seollal (Korean New Year)',
      category: 'cultural',
      ...getSeollal(currentYear, now)
    },
    {
      id: 'tet',
      emoji: '🇻🇳',
      label: 'Tết (Vietnamese New Year)',
      category: 'cultural',
      ...getTet(currentYear, now)
    },

    // === ADDITIONAL SOUTHEAST ASIAN HOLIDAYS ===
    {
      id: 'songkran',
      emoji: '💦',
      label: 'Songkran',
      category: 'cultural',
      ...getNextOccurrence(3, 13, 'Songkran')
    },
    {
      id: 'loy-krathong',
      emoji: '🏮',
      label: 'Loy Krathong',
      category: 'cultural',
      ...getLoyKrathong(currentYear, now)
    },

    // === ADDITIONAL ISLAMIC HOLIDAYS ===
    {
      id: 'mawlid',
      emoji: '🌙',
      label: 'Mawlid',
      category: 'religious',
      ...getMawlid(currentYear, now)
    },
    {
      id: 'islamic-new-year',
      emoji: '🕌',
      label: 'Islamic New Year',
      category: 'religious',
      ...getIslamicNewYear(currentYear, now)
    },

    // === ADDITIONAL LATIN AMERICAN HOLIDAYS ===
    {
      id: 'carnaval',
      emoji: '🎉',
      label: 'Carnaval',
      category: 'cultural',
      ...getCarnaval(currentYear, now)
    },
    {
      id: 'guadalupe-day',
      emoji: '🇲🇽',
      label: 'Día de la Virgen de Guadalupe',
      category: 'religious',
      ...getNextOccurrence(11, 12, 'Día de Guadalupe')
    },

    // === ADDITIONAL EUROPEAN HOLIDAYS ===
    {
      id: 'epiphany',
      emoji: '👑',
      label: 'Epiphany (Three Kings Day)',
      category: 'religious',
      ...getNextOccurrence(0, 6, 'Epiphany')
    },
    {
      id: 'guy-fawkes',
      emoji: '🎆',
      label: 'Guy Fawkes Night',
      category: 'cultural',
      ...getNextOccurrence(10, 5, 'Guy Fawkes Night')
    },
    {
      id: 'midsummer',
      emoji: '🌻',
      label: 'Midsummer',
      category: 'cultural',
      ...getMidsummer(currentYear, now)
    },
    {
      id: 'st-nicholas-day',
      emoji: '🎅',
      label: 'St. Nicholas Day',
      category: 'cultural',
      ...getNextOccurrence(11, 6, 'St. Nicholas Day')
    },

    // === ADDITIONAL INTERNATIONAL HOLIDAYS ===
    {
      id: 'intl-workers-day',
      emoji: '✊',
      label: "International Workers' Day",
      category: 'international',
      ...getNextOccurrence(4, 1, "International Workers' Day")
    },

    // === FUN & QUIRKY ===
    {
      id: 'talk-like-pirate',
      emoji: '🏴‍☠️',
      label: 'Talk Like a Pirate Day',
      category: 'fun',
      ...getNextOccurrence(8, 19, 'Talk Like a Pirate Day')
    },
    {
      id: 'world-emoji-day',
      emoji: '😀',
      label: 'World Emoji Day',
      category: 'fun',
      ...getNextOccurrence(6, 17, 'World Emoji Day')
    }
  ];
}

// ============================================================================
// CUSTOM EVENTS
// ============================================================================

/**
 * Get custom events stored in localStorage
 * Filters out past events automatically
 */
export function getCustomEvents() {
  try {
    const saved = localStorage.getItem('countdown-custom-events');
    if (saved) {
      const events = JSON.parse(saved);
      const now = dayjs();
      // Filter out past events and return valid ones
      return events.filter((e) => dayjs(e.date).isAfter(now));
    }
  } catch (e) {
    console.error('Error loading custom events:', e);
  }
  return [];
}

/**
 * Save a custom event to localStorage
 */
export function saveCustomEvent(event) {
  const customEvents = getCustomEvents();
  // Remove any existing event with same id
  const filtered = customEvents.filter((e) => e.id !== event.id);
  filtered.push(event);
  localStorage.setItem('countdown-custom-events', JSON.stringify(filtered));
}

/**
 * Delete a custom event from localStorage
 */
export function deleteCustomEvent(eventId) {
  const customEvents = getCustomEvents();
  const filtered = customEvents.filter((e) => e.id !== eventId);
  localStorage.setItem('countdown-custom-events', JSON.stringify(filtered));
}

/**
 * Get all events (presets + custom)
 */
export function getAllEvents() {
  const presets = getPresetEvents();
  const custom = getCustomEvents().map((e) => ({
    ...e,
    category: 'custom'
  }));
  // Drop any event with a missing or unparseable date so downstream
  // formatters (Intl.DateTimeFormat, etc.) can't throw "Invalid time value".
  return [...presets, ...custom].filter((e) => {
    if (!e || !e.date) return false;
    const t = new Date(e.date).getTime();
    return Number.isFinite(t);
  });
}
