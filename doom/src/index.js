// Module is available as a global variable from doom.js
const Doom = Module;

const consoleLog = console.log;
console.log = () => {};
console.error = () => {};
console.info = () => {};

const doomMusic = `b2e05b4e8dff8d76f8f4c3a724e7dbd365390536 = /music/d_inter.ogg
0c0acce45130bab935d2f1e85664b29a3c724fcd = /music/d_intro.ogg
fca4086939a68ae4ed84c96e6bf0bd5621ddbe3d = /music/d_victor.ogg
5971e5e20554f47ca06568832abd37db5e5a94f7 = /music/d_intro.ogg
99767e32769229897f7722848fb1ceccc2314d09 = /music/d_e1m1.ogg
b5e7dfb4efe9e688bf2ae6163c9d734e89e643b1 = /music/d_e1m2.ogg
fda8fa73e4d30a6b961cd46fe6e013395e87a682 = /music/d_e1m3.ogg
3805f9bf3f1702f7e7f5483a609d7d3c4daa2323 = /music/d_e1m4.ogg
f546ed823b234fe391653029159de7b67a15dbd4 = /music/d_e1m5.ogg
4450811b5a6748cfd83e3ea241222f6b88be33f9 = /music/d_e1m6.ogg
73edb50d96b0ac03be34a6134b33e4c8f00fc486 = /music/d_e1m7.ogg
47d711a6fd32f5047879975027e5b152b52aa1dc = /music/d_e1m8.ogg
62c631c2fdaa5ecd9a8d8f369917244f27128810 = /music/d_e1m9.ogg
7702a6449585428e718558d8ecc387ef1a21d948 = /music/d_e2m1.ogg
1cb1810989cbfae2b29ba8d6d0f8f1175de45f03 = /music/d_e2m2.ogg
7d740f3c881a22945e472c68754fd9485cb04750 = /music/d_e2m4.ogg
ae9c3dc2f9aeea002327a5204d080ea82505a310 = /music/d_e2m6.ogg
b26aad3caa420e9a2c76586cd59433b092fcba1c = /music/d_e2m7.ogg
90f06251a2a90bfaefd47a526b28264ea64f4f83 = /music/d_e2m8.ogg
b2fb439f23c08c8e2577d262e5ed910a6a62c735 = /music/d_e3m1.ogg
b6c07bb249526b864208922d2d9ab655f4aade78 = /music/d_e3m2.ogg
ce3587ee503ffe707b2d8b690396114fdae6b411 = /music/d_e3m3.ogg
d746ea2aa16b3237422cb18ec66f26e12cb08d40 = /music/d_e3m8.ogg
3da3b1335560a92912e6d1eb542ba8c65dcb1d2c = /d_bunny.ogg
4a5badc4f10a7d4ed021e5d1cc470c1da728a741 = /d_inter.ogg
36b14bf165b3fdd3958ee83e4929063f051ada2f = /d_e1m7.ogg
e77c3d42f2ea87f046074bd4e3ff1e535da1c653 = /d_e1m6.ogg
3d85ec9c10b5ea46556899cfba701a556e27ca34 = /d_e2m7.ogg
4d42e2ce1c1ff192500e7a08e72c85fe59741487 = /d_e1m9.ogg
a05e45f67e1b64733fe31867ba759be0b9327a74 = /d_e2m1.ogg
8024ae1616ddd97ce33079276458479c9e15ad5f = /d_e1m4.ogg
3af8d79ddba49edaf9eba5e04d258d71b19b3782 = /d_victor.ogg
a55352c96c025b6bd08a6d9112bda72504be89ff = /d_inter.ogg
76d1fc25ab7b1b4a58d6e6203b0bb0c50689ee71 = /d_e1m8.ogg
497777f0863eca7cea8763316fe6d56d599b5f84 = /d_e1m2.ogg
0228fd87f8762f112fb60c601a7b43ba3b85f97e = /d_e2m2.ogg
db94e8e1d7c02092eab553859b45b00dcaed7471 = /d_e1m6.ogg
5a8d7a307eebc952795c4438efacbb6d0d8e40ee = /d_e2m7.ogg
1a36b692bf26d94a72ccf914087f3861b6baabff = /d_e1m7.ogg
37c6cefa351b06995152558af4b866d581da945f = /d_e1m5.ogg
36b97b87fe98348d44b6c2fdf76d49f8b123d277 = /d_e2m6.ogg`;

const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';

