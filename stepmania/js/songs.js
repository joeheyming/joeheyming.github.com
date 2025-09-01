// Helper function to proxy simfile URLs through AllOrigins
function proxySimfile(url) {
  // Use the global proxy service if available, otherwise fallback
  if (window.proxyService) {
    return window.proxyService.proxySimfile(url);
  }

  // Fallback implementation
  if (url && url.includes('.sm') && (url.startsWith('http://') || url.startsWith('https://'))) {
    return `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  }
  return url;
}

let songs = {
  Lost: {
    url: 'songs/Lost/Lost.mp3',
    background: 'songs/Lost/background.png',
    title: 'Lost',
    artist: 'Unknown',
    bpm: 120
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
