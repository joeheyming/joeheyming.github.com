// Song Picker functionality
class SongPicker {
  constructor() {
    this.selectedSong = null;
    this.selectedDifficulty = null;
    this.parsedSongs = {};
    this.init();
  }

  init() {
    this.createSongPickerUI();
    this.bindEvents();
    // Add logging to verify song data
    console.log('Available songs:', Object.keys(window.songs));
    this.initByURL();
  }

  async initByURL() {
    // Decode URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const song = urlParams.get('song');
    const difficulty = urlParams.get('difficulty');

    // Check if song exists in window.songs
    const foundSong = Object.keys(window.songs).find((s) => {
      return window.songs[s].title === song;
    });
    if (foundSong) {
      const songData = window.songs[foundSong];
      this.selectSong(foundSong, songData, null);
      this.selectDifficulty(difficulty, null);
      await this.loadSongList();
      await this.loadSimfile(songData.simfile);

      this.startSelectedSong();
    } else {
      console.error(`Song not found: ${song}`);
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
          <p class="text-white mt-2">Loading song data...</p>
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
        // alert('URL copied to clipboard!'); // Removed alert, using tooltip instead
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

    // Show loading message
    const loadingMsg = document.createElement('div');
    loadingMsg.className = 'text-center text-gray-400 py-8';
    loadingMsg.innerHTML = `
      <div class="inline-block w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p>Loading song data and parsing BPMs...</p>
    `;
    songListEl.appendChild(loadingMsg);

    // Load songs from the songs.js data and parse BPM from simfiles
    const songEntries = Object.entries(window.songs);
    for (let i = 0; i < songEntries.length; i++) {
      const [songKey, songData] = songEntries[i];

      // Try to get BPM from simfile if available
      let displayData = { ...songData };
      if (songData.simfile) {
        try {
          const bpm = await this.getSimfileBPM(songData.simfile);
          if (bpm) {
            displayData.bpm = bpm;
            displayData.bpmSource = 'simfile';
          } else {
            displayData.bpmSource = 'fallback';
          }
        } catch (error) {
          console.warn(`Failed to parse BPM for ${songKey}:`, error);
          displayData.bpmSource = 'fallback';
        }
      } else {
        displayData.bpmSource = 'hardcoded';
      }

      // Create song item and replace loading message with first item, or just append subsequent items
      const songItem = this.createSongItem(songKey, displayData);
      if (i === 0) {
        songListEl.innerHTML = ''; // Clear loading message
      }
      songListEl.appendChild(songItem);
    }
  }

  createSongItem(songKey, songData) {
    const item = document.createElement('div');
    item.className =
      'song-item bg-black/30 backdrop-blur-sm rounded-xl p-4 border border-purple-400/30 cursor-pointer transition-all duration-200 hover:bg-black/50 hover:border-purple-400/60 hover:transform hover:scale-105';
    item.dataset.songKey = songKey;

    const emoji = songKey === 'Butterfly' ? '🦋' : '🎵';
    const hasSimfile = songData.simfile ? '(Simfile)' : '(Legacy)';

    // Create BPM display with source indicator
    let bpmDisplay = `BPM: ${songData.bpm}`;
    if (songData.bpmSource === 'simfile') {
      bpmDisplay += ' ✓'; // Checkmark to show it's from simfile
    } else if (songData.bpmSource === 'fallback') {
      bpmDisplay += ' ⚠️'; // Warning to show simfile parse failed
    }

    item.innerHTML = `
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-xl font-bold text-white mb-1">${songData.title || songKey}</h3>
          <p class="text-gray-300 text-sm">by ${songData.artist || 'Unknown'}</p>
          <p class="text-gray-400 text-xs">${hasSimfile} - ${bpmDisplay}</p>
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

      try {
        // Load and parse simfile
        await this.loadSimfile(songData.simfile);

        // Show difficulty selector
        this.showDifficultySelector();
      } catch (error) {
        console.error('Failed to load simfile:', error);
        alert('Failed to load song data. Please try another song.');
      } finally {
        document.getElementById('loading-indicator').classList.add('hidden');
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

  async getSimfileBPM(simfileUrl) {
    try {
      const response = await fetch(simfileUrl);
      const simfileText = await response.text();

      // Quick parse for BPM only - we don't need full chart parsing for display
      const parser = new SimfileParser();

      // Parse only metadata and BPM sections
      const cleanContent = simfileText
        .replace(/\/\/.*$/gm, '') // Remove line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');

      // Parse metadata for DISPLAYBPM
      const metadataRegex = /#([A-Z]+):([^;]+);/g;
      const metadata = {};
      let match;
      while ((match = metadataRegex.exec(cleanContent)) !== null) {
        metadata[match[1]] = match[2].trim();
      }

      // Check for DISPLAYBPM first
      if (metadata.DISPLAYBPM) {
        const bpm = parseFloat(metadata.DISPLAYBPM);
        if (!isNaN(bpm)) return bpm;
      }

      // Fall back to first BPM change
      const bpmMatch = cleanContent.match(/#BPMS:([^;]+);/);
      if (bpmMatch) {
        const bpmString = bpmMatch[1];
        const firstBpmPair = bpmString.split(',')[0];
        const [, bpm] = firstBpmPair.split('=').map((s) => parseFloat(s.trim()));
        if (!isNaN(bpm)) return bpm;
      }

      return null; // Could not parse BPM
    } catch (error) {
      console.warn('Error fetching simfile for BPM:', error);
      return null;
    }
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

  async startSelectedSong() {
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

    // Load the song into the game
    await this.loadSongIntoGame(parsedData, selectedChart);

    this.hideSongPicker();
  }

  async loadSongIntoGame(parsedData, chart) {
    // Update global song data
    window.song = {
      bpm: parsedData.bpm,
      addToMusicPosition: parsedData.offset || -0.03
    };

    // Update global steps data
    window.steps = {
      noteData: chart.noteData
    };

    // Update audio source
    const audioEl = document.getElementById('audio_with_controls');
    audioEl.innerHTML = `<source src="${this.selectedSong.data.url}" type="audio/mpeg" />`;
    audioEl.load();

    // Autoplay the new song
    audioEl.addEventListener(
      'canplay',
      () => {
        audioEl.play();
      },
      { once: true }
    );

    // Update background
    const gameArea = document.getElementById('sm-micro');
    gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${this.selectedSong.data.background})`;

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
