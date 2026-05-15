#!/usr/bin/env node

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Configuration
const BASE_URL = 'http://localhost:8000';
const VIEWPORT = { width: 1200, height: 630 };

// Command line arguments
const FORCE_REGENERATE = process.argv.includes('--force') || process.argv.includes('-f');

// Pages to screenshot with their output paths
const PAGES = [
  {
    url: `${BASE_URL}/`,
    output: 'assets/joe-heyming-og-image.png',
    title: 'Joe Heyming Portfolio'
  },
  {
    url: `${BASE_URL}/nes/`,
    output: 'nes/images/nes-emulator-preview.png',
    title: 'NES Emulator'
  },
  {
    url: `${BASE_URL}/calculator/`,
    output: 'calculator/calculator-preview.png',
    title: 'Calculator'
  },
  {
    url: `${BASE_URL}/doom/`,
    output: 'doom/doom-preview.png',
    title: 'Browser DOOM'
  },
  {
    url: `${BASE_URL}/stepmania/`,
    output: 'stepmania/stepmania-preview.png',
    title: 'StepMania'
  },
  {
    url: `${BASE_URL}/accordion-hero/`,
    output: 'accordion-hero/accordion-hero-preview.png',
    title: 'Accordion Hero'
  },
  {
    url: `${BASE_URL}/terminal/`,
    output: 'terminal/terminal-preview.png',
    title: 'Web Terminal'
  },
  {
    url: `${BASE_URL}/notepad/`,
    output: 'notepad/notepad-preview.png',
    title: 'Notepad'
  },
  {
    url: `${BASE_URL}/todo/`,
    output: 'todo/todo-preview.png',
    title: 'Todo'
  },
  {
    url: `${BASE_URL}/sadtrombone/`,
    output: 'sadtrombone/sadtrombone-preview.png',
    title: 'Sad Trombone'
  },
  {
    url: `${BASE_URL}/wordle-finder/`,
    output: 'wordle-finder/thumbnail.png',
    title: 'Wordle Finder'
  },
  {
    url: `${BASE_URL}/awesome/`,
    output: 'awesome/awesome-preview.png',
    title: 'Everything is Awesome'
  },
  {
    url: `${BASE_URL}/youtube/`,
    output: 'youtube/joetube-preview.png',
    title: 'JoeTube'
  },
  {
    url: `${BASE_URL}/badapple/`,
    output: 'badapple/badapple-preview.png',
    title: 'Bad Apple ASCII'
  },
  {
    url: `${BASE_URL}/sayit/`,
    output: 'sayit/sayit-preview.png',
    title: 'Say It OCR'
  },
  {
    url: `${BASE_URL}/farm/`,
    output: 'farm/farm-preview.png',
    title: 'AMP Farm'
  },
  {
    url: `${BASE_URL}/pbs/`,
    output: 'pbs/pbs-preview.png',
    title: 'Pirate Button Soundboard'
  },
  {
    url: `${BASE_URL}/sayhello/`,
    output: 'sayhello/sayhello-preview.png',
    title: 'Say Hello TTS'
  },
  {
    url: `${BASE_URL}/shadowbox/`,
    output: 'shadowbox/shadowbox-preview.png',
    title: 'Operation SHADOWBOX'
  },
  {
    url: `${BASE_URL}/periodic-speller/`,
    output: 'periodic-speller/periodic-speller-preview.png',
    title: 'Periodic Table Speller'
  },
  {
    url: `${BASE_URL}/os/`,
    output: 'os/os-preview.png',
    title: 'Heyming OS'
  },
  {
    url: `${BASE_URL}/model-viewer/`,
    output: 'model-viewer/model-viewer-preview.png',
    title: '3D Viewer'
  },
  {
    url: `${BASE_URL}/play/`,
    output: 'play/play-preview.png',
    title: 'Play - Browser Music Studio'
  },
  {
    url: `${BASE_URL}/play/piano/`,
    output: 'play/piano/piano-preview.png',
    title: 'Browser Piano'
  },
  {
    url: `${BASE_URL}/play/accordion/`,
    output: 'play/accordion/accordion-preview.png',
    title: 'Browser Accordion'
  },
  {
    url: `${BASE_URL}/play/drums/`,
    output: 'play/drums/drums-preview.png',
    title: 'Browser Drums'
  },
  {
    url: `${BASE_URL}/play/strings/`,
    output: 'play/strings/strings-preview.png',
    title: 'Browser Strings'
  },
  {
    url: `${BASE_URL}/play/synth/`,
    output: 'play/synth/synth-preview.png',
    title: 'Browser Synth'
  },
  {
    url: `${BASE_URL}/play/metronome/`,
    output: 'play/metronome/metronome-preview.png',
    title: 'Browser Metronome'
  },
  {
    url: `${BASE_URL}/play/harp/`,
    output: 'play/harp/harp-preview.png',
    title: 'Browser Harp'
  },
  {
    url: `${BASE_URL}/play/steeldrum/`,
    output: 'play/steeldrum/steeldrum-preview.png',
    title: 'Browser Steel Drum'
  },
  {
    url: `${BASE_URL}/play/mallets/`,
    output: 'play/mallets/mallets-preview.png',
    title: 'Browser Mallet Keyboard'
  },
  {
    url: `${BASE_URL}/play/theremin/`,
    output: 'play/theremin/theremin-preview.png',
    title: 'Browser Theremin'
  },
  {
    url: `${BASE_URL}/play/tuner/`,
    output: 'play/tuner/tuner-preview.png',
    title: 'Browser Tuner'
  },
  {
    url: `${BASE_URL}/paint/`,
    output: 'paint/paint-preview.png',
    title: 'Paint'
  },
  {
    url: `${BASE_URL}/stock/`,
    output: 'stock/stock-preview.png',
    title: 'Stock Ticker'
  }
];

