import dayjs from 'dayjs';
import {
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
} from './events-presets-helpers.js';

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
