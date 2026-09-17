/**
 * Transmuxer to convert clean MPEG-TS streams into standard MP4
 * using mux.js without re-encoding video or audio.
 */

function transmuxTsToMp4(tsBytes) {
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

  return mergedMp4;
}

const StegoTransmuxer = { transmuxTsToMp4 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoTransmuxer;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoTransmuxer = StegoTransmuxer;
}