async function ensureDirectoryExists(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

async function takeScreenshot(page, pageConfig) {
  try {
    // Check if preview already exists (unless force regenerate is enabled)
    if (!FORCE_REGENERATE && fs.existsSync(pageConfig.output)) {
      console.log(`⏭️  Skipping ${pageConfig.title} - preview already exists`);
      console.log(`   File: ${pageConfig.output}`);
      return;
    }

    console.log(`📸 Capturing ${pageConfig.title}...`);
    console.log(`   URL: ${pageConfig.url}`);

    // Navigate to page
    await page.goto(pageConfig.url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Wait a bit for any animations or dynamic content
    await page.waitForTimeout(2000);

    // Try to close any modals or overlays that might be blocking the view
    try {
      // Common modal close patterns
      await page.click('[id*="close"], [class*="close"], .modal-close, #initialMenu button', {
        timeout: 1000
      });
    } catch (e) {
      // Ignore if no modals found
    }

    // Wait another moment after closing modals
    await page.waitForTimeout(1000);

    // Ensure output directory exists
    await ensureDirectoryExists(pageConfig.output);

    // Take screenshot
    await page.screenshot({
      path: pageConfig.output,
      fullPage: false, // Use viewport size
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height }
    });

    console.log(`✅ Saved: ${pageConfig.output}`);
  } catch (error) {
    console.error(`❌ Failed to capture ${pageConfig.title}:`, error.message);
  }
}

async function generatePreviews() {
  console.log('🚀 Starting preview image generation...');
  console.log(`📐 Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  console.log(`🔄 Force regenerate: ${FORCE_REGENERATE ? 'YES' : 'NO'}`);
  console.log(`📊 Total pages: ${PAGES.length}`);
  console.log('');

  // Count existing files
  const existingFiles = PAGES.filter((page) => fs.existsSync(page.output));
  if (!FORCE_REGENERATE && existingFiles.length > 0) {
    console.log(`ℹ️  Found ${existingFiles.length} existing preview(s) - will skip these`);
    console.log(`📸 Will generate ${PAGES.length - existingFiles.length} new preview(s)`);
    console.log('');
  }

  // Hoisted so the summary block below can read these counters.
  let generated = 0;
  let skipped = 0;
  let failed = 0;

  // Launch browser
  const browser = await chromium.launch({
    headless: true // Set to false if you want to see the browser
  });

  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1
    });

    const page = await context.newPage();

    // Set user agent to avoid any bot detection
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    for (const pageConfig of PAGES) {
      const existedBefore = fs.existsSync(pageConfig.output);

      try {
        await takeScreenshot(page, pageConfig);

        // Check if file was created
        if (!existedBefore && fs.existsSync(pageConfig.output)) {
          generated++;
        } else if (existedBefore && !FORCE_REGENERATE) {
          skipped++;
        }
      } catch (error) {
        failed++;
      }
    }
  } finally {
    await browser.close();
  }

  console.log('');
  console.log('🎉 Preview generation complete!');
  console.log('');
  console.log('📊 Summary:');
  console.log(`   📸 Generated: ${generated} new preview(s)`);
  console.log(`   ⏭️  Skipped: ${skipped} existing preview(s)`);
  if (failed > 0) {
    console.log(`   ❌ Failed: ${failed} preview(s)`);
  }
  console.log('');
  console.log('📋 All preview files:');
  PAGES.forEach((page) => {
    const exists = fs.existsSync(page.output);
    const status = exists ? '✅' : '❌';
    console.log(`   ${status} ${page.output}`);
  });
  console.log('');
  console.log('💡 Next steps:');
  console.log('   1. Check the generated images');
  console.log('   2. Commit and push to GitHub');
  console.log('   3. Test social media sharing!');
}

// Handle errors gracefully
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});

// Check if server is running
async function checkServer() {
  try {
    const response = await fetch(BASE_URL);
    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }
    console.log('✅ Local server is running');
    return true;
  } catch (error) {
    console.error('❌ Local server not accessible:', error.message);
    console.log('');
    console.log('💡 Please start your local server first:');
    console.log('   python -m http.server 8000');
    console.log('   # or');
    console.log('   npx serve -p 8000');
    console.log('');
    return false;
  }
}

// Main execution
async function main() {
  // Check if server is running first
  const serverRunning = await checkServer();
  if (!serverRunning) {
    process.exit(1);
  }

  // Generate previews
  await generatePreviews();
}

// Run the script
main().catch(console.error);
