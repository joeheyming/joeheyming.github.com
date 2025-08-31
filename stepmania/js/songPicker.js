// Song Picker functionality
class SongPicker {
  constructor() {
    this.selectedSong = null;
    this.selectedDifficulty = null;
    this.parsedSongs = {};
    this.init();
  }

  async init() {
    this.createSongPickerUI();
    this.bindEvents();
    // Add logging to verify song data
    console.log('Available songs:', Object.keys(window.songs));

    // Check URL parameters first
    const hasURLParams = await this.initByURL();

    // Only load default song if no URL parameters were found
    if (!hasURLParams) {
      this.loadDefaultSong();
    }
  }

  async initByURL() {
    // Decode URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const song = urlParams.get('song');
    const difficulty = urlParams.get('difficulty');

    // Return false if no URL parameters
    if (!song) {
      return false;
    }

    // Check if song exists in window.songs
    const foundSong = Object.keys(window.songs).find((s) => {
      return window.songs[s].title === song;
    });

    if (foundSong) {
      const songData = window.songs[foundSong];

      try {
        // Show main page loading overlay for URL initialization
        this.showMainLoading(songData.title, 'Loading from URL...', 5);

        this.selectSong(foundSong, songData, null);
        this.selectDifficulty(difficulty, null);

        this.updateMainLoadingProgress('Loading song list...', 15);
        await this.loadSongList();

        if (songData.simfile) {
          this.updateMainLoadingProgress('Fetching song charts...', 25);
          await this.loadSimfile(songData.simfile);
        }

        this.updateMainLoadingProgress('Starting song...', 40);
        document.getElementById('sub-title').textContent = songData.title;
        await this.startSelectedSong(true, true); // Pass true to indicate loading is already shown, and true to use main loading

        return true; // Successfully loaded from URL
      } catch (error) {
        this.hideMainLoading();
        console.error('Error loading song from URL:', error);
        return false;
      }
    } else {
      console.error(`Song not found: ${song}`);
      return false; // Song not found, should load default
    }
  }

