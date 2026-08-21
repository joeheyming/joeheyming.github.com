import dayjs from 'dayjs';
import duration from 'dayjs/plugin/duration';
import relativeTime from 'dayjs/plugin/relativeTime';
import n2words from 'n2words';
import './event-autocomplete.js';
import './components/index.js';
import { localeService } from './i18n/locale-service.js';
import {
  getAllEvents,
  getPresetEvents,
  getCustomEvents,
  saveCustomEvent,
  deleteCustomEvent
} from './events.js';

dayjs.extend(duration);
dayjs.extend(relativeTime);

// Initialize n2words with locale service
localeService.setN2Words(n2words);

// Handle RTL layout and UI text updates
localeService.subscribe(() => {
  document.body.classList.toggle('rtl', localeService.isRTL);
  updateUIText();
});
// Set initial RTL state
document.body.classList.toggle('rtl', localeService.isRTL);

// Helper to get translated string from centralized translation files
function t(key) {
  return localeService.str(`ui.${key}`);
}

// Update all UI text based on locale
function updateUIText() {
  // Title and subtitle
  // Title contains both main title and subtitle span
  const titleEl = document.querySelector('.title');
  const subtitleEl = document.querySelector('.subtitle');
  if (titleEl && subtitleEl) {
    // Keep the span, just update text content
    titleEl.childNodes[0].textContent = t('title') + ' ';
    subtitleEl.textContent = '— ' + t('subtitle');
  }

  // Labels
  const countingLabel = document.querySelector('.event-label');
  if (countingLabel) countingLabel.textContent = t('countingDownTo');

  // Placeholders and buttons
  const searchInput = document.querySelector('event-autocomplete');
  if (searchInput) searchInput.setAttribute('placeholder', t('searchEvents'));

  const toggleCustomBtn = document.getElementById('toggleCustomBtn');
  if (toggleCustomBtn) {
    const textSpan = toggleCustomBtn.querySelector('.toggle-text');
    if (textSpan) textSpan.textContent = t('createCustom');
  }

  const displayLabel = document.querySelector('.display-label');
  if (displayLabel) displayLabel.textContent = t('display');

  const epicBtn = document.getElementById('finalCountdownBtn');
  if (epicBtn && !epicBtn.classList.contains('playing')) {
    epicBtn.textContent = `🎸 ${t('makeItEpic')}`;
  }

  const celebrateBtn = document.getElementById('celebrateNowBtn');
  if (celebrateBtn) celebrateBtn.textContent = `🎉 ${t('celebrateNow')}`;

  const shareBtn = document.querySelector('share-button');
  if (shareBtn) shareBtn.setAttribute('label', `📤 ${t('shareCountdown')}`);

  // Update target date format
  if (currentEvent) {
    const targetDateEl = document.getElementById('targetDate');
    if (targetDateEl) {
      targetDateEl.textContent = localeService.formatDate(currentEvent.date);
    }
  }
}

// State
let currentEvent = null;
let countdownInterval = null;
let startTime = null;
let displayMode = 'standard';

// DOM Elements
const eventAutocomplete = document.getElementById('eventAutocomplete');
const customDateInput = document.getElementById('customDate');
const setCustomBtn = document.getElementById('setCustomBtn');
const eventNameEl = document.getElementById('eventName');
const yearSelector = document.getElementById('yearSelector');
const yearInput = document.getElementById('yearInput');
const yearUpBtn = document.getElementById('yearUp');
const yearDownBtn = document.getElementById('yearDown');
const progressBar = document.getElementById('progressBar');
const targetDateEl = document.getElementById('targetDate');
const celebrationEl = document.getElementById('celebration');
const celebrateNowBtn = document.getElementById('celebrateNowBtn');
const finalCountdownBtn = document.getElementById('finalCountdownBtn');
const musicSection = document.getElementById('musicSection');
const countdownPlayer = document.getElementById('countdownPlayer');
const stopMusicBtn = document.getElementById('stopMusicBtn');
const starsContainer = document.getElementById('stars');
const shootingStarsContainer = document.getElementById('shootingStars');

// Fullscreen elements
const countdownDisplay = document.getElementById('countdownDisplay');
const fullscreenBtn = document.getElementById('fullscreenBtn');

