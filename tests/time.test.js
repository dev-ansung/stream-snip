const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTimestamp, formatDuration, formatBitrate, formatBytes } = require('../lib/time.js');

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

test('formatBitrate formats kbps and Mbps', () => {
  assert.equal(formatBitrate(800000), '800 kbps');
  assert.equal(formatBitrate(2450000), '2.45 Mbps');
  assert.equal(formatBitrate(0), '--');
});

test('formatBytes formats KB, MB, and GB', () => {
  assert.equal(formatBytes(500 * 1024), '500.0 KB');
  assert.equal(formatBytes(45 * 1024 * 1024), '45.0 MB');
  assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.50 GB');
  assert.equal(formatBytes(0), '--');
});