  loadDefaultSong() {
    // Load Lost as the default song, but don't auto-play
    const defaultSong = 'Lost';
    const songData = window.songs[defaultSong];

    if (songData) {
      // Update audio source but don't start playing
      const audioEl = document.getElementById('audio_with_controls');
      audioEl.innerHTML = `<source src="${songData.url}" type="audio/mpeg" />`;
      audioEl.load();

      // Update background
      const gameArea = document.getElementById('sm-micro');
      gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${songData.background})`;

      console.log('Default song loaded (Lost) - ready to play when user starts');
    }
  }

  createSongPickerUI() {
    // Create song picker modal
    const modal = document.createElement('div');
    modal.id = 'song-picker-modal';
    modal.className =
      'fixed inset-0 bg-black/80 backdrop-blur-lg z-50 flex items-center justify-center hidden';

    modal.innerHTML = `
      <div class="bg-gradient-to-br from-purple-900/90 to-blue-900/90 backdrop-blur-lg rounded-3xl p-8 max-w-4xl max-h-[90vh] overflow-y-auto border border-purple-500/30 shadow-2xl">
        <h2 class="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-neon-blue to-neon-purple mb-6 text-center">
          Select a Song
        </h2>
        
        <div id="song-list" class="space-y-4 mb-6">
          <!-- Songs will be populated here -->
        </div>
        
        <div id="difficulty-selector" class="hidden mb-6">
          <h3 class="text-xl font-bold text-white mb-4 text-center">Select Difficulty</h3>
          <div id="difficulty-buttons" class="flex flex-wrap justify-center gap-3">
            <!-- Difficulty buttons will be populated here -->
          </div>
        </div>
        
        <div class="flex justify-center gap-4">
          <button id="start-game-btn" class="hidden bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold py-3 px-8 rounded-xl transition-all duration-200 transform hover:scale-105">
            Start Game
          </button>
          <button id="close-picker-btn" class="bg-gradient-to-r from-gray-500 to-gray-600 hover:from-gray-600 hover:to-gray-700 text-white font-bold py-3 px-8 rounded-xl transition-all duration-200 transform hover:scale-105">
            Close
          </button>
        </div>
        
        <div id="loading-indicator" class="hidden text-center mt-6">
          <div class="inline-block w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
          <p id="loading-text" class="text-white mt-2">Loading song data...</p>
        </div>
        
        <!-- Full-screen loading overlay for song loading -->
        <div id="song-loading-overlay" class="hidden fixed inset-0 bg-black/90 backdrop-blur-lg z-[60] flex items-center justify-center">
          <div class="text-center">
            <div class="inline-block w-16 h-16 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-6"></div>
            <h2 id="song-loading-title" class="text-2xl font-bold text-white mb-2">Loading Song...</h2>
            <p id="song-loading-status" class="text-purple-300">Preparing audio and charts...</p>
            <div class="mt-4 w-64 bg-gray-700 rounded-full h-2">
              <div id="song-loading-progress" class="bg-purple-500 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Create a container for the song picker button
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'flex justify-between mb-4 w-full';

    // Create song picker button
    const pickerBtn = document.createElement('button');
    pickerBtn.id = 'open-song-picker';
    pickerBtn.className =
      'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold py-2 px-6 rounded-xl transition-all duration-200 transform hover:scale-105';
    pickerBtn.textContent = '🎵 Songs';

    // Create share button
    const shareBtn = document.createElement('button');
    shareBtn.id = 'share-song';
    shareBtn.className =
      'bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white font-bold py-2 px-6 rounded-xl transition-all duration-200 transform hover:scale-105';
    shareBtn.textContent = '🔗 Share';

    // Append the share button first
    buttonContainer.appendChild(shareBtn);

    // Append the song picker button
    buttonContainer.appendChild(pickerBtn);

    // Insert the container above the canvas
    const gameArea = document.getElementById('sm-micro');
    gameArea.parentNode.insertBefore(buttonContainer, gameArea);

    // Create tooltip element
    const tooltip = document.createElement('div');
    tooltip.id = 'share-tooltip';
    tooltip.className = 'hidden absolute bg-black text-white text-xs rounded py-1 px-2';
    tooltip.textContent = 'URL copied to clipboard!';
    document.body.appendChild(tooltip);
  }

  showSongLoading(songTitle, status = 'Preparing audio and charts...', progress = 0) {
    const overlay = document.getElementById('song-loading-overlay');
    const title = document.getElementById('song-loading-title');
    const statusEl = document.getElementById('song-loading-status');
    const progressBar = document.getElementById('song-loading-progress');

    title.textContent = `Loading ${songTitle}...`;
    statusEl.textContent = status;
    progressBar.style.width = `${progress}%`;
    overlay.classList.remove('hidden');
  }

  updateSongLoadingProgress(status, progress) {
    const statusEl = document.getElementById('song-loading-status');
    const progressBar = document.getElementById('song-loading-progress');

    statusEl.textContent = status;
    progressBar.style.width = `${progress}%`;
  }

  hideSongLoading() {
    document.getElementById('song-loading-overlay').classList.add('hidden');
  }

  // Main page loading functions for URL initialization
  showMainLoading(songTitle, status = 'Preparing audio and charts...', progress = 0) {
    const overlay = document.getElementById('main-loading-overlay');
    const title = document.getElementById('main-loading-title');
    const statusEl = document.getElementById('main-loading-status');
    const progressBar = document.getElementById('main-loading-progress');

    title.textContent = `Loading ${songTitle}...`;
    statusEl.textContent = status;
    progressBar.style.width = `${progress}%`;
    overlay.classList.remove('hidden');
  }