// Custom event form elements
const toggleCustomBtn = document.getElementById('toggleCustomBtn');
const customEventForm = document.getElementById('customEventForm');
const customEventNameInput = document.getElementById('customEventName');
const emojiBtn = document.getElementById('emojiBtn');
const emojiPicker = document.getElementById('emojiPicker');
const emojiGrid = document.getElementById('emojiGrid');

// Selected emoji for custom events
let selectedEmoji = '📅';

// Display mode elements
const displayModeSelector = document.getElementById('displayModeSelector');
const timerDisplayContainer = document.getElementById('timerDisplayContainer');

// Celebration video selector
const celebrationVideoSelector = document.getElementById('celebrationVideoSelector');

// All display modes follow the pattern: `${mode}-display`
const getDisplayTagName = (mode) => `${mode}-display`;

// Valid display mode IDs
const VALID_DISPLAY_MODES = [
  'standard',

  'flip',

  'analog',

  'words',
  'roman',
  'balldrop',
  'bar',
  'hourglass',
  'slot',
  'natural',
  'thermometer',
  'radar',
  'led',
  'hex',
  'percentage',
  'decimal',
  'binary',
  'total'
];

// Current active display component
let activeDisplayComponent = null;

// Emoji options for picker
const EMOJI_OPTIONS = [
  // Celebrations
  '🎉',
  '🎊',
  '🎈',
  '🎁',
  '🎂',
  '🎄',
  '🎃',
  '🎆',
  '🎇',
  '✨',
  // Hearts & Love
  '❤️',
  '💕',
  '💖',
  '💗',
  '💝',
  '💘',
  '💞',
  '🥰',
  '😍',
  '💑',
  // Nature & Seasons
  '🌸',
  '🌺',
  '🌻',
  '🌷',
  '🌹',
  '🍀',
  '🍂',
  '🍁',
  '❄️',
  '☀️',
  // Food & Drink
  '🍰',
  '🧁',
  '🍕',
  '🍔',
  '🌮',
  '🥂',
  '🍾',
  '☕',
  '🍩',
  '🍫',
  // Activities
  '⚽',
  '🏀',
  '🎮',
  '🎯',
  '🏆',
  '🎸',
  '🎵',
  '🎬',
  '📚',
  '✈️',
  // Calendar & Time
  '📅',
  '📆',
  '⏰',
  '⏳',
  '🕐',
  '📌',
  '🔔',
  '🗓️',
  '⌛',
  '🎗️',
  // People & Faces
  '👶',
  '👧',
  '👦',
  '👨',
  '👩',
  '👴',
  '👵',
  '🤰',
  '👼',
  '🎅',
  // Milestones
  '🎓',
  '💼',
  '🏠',
  '💒',
  '🚗',
  '🛫',
  '🎖️',
  '🏅',
  '🥇',
  '🌟',
  // Animals
  '🐕',
  '🐈',
  '🐰',
  '🦋',
  '🐦',
  '🦄',
  '🐉',
  '🐾',
  '🦃',
  '🐣',
  // Symbols
  '⭐',
  '🌙',
  '🌈',
  '🔥',
  '💫',
  '⚡',
  '🎭',
  '🎪',
  '🏳️‍🌈',
  '🪔'
];

// Initialize
async function init() {
  createStarfield();
  createShootingStars();
  await setupAutocomplete();
  setupEmojiPicker();
  setupEventListeners();
  loadDisplayMode();
  loadSavedEvent();
  loadCelebrationVideoPreference();
  // Wait for translations to load before updating UI text
  await localeService.ready();
  updateUIText();
}

// Load celebration video preference
function loadCelebrationVideoPreference() {
  if (celebrationVideoSelector) {
    // Wait for the component to be ready
    customElements.whenDefined('celebration-video-selector').then(() => {
      // Load saved preference
      celebrationVideoSelector.loadPreference();
      // Set initial video on celebration overlay
      celebrationEl.videoId = celebrationVideoSelector.value;
    });
  }
}

// Setup emoji picker
function setupEmojiPicker() {
  if (!emojiGrid) return;

  // Populate emoji grid
  EMOJI_OPTIONS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.className = 'emoji-option';
    btn.textContent = emoji;
    btn.type = 'button';
    btn.addEventListener('click', () => {
      selectedEmoji = emoji;
      emojiBtn.textContent = emoji;
      emojiPicker.style.display = 'none';
    });
    emojiGrid.appendChild(btn);
  });

  // Toggle emoji picker
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
  });

  // Close emoji picker when clicking outside
  document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiPicker.style.display = 'none';
    }
  });
}

