const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTimestamp,
  formatDuration,
  formatBitrate,
  formatBytes,
  formatTimestampForFilename,
  extractBaseName,
  buildClipFilename,
  detectBaseNameFromTitle
} = require('../lib/time.js');

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

test('formatTimestampForFilename converts colons to underscores', () => {
  assert.equal(formatTimestampForFilename('47:00'), '47_00');
  assert.equal(formatTimestampForFilename('01:03:15'), '01_03_15');
});

test('extractBaseName preserves base and separator without extension', () => {
  assert.deepEqual(extractBaseName('ABF-361.47_00-54_00'), { base: 'ABF-361', sep: '.' });
  assert.deepEqual(extractBaseName('ABF-361_47_00-54_00'), { base: 'ABF-361', sep: '_' });
  assert.deepEqual(extractBaseName('ABF-361_full'), { base: 'ABF-361', sep: '_' });
  assert.deepEqual(extractBaseName('ABF-361'), { base: 'ABF-361', sep: '_' });
  assert.deepEqual(extractBaseName('ABF-361.47_00-54_00.mp4'), { base: 'ABF-361', sep: '.' });
});

test('buildClipFilename formats filename dynamically without mp4 extension', () => {
  assert.equal(buildClipFilename('ABF-361', '47:00', '54:00', false, '.'), 'ABF-361.47_00-54_00');
  assert.equal(buildClipFilename('ABF-361', '47:00', '55:30', false, '_'), 'ABF-361_47_00-55_30');
  assert.equal(buildClipFilename('ABF-361', '00:00', '02:03:06', true, '_'), 'ABF-361_full');
});

test('detectBaseNameFromTitle extracts video code or cleans title', () => {
  assert.equal(
    detectBaseNameFromTitle('[无码破解]ABF-361 人文系女学生沉迷于中年男子的黏腻性爱。黏腻、高湿度、无声的性爱。'),
    'ABF-361'
  );
  assert.equal(detectBaseNameFromTitle('FNS-236 720p HD'), 'FNS-236');
  assert.equal(detectBaseNameFromTitle('FC2-PPV-123456 Video Title'), 'FC2-PPV-123456');
  assert.equal(detectBaseNameFromTitle('Regular Video Without Code'), 'Regular_Video_Without_Code');
});


