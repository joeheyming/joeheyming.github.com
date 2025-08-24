// Operation: SHADOWBOX - JavaScript Data Streams
// =====================================

// Global state
let missionProgress = 0;
let isStealthMode = false;
let operationStartTime = Date.now();

// Data stream generators
const dataGenerators = {
  satellite: {
    prefixes: ['SAT-', 'BIRD-', 'KEYHOLE-', 'LACROSSE-'],
    locations: ['MOSCOW', 'BEIJING', 'TEHRAN', 'PYONGYANG', 'LONDON', 'PARIS', 'TOKYO'],
    statuses: ['TRACKING', 'LOCKED', 'ACQUIRING', 'LOST SIGNAL', 'REACQUIRED'],
    coordinates: () =>
      `${(Math.random() * 180 - 90).toFixed(6)}°N ${(Math.random() * 360 - 180).toFixed(6)}°E`
  },

  network: {
    ips: ['192.168.', '10.0.', '172.16.', '203.45.', '185.23.', '94.142.', '37.187.'],
    ports: [22, 23, 25, 53, 80, 110, 143, 443, 993, 995, 3389, 5900, 8080],
    protocols: ['TCP', 'UDP', 'ICMP', 'SSH', 'HTTP', 'HTTPS', 'FTP', 'SMTP'],
    countries: ['RU', 'CN', 'IR', 'KP', 'SY', 'VE', 'CU'],
    actions: ['INTERCEPTED', 'BLOCKED', 'LOGGED', 'ANALYZED', 'QUARANTINED']
  },

  crypto: {
    algorithms: ['AES-256', 'RSA-4096', 'ECDH', 'ChaCha20', 'Blowfish', 'Twofish'],
    keyTypes: ['SYMMETRIC', 'ASYMMETRIC', 'HYBRID', 'QUANTUM'],
    statuses: ['CRACKING', 'BROKEN', 'PARTIAL', 'ANALYZING', 'COMPLETE'],
    hexChars: '0123456789ABCDEF'
  },

  tracking: {
    targets: ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF'],
    vehicles: ['SEDAN', 'SUV', 'TRUCK', 'MOTORCYCLE', 'HELICOPTER', 'AIRCRAFT'],
    statuses: ['MOBILE', 'STATIONARY', 'EVASIVE', 'LOST', 'REACQUIRED'],
    directions: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  },

  sigint: {
    frequencies: ['14.230', '21.125', '28.885', '146.94', '433.92', '1296.1'],
    modulations: ['AM', 'FM', 'SSB', 'CW', 'DIGITAL', 'ENCRYPTED'],
    sources: ['MILITARY', 'CIVILIAN', 'AMATEUR', 'COMMERCIAL', 'UNKNOWN'],
    strengths: ['WEAK', 'MODERATE', 'STRONG', 'EXCELLENT']
  }
};

// Utility functions
function randomChoice(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function randomHex(length = 8) {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += randomChoice(dataGenerators.crypto.hexChars);
  }
  return result;
}

function formatTime(date = new Date()) {
  return date.toTimeString().split(' ')[0];
}

function addLine(elementId, content, maxLines = 20) {
  const element = document.getElementById(elementId);
  const lines = element.innerHTML.split('\n').filter((line) => line.trim());
  lines.push(content);

  if (lines.length > maxLines) {
    lines.shift();
  }

  element.innerHTML = lines.join('\n');
  element.scrollTop = element.scrollHeight;
}

// Data stream generators
function generateSatelliteData() {
  const satellite =
    randomChoice(dataGenerators.satellite.prefixes) +
    (Math.floor(Math.random() * 99) + 1).toString().padStart(2, '0');
  const location = randomChoice(dataGenerators.satellite.locations);
  const status = randomChoice(dataGenerators.satellite.statuses);
  const coords = dataGenerators.satellite.coordinates();
  const elevation = Math.floor(Math.random() * 90);
  const signal = Math.floor(Math.random() * 100);

  return `[${formatTime()}] ${satellite} >> ${location} | ${status} | ${coords} | EL:${elevation}° | SIG:${signal}%`;
}