// Create starfield background
function createStarfield() {
  const starCount = 150;
  for (let i = 0; i < starCount; i++) {
    const star = document.createElement('div');
    star.className = 'star';
    star.style.left = `${Math.random() * 100}%`;
    star.style.top = `${Math.random() * 100}%`;
    const size = Math.random() * 2 + 1;
    star.style.width = `${size}px`;
    star.style.height = `${size}px`;
    star.style.setProperty('--base-opacity', Math.random() * 0.5 + 0.3);
    star.style.setProperty('--duration', `${Math.random() * 3 + 2}s`);
    star.style.setProperty('--delay', `${Math.random() * 3}s`);
    starsContainer.appendChild(star);
  }
}

// Create occasional shooting stars
function createShootingStars() {
  setInterval(() => {
    if (Math.random() > 0.7) {
      const shootingStar = document.createElement('div');
      shootingStar.className = 'shooting-star';
      shootingStar.style.left = `${Math.random() * 50}%`;
      shootingStar.style.top = `${Math.random() * 30}%`;
      shootingStarsContainer.appendChild(shootingStar);
      setTimeout(() => shootingStar.remove(), 1500);
    }
  }, 2000);
}

// Setup autocomplete web component
async function setupAutocomplete() {
  // Wait for custom element to be defined
  await customElements.whenDefined('event-autocomplete');
  const events = getAllEvents();
  eventAutocomplete.setEvents(events);
}

// Refresh autocomplete with latest events (including custom)
function refreshAutocomplete() {
  const events = getAllEvents();
  eventAutocomplete.setEvents(events);
}

// Setup event listeners
function setupEventListeners() {
  // Listen for event selection from autocomplete
  eventAutocomplete.addEventListener('event-selected', (e) => {
    const event = e.detail;
    setCountdown(event.date, event.name, event.id, event.emoji);
  });

  // Listen for custom event deletion
  eventAutocomplete.addEventListener('event-delete', (e) => {
    const eventId = e.detail.id;
    deleteCustomEvent(eventId);
    refreshAutocomplete();

    // If currently viewing the deleted event, switch to nearest event
    if (currentEvent && currentEvent.id === eventId) {
      const events = getAllEvents();
      const sortedEvents = [...events].sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));
      const nearestEvent = sortedEvents[0];
      if (nearestEvent) {
        setCountdown(nearestEvent.date, nearestEvent.name, nearestEvent.id);
        eventAutocomplete.setSelectedEvent(nearestEvent);
      }
    }
  });

  // Display mode selector
  displayModeSelector.addEventListener('mode-change', (e) => {
    setDisplayMode(e.detail.mode);
  });

  // Year selector controls
  yearUpBtn.addEventListener('click', () => adjustYear(1));
  yearDownBtn.addEventListener('click', () => adjustYear(-1));

  yearInput.addEventListener('input', (e) => {
    validateAndSetYear(e.target.value);
  });

  yearInput.addEventListener('blur', () => {
    // Reset to current year if invalid on blur
    if (!yearInput.value || yearInput.classList.contains('invalid')) {
      const currentYear = dayjs(currentEvent?.date).year();
      yearInput.value = currentYear;
      yearInput.classList.remove('invalid');
    }
  });

  yearInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      yearInput.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      adjustYear(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      adjustYear(-1);
    }
  });

  // Toggle custom event form
  if (toggleCustomBtn) {
    toggleCustomBtn.addEventListener('click', () => {
      const isVisible = customEventForm.style.display !== 'none';
      customEventForm.style.display = isVisible ? 'none' : 'block';
      toggleCustomBtn.classList.toggle('active', !isVisible);
    });
  }

  // Custom event creation
  setCustomBtn.addEventListener('click', () => {
    const dateValue = customDateInput.value;
    if (dateValue) {
      const customDate = dayjs(dateValue);
      if (customDate.isValid() && customDate.isAfter(dayjs())) {
        const eventName = customEventNameInput?.value?.trim() || 'Custom Event';
        const eventId = `custom-${Date.now()}`;
        const emoji = selectedEmoji || '📅';

        // Create custom event object
        const customEvent = {
          id: eventId,
          emoji: emoji,
          label: eventName,
          name: `${eventName} ${customDate.year()}`,
          date: customDate.toISOString()
        };

        // Save to localStorage
        saveCustomEvent(customEvent);

        // Refresh autocomplete to include the new custom event
        refreshAutocomplete();

        // Set the countdown
        setCountdown(customDate.toISOString(), customEvent.name, eventId, emoji);
        window.heymingAchievements?.unlockForCurrentApp('first-action');

        // Update the autocomplete display
        eventAutocomplete.setSelectedEvent(customEvent);

        // Reset and collapse the form
        if (customEventNameInput) customEventNameInput.value = '';
        customDateInput.value = '';
        selectedEmoji = '📅';
        if (emojiBtn) emojiBtn.textContent = '📅';
        if (customEventForm) {
          customEventForm.style.display = 'none';
          toggleCustomBtn?.classList.remove('active');
        }
      } else {
        alert('Please select a future date!');
      }
    } else {
      alert('Please select a date for your custom event!');
    }
  });

  customDateInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      setCustomBtn.click();
    }
  });

  if (customEventNameInput) {
    customEventNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        setCustomBtn.click();
      }
    });
  }

  // Dismiss celebration
  celebrationEl.addEventListener('celebration-dismiss', dismissCelebration);

  // Celebrate now button
  celebrateNowBtn.addEventListener('click', () => {
    // Stop epic music if playing so celebration can play its own music
    if (countdownPlayer.isPlaying) {
      stopCountdownMusic();
    }
    showCelebration();
  });

  // Final Countdown button
  finalCountdownBtn.addEventListener('click', toggleFinalCountdown);
  stopMusicBtn.addEventListener('click', stopCountdownMusic);

  // Fullscreen toggle
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }

  // ESC key to exit fullscreen
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && countdownDisplay?.classList.contains('fullscreen')) {
      toggleFullscreen();
    }
  });

  // Celebration video selector - update celebration overlay when video changes
  if (celebrationVideoSelector) {
    celebrationVideoSelector.addEventListener('video-change', (e) => {
      celebrationEl.videoId = e.detail.videoId;
    });
  }
}

