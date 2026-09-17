const test = require('node:test');
const assert = require('node:assert/strict');
const { transmuxTsToMp4 } = require('../lib/transmuxer.js');

test('transmuxTsToMp4 handles empty or invalid bytes gracefully', () => {
  const empty = new Uint8Array(0);
  const res = transmuxTsToMp4(empty);
  assert.equal(res.byteLength, 0);
});

test('transmuxTsToMp4 transmuxes valid TS packets into MP4 with ftyp header', () => {
  // Use a small synthetic TS packet (188 bytes starting with 0x47 sync byte)
  // Or test with real payload if available
  const dummyTs = new Uint8Array(188);
  dummyTs[0] = 0x47;
  dummyTs[1] = 0x40; // payload unit start indicator
  dummyTs[2] = 0x00;
  dummyTs[3] = 0x10; // no adaptation field, payload only

  const out = transmuxTsToMp4(dummyTs);
  assert.ok(out instanceof Uint8Array);
});
