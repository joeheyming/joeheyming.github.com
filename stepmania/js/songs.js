const songs = {
  Butterfly: {
    url: 'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%20%28AC%29%20%28Japan%29/Butterfly/Butterfly.ogg',
    simfile: 'songs/Butterfly/Butterfly.sm',
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
    simfile: 'songs/Sandstorm/Sandstorm.sm', // Local simfile for BPM parsing
    background:
      'https://zenius-i-vanisher.com/simfiles/DDRMAX%20-Dance%20Dance%20Revolution-%20%28PS2%29%20%28North%20America%29/Sandstorm/Sandstorm-bg.png', // Remote background
    title: 'Sandstorm',
    artist: 'Darude',
    bpm: 136 // Correct BPM from simfile (was hardcoded as 148)
  },
  DREAM_A_DREAM: {
    url: 'https://zenius-i-vanisher.com/simfiles/Dance%20Dance%20Revolution%204thMIX%20%28AC%29%20%28Japan%29/DREAM%20A%20DREAM/DREAM%20A%20DREAM.ogg',
    simfile: 'songs/DREAM_A_DREAM/DREAM%20A%20DREAM.sm',
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