// Toggle fullscreen mode
function toggleFullscreen() {
  if (!countdownDisplay) return;

  const isFullscreen = countdownDisplay.classList.toggle('fullscreen');
  document.body.classList.toggle('fullscreen-mode', isFullscreen);
  document.body.style.overflow = isFullscreen ? 'hidden' : '';

  // Update button icon
  if (fullscreenBtn) {
    const icon = fullscreenBtn.querySelector('.fullscreen-icon');
    if (icon) {
      icon.textContent = isFullscreen ? '✕' : '⛶';
    }
  }
}

// Toggle Final Countdown music
function toggleFinalCountdown() {
  if (countdownPlayer.isPlaying) {
    stopCountdownMusic();
  } else {
    playCountdownMusic();
  }
}

// Play countdown music
function playCountdownMusic() {
  // Import the VIDEOS constant from the player
  const FINAL_COUNTDOWN_ID = '9jK-NcRmVcw';
  musicSection.style.display = 'block';
  countdownPlayer.play(FINAL_COUNTDOWN_ID, true);
  finalCountdownBtn.classList.add('playing');
  finalCountdownBtn.textContent = '🎸 Playing...';
}

// Stop countdown music
function stopCountdownMusic() {
  countdownPlayer.stop();
  musicSection.style.display = 'none';
  finalCountdownBtn.classList.remove('playing');
  finalCountdownBtn.textContent = `🎸 ${t('makeItEpic')}`;
}

// Adjust year by delta
function adjustYear(delta) {
  if (!currentEvent) return;

  const currentYear = parseInt(yearInput.value, 10);
  const newYear = currentYear + delta;
  const minYear = dayjs().year();

  if (newYear >= minYear) {
    setYearForCurrentEvent(newYear);
  }
}

// Validate and set year from input
function validateAndSetYear(value) {
  const year = parseInt(value, 10);
  const minYear = dayjs().year();

  if (isNaN(year) || year < minYear) {
    yearInput.classList.add('invalid');
    return;
  }

  yearInput.classList.remove('invalid');
  setYearForCurrentEvent(year);
}