function generateNetworkData() {
  const ip =
    randomChoice(dataGenerators.network.ips) +
    Math.floor(Math.random() * 256) +
    '.' +
    Math.floor(Math.random() * 256);
  const port = randomChoice(dataGenerators.network.ports);
  const protocol = randomChoice(dataGenerators.network.protocols);
  const country = randomChoice(dataGenerators.network.countries);
  const action = randomChoice(dataGenerators.network.actions);
  const bytes = Math.floor(Math.random() * 9999) + 1;

  return `[${formatTime()}] ${ip}:${port} | ${protocol} | ${country} | ${action} | ${bytes}B`;
}

function generateCryptoData() {
  const algorithm = randomChoice(dataGenerators.crypto.algorithms);
  const keyType = randomChoice(dataGenerators.crypto.keyTypes);
  const status = randomChoice(dataGenerators.crypto.statuses);
  const key = randomHex(16);
  const progress = Math.floor(Math.random() * 100) + 1;

  return `[${formatTime()}] ${algorithm} | ${keyType} | ${status} | KEY:${key} | ${progress}%`;
}

function generateTrackingData() {
  const target = randomChoice(dataGenerators.tracking.targets);
  const vehicle = randomChoice(dataGenerators.tracking.vehicles);
  const status = randomChoice(dataGenerators.tracking.statuses);
  const direction = randomChoice(dataGenerators.tracking.directions);
  const speed = Math.floor(Math.random() * 120) + 1;
  const coords = dataGenerators.satellite.coordinates();

  return `[${formatTime()}] TGT-${target} | ${vehicle} | ${status} | ${direction} ${speed}km/h | ${coords}`;
}

function generateSigintData() {
  const freq = randomChoice(dataGenerators.sigint.frequencies);
  const mod = randomChoice(dataGenerators.sigint.modulations);
  const source = randomChoice(dataGenerators.sigint.sources);
  const strength = randomChoice(dataGenerators.sigint.strengths);
  const bearing = Math.floor(Math.random() * 360);

  return `[${formatTime()}] ${freq}MHz | ${mod} | ${source} | ${strength} | BRG:${bearing}°`;
}

function generateMissionData() {
  const objectives = [
    'INFILTRATION PROTOCOL ACTIVE',
    'ASSET EXTRACTION IN PROGRESS',
    'SURVEILLANCE TARGET ACQUIRED',
    'COMMUNICATION INTERCEPT SUCCESS',
    'DATA EXFILTRATION COMPLETE',
    'COUNTERMEASURES DEPLOYED',
    'STEALTH SYSTEMS NOMINAL',
    'BACKUP ROUTE ESTABLISHED',
    'SECURE CHANNEL ESTABLISHED',
    'FIELD OPERATIVE CHECK-IN'
  ];

  const statuses = ['SUCCESS', 'PENDING', 'IN PROGRESS', 'COMPLETE', 'STANDBY'];
  const objective = randomChoice(objectives);
  const status = randomChoice(statuses);

  return `[${formatTime()}] ${objective} | STATUS: ${status}`;
}

// Main animation loop
function updateAllStreams() {
  if (isStealthMode) return;

  // Update data streams
  addLine('satellite-feed', generateSatelliteData());
  addLine('network-feed', generateNetworkData());
  addLine('crypto-feed', generateCryptoData());
  addLine('tracking-feed', generateTrackingData());
  addLine('sigint-feed', generateSigintData());
  addLine('mission-feed', generateMissionData());

  // Update mission progress
  missionProgress += Math.random() * 0.5;
  if (missionProgress > 100) missionProgress = 100;

  const progressBar = document.getElementById('mission-progress');
  const progressText = document.getElementById('progress-text');

  progressBar.style.width = missionProgress + '%';

  if (missionProgress < 25) {
    progressText.textContent = 'Initializing surveillance protocols...';
  } else if (missionProgress < 50) {
    progressText.textContent = 'Establishing secure connections...';
  } else if (missionProgress < 75) {
    progressText.textContent = 'Gathering intelligence data...';
  } else if (missionProgress < 100) {
    progressText.textContent = 'Finalizing operation parameters...';
  } else {
    progressText.textContent = 'Mission objectives complete. Awaiting orders...';
  }
}

