/**
 * Decodes an audio-only MP4 buffer via the Web Audio API and re-encodes the
 * PCM samples to real MP3 (MPEG-1/2 Layer III) using lamejs (lib/lame.min.js).
 * The Web Audio decode step is browser-only (requires AudioContext), so
 * encodeMp4ToMp3 only runs from popup.html. The PCM->MP3 encode step itself
 * (encodePcmToMp3) has no browser dependency beyond lamejs, so it's kept
 * separate and is exercised directly in tests/mp3-encoder.test.js.
 */

function floatTo16BitPCM(floatSamples) {
  const out = new Int16Array(floatSamples.length);
  for (let i = 0; i < floatSamples.length; i++) {
    const s = Math.max(-1, Math.min(1, floatSamples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function getLameJs() {
  return typeof globalThis !== 'undefined' ? globalThis.lamejs : undefined;
}

/**
 * Encodes PCM channel data to MP3 using lamejs.
 * @param {Float32Array[]} channelData - One Float32Array per channel (max 2 used)
 * @param {number} sampleRate
 * @param {number} kbps - Target MP3 bitrate
 * @returns {Uint8Array} - MP3 file bytes
 */
function encodePcmToMp3(channelData, sampleRate, kbps = 192) {
  const encoderLib = getLameJs();
  if (!encoderLib || !encoderLib.Mp3Encoder) {
    throw new Error('MP3 encoder library (lamejs) is not loaded.');
  }

  const channels = Math.min(2, channelData.length);
  const left = floatTo16BitPCM(channelData[0]);
  const right = channels > 1 ? floatTo16BitPCM(channelData[1]) : left;

  const encoder = new encoderLib.Mp3Encoder(channels, sampleRate, kbps);
  const blockSize = 1152;
  const chunks = [];
  for (let i = 0; i < left.length; i += blockSize) {
    const encoded = encoder.encodeBuffer(
      left.subarray(i, i + blockSize),
      right.subarray(i, i + blockSize)
    );
    if (encoded.length > 0) chunks.push(encoded);
  }
  const finalChunk = encoder.flush();
  if (finalChunk.length > 0) chunks.push(finalChunk);

  return StegoBytes.concatUint8Arrays(chunks);
}

/**
 * @param {Uint8Array} audioMp4Bytes - Audio-only MP4 (e.g. from StegoTransmuxer.transmuxTsToAudioMp4)
 * @param {number} kbps - Target MP3 bitrate
 * @param {any} [options]
 * @returns {Promise<Uint8Array>} - MP3 file bytes
 */
async function encodeMp4ToMp3(audioMp4Bytes, kbps = 192, options = {}) {
  const AudioContextCtor =
    (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) ||
    (typeof globalThis !== 'undefined' && globalThis.AudioContext);
  if (!AudioContextCtor) {
    throw new Error('Web Audio API is not available in this context.');
  }

  const encoderLib = getLameJs();
  if (!encoderLib || !encoderLib.Mp3Encoder) {
    throw new Error('MP3 encoder library (lamejs) is not loaded.');
  }

  const audioCtx = new AudioContextCtor();
  try {
    // decodeAudioData can detach the source buffer in some implementations,
    // so hand it an isolated copy rather than the caller's own bytes.
    const arrayBuffer = /** @type {ArrayBuffer} */ (
      audioMp4Bytes.buffer.slice(
        audioMp4Bytes.byteOffset,
        audioMp4Bytes.byteOffset + audioMp4Bytes.byteLength
      )
    );
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const channels = Math.min(2, audioBuffer.numberOfChannels);
    let channelData = [audioBuffer.getChannelData(0)];
    if (channels > 1) channelData.push(audioBuffer.getChannelData(1));

    // If fine start or duration trimming is requested, slice the PCM channels
    // directly because decodeAudioData ignores container elst edits.
    const trimStart =
      typeof options.trimStart === 'number' && options.trimStart > 0 ? options.trimStart : 0;
    const duration =
      typeof options.duration === 'number' && options.duration > 0 ? options.duration : 0;

    if (trimStart > 0 || duration > 0) {
      const startSample = Math.min(
        audioBuffer.length,
        Math.round(trimStart * audioBuffer.sampleRate)
      );
      const endSample =
        duration > 0
          ? Math.min(
              audioBuffer.length,
              startSample + Math.round(duration * audioBuffer.sampleRate)
            )
          : audioBuffer.length;
      if (startSample < endSample) {
        channelData = channelData.map((c) => c.subarray(startSample, endSample));
      }
    }

    return encodePcmToMp3(channelData, audioBuffer.sampleRate, kbps);
  } finally {
    if (typeof audioCtx.close === 'function') {
      audioCtx.close().catch(() => {});
    }
  }
}

const StegoMp3Encoder = { encodeMp4ToMp3, encodePcmToMp3 };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoMp3Encoder;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoMp3Encoder = StegoMp3Encoder;
}
