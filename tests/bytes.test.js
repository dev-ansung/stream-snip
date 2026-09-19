const test = require('node:test');
const assert = require('node:assert/strict');
const { concatUint8Arrays } = require('../lib/bytes.js');

test('concatUint8Arrays joins chunks in order', () => {
  const c1 = new Uint8Array([1, 2, 3]);
  const c2 = new Uint8Array([4, 5]);
  const c3 = new Uint8Array([6]);

  const out = concatUint8Arrays([c1, c2, c3]);
  assert.equal(out.byteLength, 6);
  assert.deepEqual(Array.from(out), [1, 2, 3, 4, 5, 6]);
});

test('concatUint8Arrays skips falsy entries (holes)', () => {
  const c1 = new Uint8Array([1, 2]);
  const c2 = null;
  const c3 = new Uint8Array([3]);

  const out = concatUint8Arrays([c1, c2, c3]);
  assert.equal(out.byteLength, 3);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
});

test('concatUint8Arrays returns an empty Uint8Array for no input', () => {
  assert.equal(concatUint8Arrays([]).byteLength, 0);
  assert.equal(concatUint8Arrays(null).byteLength, 0);
});

test('concatUint8Arrays accepts Int8Array chunks and preserves byte patterns', () => {
  const c1 = new Int8Array([0x47, 0x40]);
  const out = concatUint8Arrays([c1]);
  assert.equal(out.byteLength, 2);
  assert.equal(out[0], 0x47);
  assert.equal(out[1], 0x40);
});