// Time and status updates
function updateMissionTime() {
  const now = new Date();
  const elapsed = Math.floor((now.getTime() - operationStartTime) / 1000);
  const hours = Math.floor(elapsed / 3600)
    .toString()
    .padStart(2, '0');
  const minutes = Math.floor((elapsed % 3600) / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (elapsed % 60).toString().padStart(2, '0');

  document.getElementById(
    'mission-time'
  ).textContent = `MISSION TIME: ${hours}:${minutes}:${seconds}`;
}

// Event handlers
function initializeEventHandlers() {
  document.getElementById('abort-mission').addEventListener('click', function () {
    if (
      confirm(
        '⚠️ ABORT MISSION?\n\nThis will terminate all active surveillance operations.\n\nContinue?'
      )
    ) {
      window.close();
      // If window.close doesn't work (some browsers block it), try going back
      setTimeout(() => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = '../index.html';
        }
      }, 100);
    }
  });

  document.getElementById('stealth-mode').addEventListener('click', function () {
    isStealthMode = !isStealthMode;
    const body = document.body;
    const btn = document.getElementById('stealth-mode');

    if (isStealthMode) {
      body.classList.add('stealth-mode');
      btn.textContent = '👁️ NORMAL MODE';
      btn.title = 'Exit stealth mode';
    } else {
      body.classList.remove('stealth-mode');
      btn.textContent = '👻 STEALTH MODE';
      btn.title = 'Enter stealth mode';
    }
  });

  // ESC key to abort
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.getElementById('abort-mission').click();
    }
  });
}

// Glitch effects
function addRandomGlitch() {
  const panels = document.querySelectorAll('.panel');
  const randomPanel = panels[Math.floor(Math.random() * panels.length)];

  randomPanel.classList.add('glitch');
  setTimeout(() => {
    randomPanel.classList.remove('glitch');
  }, 300);
}

// Initialize everything
function initializeShadowbox() {
  console.log('🕵️ Operation: SHADOWBOX initiated...');

  // Initialize event handlers
  initializeEventHandlers();

  // Start data streams (different intervals for realism)
  setInterval(updateAllStreams, 500 + Math.random() * 500); // 500-1000ms
  setInterval(() => addLine('satellite-feed', generateSatelliteData()), 800 + Math.random() * 400);
  setInterval(() => addLine('network-feed', generateNetworkData()), 200 + Math.random() * 300);
  setInterval(() => addLine('crypto-feed', generateCryptoData()), 1000 + Math.random() * 1000);
  setInterval(() => addLine('tracking-feed', generateTrackingData()), 600 + Math.random() * 800);
  setInterval(() => addLine('sigint-feed', generateSigintData()), 700 + Math.random() * 600);

  // Update time every second
  setInterval(updateMissionTime, 1000);
  updateMissionTime();

  // Random glitch effects
  setInterval(addRandomGlitch, 3000 + Math.random() * 7000);

  // Initial data population
  setTimeout(() => {
    for (let i = 0; i < 10; i++) {
      addLine('satellite-feed', generateSatelliteData());
      addLine('network-feed', generateNetworkData());
      addLine('crypto-feed', generateCryptoData());
      addLine('tracking-feed', generateTrackingData());
      addLine('sigint-feed', generateSigintData());
      addLine('mission-feed', generateMissionData());
    }
  }, 500);

  console.log('🎯 All systems operational. Good luck, Agent.');
}

// Start the operation when the page loads
document.addEventListener('DOMContentLoaded', initializeShadowbox);