// Set the year for the current event
function setYearForCurrentEvent(year) {
  if (!currentEvent) return;

  // Don't allow year modification for custom events
  const events = getAllEvents();
  const baseEvent = events.find((e) => e.id === currentEvent.id);
  if (!baseEvent || baseEvent.category === 'custom') return;

  // Get the base date's month and day
  const baseDate = dayjs(baseEvent.date);
  const month = baseDate.month();
  const day = baseDate.date();

  // Create new date with the selected year
  let newDate = dayjs().year(year).month(month).date(day).startOf('day');

  // Check if the date is in the past
  if (newDate.isBefore(dayjs())) {
    yearInput.classList.add('invalid');
    setTimeout(() => yearInput.classList.remove('invalid'), 300);
    return;
  }

  const newName = `${baseEvent.label} ${year}`;
  setCountdown(newDate.toISOString(), newName, currentEvent.id);
  yearInput.value = year;
  updateYearButtonStates();
}

// Update year button disabled states
function updateYearButtonStates() {
  const currentYear = parseInt(yearInput.value, 10);
  const minYear = dayjs().year();

  // Check if going down a year would result in a past date
  if (currentEvent) {
    const events = getAllEvents();
    const baseEvent = events.find((e) => e.id === currentEvent.id);
    if (baseEvent && baseEvent.category !== 'custom') {
      const baseDate = dayjs(baseEvent.date);
      const prevYearDate = dayjs()
        .year(currentYear - 1)
        .month(baseDate.month())
        .date(baseDate.date())
        .startOf('day');
      yearDownBtn.disabled = prevYearDate.isBefore(dayjs());
    } else {
      yearDownBtn.disabled = currentYear <= minYear;
    }
  } else {
    yearDownBtn.disabled = currentYear <= minYear;
  }

  yearUpBtn.disabled = false;
}

// Set display mode
function setDisplayMode(mode, updateUrl = true) {
  displayMode = mode;

  // Validate mode and get tag name
  if (!VALID_DISPLAY_MODES.includes(mode)) return;
  const tagName = getDisplayTagName(mode);

  // Remove existing display component if different
  if (activeDisplayComponent) {
    const currentTag = activeDisplayComponent.tagName.toLowerCase();
    if (currentTag === tagName) {
      // Same component, no need to recreate
    } else {
      activeDisplayComponent.remove();
      activeDisplayComponent = null;
    }
  }

  // Create new display component if needed
  if (!activeDisplayComponent) {
    activeDisplayComponent = document.createElement(tagName);
    timerDisplayContainer.appendChild(activeDisplayComponent);
  }

  // Update selector if needed
  if (displayModeSelector.value !== mode) {
    displayModeSelector.value = mode;
  }

  // Save preference
  localStorage.setItem('countdown-display-mode', mode);

  // Update URL with display mode
  if (updateUrl) {
    const url = new URL(window.location);
    url.searchParams.set('display', mode);
    window.history.replaceState({}, '', url);
  }

  // Update display immediately
  if (currentEvent) {
    updateCountdown();
  }
}

// Load display mode preference
function loadDisplayMode() {
  const validModes = VALID_DISPLAY_MODES;

  // Check URL parameter first
  const urlParams = new URLSearchParams(window.location.search);
  const urlMode = urlParams.get('display');
  if (urlMode && validModes.includes(urlMode)) {
    setDisplayMode(urlMode, false); // Don't update URL since it's already there
    return;
  }

  // Fall back to localStorage
  const saved = localStorage.getItem('countdown-display-mode');
  if (saved && validModes.includes(saved)) {
    setDisplayMode(saved);
  } else {
    // Default to standard display
    setDisplayMode('standard');
  }
}

// Dismiss celebration and reset to next event
function dismissCelebration() {
  // Clear saved event and load fresh
  localStorage.removeItem('countdown-event');
  loadSavedEvent();
}

