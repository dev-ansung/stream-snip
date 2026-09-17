/**
 * Steganographic decoder for HLS video segments.
 * 
 * Many protected streaming sites disguise MPEG-TS packets by prepending a 
 * dummy 1x1 PNG header image. The real MPEG-TS transport stream bytes start 
 * immediately following the PNG 'IEND' chunk marker + 4-byte CRC.
 */

function isPng(bytes) {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0D && bytes[5] === 0x0A && bytes[6] === 0x1A && bytes[7] === 0x0A;
}

function stripStego(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  if (!isPng(bytes)) {
    return bytes;
  }

  // Look for IEND chunk marker: 'IEND' = [0x49, 0x45, 0x4E, 0x44]
  for (let i = 0; i <= bytes.length - 8; i++) {
    if (bytes[i] === 0x49 && bytes[i + 1] === 0x45 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x44) {
      // IEND chunk is 4 bytes length (00 00 00 00) + 'IEND' + 4 bytes CRC
      // Video payload begins immediately after the 4-byte CRC
      const mpegTsStart = i + 8;
      if (mpegTsStart < bytes.length) {
        return bytes.subarray(mpegTsStart);
      }
    }
  }

  return bytes;
}

const StegoDecoder = { isPng, stripStego };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoDecoder;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoDecoder = StegoDecoder;
}
