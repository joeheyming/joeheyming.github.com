#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const HOST = 'joeheyming.github.io';
const SITEMAP_PATH = path.join(REPO_ROOT, 'sitemap.xml');
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

const KEY_FILE = '8f4e2a1b6c9d3e7f0a5b8c2d1e4f6a9.txt';

function readKey() {
  const keyPath = path.join(REPO_ROOT, KEY_FILE);
  if (!fs.existsSync(keyPath)) {
    throw new Error(
      `IndexNow key file not found: ${KEY_FILE}\n` +
        'Generate a key in Bing Webmaster Tools and add {key}.txt at the repo root.'
    );
  }
  const key = fs.readFileSync(keyPath, 'utf8').trim();
  if (!key) {
    throw new Error(`IndexNow key file ${KEY_FILE} is empty.`);
  }
  return key;
}

function readSitemapUrls() {
  const xml = fs.readFileSync(SITEMAP_PATH, 'utf8');
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim());
  if (urls.length === 0) {
    throw new Error(`No URLs found in ${SITEMAP_PATH}`);
  }
  return urls;
}

function parseArgs(argv) {
  const urlFlagIndex = argv.indexOf('--url');
  if (urlFlagIndex !== -1) {
    const url = argv[urlFlagIndex + 1];
    if (!url) {
      throw new Error('Missing value for --url');
    }
    return [url];
  }

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`Usage:
  node scripts/indexnow-submit.mjs           Submit all sitemap URLs
  node scripts/indexnow-submit.mjs --url URL Submit one URL`);
    process.exit(0);
  }

  return readSitemapUrls();
}

async function submitUrls(urlList, key) {
  const keyLocation = `https://${HOST}/${KEY_FILE}`;
  const payload = {
    host: HOST,
    key,
    keyLocation,
    urlList
  };

  console.log(`Submitting ${urlList.length} URL(s) to IndexNow...`);

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload)
  });

  if (response.status === 200 || response.status === 202) {
    console.log(`IndexNow accepted (${response.status}).`);
    return;
  }

  const body = await response.text();
  throw new Error(`IndexNow request failed (${response.status}): ${body || response.statusText}`);
}

async function main() {
  const key = process.env.INDEXNOW_KEY?.trim() || readKey();
  const urlList = parseArgs(process.argv.slice(2));
  await submitUrls(urlList, key);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