// Load saved event from localStorage
function loadSavedEvent() {
  const events = getAllEvents();
  const saved = localStorage.getItem('countdown-event');

  if (saved) {
    try {
      const { date, name, id, emoji } = JSON.parse(saved);
      if (dayjs(date).isAfter(dayjs())) {
        const event = events.find((e) => e.id === id);
        if (event) {
          setCountdown(date, name, id);
          eventAutocomplete.setSelectedEvent(event);
        } else {
          // Custom event - create a temporary event object for the autocomplete
          const customEvent = {
            id,
            name,
            label: name,
            date,
            emoji: emoji || '📅',
            category: 'custom'
          };
          setCountdown(date, name, id);
          eventAutocomplete.setSelectedEvent(customEvent);
        }
        return;
      }
    } catch (e) {
      // Invalid saved data, ignore
    }
  }

  // Default to nearest upcoming event
  const sortedEvents = [...events].sort((a, b) => dayjs(a.date).diff(dayjs(b.date)));
  const nearestEvent = sortedEvents[0];
  setCountdown(nearestEvent.date, nearestEvent.name, nearestEvent.id);
  eventAutocomplete.setSelectedEvent(nearestEvent);
}

// Set countdown
function setCountdown(targetDate, eventName, eventId, emoji = null) {
  currentEvent = { date: targetDate, name: eventName, id: eventId, emoji };
  startTime = dayjs();

  // Save to localStorage
  localStorage.setItem('countdown-event', JSON.stringify(currentEvent));

  // Get the base label (without year) for preset events
  const events = getAllEvents();
  const baseEvent = events.find((e) => e.id === eventId);
  const year = dayjs(targetDate).year();

  // Update UI - show label without year for preset events, full name for custom
  if (baseEvent && baseEvent.category !== 'custom') {
    eventNameEl.textContent = baseEvent.label;
    yearSelector.style.display = 'flex';
    yearInput.value = year;
    yearInput.min = dayjs().year();
    updateYearButtonStates();
  } else {
    // Custom event - show label (without year) and hide year selector
    const displayName = baseEvent?.label || eventName.replace(/ \d{4}$/, '');
    eventNameEl.textContent = displayName;
    yearSelector.style.display = 'none';
  }

  targetDateEl.textContent = localeService.formatDate(targetDate);

  // Update celebration video selector with event ID for smart defaults
  if (celebrationVideoSelector) {
    celebrationVideoSelector.setAttribute('event-id', eventId);
  }

  // Hide celebration if showing
  if (celebrationEl.isVisible) {
    celebrationEl.hide();
  }

  // Clear existing interval
  if (countdownInterval) {
    clearInterval(countdownInterval);
  }

  // Start countdown
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

// Update countdown display
function updateCountdown() {
  if (!currentEvent) return;

  const now = dayjs();
  const target = dayjs(currentEvent.date);
  const diff = target.diff(now);

  if (diff <= 0) {
    // Countdown complete!
    clearInterval(countdownInterval);
    showCelebration();
    return;
  }

  const dur = dayjs.duration(diff);

  const totalDaysDecimal = dur.asDays();
  const totalDays = Math.floor(totalDaysDecimal);
  const years = Math.floor(totalDays / 365);
  const days = totalDays % 365;
  const hours = dur.hours();
  const minutes = dur.minutes();
  const seconds = dur.seconds();
  const totalSecs = Math.floor(dur.asSeconds());

  // Calculate percentage elapsed
  const totalDuration = target.diff(startTime);
  const elapsed = now.diff(startTime);
  const percentElapsed = Math.min((elapsed / totalDuration) * 100, 100);

  // Create data object for components
  const data = {
    years,
    days,
    totalDays,
    totalDaysDecimal,
    hours,
    minutes,
    seconds,
    totalSeconds: totalSecs,
    percentElapsed
  };

  // Update the active display component
  if (activeDisplayComponent && activeDisplayComponent.update) {
    activeDisplayComponent.update(data);
  }

  // Update progress bar
  progressBar.style.width = `${percentElapsed}%`;
}

// Update time unit with animation

// Show celebration
function showCelebration() {
  // Exit fullscreen if active so celebration overlay is visible
  if (countdownDisplay?.classList.contains('fullscreen')) {
    toggleFullscreen();
  }

  // Set dynamic message based on event
  if (currentEvent && currentEvent.id !== 'custom') {
    celebrationEl.message = `🎉 ${currentEvent.name}! 🎉`;
  } else if (currentEvent) {
    celebrationEl.message = `🎉 ${t('momentArrived')} 🎉`;
  }

  // Set celebration video - use selector value (which may have event defaults)
  if (celebrationVideoSelector) {
    celebrationEl.videoId = celebrationVideoSelector.value;
  }

  celebrationEl.show();
  progressBar.style.width = '100%';
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
