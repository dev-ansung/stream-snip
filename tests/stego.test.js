const test = require('node:test');
const assert = require('node:assert/strict');
const { isPng, stripStego } = require('../lib/stego.js');

test('isPng detects PNG headers', () => {
  const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(isPng(pngHeader), true);

  const rawTsHeader = new Uint8Array([0x47, 0x40, 0x00, 0x10]);
  assert.equal(isPng(rawTsHeader), false);
});

test('stripStego strips dummy PNG wrapping and leaves MPEG-TS payload', () => {
  // Construct a dummy PNG with an IEND chunk followed by MPEG-TS packets
  // PNG Magic (8 bytes)
  const pngMagic = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // Dummy IHDR (10 bytes)
  const dummyIhdr = [0x00, 0x00, 0x00, 0x01, 0x49, 0x48, 0x44, 0x52, 0x11, 0x22];
  // IEND chunk: length 0 (4 bytes), 'IEND' (4 bytes), CRC (4 bytes)
  const iendChunk = [0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  // Video payload: MPEG-TS sync byte 0x47 + sample bytes
  const videoPayload = [0x47, 0x40, 0x00, 0x10, 0xca, 0xfe, 0xba, 0xbe];

  const fullStream = new Uint8Array([...pngMagic, ...dummyIhdr, ...iendChunk, ...videoPayload]);

  const stripped = stripStego(fullStream);

  assert.equal(stripped.length, videoPayload.length);
  assert.equal(stripped[0], 0x47);
  assert.deepEqual(Array.from(stripped), videoPayload);
});

test('stripStego leaves pure MPEG-TS unchanged', () => {
  const pureTs = new Uint8Array([0x47, 0x40, 0x00, 0x10, 0x00, 0x01, 0x02]);
  const result = stripStego(pureTs);
  assert.equal(result.length, pureTs.length);
  assert.deepEqual(Array.from(result), Array.from(pureTs));
});
