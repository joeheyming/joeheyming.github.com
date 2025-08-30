#!/usr/bin/env node

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

class SimfileDownloader {
  constructor() {
    this.downloadedFiles = {};
    this.songsPath = 'js/songs.js';
  }

  async downloadSimfile(pageUrl) {
    console.log(`🎵 Processing: ${pageUrl}`);

    try {
      // Get simfile detail page
      const pageHtml = await this.fetchUrl(pageUrl);
      const files = this.parseSimfilePage(pageHtml, pageUrl);
      const songInfo = this.extractSongInfo(pageHtml);

      console.log(`🎵 Song: ${songInfo.title} by ${songInfo.artist} (BPM: ${songInfo.bpm})`);
      console.log(`📁 Song folder: ${songInfo.cleanName}`);

      // Create local directory
      const songDir = path.join('songs', songInfo.cleanName);
      if (!fs.existsSync(songDir)) {
        fs.mkdirSync(songDir, { recursive: true });
        console.log(`✅ Created directory: ${songDir}`);
      }

      console.log(`🔍 Found ${files.length} files`);

      // Filter and download files
      const filesToDownload = files.filter((file) => this.shouldDownloadFile(file.name));
      const filesToSkip = files.filter((file) => !this.shouldDownloadFile(file.name));

      console.log(`⬇️  Downloading ${filesToDownload.length} files:`);
      filesToDownload.forEach((file) => console.log(`   - ${file.name} (${file.size})`));

      console.log(`⏭️  Skipping ${filesToSkip.length} large files:`);
      filesToSkip.forEach((file) => console.log(`   - ${file.name} (${file.size})`));

      // Download the files we want
      for (const file of filesToDownload) {
        await this.downloadFile(file.url, path.join(songDir, file.name));
        this.downloadedFiles[file.name] = `songs/${songInfo.cleanName}/${file.name}`;
      }

      // Generate songs.js entry
      const songsEntry = this.generateSongsEntry(songInfo.cleanName, files, songInfo, pageUrl);
      console.log(`\n📝 Generated songs.js entry:`);
      console.log('----------------------------------------');
      console.log(songsEntry);
      console.log('----------------------------------------');

      // Automatically update songs.js file
      this.updateSongsFile(songInfo.cleanName, files, songInfo, pageUrl);
    } catch (error) {
      console.error(`❌ Error processing ${pageUrl}:`, error.message);
    }
  }

  shouldDownloadFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    const name = filename.toLowerCase();

    // Only download simfiles
    const downloadExtensions = ['.sm', '.ssc', '.dwi'];

    // Skip all other file types (media files, images, etc.)
    const skipExtensions = [
      '.ogg',
      '.mp3',
      '.wav',
      '.avi',
      '.mp4',
      '.wmv',
      '.flv',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.bmp'
    ];

    // Skip large files and images
    if (skipExtensions.includes(ext)) {
      return false;
    }

    // Only download simfiles
    if (downloadExtensions.includes(ext)) {
      return true;
    }

