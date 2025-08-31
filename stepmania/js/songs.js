// Helper function to proxy simfile URLs through AllOrigins
function proxySimfile(url) {
  // Only proxy .sm files from external sources
  if (url && url.includes('.sm') && (url.startsWith('http://') || url.startsWith('https://'))) {
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  }
  return url;
}

const songs = {
  Butterfly: {
    url: 'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%20%28AC%29%20%28Japan%29/Butterfly/Butterfly.ogg',
    simfile: proxySimfile(
      'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%20%28AC%29%20%28Japan%29/Butterfly/Butterfly.sm'
    ),
    background:
      'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%20%28AC%29%20%28Japan%29/Butterfly/Butterfly-bg.png',
    avi: 'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%20%28AC%29%20%28Japan%29/Butterfly/Butterfly.avi',
    title: 'Butterfly',
    artist: 'SMILE.dk',
    bpm: 135
  },
  Lost: {
    url: 'songs/Lost/Lost.mp3',
    simfile: null, // Uses hardcoded steps for now
    background: 'songs/Lost/background.png',
    title: 'Lost',
    artist: 'Unknown',
    bpm: 148
  },
  Sandstorm: {
    url: 'https://zenius-i-vanisher.com/simfiles/DDRMAX%20-Dance%20Dance%20Revolution-%20%28PS2%29%20%28North%20America%29/Sandstorm/Sandstorm.ogg',
    simfile: proxySimfile(
      'https://zenius-i-vanisher.com/simfiles/DDRMAX%20-Dance%20Dance%20Revolution-%20%28PS2%29%20%28North%20America%29/Sandstorm/Sandstorm.sm'
    ),
    background:
      'https://zenius-i-vanisher.com/simfiles/DDRMAX%20-Dance%20Dance%20Revolution-%20%28PS2%29%20%28North%20America%29/Sandstorm/Sandstorm-bg.png', // Remote background
    title: 'Sandstorm',
    artist: 'Darude',
    bpm: 136 // Correct BPM from simfile (was hardcoded as 148)
  },
  DREAM_A_DREAM: {
    url: 'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%204thMIX%20%28AC%29%20%28Japan%29/DREAM%20A%20DREAM/DREAM%20A%20DREAM.ogg',
    simfile: proxySimfile(
      'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%204thMIX%20%28AC%29%20%28Japan%29/DREAM%20A%20DREAM/DREAM%20A%20DREAM.sm'
    ),
    background:
      'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%204thMIX%20%28AC%29%20%28Japan%29/DREAM%20A%20DREAM/DREAM%20A%20DREAM.png',
    title: 'DREAM A DREAM',
    artist: 'CAPTAIN JACK',
    bpm: 141,
    avi: 'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%204thMIX%20%28AC%29%20%28Japan%29/DREAM%20A%20DREAM/DREAM%20A%20DREAM.avi'
  }
};

// Make globally accessible
window.songs = songs;
window.proxySimfile = proxySimfile;

// Debug function to show which simfiles are being proxied
window.showProxiedSimfiles = function () {
  console.log('Simfile proxy status:');
  Object.entries(songs).forEach(([songName, song]) => {
    if (song.simfile) {
      const isProxied = song.simfile.includes('api.allorigins.win');
      console.log(`${songName}: ${isProxied ? '✅ PROXIED' : '❌ LOCAL'} - ${song.simfile}`);
    } else {
      console.log(`${songName}: ⚪ NO SIMFILE`);
    }
  });
};

// Debug function to fetch and check simfile content
window.debugSimfileContent = async function (songName) {
  const song = songs[songName];
  if (!song || !song.simfile) {
    console.log(`No simfile for ${songName}`);
    return;
  }

  try {
    console.log(`Fetching simfile for ${songName}...`);
    console.log(`URL: ${song.simfile}`);

    const response = await fetch(song.simfile);
    const content = await response.text();

    // Extract title from simfile content
    const titleMatch = content.match(/#TITLE:([^;]+);/);
    const artistMatch = content.match(/#ARTIST:([^;]+);/);

    console.log(`Expected: ${song.title} by ${song.artist}`);
    console.log(
      `Simfile contains: ${titleMatch ? titleMatch[1] : 'NO TITLE'} by ${
        artistMatch ? artistMatch[1] : 'NO ARTIST'
      }`
    );

    // Show first few lines of simfile
    console.log('First 10 lines of simfile:');
    console.log(content.split('\n').slice(0, 10).join('\n'));
  } catch (error) {
    console.error(`Error fetching simfile for ${songName}:`, error);
  }
};
