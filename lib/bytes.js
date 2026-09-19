/**
 * Shared byte-buffer helpers used across the download/transmux/encode pipeline.
 */

/**
 * Concatenates a list of Uint8Array-like chunks into a single contiguous
 * Uint8Array. Falsy entries (e.g. holes from a failed/skipped segment) are
 * skipped.
 * @param {Array<Uint8Array|Int8Array|null|undefined>} chunks
 * @returns {Uint8Array}
 */
function concatUint8Arrays(chunks) {
  let totalLength = 0;
  for (const chunk of chunks) {
    if (chunk) totalLength += chunk.byteLength;
  }

  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const StegoBytes = { concatUint8Arrays };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoBytes;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoBytes = StegoBytes;
}
