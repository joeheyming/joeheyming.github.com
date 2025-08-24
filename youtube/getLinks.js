#!/usr/bin/env node

/**
 * Script to automatically fetch YouTube video links and save them to links.js
 * Usage: node getLinks.js
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const CONFIG = {
  url: 'https://www.youtube.com/@joeyjojojojojojojojojojojojojo/videos',
  tempFile: './temp_page.html',
  linksFile: './links.js',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
};

async function fetchYouTubeChannel() {
  console.log(`🎬 Fetching videos from: ${CONFIG.url}`);

  try {
    const response = await fetch(CONFIG.url, {
      headers: {
        'User-Agent': CONFIG.userAgent
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    console.log('✅ Downloaded channel page');

    return html;
  } catch (error) {
    console.error('❌ Error: Failed to fetch the YouTube page');
    console.error(error.message);
    process.exit(1);
  }
}

function extractVideoData(html) {
  console.log('🔍 Parsing HTML with DOM to extract video titles and IDs...');

  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;

    // Store unique videos using video ID as key
    const videoMap = new Map();

    // Strategy 1: Look for video links with titles in rich-item-renderer elements
    const richItems = document.querySelectorAll(
      '#contents ytd-rich-item-renderer, .ytd-rich-item-renderer'
    );
    console.log(`📋 Found ${richItems.length} rich item renderers`);

    richItems.forEach((item, index) => {
      try {
        // Find the video link
        const linkElement = item.querySelector('a[href*="/watch?v="]');
        if (!linkElement) return;

        const href = linkElement.getAttribute('href');
        const videoIdMatch = href.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
        if (!videoIdMatch) return;

        const videoId = videoIdMatch[1];

        // Find the title - try multiple selectors
        let title = null;
        const titleSelectors = [
          '#video-title',
          '.ytd-rich-grid-media #video-title',
          'h3 a[href*="/watch"]',
          '.ytd-rich-grid-media h3',
          '#video-title-link',
          'a[aria-label]'
        ];

        for (const selector of titleSelectors) {
          const titleElement = item.querySelector(selector);
          if (titleElement) {
            title =
              titleElement.textContent?.trim() ||
              titleElement.getAttribute('title')?.trim() ||
              titleElement.getAttribute('aria-label')?.trim();
            if (title && title !== '') break;
          }
        }

        // Fallback: use aria-label from the link itself
        if (!title) {
          title =
            linkElement.getAttribute('aria-label')?.trim() ||
            linkElement.getAttribute('title')?.trim();
        }

        if (!title || title === '') {
          title = `Video ${videoId}`;
        }

        const url = `https://www.youtube.com/watch?v=${videoId}`;
        videoMap.set(videoId, { title: title, url: url });

        console.log(`✅ Extracted: "${title}" (${videoId})`);
      } catch (error) {
        console.warn(`⚠️ Error processing rich item ${index}:`, error.message);
      }
    });

    // Strategy 2: Fallback regex method for video IDs if DOM parsing found few results
    if (videoMap.size < 5) {
      console.log('🔄 Using fallback regex method for additional video IDs...');

      const videoIdPattern = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
      let match;
      while ((match = videoIdPattern.exec(html)) !== null) {
        const videoId = match[1];
        if (!videoMap.has(videoId)) {
          const url = `https://www.youtube.com/watch?v=${videoId}`;
          videoMap.set(videoId, { title: `Video ${videoId}`, url: url });
        }
      }
    }

    // Strategy 3: Try to find titles in script tags with JSON data
    const scriptTags = document.querySelectorAll('script');
    for (const script of scriptTags) {
      const content = script.textContent;
      if (content && content.includes('var ytInitialData')) {
        try {
          // Extract and parse the ytInitialData
          const jsonMatch = content.match(/var ytInitialData\s*=\s*({.+?});/);
          if (jsonMatch) {
            const data = JSON.parse(jsonMatch[1]);
            // Navigate the complex YouTube JSON structure
            const contents =
              data?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[1]?.tabRenderer?.content
                ?.richGridRenderer?.contents;

            if (contents && Array.isArray(contents)) {
              contents.forEach((item) => {
                try {
                  const videoRenderer = item?.richItemRenderer?.content?.videoRenderer;
                  if (videoRenderer) {
                    const videoId = videoRenderer.videoId;
                    const title =
                      videoRenderer.title?.runs?.[0]?.text ||
                      videoRenderer.title?.simpleText ||
                      `Video ${videoId}`;

                    if (videoId && title) {
                      const url = `https://www.youtube.com/watch?v=${videoId}`;
                      if (videoMap.has(videoId)) {
                        // Update title if we have a better one
                        if (title !== `Video ${videoId}`) {
                          videoMap.set(videoId, { title: title, url: url });
                          console.log(`🔄 Updated title: "${title}" (${videoId})`);
                        }
                      } else {
                        videoMap.set(videoId, { title: title, url: url });
                        console.log(`➕ Added from JSON: "${title}" (${videoId})`);
                      }
                    }
                  }
                } catch (error) {
                  // Silently continue if this item fails
                }
              });
            }
          }
        } catch (error) {
          console.warn('⚠️ Error parsing ytInitialData:', error.message);
        }
        break; // Only process the first ytInitialData script
      }
    }

    const videos = Array.from(videoMap.values());
    console.log(`🎯 Successfully extracted ${videos.length} unique videos with titles`);

    return videos;
  } catch (error) {
    console.error('❌ Error parsing HTML with DOM:', error.message);
    console.log('🔄 Falling back to regex-only method...');

    // Fallback to regex method
    const videoIdPattern = /\/watch\?v=([a-zA-Z0-9_-]{11})/g;
    const videoIds = new Set();

    let match;
    while ((match = videoIdPattern.exec(html)) !== null) {
      videoIds.add(match[1]);
    }

    return Array.from(videoIds).map((id) => ({
      title: `Video ${id}`,
      url: `https://www.youtube.com/watch?v=${id}`
    }));
  }
}

function createJavaScriptArray(videos) {
  if (videos.length === 0) {
    return 'window.videoLinks = [];';
  }

  const formattedVideos = videos
    .map((video) => {
      // Escape quotes in title for JavaScript string
      const escapedTitle = video.title.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      return `        { title: "${escapedTitle}", url: "${video.url}" }`;
    })
    .join(',\n');

  return `window.videoLinks = [
${formattedVideos}
      ];`;
}

async function saveToFile(content, filePath) {
  try {
    await fs.promises.writeFile(filePath, content, 'utf8');
    console.log(`💾 Saved video links to ${filePath}`);
  } catch (error) {
    console.error(`❌ Error saving to ${filePath}:`, error.message);
    process.exit(1);
  }
}

function displayResults(videos) {
  const videoCount = videos.length;
  console.log(`🔍 Found ${videoCount} unique videos`);

  if (videoCount === 0) {
    console.log('⚠️  No videos found. The page might have changed or require JavaScript.');
    console.log('💡 Try adding video URLs manually to the HTML file.');
    process.exit(1);
  }

  console.log('📝 Creating video links array with titles...');
  console.log('📝 You can now copy the videoLinks array from links.js to your index.html file');
  console.log('🎉 Done! Video links with titles saved to links.js');
  console.log(
    '📋 Copy the videoLinks array from links.js and paste it into your index.html file to update your page.'
  );
  console.log('');
  console.log('Videos found:');

  // Show first 10 videos with titles
  const videosToShow = videos.slice(0, 10);
  videosToShow.forEach((video, index) => {
    console.log(`${index + 1}. "${video.title}" - ${video.url}`);
  });

  if (videoCount > 10) {
    const remaining = videoCount - 10;
    console.log(`... and ${remaining} more videos`);
  }
}

async function main() {
  try {
    // Fetch the YouTube channel page
    const html = await fetchYouTubeChannel();

    // Extract video data (titles and URLs) using DOM parsing
    const videos = extractVideoData(html);

    // Display results and handle empty case
    displayResults(videos);

    // Create JavaScript array format
    const jsArray = createJavaScriptArray(videos);

    // Save to file
    await saveToFile(jsArray, CONFIG.linksFile);
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main();
}

module.exports = {
  fetchYouTubeChannel,
  extractVideoData,
  createJavaScriptArray
};
