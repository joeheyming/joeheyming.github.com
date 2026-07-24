import { adviceCategories, advice } from './advice-data.js';

// DOM elements
const adviceCard = document.getElementById('advice-card');
const adviceText = document.getElementById('advice-text');
const adviceSource = document.getElementById('advice-source');
const categoryIcon = document.querySelector('.category-icon');
const categoryName = document.querySelector('.category-name');
const postBtn = document.getElementById('postBtn');
const postStatus = document.getElementById('post-status');

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

function setPostStatus(message, isError = false) {
  if (!postStatus) return;
  if (!message) {
    postStatus.hidden = true;
    postStatus.textContent = '';
    postStatus.classList.remove('is-error');
    return;
  }
  postStatus.hidden = false;
  postStatus.textContent = message;
  postStatus.classList.toggle('is-error', isError);
}

/** Format the visible quote + attribution as clean markdown for Posts. */
function formatQuoteMarkdown(item) {
  const quoteBlock = String(item.text || '')
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');

  const attribution = item.sourceUrl ? `— [${item.source}](${item.sourceUrl})` : `— ${item.source}`;

  return `${quoteBlock}\n\n${attribution}\n\nFrom [Programming Wisdom](https://joeheyming.github.io/programming-advice/).`;
}

async function shareCurrentQuote() {
  if (!currentAdvice) {
    setPostStatus('No quote to share yet. Click for wisdom first.', true);
    return;
  }

  setPostStatus('Preparing your post…');
  if (postBtn) postBtn.disabled = true;

  try {
    const { share } = await import('/posts/share-client.js');
    await share({ text: formatQuoteMarkdown(currentAdvice) });
    if (window.trackEvent) {
      window.trackEvent('posts_share', 'Engagement', 'programming-advice');
    }
  } catch (err) {
    console.error('Failed to share quote as a post:', err);
    setPostStatus('Could not prepare the post. Please try again.', true);
    if (postBtn) postBtn.disabled = false;
  }
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

function shouldAdvanceQuote(target) {
  if (!(target instanceof Element)) return false;
  // Don't advance when interacting with chrome, links, or quote controls
  return !target.closest(
    'a, button, input, textarea, select, .quote-controls, .page-faq, feedback-button, #nav-toggle, #nav-drawer'
  );
}

// Event listeners
document.body.addEventListener('click', (e) => {
  if (shouldAdvanceQuote(e.target)) {
    showNewAdvice();
  }
});

postBtn?.addEventListener('click', (e) => {
  e.stopPropagation();
  shareCurrentQuote();
});

// Show initial advice
showNewAdvice();
