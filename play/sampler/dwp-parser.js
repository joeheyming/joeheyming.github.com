const MAGIC = new Uint8Array([0x44, 0x77, 0x50, 0x72, 0x26]); // DwPr&
const CHUNK_HEADER_SIZE = 12;
const ZONE_MAP_CHUNK = 0x1f4;
const ZONE_NAME_CHUNK = 0x1f5;
const SAMPLE_PATH_CHUNK = 0x1f6;
const SAMPLE_INFO_CHUNK = 0x1f7;
const SAMPLE_DATA_CHUNK = 0x205;
const MAX_ZONE_CHUNKS = 96;

const decoder = new TextDecoder('utf-8');

export class DwpParseError extends Error {
  constructor(message, code = 'INVALID_DWP') {
    super(message);
    this.name = 'DwpParseError';
    this.code = code;
  }
}

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  throw new TypeError('parseDwp expects an ArrayBuffer or Uint8Array');
}

function hasMagic(bytes) {
  return MAGIC.every((value, index) => bytes[index] === value);
}

function cleanText(bytes) {
  return decoder.decode(bytes).replace(/\0.*$/s, '').trim();
}

function basename(path) {
  return path.split(/[\\/]/).pop() || path;
}

function readChunk(view, bytes, offset) {
  if (offset + CHUNK_HEADER_SIZE > bytes.length) {
    throw new DwpParseError('This DWP file appears to be incomplete.', 'TRUNCATED');
  }

  const id = view.getUint32(offset, true);
  const length = view.getUint32(offset + 4, true);
  const reserved = view.getUint32(offset + 8, true);
  const start = offset + CHUNK_HEADER_SIZE;
  const end = start + length;

  if (end < start || end > bytes.length) {
    throw new DwpParseError('This DWP file appears to be incomplete.', 'TRUNCATED');
  }

  return { id, length, reserved, offset, start, end, payload: bytes.subarray(start, end) };
}

function looksLikeZoneMap(chunk) {
  if (chunk.id !== ZONE_MAP_CHUNK || chunk.length < 5 || chunk.reserved !== 0) return false;
  const [rootKey, keyLow, keyHigh, velocityLow, velocityHigh] = chunk.payload;
  return (
    rootKey <= 127 &&
    keyLow <= rootKey &&
    rootKey <= keyHigh &&
    velocityLow <= velocityHigh &&
    velocityHigh <= 127
  );
}

function findNextZone(view, bytes, startOffset = MAGIC.length) {
  for (let offset = startOffset; offset + CHUNK_HEADER_SIZE <= bytes.length; offset += 1) {
    if (view.getUint32(offset, true) !== ZONE_MAP_CHUNK) continue;
    let chunk;
    try {
      chunk = readChunk(view, bytes, offset);
    } catch {
      continue;
    }
    if (!looksLikeZoneMap(chunk)) continue;

    const nextOffset = chunk.end;
    if (
      nextOffset + CHUNK_HEADER_SIZE <= bytes.length &&
      view.getUint32(nextOffset, true) === ZONE_NAME_CHUNK
    ) {
      return offset;
    }
  }
  return -1;
}

function readProgramName(bytes) {
  // Modern monolithic DWP files observed from DirectWave 20.x store the
  // program-name length at 0x5e and the UTF-8 bytes at 0x66.
  if (bytes.length <= 0x66) return 'DirectWave program';
  const length = bytes[0x5e];
  if (!length || 0x66 + length > bytes.length) return 'DirectWave program';
  return cleanText(bytes.subarray(0x66, 0x66 + length)) || 'DirectWave program';
}

function parseSampleInfo(chunk) {
  if (chunk.length < 40) {
    throw new DwpParseError('This DWP file appears to be incomplete.', 'TRUNCATED');
  }
  const view = new DataView(
    chunk.payload.buffer,
    chunk.payload.byteOffset,
    chunk.payload.byteLength
  );
  const frameCount = view.getUint32(0, true);
  const rawChannels = view.getUint32(8, true);
  const sampleRate = view.getFloat32(16, true);
  const loopStart = view.getUint32(24, true);
  const loopEnd = view.getUint32(28, true);
  const bitDepth = view.getUint32(36, true);

  if (!frameCount || frameCount > 100_000_000) {
    throw new DwpParseError('This DWP contains invalid sample information.', 'INVALID_SAMPLE');
  }
  if (rawChannels < 1 || rawChannels > 2) {
    throw new DwpParseError('This DWP contains audio that is not supported yet.', 'UNSUPPORTED');
  }
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000) {
    throw new DwpParseError('This DWP contains invalid sample information.', 'INVALID_SAMPLE');
  }
  if (bitDepth !== 32) {
    throw new DwpParseError(
      `This DWP uses ${
        bitDepth ? `${bitDepth}-bit` : 'an unknown sample depth'
      } audio, which is not supported yet.`,
      'UNSUPPORTED'
    );
  }

  const loop =
    loopEnd > loopStart && loopEnd <= frameCount ? { start: loopStart, end: loopEnd } : null;
  return { frameCount, channels: rawChannels, sampleRate, bitDepth, loop };
}

