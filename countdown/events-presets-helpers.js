import dayjs from 'dayjs';

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

export {
  getCarnaval,
  getChuseok,
  getDragonBoat,
  getDiwali,
  getEaster,
  getEidAlAdha,
  getEidAlFitr,
  getGaneshChaturthi,
  getHanukkah,
  getHoli,
  getIslamicNewYear,
  getLoyKrathong,
  getLunarNewYear,
  getMardiGras,
  getMawlid,
  getMidAutumn,
  getMidsummer,
  getNavratri,
  getOrthodoxEaster,
  getPassover,
  getPurim,
  getRakshaBandhan,
  getRoshHashanah,
  getSeollal,
  getShavuot,
  getSukkot,
  getTet,
  getThanksgiving,
  getVesak,
  getYomKippur
};
