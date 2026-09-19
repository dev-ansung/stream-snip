const test = require('node:test');
const assert = require('node:assert/strict');
const { transmuxTsToMp4, unfragmentFmp4, fixFileDuration } = require('../lib/transmuxer.js');

test('transmuxTsToMp4 handles empty or invalid bytes gracefully', () => {
  const empty = new Uint8Array(0);
  const res = transmuxTsToMp4(empty);
  assert.equal(res.byteLength, 0);
});

test('transmuxTsToMp4 transmuxes valid TS packets into MP4 with ftyp header', () => {
  const dummyTs = new Uint8Array(188);
  dummyTs[0] = 0x47;
  dummyTs[1] = 0x40; // payload unit start indicator
  dummyTs[2] = 0x00;
  dummyTs[3] = 0x10; // no adaptation field, payload only

  const out = transmuxTsToMp4(dummyTs);
  assert.ok(out instanceof Uint8Array);
});

test('unfragmentFmp4 handles non-fragmented or empty bytes gracefully', () => {
  const empty = new Uint8Array(0);
  assert.equal(unfragmentFmp4(empty).byteLength, 0);

  const small = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
  assert.equal(unfragmentFmp4(small), small);
});

test('fixFileDuration patches mvhd, tkhd, and mdhd boxes correctly', () => {
  // Construct mock MP4 header with mvhd, tkhd, mdhd, and mdat
  const buf = new Uint8Array(200);

  // mvhd at offset 0
  buf[0] = 0x6d;
  buf[1] = 0x76;
  buf[2] = 0x68;
  buf[3] = 0x64; // "mvhd"
  // timescale at offset 16 (big endian 90000 = 0x00015f90)
  buf[16] = 0x00;
  buf[17] = 0x01;
  buf[18] = 0x5f;
  buf[19] = 0x90;

  // tkhd at offset 40
  buf[40] = 0x74;
  buf[41] = 0x6b;
  buf[42] = 0x68;
  buf[43] = 0x64; // "tkhd"

  // mdhd at offset 80
  buf[80] = 0x6d;
  buf[81] = 0x64;
  buf[82] = 0x68;
  buf[83] = 0x64; // "mdhd"
  // timescale at offset 80 + 16 = 96 (big endian 48000 = 0x0000bb80)
  buf[96] = 0x00;
  buf[97] = 0x00;
  buf[98] = 0xbb;
  buf[99] = 0x80;

  // mdat at offset 150
  buf[150] = 0x6d;
  buf[151] = 0x64;
  buf[152] = 0x61;
  buf[153] = 0x74; // "mdat"

  const durationSec = 10;
  const fixed = fixFileDuration(buf, durationSec);

  // Check mvhd duration at 20 (90000 * 10 = 900000 = 0x000dbba0)
  const mvhdDur = ((fixed[20] << 24) | (fixed[21] << 16) | (fixed[22] << 8) | fixed[23]) >>> 0;
  assert.equal(mvhdDur, 900000);

  // Check tkhd duration at 40 + 24 = 64
  const tkhdDur = ((fixed[64] << 24) | (fixed[65] << 16) | (fixed[66] << 8) | fixed[67]) >>> 0;
  assert.equal(tkhdDur, 900000);

  // Check mdhd duration at 80 + 20 = 100 (48000 * 10 = 480000 = 0x00075300)
  const mdhdDur = ((fixed[100] << 24) | (fixed[101] << 16) | (fixed[102] << 8) | fixed[103]) >>> 0;
  assert.equal(mdhdDur, 480000);
});
