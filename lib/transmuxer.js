/**
 * Transmuxer to convert clean MPEG-TS streams into standard MP4
 * using mux.js without re-encoding video or audio.
 */

/**
 * Fixes MP4 container display duration in mvhd, tkhd, and mdhd boxes.
 * Based on CatCatch's duration patching technique for mux.js fMP4 streams.
 *
 * @param {Uint8Array} data - MP4 data
 * @param {number} duration - Video duration in seconds
 * @returns {Uint8Array} - Patched MP4 data
 */
function fixFileDuration(data, duration) {
  if (!duration || duration <= 0 || !data || data.length < 32) {
    return data;
  }

  let mvhdBoxDuration = Math.round(duration * 90000);

  function getBoxDuration(buffer, dur, index) {
    const timescaleIndex = index + 16;
    if (timescaleIndex + 4 > buffer.length) return Math.round(dur * 90000);
    const timescale =
      ((buffer[timescaleIndex] << 24) |
        (buffer[timescaleIndex + 1] << 16) |
        (buffer[timescaleIndex + 2] << 8) |
        buffer[timescaleIndex + 3]) >>>
      0;
    return Math.round((timescale || 90000) * dur);
  }

  function writeUint32(buffer, index, val) {
    if (index + 4 > buffer.length) return;
    buffer[index] = (val >>> 24) & 0xff;
    buffer[index + 1] = (val >>> 16) & 0xff;
    buffer[index + 2] = (val >>> 8) & 0xff;
    buffer[index + 3] = val & 0xff;
  }

  for (let i = 0; i < data.length - 8; i++) {
    // mvhd
    if (data[i] === 0x6d && data[i + 1] === 0x76 && data[i + 2] === 0x68 && data[i + 3] === 0x64) {
      mvhdBoxDuration = getBoxDuration(data, duration, i);
      if (i + 11 < data.length) {
        data[i + 11] = 0; // Clear creation date
      }
      writeUint32(data, i + 20, mvhdBoxDuration);
      i += 24;
      continue;
    }
    // tkhd
    if (data[i] === 0x74 && data[i + 1] === 0x6b && data[i + 2] === 0x68 && data[i + 3] === 0x64) {
      writeUint32(data, i + 24, mvhdBoxDuration);
      i += 28;
      continue;
    }
    // mdhd
    if (data[i] === 0x6d && data[i + 1] === 0x64 && data[i + 2] === 0x68 && data[i + 3] === 0x64) {
      const mdhdBoxDuration = getBoxDuration(data, duration, i);
      writeUint32(data, i + 20, mdhdBoxDuration);
      i += 24;
      continue;
    }
    // stop when media data (mdat) begins
    if (data[i] === 0x6d && data[i + 1] === 0x64 && data[i + 2] === 0x61 && data[i + 3] === 0x74) {
      return data;
    }
  }

  return data;
}

function transmuxTsToMp4(tsBytes, duration = 0) {
  let mux = null;
  if (typeof globalThis !== 'undefined' && globalThis.muxjs) {
    mux = globalThis.muxjs;
  } else if (typeof window !== 'undefined' && window.muxjs) {
    mux = window.muxjs;
  } else if (typeof require !== 'undefined') {
    try {
      mux = require('mux.js');
    } catch {
      // Ignore
    }
  }

  if (!mux || !mux.mp4 || !mux.mp4.Transmuxer) {
    console.warn('mux.js Transmuxer not found, skipping MP4 transmuxing.');
    return tsBytes;
  }

  const transmuxer = new mux.mp4.Transmuxer({
    keepOriginalTimestamps: false,
    remux: true
  });

  const parts = [];

  transmuxer.on('data', (segment) => {
    if (segment.initSegment) {
      parts.push(segment.initSegment);
    }
    if (segment.data) {
      parts.push(segment.data);
    }
  });

  const bytes = tsBytes instanceof Uint8Array ? tsBytes : new Uint8Array(tsBytes);
  transmuxer.push(bytes);
  transmuxer.flush();

  if (parts.length === 0) {
    return bytes;
  }

  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const mergedMp4 = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    mergedMp4.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }

  if (duration > 0) {
    return fixFileDuration(mergedMp4, duration);
  }

  return mergedMp4;
}

const StegoTransmuxer = { transmuxTsToMp4, fixFileDuration };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoTransmuxer;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoTransmuxer = StegoTransmuxer;
}
