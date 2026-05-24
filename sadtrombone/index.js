// Game state
let sadCount = parseInt(localStorage.getItem('sadCount') || '0');
let totalSadness = parseInt(localStorage.getItem('totalSadness') || '0');
let isPlaying = false;

// DOM elements
const tromboneImg = document.getElementById('tromboneImg');
const tromboneAudio = document.getElementById('trombone');
const mainButton = document.getElementById('mainButton');
const sadnessSlider = document.getElementById('sadnessSlider');
const sadnessLevel = document.getElementById('sadnessLevel');
const scenarioText = document.getElementById('scenarioText');
const sadCountEl = document.getElementById('sadCount');
const totalSadnessEl = document.getElementById('totalSadness');

// Sad scenarios
const sadScenarios = [
  // General life sadness
  'Your pizza slice fell cheese-side down 🍕',
  'WiFi went out during an important video call 📶',
  'Your phone battery died at 1% 🔋',
  'The ice cream machine is broken... again 🍦',
  'You missed your bus by 3 seconds 🚌',
  'Your favorite show got cancelled 📺',
  "It's Monday morning... again 📅",
  'Your coffee got cold while you were busy ☕',
  "The elevator is out of order... you're on floor 20 🏢",
  'Your favorite restaurant closed permanently 🍽️',
  "You forgot your umbrella and it's pouring ☔",
  'Your plant died despite your best efforts 🪴',
  'The printer is jammed... again 🖨️',
  'You put on mismatched socks 🧦',
  'Your favorite mug broke 💔',
  'The weekend is over already 😢',
  'You locked yourself out of the house 🔑',
  'Your headphones got tangled in knots 🎧',
  'The last cookie was taken from the jar 🍪',
  'You stepped in a puddle with clean socks 💧',

  // Engineering & Developer sadness
  'Your code worked on your machine but not in production 💻',
  'The build broke right before the demo 🏗️',
  'You spent 6 hours debugging... it was a missing semicolon 🔍',
  'The client wants to "make the logo bigger" 🎨',
  'Your 3-hour meeting could have been an email 📧',
  'The requirements changed again... for the 5th time 📋',
  'Legacy code has zero documentation and zero tests 📚',
  'You accidentally pushed to master instead of your branch 🚫',
  'The API you depend on is deprecated effective immediately 🔌',
  'Your laptop died and you forgot to commit your changes 💾',
  'Stack Overflow is down when you need it most 🆘',
  'The deployment failed at 5 PM on Friday 🕔',
  'Your code review has been pending for 2 weeks ⏳',
  'The merge conflict has merge conflicts 🔀',
  'Your Docker container works everywhere except production 🐳',
  'The database migration took down the entire site 🗄️',
  "You realized you've been using the wrong algorithm all along 🧮",
  'The bug only happens on Internet Explorer 🌐',
  'Your AWS bill is 10x higher than expected 💸',
  'The vendor SDK documentation is completely wrong 📖',
  'Your feature got cut from the sprint... again ✂️',
  'The intern accidentally deleted the entire database 🗑️',
  'Your pull request conflicts with 47 other files 📄',
  'The "quick fix" turned into a 3-week refactor 🔧',
  'Kubernetes is having an existential crisis again ☸️',
  'Your localhost works but staging returns 500 errors 🚨',
  'The client wants it to work on IE6 🦕',
  "Your SSH key expired and you're locked out of everything 🔐",
  'The third-party service is down during your live demo 📡',
  "Your perfect code got replaced by a one-liner you didn't think of 😤"
];

// Sadness level descriptions
const sadnessLevels = [
  'Barely Bothered',
  'Slightly Sad',
  'Mildly Disappointed',
  'Moderately Miffed',
  'Notably Bummed',
  'Considerably Crushed',
  'Severely Sorrowful',
  'Extremely Dejected',
  'Utterly Devastated',
  'Completely Catastrophic'
];

// Initialize
function init() {
  updateStats();
  createParticles();
  updateSadnessLevel();

  // Event listeners
  mainButton.addEventListener('click', expressSadness);
  sadnessSlider.addEventListener('input', updateSadnessLevel);

  // Keyboard controls
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      expressSadness();
    }
  });

  // Audio ended event
  tromboneAudio.addEventListener('ended', () => {
    stopTrombone();
  });

  // Configure share button with custom text generator
  const shareBtn = document.getElementById('share-sadness-btn');
  if (shareBtn) {
    shareBtn.textGenerator = () => {
      const sadnessValue = parseInt(sadnessSlider.value);
      const currentScenario = scenarioText.textContent;
      return `I just expressed ${
        sadnessLevels[sadnessValue - 1]
      } sadness about: "${currentScenario}" on the Sad Trombone Symphony! 🎺💔 Total sadness count: ${sadCount}`;
    };
  }
}

function expressSadness() {
  if (isPlaying) {
    stopTrombone();
  } else {
    playTrombone();
  }
}

