/**
 * Fast byte buffer utilities.
 */

/**
 * Concatenates an array of Uint8Arrays into a single Uint8Array.
 * Precalculates total byte length to allocate memory once.
 *
 * @param {Array<Uint8Array | ArrayLike<number>>} arrays
 * @returns {Uint8Array}
 */
function concatUint8Arrays(arrays) {
  if (!arrays || arrays.length === 0) {
    return new Uint8Array(0);
  }

  let totalLength = 0;
  for (let i = 0; i < arrays.length; i++) {
    const arr = arrays[i];
    if (arr) {
      totalLength += arr.length;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (let i = 0; i < arrays.length; i++) {
    const arr = arrays[i];
    if (arr) {
      result.set(arr, offset);
      offset += arr.length;
    }
  }

  return result;
}

const StegoBytes = {
  concatUint8Arrays
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoBytes;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoBytes = StegoBytes;
}
