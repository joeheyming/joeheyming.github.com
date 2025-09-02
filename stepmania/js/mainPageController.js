// Main Page Controller
class MainPageController {
  constructor() {
    this.currentSong = null;
    this.currentDifficulty = null;
    this.parsedSongs = {};
    this.lastZeniusUrl = null; // Store the last Zenius URL for retry
    this.lastDifficulty = null; // Store the last difficulty for retry
    this.lastSongKey = null; // Store the last song key for retry
    this.init();
  }

  async init() {
    this.bindEvents();

    // Check URL parameters first
    const hasURLParams = await this.initByURL();

    // Only load default song if no URL parameters were found
    if (!hasURLParams) {
      this.loadDefaultSong();
    }
  }

  bindEvents() {
    // Set up main difficulty selector onChange callback
    const difficultySelector = document.getElementById('main-difficulty-selector');
    if (difficultySelector) {
      difficultySelector.setOnChange((index, chart) => {
        this.onDifficultySelected(index, chart);
      });

      // Show the difficulty selector initially (even if empty)
      difficultySelector.show();
    }

    // Listen for URL changes (back/forward buttons)
    window.addEventListener('popstate', () => {
      this.handleURLChange();
    });

    // Bind retry button event
    const retryBtn = document.getElementById('main-loading-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        this.handleRetry();
      });
    }

    // Bind back to browser button event
    const backBtn = document.getElementById('main-loading-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        this.handleBackToBrowser();
      });
    }
  }

  async initByURL() {
    // Decode URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const song = urlParams.get('song');
    const difficulty = urlParams.get('difficulty');
    const zeniusUrl = urlParams.get('zenius');

    // Check for Zenius I Vanisher URL first
    if (zeniusUrl) {
      return await this.loadFromZeniusURL(zeniusUrl, difficulty);
    }

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

      // Store song info for potential retry
      this.lastSongKey = foundSong;
      this.lastDifficulty = difficulty;
      this.lastZeniusUrl = null; // Clear Zenius URL since this is a regular song

      try {
        // Show main page loading overlay for URL initialization
        this.showMainLoading(songData.title, 'Loading from URL...', 5);

        this.setCurrentSong(foundSong, songData);
        this.setCurrentDifficulty(difficulty);

        this.updateMainLoadingProgress('Loading song list...', 15);
        await this.loadSongData();

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
        this.showMainLoadingError(
          'Failed to load song',
          'Unable to load song data - try again or return to browser'
        );
        return false;
      }
    } else {
      console.error(`Song not found: ${song}`);
      return false; // Song not found, should load default
    }
  }

  async loadFromZeniusURL(zeniusUrl, difficulty) {
    // Store URL and difficulty for potential retry
    this.lastZeniusUrl = zeniusUrl;
    this.lastDifficulty = difficulty;

    try {
      this.showMainLoading('from Song Library', 'Parsing song URL...', 5);

      // Parse the Zenius URL to extract simfile ID
      const simfileId = this.extractSimfileId(zeniusUrl);
      if (!simfileId) {
        throw new Error('Could not extract simfile ID from song URL');
      }

      this.updateMainLoadingProgress('Fetching simfile data...', 15);

      // Fetch the simfile data from Song Library
      const simfileData = await this.fetchZeniusSimfile(simfileId);

      this.updateMainLoadingProgress('Downloading audio file...', 30);

      // Download the audio file
      const audioUrl = simfileData.oggUrl; // Use the URL directly, no need to download

      this.updateMainLoadingProgress('Parsing simfile charts...', 50);

      // Parse the simfile
      const parser = new SimfileParser();
      const parsedData = parser.parse(simfileData.simfileText);

      // Create a temporary song object
      const tempSongKey = `zenius_${simfileId}`;
      const tempSongData = {
        title: simfileData.title,
        artist: simfileData.artist,
        url: audioUrl,
        background: simfileData.backgroundUrl || 'songs/Lost/background.png', // fallback background
        simfile: null // We already have the parsed data
      };

      // Store the parsed data
      this.parsedSongs[tempSongKey] = parsedData;

      this.updateMainLoadingProgress('Setting up song...', 70);

      // Select the song and difficulty
      this.setCurrentSong(tempSongKey, tempSongData);
      this.setCurrentDifficulty(difficulty || 0);

      // Update URL with Zenius URL
      const url = new URL(window.location);
      url.searchParams.set('zenius', zeniusUrl);
      url.searchParams.set('difficulty', difficulty || 0);
      window.history.pushState({}, '', url);

      this.updateMainLoadingProgress('Starting game...', 85);
      document.getElementById('sub-title').textContent = simfileData.title;
      await this.startSelectedSong(true, true);

      return true;
    } catch (error) {
      this.hideMainLoading();
      console.error('Error loading from Song Library URL:', error);
      this.showMainLoadingError(
        'Failed to load from Song Library',
        'Network error - try again or return to browser'
      );
      return false;
    }
  }

  extractSimfileId(zeniusUrl) {
    try {
      const url = new URL(zeniusUrl);
      const simfileId = url.searchParams.get('simfileid');
      return simfileId;
    } catch (error) {
      console.error('Error parsing Song Library URL:', error);
      return null;
    }
  }

  async fetchZeniusSimfile(simfileId) {
    try {
      // Use the global proxy service
      const zeniusPageUrl =
        'https://zenius-i-vanisher.com/v5.2/viewsimfile.php?simfileid=' + simfileId;

      const html = await window.proxyService.fetchWithProxy(zeniusPageUrl);

      // Debug: Log the HTML to see the actual structure
      console.log('Zenius page HTML (first 2000 chars):', html.substring(0, 2000));

      // Extract simfile URL from the page - try multiple patterns
      let simfileMatch = html.match(/href="([^"]*\.sm)"[^>]*>.*?SM.*?<\/a>/);
      let oggMatch = html.match(/href="([^"]*\.ogg)"[^>]*>.*?OGG.*?<\/a>/);
      let backgroundMatch = html.match(/href="([^"]*\.png)"[^>]*>.*?Background.*?<\/a>/);

      // If first pattern doesn't work, try alternative patterns
      if (!simfileMatch) {
        simfileMatch = html.match(/href="([^"]*\.sm)"/);
      }
      if (!oggMatch) {
        oggMatch = html.match(/href="([^"]*\.ogg)"/);
      }
      if (!backgroundMatch) {
        backgroundMatch = html.match(/href="([^"]*\.png)"/);
      }

      console.log('Simfile match:', simfileMatch);
      console.log('OGG match:', oggMatch);
      console.log('Background match:', backgroundMatch);

      if (!simfileMatch || !oggMatch) {
        throw new Error('Could not find simfile or audio files on Zenius page');
      }

      // Use AllOrigins proxy for all Zenius URLs
      const simfileUrl =
        'https://api.allorigins.win/raw?url=' +
        encodeURIComponent('https://zenius-i-vanisher.com' + simfileMatch[1]);
      const oggUrl = 'https://zenius-i-vanisher.com' + oggMatch[1]; // Audio files don't need proxy
      const backgroundUrl = backgroundMatch
        ? 'https://zenius-i-vanisher.com' + backgroundMatch[1] // Images don't need proxy
        : null;

      // Extract title and artist from the page
      const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
      const artistMatch = html.match(/by\s+([^<]+)/);

      const title = titleMatch ? titleMatch[1].trim() : 'Zenius Song ' + simfileId;
      const artist = artistMatch ? artistMatch[1].trim() : 'Unknown Artist';

      // Download the simfile through proxy service
      const simfileDirectUrl = 'https://zenius-i-vanisher.com' + simfileMatch[1];
      const simfileText = await window.proxyService.fetchSimfile(simfileDirectUrl);

      return {
        title,
        artist,
        simfileText,
        oggUrl,
        backgroundUrl
      };
    } catch (error) {
      console.error('Error fetching Zenius simfile:', error);
      throw new Error('Failed to fetch simfile from Zenius: ' + error.message);
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

      // Default song loaded and ready
    }
  }

  setCurrentSong(songKey, songData) {
    this.currentSong = { key: songKey, data: songData };
  }

  setCurrentDifficulty(difficulty) {
    // Default to first difficulty if null is passed
    if (difficulty === null) {
      difficulty = 0;
    }

    this.currentDifficulty = difficulty;

    // Update the main difficulty selector if we have parsed data
    if (this.currentSong && this.parsedSongs[this.currentSong.key]) {
      const difficultySelector = document.getElementById('main-difficulty-selector');
      if (difficultySelector) {
        difficultySelector.setCharts(this.parsedSongs[this.currentSong.key].charts);
        difficultySelector.selectDifficultyByIndex(difficulty);
      }
    }
  }

  // Method to handle simfile data from song picker
  handleSimfileData(songKey, parsedData) {
    this.parsedSongs[songKey] = parsedData;

    // Update the main difficulty selector with the charts
    const mainDifficultySelector = document.getElementById('main-difficulty-selector');
    if (mainDifficultySelector) {
      mainDifficultySelector.setCharts(parsedData.charts);
      console.log(
        'Main page controller received simfile data and updated difficulty selector:',
        parsedData.charts.length,
        'difficulties'
      );
    }
  }

  async loadSongData() {
    // This method can be used to load additional song data if needed
    console.log('Loading song data...');
  }

  async loadSimfile(simfileUrl) {
    const response = await fetch(simfileUrl);
    const simfileText = await response.text();

    // Parse simfile
    const parser = new SimfileParser();
    const parsedData = parser.parse(simfileText);

    // Store parsed data
    this.parsedSongs[this.currentSong.key] = parsedData;

    // Update the main difficulty selector with the charts
    const mainDifficultySelector = document.getElementById('main-difficulty-selector');
    if (mainDifficultySelector) {
      mainDifficultySelector.setCharts(parsedData.charts);
      console.log(
        'Main page controller updated difficulty selector with charts:',
        parsedData.charts.length,
        'difficulties'
      );
    } else {
      console.warn('Main difficulty selector not found in main page controller');
    }
  }

  onDifficultySelected(index, chart) {
    this.currentDifficulty = index;
    this.updateURLWithDifficulty(index);

    // Start the song with the selected difficulty
    this.startSelectedSong();
  }

  updateURLWithDifficulty(difficulty) {
    const url = new URL(window.location);

    if (this.currentSong) {
      if (this.currentSong.key.startsWith('zenius_')) {
        // Keep Zenius URL if it exists
        const zenius = url.searchParams.get('zenius');
        if (zenius) {
          url.searchParams.set('zenius', zenius);
        }
      } else {
        // Set regular song URL
        url.searchParams.set('song', this.currentSong.data.title);
      }
    }

    url.searchParams.set('difficulty', difficulty);
    window.history.pushState({}, '', url);
  }

  async startSelectedSong(loadingAlreadyShown = false, useMainLoading = false) {
    if (!this.currentSong) {
      console.log('No song selected');
      return;
    }

    // Default to first difficulty if none is selected
    if (this.currentDifficulty === null) {
      this.currentDifficulty = 0;
    }

    const parsedData = this.parsedSongs[this.currentSong.key];
    if (!parsedData) {
      console.error(`Parsed data not found for song key: ${this.currentSong.key}`);
      return;
    }

    const selectedChart = parsedData.charts[this.currentDifficulty];
    if (!selectedChart) {
      console.error(`Chart not found for difficulty: ${this.currentDifficulty}`);
      return;
    }

    try {
      // Show loading overlay only if not already shown
      if (!loadingAlreadyShown) {
        if (useMainLoading) {
          this.showMainLoading(this.currentSong.data.title, 'Loading audio and charts...', 10);
        }
      }

      // Load the song into the game (starts at 50% if from URL, 30% if standalone)
      const startProgress = loadingAlreadyShown ? 50 : 30;
      await this.loadSongIntoGame(parsedData, selectedChart, startProgress, useMainLoading);

      if (useMainLoading) {
        this.updateMainLoadingProgress('Starting game...', 90);
      }

      // Small delay to show completion
      await new Promise((resolve) => setTimeout(resolve, 500));

      if (useMainLoading) {
        this.updateMainLoadingProgress('Ready!', 100);
      }
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Don't hide the loading overlay here - let the user click the Start Playing button
      // The overlay will be hidden when the user clicks the Start Playing button
    } catch (error) {
      if (useMainLoading) {
        this.hideMainLoading();
      }
      console.error('Error starting song:', error);
    }
  }

  async loadSongIntoGame(parsedData, chart, startProgress = 30, useMainLoading = false) {
    // Update progress: Setting up game data
    if (useMainLoading) {
      this.updateMainLoadingProgress('Setting up game data...', startProgress);
    }

    // Update global song data
    window.song = {
      bpm: parsedData.bpm,
      addToMusicPosition: parsedData.offset || -0.03,
      bpmChanges: parsedData.bpmChanges || []
    };

    // Update global steps data
    window.steps = {
      noteData: chart.noteData
    };

    // Update global background changes data
    if (parsedData.bgChanges) {
      window.bgChanges = parsedData.bgChanges;
    } else {
      window.bgChanges = [];
    }

    // Update progress: Loading audio
    const audioProgress = startProgress + 20;
    if (useMainLoading) {
      this.updateMainLoadingProgress('Loading audio file...', audioProgress);
    }

    // Update audio source
    const audioEl = document.getElementById('audio_with_controls');
    audioEl.innerHTML = `<source src="${this.currentSong.data.url}" type="audio/mpeg" />`;
    audioEl.load();

    // Wait for audio to be ready (but don't autoplay due to browser restrictions)
    await new Promise((resolve) => {
      audioEl.addEventListener(
        'canplay',
        () => {
          // Show "ready to play" message
          this.showReadyToPlayMessage();

          resolve();
        },
        { once: true }
      );
    });

    // Update progress: Setting up visuals
    const visualProgress = startProgress + 40;
    if (useMainLoading) {
      this.updateMainLoadingProgress('Setting up visuals...', visualProgress);
    }

    // Update background
    const gameArea = document.getElementById('sm-micro');
    gameArea.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0.7)), url(${this.currentSong.data.background})`;

    // Update progress: Preparing charts
    const chartProgress = startProgress + 50;
    if (useMainLoading) {
      this.updateMainLoadingProgress('Preparing note charts...', chartProgress);
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
  }

  handleURLChange() {
    // Handle URL changes (back/forward buttons)
    this.initByURL();
  }

  // Main page loading functions for URL initialization
  showMainLoading(songTitle, status = 'Preparing audio and charts...', progress = 0) {
    const overlay = document.getElementById('main-loading-overlay');
    const title = document.getElementById('main-loading-title');
    const statusEl = document.getElementById('main-loading-status');
    const progressBar = document.getElementById('main-loading-progress');
    const spinner = document.getElementById('main-loading-spinner');
    const errorIcon = document.getElementById('main-loading-error-icon');
    const progressContainer = document.getElementById('main-loading-progress-container');
    const retryBtn = document.getElementById('main-loading-retry-btn');
    const backBtn = document.getElementById('main-loading-back-btn');

    // Show loading state
    title.textContent = `Loading ${songTitle}...`;
    statusEl.textContent = status;
    progressBar.style.width = `${progress}%`;

    // Show spinner, hide error icon
    spinner.classList.remove('hidden');
    errorIcon.classList.add('hidden');

    // Show progress bar, hide retry and back buttons
    progressContainer.classList.remove('hidden');
    retryBtn.classList.add('hidden');
    backBtn.classList.add('hidden');

    // Hide play button if it exists
    const playBtn = document.getElementById('main-loading-play-btn');
    if (playBtn) {
      playBtn.classList.add('hidden');
    }

    overlay.classList.remove('hidden');
  }

  showMainLoadingError(title, errorMessage) {
    const overlay = document.getElementById('main-loading-overlay');
    const titleEl = document.getElementById('main-loading-title');
    const statusEl = document.getElementById('main-loading-status');
    const spinner = document.getElementById('main-loading-spinner');
    const errorIcon = document.getElementById('main-loading-error-icon');
    const progressContainer = document.getElementById('main-loading-progress-container');
    const retryBtn = document.getElementById('main-loading-retry-btn');
    const backBtn = document.getElementById('main-loading-back-btn');

    // Show error state
    titleEl.textContent = title;
    statusEl.textContent = errorMessage;

    // Hide spinner, show error icon
    spinner.classList.add('hidden');
    errorIcon.classList.remove('hidden');

    // Hide progress bar, show retry and back buttons
    progressContainer.classList.add('hidden');
    retryBtn.classList.remove('hidden');
    backBtn.classList.remove('hidden');

    // Hide play button if it exists
    const playBtn = document.getElementById('main-loading-play-btn');
    if (playBtn) {
      playBtn.classList.add('hidden');
    }

    overlay.classList.remove('hidden');
  }

  async handleRetry() {
    if (this.lastZeniusUrl) {
      await this.loadFromZeniusURL(this.lastZeniusUrl, this.lastDifficulty);
    } else if (this.lastSongKey) {
      const songData = window.songs[this.lastSongKey];
      if (songData) {
        try {
          this.showMainLoading(songData.title, 'Retrying...', 5);
          this.setCurrentSong(this.lastSongKey, songData);
          this.setCurrentDifficulty(this.lastDifficulty);

          this.updateMainLoadingProgress('Loading song list...', 15);
          await this.loadSongData();

          if (songData.simfile) {
            this.updateMainLoadingProgress('Fetching song charts...', 25);
            await this.loadSimfile(songData.simfile);
          }

          this.updateMainLoadingProgress('Starting song...', 40);
          document.getElementById('sub-title').textContent = songData.title;
          await this.startSelectedSong(true, true);
        } catch (error) {
          this.hideMainLoading();
          console.error('Error retrying song:', error);
          this.showMainLoadingError(
            'Failed to retry song',
            'Retry failed - try again or return to browser'
          );
        }
      }
    } else {
      this.hideMainLoading();
      // Load default song if no retry URL is available
      this.loadDefaultSong();
    }
  }

  handleBackToBrowser() {
    console.log('Returning to browser interface');

    // Clear any stored retry data
    this.lastZeniusUrl = null;
    this.lastSongKey = null;
    this.lastDifficulty = null;

    // Hide the loading overlay
    this.hideMainLoading();

    // Clear URL parameters to return to main interface
    const url = new URL(window.location);
    url.searchParams.delete('zenius');
    url.searchParams.delete('song');
    url.searchParams.delete('difficulty');
    window.history.pushState({}, '', url);

    // Load default song to ensure interface is ready
    this.loadDefaultSong();
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

  showReadyToPlayMessage() {
    const overlay = document.getElementById('main-loading-overlay');
    const title = document.getElementById('main-loading-title');
    const statusEl = document.getElementById('main-loading-status');
    const spinner = document.getElementById('main-loading-spinner');
    const progressContainer = document.getElementById('main-loading-progress-container');
    const retryBtn = document.getElementById('main-loading-retry-btn');
    const backBtn = document.getElementById('main-loading-back-btn');

    if (overlay && title && statusEl) {
      // Hide spinner and progress bar
      spinner.classList.add('hidden');
      progressContainer.classList.add('hidden');

      // Show ready message
      title.textContent = 'Ready to Play!';
      statusEl.textContent = 'Click the Start Playing button to begin';

      // Show play button and back button
      backBtn.classList.remove('hidden');

      // Create or show play button
      let playBtn = document.getElementById('main-loading-play-btn');
      if (!playBtn) {
        playBtn = document.createElement('button');
        playBtn.id = 'main-loading-play-btn';
        playBtn.className =
          'mt-4 px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors duration-200';
        playBtn.textContent = '🎵 Start Playing';
        playBtn.addEventListener('click', () => {
          this.startPlaying();
        });

        // Insert play button before back button
        const buttonContainer = backBtn.parentElement;
        buttonContainer.insertBefore(playBtn, backBtn);
      } else {
        playBtn.classList.remove('hidden');
      }

      // Keep overlay visible but with ready state
      overlay.classList.remove('hidden');
    }
  }

  startPlaying() {
    // Hide the loading overlay
    this.hideMainLoading();

    // Start the audio
    const audioEl = document.getElementById('audio_with_controls');
    if (audioEl) {
      audioEl.play();
    }

    // Also trigger spacebar functionality if it exists
    if (window.startGame) {
      window.startGame();
    }
  }
}

// Initialize main page controller when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.mainPageController = new MainPageController();
});

// Make globally accessible
window.MainPageController = MainPageController;
