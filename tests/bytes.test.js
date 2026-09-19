const test = require('node:test');
const assert = require('node:assert/strict');
const { concatUint8Arrays } = require('../lib/bytes.js');

test('concatUint8Arrays joins chunks in order', () => {
  const out = concatUint8Arrays([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]);
  assert.deepEqual(Array.from(out), [1, 2, 3, 4, 5]);
});

test('concatUint8Arrays skips falsy entries (holes)', () => {
  const out = concatUint8Arrays([new Uint8Array([1]), null, undefined, new Uint8Array([2])]);
  assert.deepEqual(Array.from(out), [1, 2]);
});

test('concatUint8Arrays returns an empty Uint8Array for no input', () => {
  assert.deepEqual(Array.from(concatUint8Arrays([])), []);
});

test('concatUint8Arrays accepts Int8Array chunks and preserves byte patterns', () => {
  // lamejs (lib/mp3-encoder.js) hands back Int8Array frame buffers.
  const signed = new Int8Array([-1, 0, 127, -128]);
  const out = concatUint8Arrays([signed]);
  assert.deepEqual(Array.from(out), [0xff, 0x00, 0x7f, 0x80]);
});