function playTrombone() {
  isPlaying = true;
  const sadnessValue = parseInt(sadnessSlider.value);

  // Update stats
  sadCount++;
  totalSadness += sadnessValue;
  updateStats();
  saveStats();

  // Visual effects
  tromboneImg.classList.remove('hidden');
  tromboneImg.classList.add('playing', 'fade-in');
  document.body.classList.add('shake');

  // Launch tears based on sadness level
  launchTears(sadnessValue);

  // Get a new random scenario every time sadness is expressed
  randomScenario();

  // Button state
  mainButton.textContent = '🛑 Stop the Sadness';
  mainButton.style.background = 'var(--success)';

  // Play audio with volume based on sadness level
  tromboneAudio.volume = Math.min(sadnessValue / 10, 1);
  tromboneAudio.play().catch((e) => console.log('Audio play failed:', e));

  // Remove shake effect
  setTimeout(() => {
    document.body.classList.remove('shake');
  }, 500);
}

function stopTrombone() {
  isPlaying = false;

  // Visual effects
  tromboneImg.classList.add('hidden');
  tromboneImg.classList.remove('playing');

  // Button state
  mainButton.textContent = '💔 Express Sadness 💔';
  mainButton.style.background = 'var(--danger)';

  // Stop audio
  tromboneAudio.pause();
  tromboneAudio.currentTime = 0;
}

function updateSadnessLevel() {
  const value = parseInt(sadnessSlider.value);
  sadnessLevel.textContent = sadnessLevels[value - 1];
}

function updateStats() {
  sadCountEl.textContent = sadCount;
  totalSadnessEl.textContent = totalSadness;
}

function saveStats() {
  localStorage.setItem('sadCount', sadCount.toString());
  localStorage.setItem('totalSadness', totalSadness.toString());
}

function resetStats() {
  if (confirm('Are you sure you want to reset your sadness stats? This cannot be undone!')) {
    sadCount = 0;
    totalSadness = 0;
    updateStats();
    saveStats();
    randomScenario();
  }
}

function randomScenario() {
  const randomIndex = Math.floor(Math.random() * sadScenarios.length);
  scenarioText.textContent = sadScenarios[randomIndex];
  scenarioText.parentElement.classList.add('fade-in');
  setTimeout(() => {
    scenarioText.parentElement.classList.remove('fade-in');
  }, 500);
}

function createParticles() {
  const particlesContainer = document.getElementById('particles');
  const particleCount = 15;

  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';

    // Random size and position
    const size = Math.random() * 6 + 4;
    particle.style.width = size + 'px';
    particle.style.height = size + 'px';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.top = Math.random() * 100 + '%';
    particle.style.animationDelay = Math.random() * 6 + 's';
    particle.style.animationDuration = Math.random() * 3 + 4 + 's';

    particlesContainer.appendChild(particle);
  }
}

function launchTears(intensity) {
  const tearsContainer = document.getElementById('tearsContainer');
  const tearCount = Math.min(intensity * 20, 200); // More sadness = more tears

  for (let i = 0; i < tearCount; i++) {
    setTimeout(() => {
      createTearPiece(tearsContainer);
    }, i * 25); // Stagger the tear creation for rain effect
  }
}

function createTearPiece(container) {
  const tear = document.createElement('div');

  // Different types of sad falling elements
  const sadEmojis = ['😢', '😭', '💧', '😔', '😞', '😿', '☔', '🌧️'];
  const tearTypes = [
    'teardrop',
    'big-teardrop',
    'rain-streak',
    'emoji',
    'small-emoji',
    'cloud-tear'
  ];

  const randomType = tearTypes[Math.floor(Math.random() * tearTypes.length)];

  if (randomType === 'emoji' || randomType === 'small-emoji') {
    // Create sad emoji
    const randomEmoji = sadEmojis[Math.floor(Math.random() * sadEmojis.length)];
    tear.textContent = randomEmoji;
    tear.className = `confetti ${randomType}`;
  } else {
    // Create teardrop or rain element
    const colorNum = Math.floor(Math.random() * 5) + 1;
    tear.className = `confetti ${randomType} tear-${colorNum}`;
  }

  // Random position across screen width
  tear.style.left = Math.random() * 100 + '%';

  // Ensure it starts above the viewport
  tear.style.top = '-50px';

  // Slight random delay for natural rain effect
  tear.style.animationDelay = Math.random() * 0.3 + 's';

  // Variable fall speed for realism
  const fallDuration = Math.random() * 1.5 + 2.5; // 2.5 to 4 seconds
  tear.style.animationDuration = fallDuration + 's';

  // Add slight horizontal drift for wind effect
  const drift = (Math.random() - 0.5) * 20; // -10px to +10px
  tear.style.setProperty('--drift', drift + 'px');

  // Add slight rotation for natural movement
  const rotation = (Math.random() - 0.5) * 20; // -10deg to +10deg
  tear.style.setProperty('--rotation', rotation + 'deg');

  container.appendChild(tear);

  // Remove tear after animation
  setTimeout(() => {
    if (tear.parentNode) {
      tear.parentNode.removeChild(tear);
    }
  }, (fallDuration + 0.5) * 1000);
}

// Initialize when page loads
window.addEventListener('load', init);

// Random scenario on page load
setTimeout(randomScenario, 1000);
