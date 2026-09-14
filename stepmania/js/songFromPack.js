import { danceSingleCharts } from './simfileParser.js';

const objectUrls = new Set();
let urlByBlob = new WeakMap();

export function revokePackObjectUrls() {
  for (const url of objectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }
  objectUrls.clear();
  urlByBlob = new WeakMap();
}

function blobUrl(file, fileName) {
  if (!file?.blob) return null;
  if (urlByBlob.has(file.blob)) return urlByBlob.get(file.blob);
  const blob =
    file.mime && file.blob.type !== file.mime
      ? new Blob([file.blob], { type: file.mime })
      : file.blob;
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  const base =
    String(fileName || '')
      .split('/')
      .pop() || '';
  // Keep the extension visible: AVI detection and audio sniffing read the URL.
  const withName = base && /\.[a-z0-9]+$/i.test(base) ? `${url}#${encodeURIComponent(base)}` : url;
  urlByBlob.set(file.blob, withName);
  return withName;
}

/**
 * Point every BGCHANGES entry at a blob URL from the pack. Nothing downstream
 * can resolve a pack-relative filename once the song is playing from blobs,
 * so an unresolvable entry is dropped rather than left to 404.
 * @param {import('./packIo.js').SongPack} pack
 */
function bgChangesWithBlobUrls(pack) {
  const byBasename = new Map();
  for (const [path, file] of pack.files) {
    if (file.kind === 'text') continue;
    const base = path.split('/').pop().toLowerCase();
    if (!byBasename.has(base)) byBasename.set(base, { path, file });
  }
  const resolved = [];
  for (const bg of pack.parsed.bgChanges || []) {
    if (!bg.file || /^(https?:|blob:|data:)/i.test(bg.file)) {
      resolved.push(bg);
      continue;
    }
    const hit = byBasename.get(bg.file.split('/').pop().toLowerCase());
    if (!hit) continue;
    const url = blobUrl(hit.file, hit.path);
    if (url) resolved.push({ ...bg, file: url });
  }
  return resolved;
}

/**
 * Map a loaded SongPack onto songManager + loadSongIntoGame inputs.
 * @param {import('./packIo.js').SongPack} pack
 * @param {string} [key]
 */
export function songFromPack(pack, key = `local_${Date.now()}`) {
  const parsed = {
    ...pack.parsed,
    charts: danceSingleCharts(pack.parsed.charts)
  };
  const music = pack.musicPath ? pack.files.get(pack.musicPath) : null;
  const background = pack.backgroundPath ? pack.files.get(pack.backgroundPath) : null;
  const video = pack.videoPath ? pack.files.get(pack.videoPath) : null;
  const musicUrl = blobUrl(music, pack.musicPath);
  parsed.bgChanges = bgChangesWithBlobUrls(pack);
  const songData = {
    title: parsed.title,
    artist: parsed.artist,
    url: musicUrl || '',
    audioBlob: music?.blob || null,
    audioType: music?.mime || music?.blob?.type || 'audio/mpeg',
    background: blobUrl(background, pack.backgroundPath),
    video: blobUrl(video, pack.videoPath),
    simfile: null,
    localPack: true
  };
  return { songKey: key, songData, parsedData: parsed, pack };
}

/**
 * Timing + offset for play: chart split timing wins when present.
 * @param {import('./simfileParser.js').ParsedSimfile} parsed
 * @param {import('./simfileParser.js').Chart} chart
 */
export function playTimingForChart(parsed, chart) {
  if (chart?.hasSplitTiming && chart.timing) {
    return {
      timing: chart.timing,
      offset: Number.isFinite(chart.offset) ? chart.offset : parsed.offset,
      bpmChanges: (chart.timingTags?.bpms || []).map((p) => ({ beat: p.beat, bpm: p.value }))
    };
  }
  return {
    timing: parsed.timing,
    offset: parsed.offset,
    bpmChanges: parsed.bpmChanges || []
  };
}