function parseZone(view, bytes, offset, index) {
  const mapChunk = readChunk(view, bytes, offset);
  if (!looksLikeZoneMap(mapChunk)) {
    throw new DwpParseError('This DWP contains an invalid sample zone.', 'INVALID_ZONE');
  }

  const [rootKey, keyLow, keyHigh, velocityLow, velocityHigh] = mapChunk.payload;
  let name = `Zone ${index + 1}`;
  let sampleFile = '';
  let sampleInfo = null;
  let sampleBytes = null;
  let cursor = mapChunk.end;

  for (let count = 0; count < MAX_ZONE_CHUNKS && cursor < bytes.length; count += 1) {
    const chunk = readChunk(view, bytes, cursor);
    if (chunk.id === ZONE_MAP_CHUNK) break;
    if (chunk.id === ZONE_NAME_CHUNK) name = cleanText(chunk.payload) || name;
    if (chunk.id === SAMPLE_PATH_CHUNK) sampleFile = basename(cleanText(chunk.payload));
    if (chunk.id === SAMPLE_INFO_CHUNK) sampleInfo = parseSampleInfo(chunk);
    if (chunk.id === SAMPLE_DATA_CHUNK) {
      sampleBytes = chunk.payload.slice();
      cursor = chunk.end;
      break;
    }
    cursor = chunk.end;
  }

  if (!sampleBytes) {
    throw new DwpParseError(
      'This preset uses separate sample files, which are not supported yet. Try a monolithic DWP instead.',
      'EXTERNAL_SAMPLES'
    );
  }
  if (!sampleInfo) {
    throw new DwpParseError('This DWP contains invalid sample information.', 'INVALID_SAMPLE');
  }

  const requiredBytes = sampleInfo.frameCount * sampleInfo.channels * 4;
  if (sampleBytes.byteLength < requiredBytes) {
    throw new DwpParseError('This DWP file appears to be incomplete.', 'TRUNCATED');
  }

  return {
    zone: {
      id: index,
      name,
      sampleFile,
      rootKey,
      keyLow,
      keyHigh,
      velocityLow,
      velocityHigh,
      tuningCents: 0,
      ...sampleInfo,
      sampleBytes
    },
    nextOffset: cursor
  };
}

export function findZoneForNote(programOrZones, midi, velocity = 100) {
  const zones = Array.isArray(programOrZones) ? programOrZones : programOrZones?.zones || [];
  const matches = zones.filter(
    (zone) =>
      midi >= zone.keyLow &&
      midi <= zone.keyHigh &&
      velocity >= zone.velocityLow &&
      velocity <= zone.velocityHigh
  );
  if (!matches.length) return null;
  return matches.reduce((best, zone) =>
    Math.abs(zone.rootKey - midi) < Math.abs(best.rootKey - midi) ? zone : best
  );
}

export function parseDwp(input) {
  const bytes = asBytes(input);
  if (bytes.length < MAGIC.length || !hasMagic(bytes)) {
    throw new DwpParseError('That file is not an FL Studio DirectWave DWP program.', 'BAD_MAGIC');
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = findNextZone(view, bytes);
  if (offset < 0) {
    throw new DwpParseError('This DWP format is not supported yet.', 'UNSUPPORTED');
  }

  const zones = [];
  while (offset >= 0 && offset < bytes.length) {
    const parsed = parseZone(view, bytes, offset, zones.length);
    zones.push(parsed.zone);
    offset = findNextZone(view, bytes, parsed.nextOffset);
  }

  if (!zones.length) {
    throw new DwpParseError('This DWP contains no playable samples.', 'NO_ZONES');
  }

  return {
    format: 'directwave-monolithic',
    name: readProgramName(bytes),
    zones,
    keyLow: Math.min(...zones.map((zone) => zone.keyLow)),
    keyHigh: Math.max(...zones.map((zone) => zone.keyHigh)),
    velocityLayers: new Set(zones.map((zone) => `${zone.velocityLow}-${zone.velocityHigh}`)).size
  };
}