const loadDoom = async (canvas, consoleLog) => {
  console.log(location.hostname);
  consoleLog('Loading doom.wad...');

  const wadUrl = isDev ? './data/doom.wad' : 'https://console-doom.netlify.app/data/doom.wad';

  const res = await fetch(wadUrl);
  const content = await res.arrayBuffer();

  const doomFile = {
    filename: 'doom.wad',
    data: content,
    url: 'doom.wad',
    type: 'IWAD'
  };

  consoleLog('Loading doom.wasm...');
  consoleLog('🖱️ Trying PrBoom+ mouse arguments: -mouse 1 -novert 0 -mousesens 5');
  const audioContext = new AudioContext();
  const doom = await Doom({
    preRun: [
      ({ FS }) => {
        // add music
        const enc = new TextEncoder();
        FS.writeFile('./doom1-music.cfg', enc.encode(doomMusic));
        window.SDL2 = {};
        window.SDL2.audioContext = audioContext;

        // add game file
        FS.writeFile(doomFile.url, new Uint8Array(doomFile.data));
      }
    ],
    arguments: `-iwad ${doomFile.filename} -mouse 1 -novert 0 -mousesens 5`,
    canvas: canvas
  });

  return {
    pause: () => {
      doom.pauseMainLoop();
      if (audioContext) {
        audioContext.suspend();
      }
    },
    resume: () => {
      doom.resumeMainLoop();
      if (audioContext) {
        audioContext.resume();
      }
    }
  };
};

const wait = (time) => new Promise((r) => setTimeout(r, time));
const onFocus = () =>
  new Promise((resolve) => window.addEventListener('focus', resolve, { once: true }));

const logImage = (imageUrl) => {
  consoleLog(
    '%c ',
    `padding: 1200px 560px 0 0; background: bottom no-repeat url(${imageUrl}); background-size: 100%;`
  );
};

let isPaused = false;
const renderToConsole = async (canvas) => {
  let lastFrame;
  let wasPaused = false;
  let i = 0;
  while (true) {
    if (isPaused) {
      wasPaused = true;
      await wait(100);
      continue;
    }
    try {
      let frameUrl = canvas.toDataURL();
      const isValidFrame = frameUrl && frameUrl.length > 100;
      if (isValidFrame && (frameUrl !== lastFrame || wasPaused)) {
        if (wasPaused || i++ % 200 === 0) {
          console.clear();
        }
        lastFrame = frameUrl;
        logImage(frameUrl);
      }
    } catch (e) {}
    wasPaused = false;
    await wait(30);
  }
};

const main = async () => {
  // we need to make sure the user has clicked on the main window
  // or chrome won't allow us to play audio
  // also the controls will not work correctly
  if (!document.hasFocus()) {
    consoleLog('click on the main window');
    await onFocus();
  }

  const canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  canvas.width = 320;
  canvas.height = 320;

  // Style the canvas for display in the browser
  canvas.style.display = 'block';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.margin = '0 auto';
  canvas.style.border = '2px solid #333';
  canvas.style.backgroundColor = '#000';
  canvas.style.width = '640px'; // Scale up 2x for better visibility
  canvas.style.height = '640px';
  canvas.style.borderRadius = '8px';
  canvas.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.5)';

  // Insert canvas into the designated game container instead of body
  const gameContainer = document.getElementById('game-container');
  if (gameContainer) {
    // Hide loading indicator
    const loadingIndicator = document.getElementById('loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.style.display = 'none';
    }
    gameContainer.appendChild(canvas);
  } else {
    // Fallback to body if container not found
    document.body.appendChild(canvas);
  }

  const doom = await loadDoom(canvas, consoleLog);

  // Display game info in console instead of rendering frames
  consoleLog('🎮 DOOM is now running in the browser window!');
  consoleLog('🔧 Applied PrBoom+ mouse arguments - mouse should now work!');
  consoleLog('Controls:');
  consoleLog('- WASD: Move/Strafe (confirmed working)');
  consoleLog('- Q: Fire weapon (confirmed working)');
  consoleLog('- Mouse: Look around (testing with -mouse 1 argument)');
  consoleLog('- E: Open doors/Use');
  consoleLog('- Arrow keys: Turn (fallback - should be replaced by mouse)');

  // Comment out console rendering since we're showing in browser
  // renderToConsole(canvas);

  if (!document.hasFocus()) {
    doom.pause();
    isPaused = true;
    consoleLog('click on the main window');
  }

  window.addEventListener('blur', () => {
    if (isPaused) return;
    doom.pause();
    isPaused = true;
    consoleLog('PAUSED');
    consoleLog('Click on the main window to resume');
  });

  window.addEventListener('focus', () => {
    if (!isPaused) return;
    doom.resume();
    isPaused = false;
  });
};

main();
