import { adviceCategories, advice } from './advice-data.js';

// DOM elements
const adviceCard = document.getElementById('advice-card');
const adviceText = document.getElementById('advice-text');
const adviceSource = document.getElementById('advice-source');
const categoryIcon = document.querySelector('.category-icon');
const categoryName = document.querySelector('.category-name');

let currentAdvice = null;
let shownAdviceIds = new Set();

// Get a random advice that hasn't been shown yet
function getRandomAdvice() {
  // Reset if we've shown everything
  if (shownAdviceIds.size === advice.length) {
    shownAdviceIds.clear();
  }

  let randomIndex;
  do {
    randomIndex = Math.floor(Math.random() * advice.length);
  } while (shownAdviceIds.has(randomIndex));

  shownAdviceIds.add(randomIndex);
  return advice[randomIndex];
}

// Update the displayed advice
function showNewAdvice() {
  currentAdvice = getRandomAdvice();
  const category = adviceCategories[currentAdvice.category];

  // Fade out
  adviceCard.style.opacity = '0';

  setTimeout(() => {
    // Update content
    adviceText.textContent = currentAdvice.text;

    // Handle source with optional link
    if (currentAdvice.sourceUrl) {
      adviceSource.innerHTML = `— <a href="${currentAdvice.sourceUrl}" target="_blank" rel="noopener noreferrer">${currentAdvice.source}</a>`;
    } else {
      adviceSource.textContent = `— ${currentAdvice.source}`;
    }

    // Update category badge
    categoryIcon.textContent = category.icon;
    categoryName.textContent = category.name.replace(category.icon, '').trim();

    // Fade in
    adviceCard.style.opacity = '1';

    // Track in analytics
    if (window.trackEvent) {
      window.trackEvent('advice_viewed', 'Engagement', currentAdvice.category);
    }
  }, 200);
}

// Event listeners
document.body.addEventListener('click', (e) => {
  // Don't trigger if clicking on links
  if (e.target.tagName !== 'A') {
    showNewAdvice();
  }
});

// Show initial advice
showNewAdvice();
