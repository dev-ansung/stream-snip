const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

globalThis.StegoBytes = require('../lib/bytes.js');

// lib/lame.min.js is a classic (non-UMD) script that defines a global
// `lamejs`, the same way it would after a <script> tag loads it in
// popup.html. Load it into a sandbox context and hang it off `globalThis`
// so encodePcmToMp3 (which reads globalThis.lamejs) can find it, exactly
// like it would in the real popup.
const lameSrc = fs.readFileSync(path.join(__dirname, '..', 'lib', 'lame.min.js'), 'utf8');
const lameSandbox = {};
vm.createContext(lameSandbox);
vm.runInContext(lameSrc, lameSandbox);
globalThis.lamejs = lameSandbox.lamejs;

const { encodeMp4ToMp3, encodePcmToMp3 } = require('../lib/mp3-encoder.js');

function sineWave(seconds, sampleRate, freq = 440, amplitude = 0.5) {
  const n = Math.round(seconds * sampleRate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sampleRate) * amplitude;
  }
  return out;
}

const MPEG1_L3_BITRATES_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1
];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000, -1];

// Parses a real MPEG-1 Layer III frame header (not just a sync-byte scan),
// so a malformed encoder output can't pass by coincidentally containing a
// 0xFF 0xEx byte pair somewhere in its payload.
function parseMpegFrameHeader(buf, pos) {
  if (pos + 4 > buf.length) return null;
  const b0 = buf[pos];
  const b1 = buf[pos + 1];
  const b2 = buf[pos + 2];
  if (b0 !== 0xff || (b1 & 0xe0) !== 0xe0) return null;

  const versionBits = (b1 >> 3) & 0x03; // 3 = MPEG-1
  const layerBits = (b1 >> 1) & 0x03; // 1 = Layer III
  if (versionBits !== 3 || layerBits !== 1) return null;

  const bitrateIdx = (b2 >> 4) & 0x0f;
  const sampleRateIdx = (b2 >> 2) & 0x03;
  const padding = (b2 >> 1) & 0x01;
  const bitrate = MPEG1_L3_BITRATES_KBPS[bitrateIdx];
  const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIdx];
  if (bitrate <= 0 || sampleRate <= 0) return null;

  const frameLength = Math.floor((144 * bitrate * 1000) / sampleRate) + padding;
  return { frameLength, bitrate, sampleRate };
}

// Walks the buffer strictly frame-by-frame: each frame's declared length
// must land exactly on the next frame's sync word, all the way to the end,
// with zero gaps or misalignment.
function assertWellFormedMp3(bytes) {
  let pos = 0;
  let frameCount = 0;
  while (pos < bytes.length) {
    const frame = parseMpegFrameHeader(bytes, pos);
    assert.ok(frame, `invalid/unparseable MPEG frame header at byte offset ${pos}`);
    frameCount++;
    pos += frame.frameLength;
  }
  assert.equal(pos, bytes.length, 'frame walk did not exactly consume the buffer');
  assert.ok(frameCount > 0, 'expected at least one MP3 frame');
  return frameCount;
}

test('encodePcmToMp3 produces a strictly well-formed, frame-accurate MP3 bitstream (stereo)', () => {
  const sampleRate = 44100;
  const left = sineWave(1, sampleRate, 440);
  const right = sineWave(1, sampleRate, 440);

  const out = encodePcmToMp3([left, right], sampleRate, 192);
  assert.ok(out instanceof Uint8Array);
  assert.ok(out.length > 0);

  const frameCount = assertWellFormedMp3(out);
  assert.ok(frameCount >= 35 && frameCount <= 45, `unexpected frame count: ${frameCount}`);
});

test('encodePcmToMp3 handles mono input by duplicating the single channel', () => {
  const sampleRate = 44100;
  const mono = sineWave(0.25, sampleRate, 220);

  const out = encodePcmToMp3([mono], sampleRate, 128);
  assertWellFormedMp3(out);
});

test('encodePcmToMp3 throws a clear error when lamejs is missing', () => {
  const saved = globalThis.lamejs;
  delete globalThis.lamejs;
  try {
    assert.throws(() => {
      encodePcmToMp3([new Float32Array(10)], 44100, 128);
    }, /lamejs.*not loaded/);
  } finally {
    globalThis.lamejs = saved;
  }
});

test('encodeMp4ToMp3 throws a clear error when Web Audio API is unavailable', async () => {
  await assert.rejects(async () => {
    await encodeMp4ToMp3(new Uint8Array([1, 2, 3]));
  }, /Web Audio API is not available/);
});

test('encodeMp4ToMp3 throws a clear error when lamejs is missing, even with AudioContext present', async () => {
  class FakeAudioContext {
    async decodeAudioData() {
      throw new Error('should not be called before the lamejs check');
    }
  }
  globalThis.AudioContext = FakeAudioContext;
  const savedLame = globalThis.lamejs;
  delete globalThis.lamejs;
  try {
    await assert.rejects(async () => {
      await encodeMp4ToMp3(new Uint8Array([1, 2, 3]));
    }, /lamejs.*not loaded/);
  } finally {
    delete globalThis.AudioContext;
    globalThis.lamejs = savedLame;
  }
});
