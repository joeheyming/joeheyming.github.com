// Carousel State
let currentSlide = 0;
let totalVideos = 0;

// Function to extract video ID from YouTube URL
function getVideoId(url) {
  const regex = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

// Function to create a carousel slide (lazy loading - no iframe initially)
function createCarouselSlide(videoData, index) {
  const videoUrl = videoData.url;
  const videoTitle = videoData.title || `Video ${index + 1}`;
  const videoId = getVideoId(videoUrl);
  if (!videoId) {
    console.warn('Could not extract video ID from:', videoUrl);
    return null;
  }

  // Clone the template
  const template = document.getElementById('carousel-slide-template');
  const slideDiv = template.content.cloneNode(true).querySelector('.carousel-slide');

  // Set data attributes
  slideDiv.setAttribute('data-video-id', videoId);
  slideDiv.setAttribute('data-video-url', videoUrl);
  slideDiv.setAttribute('data-video-title', videoTitle);
  slideDiv.setAttribute('data-video-index', index);

  // Populate template fields
  const titleElement = slideDiv.querySelector('.video-title');
  if (titleElement) {
    titleElement.textContent = index === 0 ? '🌟 ' + videoTitle : videoTitle;
  }

  const videoIdElement = slideDiv.querySelector('.video-id');
  if (videoIdElement) {
    videoIdElement.textContent = videoId;
  }

  const videoNumberElement = slideDiv.querySelector('.video-number');
  if (videoNumberElement) {
    videoNumberElement.textContent = index + 1;
  }

  // Set unique ID for video container
  const videoContainer = slideDiv.querySelector('.video-container');
  if (videoContainer) {
    videoContainer.id = `video-container-${index}`;
  }

  // Store video data for centralized controls (no longer need individual button setup)

  return slideDiv;
}

// Function to load iframe with autoplay (for current video)
function loadVideoIframeWithAutoplay(index) {
  const slides = document.querySelectorAll('.carousel-slide');
  const slide = slides[index];
  if (!slide) return;

  const videoId = slide.getAttribute('data-video-id');
  const container = document.getElementById(`video-container-${index}`);
  const statusSpan = slide.querySelector('.video-status');

  if (!container || container.querySelector('iframe')) {
    return; // Already loaded or container not found
  }

  // Update status
  if (statusSpan) {
    statusSpan.textContent = 'LOADING';
  }

  // Create iframe with autoplay enabled
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?rel=0&showinfo=0&autoplay=1&mute=0`;
  iframe.title = `YouTube video player ${index + 1}`;
  iframe.frameBorder = '0';
  iframe.allow =
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.className = 'w-full h-full rounded-lg border-2 border-green-500';

  // Handle load event
  iframe.onload = () => {
    if (statusSpan) {
      statusSpan.textContent = 'PLAYING';
    }
  };

  // Replace placeholder with iframe
  container.innerHTML = '';
  container.appendChild(iframe);

  console.log(
    `🎪 ✨ JoeTube magic loaded video ${index + 1} (ID: ${videoId}) - Ready for the show!`
  );
}

// Function to preload iframe without autoplay (for adjacent videos)
function preloadVideoIframe(index) {
  const slides = document.querySelectorAll('.carousel-slide');
  const slide = slides[index];
  if (!slide) return;

  const videoId = slide.getAttribute('data-video-id');
  const container = document.getElementById(`video-container-${index}`);
  const statusSpan = slide.querySelector('.video-status');

  if (!container || container.querySelector('iframe')) {
    return; // Already loaded or container not found
  }

  // Update status
  if (statusSpan) {
    statusSpan.textContent = 'LOADING';
  }

  // Create iframe without autoplay for preloading
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube.com/embed/${videoId}?rel=0&showinfo=0&autoplay=0&mute=0`;
  iframe.title = `YouTube video player ${index + 1}`;
  iframe.frameBorder = '0';
  iframe.allow =
    'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
  iframe.allowFullscreen = true;
  iframe.className = 'w-full h-full rounded-lg border-2 border-green-500';

  // Handle load event
  iframe.onload = () => {
    if (statusSpan) {
      statusSpan.textContent = 'READY';
    }
  };

  // Replace placeholder with iframe
  container.innerHTML = '';
  container.appendChild(iframe);

  console.log(`🎭 Preloaded video ${index + 1} (ID: ${videoId}) - Magic is ready backstage!`);
}

// Function to unload iframe for a specific video
function unloadVideoIframe(index) {
  const container = document.getElementById(`video-container-${index}`);
  const slides = document.querySelectorAll('.carousel-slide');
  const slide = slides[index];

  if (!container || !slide) return;

  const statusSpan = slide.querySelector('.video-status');
  if (statusSpan) {
    statusSpan.textContent = 'UNLOADED';
  }

  // Replace iframe with placeholder using template
  const template = document.getElementById('video-unloaded-template');
  const placeholder = template.content.cloneNode(true);
  container.innerHTML = '';
  container.appendChild(placeholder);

  console.log(`🎪 Video ${index + 1} went backstage for intermission - saving magic energy!`);
}

// Function to create progress indicators
function createProgressIndicators() {
  const container = document.getElementById('progress-indicators');
  container.innerHTML = '';

  for (let i = 0; i < totalVideos; i++) {
    const dot = document.createElement('div');
    dot.className = `progress-dot ${i === 0 ? 'active' : ''}`;
    dot.addEventListener('click', () => goToSlide(i));
    container.appendChild(dot);
  }
}

// Function to update carousel position with lazy loading
function updateCarouselPosition() {
  const track = document.getElementById('carousel-track');
  const translateX = -currentSlide * 100;
  track.style.transform = `translateX(${translateX}%)`;

  // Update progress indicators
  const dots = document.querySelectorAll('.progress-dot');
  dots.forEach((dot, index) => {
    dot.classList.toggle('active', index === currentSlide);
  });

  // Update counters and info
  const currentIndexElement = document.getElementById('current-index');
  const totalVideosElement = document.getElementById('total-videos');

  if (currentIndexElement) currentIndexElement.textContent = currentSlide + 1;
  if (totalVideosElement) totalVideosElement.textContent = totalVideos;

  // Update main video controls with current video data
  updateMainVideoControls();

  // Load current video iframe with autoplay enabled
  loadVideoIframeWithAutoplay(currentSlide);

  // Optional: Unload other videos to save memory (keeping previous and next loaded for smooth navigation)
  for (let i = 0; i < totalVideos; i++) {
    if (i !== currentSlide && i !== currentSlide - 1 && i !== currentSlide + 1) {
      // Unload videos that are not current, previous, or next
      unloadVideoIframe(i);
    }
  }

  // Preload next and previous videos WITHOUT autoplay for smooth navigation
  if (currentSlide > 0) {
    setTimeout(() => preloadVideoIframe(currentSlide - 1), 1000);
  }
  if (currentSlide < totalVideos - 1) {
    setTimeout(() => preloadVideoIframe(currentSlide + 1), 1000);
  }
}

// Navigation functions
function goToSlide(index) {
  if (index >= 0 && index < totalVideos) {
    currentSlide = index;
    updateCarouselPosition();
  }
}

function nextSlide() {
  // Stop current video before navigation
  unloadVideoIframe(currentSlide);

  currentSlide = (currentSlide + 1) % totalVideos;
  updateCarouselPosition();
}

function prevSlide() {
  // Stop current video before navigation
  unloadVideoIframe(currentSlide);

  currentSlide = (currentSlide - 1 + totalVideos) % totalVideos;
  updateCarouselPosition();
}

function shuffleVideos() {
  // Create a shuffled array of indices
  const indices = Array.from({ length: totalVideos }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  // Go to first shuffled video
  currentSlide = indices[0];
  updateCarouselPosition();

  showJoeTubeMessage(`🎲 ✨ SURPRISE! Magically teleported to video ${currentSlide + 1}! 🎪`);
}

// Manual navigation only - videos auto-play when navigated to

// Function to update main video controls with current video data
function updateMainVideoControls() {
  const slides = document.querySelectorAll('.carousel-slide');
  const currentSlideElement = slides[currentSlide];

  if (!currentSlideElement) return;

  const videoUrl = currentSlideElement.getAttribute('data-video-url');
  const videoTitle = currentSlideElement.getAttribute('data-video-title');

  // Update YouTube link
  const youtubeLink = document.getElementById('youtube-link-main');
  if (youtubeLink && videoUrl) {
    youtubeLink.href = videoUrl;
  }

  // Store current video data for button handlers
  window.currentVideoData = { url: videoUrl, title: videoTitle };
}

// Function to set up main button event listeners
function setupMainVideoControls() {
  const copyUrlBtn = document.getElementById('copy-url-btn-main');
  const copyTitleBtn = document.getElementById('copy-title-btn-main');

  if (copyUrlBtn) {
    copyUrlBtn.addEventListener('click', () => {
      if (window.currentVideoData) {
        copyVideoUrl(window.currentVideoData.url);
      }
    });
  }

  if (copyTitleBtn) {
    copyTitleBtn.addEventListener('click', () => {
      if (window.currentVideoData) {
        copyVideoTitle(window.currentVideoData.title);
      }
    });
  }
}

// Utility functions
function copyVideoUrl(url) {
  navigator.clipboard
    .writeText(url)
    .then(() => {
      showJoeTubeMessage(`🎭 ✨ Magic link copied to your clipboard! 📋`);
    })
    .catch(() => {
      showJoeTubeMessage(`😵 Oops! The magic trick failed! Try again! 🎪`);
    });
}

function copyVideoTitle(title) {
  navigator.clipboard
    .writeText(title)
    .then(() => {
      showJoeTubeMessage(`🎨 ✨ Title magically copied to your clipboard! 📝`);
    })
    .catch(() => {
      showJoeTubeMessage(`🎭 Whoops! The title escaped! Try catching it again! 🏃‍♂️`);
    });
}

function showJoeTubeMessage(message) {
  const cursor = document.querySelector('.joe-tube-cursor');
  if (cursor) {
    const originalText = cursor.innerHTML;
    cursor.innerHTML = message;

    setTimeout(() => {
      cursor.innerHTML = originalText;
    }, 3000);
  } else {
    // Fallback: show message in console if cursor element doesn't exist
    console.log(message);
  }
}

function updateTime() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const timeElement = document.getElementById('current-time');
  if (timeElement) {
    timeElement.textContent = timeStr;
  }
}

// Function to initialize the carousel
function initializeCarousel() {
  const track = document.getElementById('carousel-track');
  const noVideosMessage = document.getElementById('no-videos');

  if (!window.videoLinks || window.videoLinks.length === 0) {
    noVideosMessage.classList.remove('hidden');
    return;
  }

  totalVideos = window.videoLinks.length;

  // Clear track
  track.innerHTML = '';

  // Create slides for each video
  window.videoLinks.forEach((videoData, index) => {
    const slide = createCarouselSlide(videoData, index);
    if (slide) {
      track.appendChild(slide);
    }
  });

  // Create progress indicators
  createProgressIndicators();

  // Start on a random video instead of the first one
  currentSlide = Math.floor(Math.random() * totalVideos);

  // Initialize position and load random video
  updateCarouselPosition();

  console.log(
    `🎪 ✨ JoeTube circus opened with ${totalVideos} amazing acts - magic loading enabled!`
  );
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  initializeCarousel();
  setupMainVideoControls();

  // Only start time updates if time element exists
  if (document.getElementById('current-time')) {
    updateTime();
    setInterval(updateTime, 1000);
  }

  // Navigation button listeners
  document.getElementById('prev-btn').addEventListener('click', prevSlide);
  document.getElementById('next-btn').addEventListener('click', nextSlide);
  document.getElementById('shuffle').addEventListener('click', shuffleVideos);

  // Keyboard navigation
  document.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        prevSlide();
        break;
      case 'ArrowRight':
        e.preventDefault();
        nextSlide();
        break;
      case 'r':
      case 'R':
        e.preventDefault();
        shuffleVideos();
        break;
    }
  });
});
