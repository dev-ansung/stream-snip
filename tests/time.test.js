const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimestamp, formatDuration } = require('../lib/time.js');

test('parseTimestamp handles MM:SS', () => {
  assert.equal(parseTimestamp('01:40'), 100);
  assert.equal(parseTimestamp('08:00'), 480);
  assert.equal(parseTimestamp('00:05'), 5);
});

test('parseTimestamp handles HH:MM:SS', () => {
  assert.equal(parseTimestamp('01:03:00'), 3780);
  assert.equal(parseTimestamp('02:18:00'), 8280);
});

test('parseTimestamp handles raw seconds', () => {
  assert.equal(parseTimestamp('45'), 45);
  assert.equal(parseTimestamp('12.5'), 12.5);
  assert.equal(parseTimestamp(120), 120);
});

test('parseTimestamp throws on invalid input', () => {
  assert.throws(() => parseTimestamp('invalid'), /Invalid timestamp/);
});

test('formatDuration formats correctly', () => {
  assert.equal(formatDuration(5), '00:05');
  assert.equal(formatDuration(100), '01:40');
  assert.equal(formatDuration(3780), '01:03:00');
  assert.equal(formatDuration(-1), '00:00');
});