  updateMainLoadingProgress(status, progress) {
    const statusEl = document.getElementById('main-loading-status');
    const progressBar = document.getElementById('main-loading-progress');

    statusEl.textContent = status;
    progressBar.style.width = `${progress}%`;
  }

  hideMainLoading() {
    document.getElementById('main-loading-overlay').classList.add('hidden');
  }

  bindEvents() {
    // Open song picker
    document.getElementById('open-song-picker').addEventListener('click', () => {
      this.showSongPicker();
    });

    // Close song picker
    document.getElementById('close-picker-btn').addEventListener('click', () => {
      this.hideSongPicker();
    });

    // Start game
    document.getElementById('start-game-btn').addEventListener('click', () => {
      this.startSelectedSong();
    });

    // Close modal when clicking outside
    document.getElementById('song-picker-modal').addEventListener('click', (e) => {
      if (e.target.id === 'song-picker-modal') {
        this.hideSongPicker();
      }
    });

    async function copyToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          console.log('Text copied to clipboard!');
        } catch (err) {
          console.error('Failed to copy text: ', err);
        }
      } else {
        // create a temporary input element
        const input = document.createElement('input');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        // select the text
        document.execCommand('copy', true, text);
        document.body.removeChild(input);
      }
    }

    // Share song
    document.getElementById('share-song').addEventListener('click', () => {
      const searchParams = new URLSearchParams(window.location.search);
      const song = searchParams.get('title');
      const difficulty = searchParams.get('difficulty');
      const songTitle = song;
      const url =
        song && difficulty
          ? `window.location.origin}/?title=${song}&difficulty=${difficulty}`
          : window.location.href;

      copyToClipboard(url).then(() => {
        this.showTooltip(document.getElementById('share-song'));
      });
    });
  }

  async showSongPicker() {
    document.getElementById('song-picker-modal').classList.remove('hidden');
    await this.loadSongList();
  }

  hideSongPicker() {
    document.getElementById('song-picker-modal').classList.add('hidden');
    this.resetPicker();
  }

  resetPicker() {
    this.selectedSong = null;
    this.selectedDifficulty = null;
    document.getElementById('difficulty-selector').classList.add('hidden');
    document.getElementById('start-game-btn').classList.add('hidden');

    // Reset song selection
    document.querySelectorAll('.song-item').forEach((item) => {
      item.classList.remove('selected');
    });
  }

  async loadSongList() {
    const songListEl = document.getElementById('song-list');
    songListEl.innerHTML = '';

    // Load songs from the songs.js data (no need to prefetch simfiles for BPM)
    const songEntries = Object.entries(window.songs);
    songEntries.forEach(([songKey, songData]) => {
      const songItem = this.createSongItem(songKey, songData);
      songListEl.appendChild(songItem);
    });
  }

  createSongItem(songKey, songData) {
    const item = document.createElement('div');
    item.className =
      'song-item bg-black/30 backdrop-blur-sm rounded-xl p-4 border border-purple-400/30 cursor-pointer transition-all duration-200 hover:bg-black/50 hover:border-purple-400/60 hover:transform hover:scale-105';
    item.dataset.songKey = songKey;

    const emoji = songKey === 'Butterfly' ? '🦋' : '🎵';
    const hasSimfile = songData.simfile ? '(Simfile)' : '(Legacy)';

    item.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-xl font-bold text-white mb-1">${songData.title || songKey}</h3>
          <p class="text-gray-300 text-sm">by ${songData.artist || 'Unknown'}</p>
          <p class="text-gray-400 text-xs">${hasSimfile}</p>
        </div>
        <div class="text-4xl">${emoji}</div>
      </div>
    `;

    // Update the title text to the selected song title
    const titleElement = document.querySelector('#sub-title');
    if (titleElement) {
      titleElement.textContent = songData.title;
    }

    // Pass the original song data from songs.js for loading
    const originalSongData = window.songs[songKey];
    item.addEventListener('click', () => this.selectSong(songKey, originalSongData, item));

    return item;
  }

  async selectSong(songKey, songData, element) {
    // Update UI selection if element is provided
    if (element) {
      document.querySelectorAll('.song-item').forEach((item) => {
        item.classList.remove('selected');
      });
      element.classList.add('selected', 'border-neon-blue/60', 'bg-purple-500/20');
    }

    this.selectedSong = { key: songKey, data: songData };
    this.updateURLWithSongDetails(songData.title, this.selectedDifficulty);

    // Check if song has simfile
    if (songData.simfile) {
      // Show loading indicator
      document.getElementById('loading-indicator').classList.remove('hidden');
      document.getElementById('loading-text').textContent = `Loading ${songData.title} charts...`;

      try {
        // Load and parse simfile
        await this.loadSimfile(songData.simfile);

        // Show difficulty selector
        this.showDifficultySelector();
      } catch (error) {
        console.error('Failed to load simfile:', error);
      } finally {
        document.getElementById('loading-indicator').classList.add('hidden');
        document.getElementById('loading-text').textContent = 'Loading song data...';
      }
    }
  }

  updateURLWithSongDetails(title, difficulty) {
    const url = new URL(window.location);
    url.searchParams.set('song', title);
    url.searchParams.set('difficulty', difficulty);
    window.history.pushState({}, '', url);
  }

  async loadSimfile(simfileUrl) {
    const response = await fetch(simfileUrl);
    const simfileText = await response.text();

    // Parse simfile
    const parser = new SimfileParser();
    const parsedData = parser.parse(simfileText);

    // Store parsed data
    this.parsedSongs[this.selectedSong.key] = parsedData;
  }

  showDifficultySelector() {
    const parsedData = this.parsedSongs[this.selectedSong.key];
    const difficultyEl = document.getElementById('difficulty-buttons');

    difficultyEl.innerHTML = '';

    // Create difficulty buttons
    parsedData.charts.forEach((chart, index) => {
      const btn = document.createElement('button');
      btn.className =
        'difficulty-btn bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-all duration-200 transform hover:scale-105';
      btn.textContent = `${chart.difficulty} (${chart.rating})`;
      btn.dataset.chartIndex = index;

      btn.addEventListener('click', () => this.selectDifficulty(index, btn));

      difficultyEl.appendChild(btn);
    });

    document.getElementById('difficulty-selector').classList.remove('hidden');
  }

  selectDifficulty(chartIndex, element) {
    // Update UI selection if element is provided
    if (element) {
      document.querySelectorAll('.difficulty-btn').forEach((btn) => {
        btn.classList.remove('selected', 'from-green-500', 'to-green-600');
        btn.classList.add('from-blue-500', 'to-blue-600');
      });

      element.classList.add('selected', 'from-green-500', 'to-green-600');
      element.classList.remove('from-blue-500', 'to-blue-600');
    }

    this.selectedDifficulty = chartIndex;
    this.updateURLWithSongDetails(this.selectedSong.data.title, chartIndex);
    document.getElementById('start-game-btn').classList.remove('hidden');
  }

  async startSelectedSong(loadingAlreadyShown = false, useMainLoading = false) {
    if (!this.selectedSong || this.selectedDifficulty === null) {
      alert('Please select a song and difficulty first.');
      return;
    }

    const parsedData = this.parsedSongs[this.selectedSong.key];
    if (!parsedData) {
      console.error(`Parsed data not found for song key: ${this.selectedSong.key}`);
      return;
    }

    const selectedChart = parsedData.charts[this.selectedDifficulty];
    if (!selectedChart) {
      console.error(`Chart not found for difficulty: ${this.selectedDifficulty}`);
      return;
    }

    try {
      // Show loading overlay only if not already shown
      if (!loadingAlreadyShown) {
        if (useMainLoading) {
          this.showMainLoading(this.selectedSong.data.title, 'Loading audio and charts...', 10);
        } else {
          this.showSongLoading(this.selectedSong.data.title, 'Loading audio and charts...', 10);
        }
      }

      // Load the song into the game (starts at 50% if from URL, 30% if standalone)
      const startProgress = loadingAlreadyShown ? 50 : 30;
      await this.loadSongIntoGame(parsedData, selectedChart, startProgress, useMainLoading);

      if (useMainLoading) {
        this.updateMainLoadingProgress('Starting game...', 90);
      } else {
        this.updateSongLoadingProgress('Starting game...', 90);
      }

      // Small delay to show completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (useMainLoading) {
        this.updateMainLoadingProgress('Ready!', 100);
      } else {
        this.updateSongLoadingProgress('Ready!', 100);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));

      this.hideSongPicker();
      if (useMainLoading) {
        this.hideMainLoading();
      } else {
        this.hideSongLoading();
      }
    } catch (error) {
      if (useMainLoading) {
        this.hideMainLoading();
      } else {
        this.hideSongLoading();
      }
      console.error('Error starting song:', error);
    }
  }

  async loadSongIntoGame(parsedData, chart, startProgress = 30, useMainLoading = false) {
    // Update progress: Setting up game data
    if (useMainLoading) {
      this.updateMainLoadingProgress('Setting up game data...', startProgress);
    } else {
      this.updateSongLoadingProgress('Setting up game data...', startProgress);
    }

    // Update global song data
    window.song = {
      bpm: parsedData.bpm,
      addToMusicPosition: parsedData.offset || -0.03
    };

    // Update global steps data
    window.steps = {
      noteData: chart.noteData
    };

    // Update progress: Loading audio
    const audioProgress = startProgress + 20;
    if (useMainLoading) {
      this.updateMainLoadingProgress('Loading audio file...', audioProgress);
    } else {
      this.updateSongLoadingProgress('Loading audio file...', audioProgress);
    }

    // Update audio source
    const audioEl = document.getElementById('audio_with_controls');
    audioEl.innerHTML = `<source src="${this.selectedSong.data.url}" type="audio/mpeg" />`;
    audioEl.load();

    // Wait for audio to be ready and autoplay
    await new Promise((resolve) => {
      audioEl.addEventListener(
        'canplay',
        () => {
          audioEl.play();
          resolve();
        },
        { once: true }
      );
    });

    // Update progress: Setting up visuals
    const visualProgress = startProgress + 40;
    if (useMainLoading) {
      this.updateMainLoadingProgress('Setting up visuals...', visualProgress);
    } else {
      this.updateSongLoadingProgress('Setting up visuals...', visualProgress);
    }

    // Update background
    const gameArea = document.getElementById('sm-micro');
    gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${this.selectedSong.data.background})`;

    // Update progress: Preparing charts
    const chartProgress = startProgress + 50;
    if (useMainLoading) {
      this.updateMainLoadingProgress('Preparing note charts...', chartProgress);
    } else {
      this.updateSongLoadingProgress('Preparing note charts...', chartProgress);
    }

    // Reset game state
    if (window.resetGame) {
      window.resetGame();
    }

    // Update stepmania.js variables
    if (window.noteData !== undefined) {
      window.noteData = chart.noteData;
    }
    if (window.bpm !== undefined) {
      window.bpm = parsedData.bpm;
    }

    console.log('Song loaded:', parsedData.title, 'by', parsedData.artist);
  }

  showTooltip(button) {
    const tooltip = document.getElementById('share-tooltip');
    const rect = button.getBoundingClientRect();
    tooltip.style.left = `${rect.left + window.scrollX + rect.width / 2}px`;
    tooltip.style.top = `${rect.top + window.scrollY - 30}px`;
    tooltip.classList.remove('hidden');
    setTimeout(() => tooltip.classList.add('hidden'), 2000);
  }
}

// Initialize song picker when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.songPicker = new SongPicker();
});

// Make globally accessible
window.SongPicker = SongPicker;