    // Skip unknown file types by default
    return false;
  }

  parseSimfilePage(html, pageUrl) {
    const files = [];
    const baseUrl = 'https://zenius-i-vanisher.com';

    // Parse the simfile download table
    const downloadTableRegex = /Simfile File Download[\s\S]*?<\/table>/i;
    const tableMatch = html.match(downloadTableRegex);

    if (tableMatch) {
      const tableHtml = tableMatch[0];

      // Extract file links from the table
      const linkRegex = /<a\s+href="([^"]+)"[^>]*>\s*([^<]+)\s*<\/a>[^<]*\(([^)]+)\)/gi;
      let match;

      while ((match = linkRegex.exec(tableHtml)) !== null) {
        const href = match[1].trim();
        const text = match[2].trim();
        const size = match[3].trim();

        // Skip ZIP downloads and other non-direct file links
        if (href.includes('download.php') || text.toLowerCase() === 'zip') continue;

        // Build full URL
        const fileUrl = href.startsWith('http') ? href : baseUrl + href;
        const fileName = decodeURIComponent(href.split('/').pop());

        files.push({
          name: fileName,
          displayName: text,
          url: fileUrl,
          size: size
        });
      }
    }

    return files;
  }

  extractSongInfo(html) {
    // Extract song title and artist from the page header
    const titleMatch = html.match(/<h1[^>]*>([^<]+)\s*\/\s*([^<]+)<\/h1>/i);
    let title = 'Unknown';
    let artist = 'Unknown';

    if (titleMatch) {
      title = titleMatch[1].trim();
      artist = titleMatch[2].trim();
    }

    // Extract BPM from the information table
    let bpm = null;
    const bpmMatch = html.match(/BPM[\s\S]*?<td[^>]*>([^<]+)<\/td>/i);
    if (bpmMatch) {
      bpm = parseInt(bpmMatch[1].trim());
    }

    // Create clean folder name
    const cleanName = title.replace(/[^a-zA-Z0-9\-_]/g, '_');

    return {
      title,
      artist,
      bpm,
      cleanName
    };
  }

  generateSongsEntry(songName, allFiles, songInfo, pageUrl) {
    const simfile = allFiles.find((f) => f.name.toLowerCase().endsWith('.sm'));
    const audio = allFiles.find((f) => {
      const ext = path.extname(f.name).toLowerCase();
      return ['.ogg', '.mp3', '.wav'].includes(ext);
    });
    const background = allFiles.find((f) => {
      const ext = path.extname(f.name).toLowerCase();
      const name = f.name.toLowerCase();
      return (
        ['.png', '.jpg', '.jpeg', '.gif'].includes(ext) &&
        (name.includes('bg') || name.includes('background') || !name.includes('banner'))
      );
    });
    const video = allFiles.find((f) => {
      const ext = path.extname(f.name).toLowerCase();
      return ['.avi', '.mp4', '.wmv'].includes(ext);
    });

    const entry = {
      url: audio ? `'${audio.url}'` : 'null // No audio file found',
      simfile: simfile ? `'songs/${songName}/${simfile.name}'` : 'null // No simfile found',
      background: background ? `'${background.url}'` : 'null // No background found',
      title: `'${songInfo.title}'`,
      artist: `'${songInfo.artist}'`,
      bpm: songInfo.bpm
        ? `${songInfo.bpm} // Parsed from simfile page`
        : 'null // Will be parsed from simfile'
    };

    if (video) {
      entry.avi = `'${video.url}'`;
    }

    const entryString =
      `  ${songName}: {\n` +
      Object.entries(entry)
        .map(([key, value]) => {
          return `    ${key}: ${value}`;
        })
        .join(',\n') +
      '\n  }';

    return entryString;
  }

  updateSongsFile(songName, allFiles, songInfo, pageUrl) {
    const songsFilePath = 'js/songs.js';

    if (!fs.existsSync(songsFilePath)) {
      console.log(`❌ ${songsFilePath} not found`);
      return;
    }

    try {
      // Read existing songs.js file
      const fileContent = fs.readFileSync(songsFilePath, 'utf8');

      // Find the songs object and extract it
      const songsMatch = fileContent.match(/const songs = \{([\s\S]*?)\};/);
      if (!songsMatch) {
        console.log('❌ Could not parse songs.js structure');
        return;
      }

      // Check if song already exists
      const existingEntryRegex = new RegExp(`^\\s*${songName}:\\s*\\{`, 'm');
      if (existingEntryRegex.test(songsMatch[1])) {
        console.log(`⚠️  Song "${songName}" already exists in songs.js - skipping update`);
        return;
      }

      // Generate the new entry
      const simfile = allFiles.find((f) => f.name.toLowerCase().endsWith('.sm'));
      const audio = allFiles.find((f) => {
        const ext = path.extname(f.name).toLowerCase();
        return ['.ogg', '.mp3', '.wav'].includes(ext);
      });
      const background = allFiles.find((f) => {
        const ext = path.extname(f.name).toLowerCase();
        const name = f.name.toLowerCase();
        return (
          ['.png', '.jpg', '.jpeg', '.gif'].includes(ext) &&
          (name.includes('bg') || name.includes('background') || !name.includes('banner'))
        );
      });
      const video = allFiles.find((f) => {
        const ext = path.extname(f.name).toLowerCase();
        return ['.avi', '.mp4', '.wmv'].includes(ext);
      });

      const newEntry = {
        url: audio ? `'${audio.url}'` : 'null',
        simfile: simfile ? `'songs/${songName}/${simfile.name}'` : 'null',
        background: background ? `'${background.url}'` : 'null',
        title: `'${songInfo.title}'`,
        artist: `'${songInfo.artist}'`,
        bpm: songInfo.bpm || 'null'
      };

      if (video) {
        newEntry.avi = `'${video.url}'`;
      }

      // Build the new entry string with proper formatting
      const newEntryString =
        `  ${songName}: {\n` +
        Object.entries(newEntry)
          .map(([key, value]) => `    ${key}: ${value}`)
          .join(',\n') +
        '\n  }';

      // Insert the new entry (add comma after last entry and before closing brace)
      const existingSongsContent = songsMatch[1].trim();
      const updatedSongsContent =
        existingSongsContent.length > 0
          ? existingSongsContent + ',\n' + newEntryString
          : newEntryString;

      // Rebuild the entire file content
      const updatedFileContent = fileContent.replace(
        /const songs = \{[\s\S]*?\};/,
        `const songs = {\n${updatedSongsContent}\n};`
      );

      // Write back to file
      fs.writeFileSync(songsFilePath, updatedFileContent, 'utf8');
      console.log(`✅ Added "${songName}" to ${songsFilePath}`);
    } catch (error) {
      console.log(`❌ Error updating songs.js: ${error.message}`);
      console.log('📝 Please manually add the entry shown above');
    }
  }

  fetchUrl(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https:') ? https : http;

      client
        .get(url, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            return this.fetchUrl(res.headers.location).then(resolve).catch(reject);
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            return;
          }

          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        })
        .on('error', reject);
    });
  }

  downloadFile(fileUrl, localPath) {
    return new Promise((resolve, reject) => {
      console.log(`  📥 Downloading ${path.basename(localPath)}...`);

      const client = fileUrl.startsWith('https:') ? https : http;
      const file = fs.createWriteStream(localPath);

      client
        .get(fileUrl, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            return this.downloadFile(res.headers.location, localPath).then(resolve).catch(reject);
          }

          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
            return;
          }

          res.pipe(file);

          file.on('finish', () => {
            file.close();
            console.log(`  ✅ Downloaded ${path.basename(localPath)}`);
            resolve();
          });

          file.on('error', (err) => {
            fs.unlink(localPath, () => {}); // Delete partial file
            reject(err);
          });
        })
        .on('error', reject);
    });
  }

  // Song update functionality (merged from updateSong.js)
  async updateSongFromLocal(songKey) {
    const songDir = path.join('songs', songKey);

    if (!fs.existsSync(songDir)) {
      console.log(`❌ Directory songs/${songKey}/ does not exist`);
      return;
    }

    console.log(`🔍 Scanning songs/${songKey}/ for files...`);

    const files = fs.readdirSync(songDir);
    const simfile = files.find((f) => f.toLowerCase().endsWith('.sm'));
    const background = files.find((f) => {
      const ext = path.extname(f).toLowerCase();
      const name = f.toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif'].includes(ext);
    });

    console.log(`Files found:`);
    if (simfile) console.log(`  ✅ Simfile: ${simfile}`);
    if (background) console.log(`  ✅ Background: ${background}`);

    // Parse BPM from simfile if available
    let bpmInfo = '';
    if (simfile) {
      try {
        const simContent = fs.readFileSync(path.join(songDir, simfile), 'utf8');
        const bpm = this.extractBPM(simContent);
        if (bpm) {
          bpmInfo = ` (BPM: ${bpm})`;
        }
      } catch (error) {
        console.log(`⚠️  Could not parse BPM from ${simfile}`);
      }
    }

    // Generate updated entry suggestion
    console.log(`\n📝 Suggested update for ${songKey} in songs.js:`);
    console.log('----------------------------------------');

    const entry = {
      url: `// Keep existing URL for audio`,
      simfile: simfile ? `'songs/${songKey}/${simfile}'` : `// No simfile found`,
      background: background ? `'songs/${songKey}/${background}'` : `// Keep existing or use null`,
      title: songKey.replace(/_/g, ' '),
      artist: `// Keep existing artist`,
      bpm: `// Will be parsed from simfile${bpmInfo}`
    };

    console.log(`  ${songKey}: {`);
    Object.entries(entry).forEach(([key, value]) => {
      if (value.startsWith('//')) {
        console.log(`    ${key}: ${value}`);
      } else {
        console.log(`    ${key}: ${value},`);
      }
    });
    console.log('  }');
    console.log('----------------------------------------');
  }

  extractBPM(simContent) {
    // Clean content
    const cleanContent = simContent
      .replace(/\/\/.*$/gm, '') // Remove line comments
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');

    // Check for DISPLAYBPM first
    const displayBpmMatch = cleanContent.match(/#DISPLAYBPM:([^;]+);/);
    if (displayBpmMatch) {
      const bpm = parseFloat(displayBpmMatch[1].trim());
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

    return null;
  }
}

// Command line usage
if (require.main === module) {
  const args = process.argv.slice(2);
  const downloader = new SimfileDownloader();

  if (args.length === 0) {
    console.log(`
🎵 Simfile Downloader & Song Updater

Usage: 
  node downloadSimfile.js <SIMFILE_PAGE_URL>   # Download from zenius-i-vanisher
  node downloadSimfile.js <songKey>            # Update local song

Examples:
  node downloadSimfile.js "https://zenius-i-vanisher.com/v5.2/viewsimfile.php?simfileid=6356"
  node downloadSimfile.js Sandstorm            # Generate update for Sandstorm
  node downloadSimfile.js Butterfly            # Generate update for Butterfly

Download mode will:
✅ Parse simfile detail page from zenius-i-vanisher.com
✅ Download ONLY .sm simfiles (for BPM parsing)
⏭️  Skip ALL media files and images (but keep their URLs)
📝 Extract BPM, title, and artist from the page
📝 Generate complete songs.js entry for you to copy-paste

Update mode will:
✅ Scan local songs/[name]/ directory
✅ Find simfiles and backgrounds  
✅ Extract BPM from simfiles
📝 Generate songs.js entry suggestions

Find simfile URLs at: https://zenius-i-vanisher.com/v5.2/simfiles.php?gameid=1
`);
    process.exit(1);
  }

  // Handle different command modes
  if (args[0].startsWith('http')) {
    // URL detected: download mode
    downloader
      .downloadSimfile(args[0])
      .then(() => {
        console.log('\n🎉 Done!');
      })
      .catch((error) => {
        console.error('❌ Error:', error);
        process.exit(1);
      });
  } else {
    // Song key detected: update mode
    downloader.updateSongFromLocal(args[0]);
  }
}

module.exports = SimfileDownloader;
