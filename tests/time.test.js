const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseTimestamp,
  formatDuration,
  formatBitrate,
  formatBytes,
  formatTimestampForFilename,
  formatStartTimeForFilename,
  extractBaseName,
  buildClipFilename,
  buildTrimmedFilename,
  buildPartialFilename,
  cleanTitleForFilename
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
  assert.deepEqual(extractBaseName('REC-4021.47_00-54_00'), { base: 'REC-4021', sep: '.' });
  assert.deepEqual(extractBaseName('REC-4021_47_00-54_00'), { base: 'REC-4021', sep: '_' });
  assert.deepEqual(extractBaseName('REC-4021_full'), { base: 'REC-4021', sep: '_' });
  assert.deepEqual(extractBaseName('REC-4021'), { base: 'REC-4021', sep: '-' });
  assert.deepEqual(extractBaseName('REC-4021.47_00-54_00.mp4'), { base: 'REC-4021', sep: '.' });
  assert.deepEqual(extractBaseName('REC-4021.47_00-54_00.mp3'), { base: 'REC-4021', sep: '.' });
});

test('buildClipFilename formats filename dynamically without mp4 extension', () => {
  assert.equal(buildClipFilename('REC-4021', '47:00', '54:00'), 'REC-4021-47_00-54_00');
  assert.equal(buildClipFilename('REC-4021', '47:00', '54:00', false, '.'), 'REC-4021.47_00-54_00');
  assert.equal(buildClipFilename('REC-4021', '47:00', '55:30', false, '_'), 'REC-4021_47_00-55_30');
  assert.equal(buildClipFilename('REC-4021', '00:00', '02:03:06', true), 'REC-4021-full');
  assert.equal(buildClipFilename('REC-4021.mp3', '47:00', '54:00'), 'REC-4021-47_00-54_00');
});

test('cleanTitleForFilename sanitizes document.title into dash-separated filename title', () => {
  assert.equal(cleanTitleForFilename('[字幕版]REC-4021 発表会'), '[字幕版]REC-4021-発表会');
  assert.equal(cleanTitleForFilename('CAM-2024 720p HD'), 'CAM-2024-720p-HD');
  assert.equal(
    cleanTitleForFilename('REC-SESSION-123456 Video Title'),
    'REC-SESSION-123456-Video-Title'
  );
  assert.equal(cleanTitleForFilename('Regular Video Without Code'), 'Regular-Video-Without-Code');
});

test('extractBaseName upgrades generic names to detected code', () => {
  assert.deepEqual(extractBaseName('video_clip-47_00-54_00', 'REC-4021'), {
    base: 'REC-4021',
    sep: '-'
  });
  assert.deepEqual(extractBaseName('master-1080p-clip', 'REC-4021'), {
    base: 'REC-4021',
    sep: '-'
  });
  assert.deepEqual(extractBaseName('MyCustomClip-47_00-54_00', 'REC-4021'), {
    base: 'MyCustomClip',
    sep: '-'
  });
});

test('extractBaseName handles multiple or chained timestamp suffixes cleanly', () => {
  const uglyString =
    'CLIP-8842_1-02_00_55_1_-02_00_55_1_0-02_00_55_1_03_-02_00_55_1_03_0-02_00_55_1_03_00-1_1_03_00-1__1_03_00-1_1_1_03_00-1_18__1_03_00-1_18_0_1_03_00-1_18_00';
  assert.deepEqual(extractBaseName(uglyString, 'CLIP-8842'), { base: 'CLIP-8842', sep: '-' });
  assert.deepEqual(extractBaseName(uglyString, 'video_clip'), { base: 'CLIP-8842', sep: '-' });
});

test('buildClipFilename normalizes hours into dash-separated title-start-end', () => {
  assert.equal(buildClipFilename('CLIP-8842', '1:03:00', '1:18:00'), 'CLIP-8842-01_03_00-01_18_00');
  assert.equal(
    buildClipFilename('CLIP-8842-新製品発表会', '1:03:00', '1:18:00'),
    'CLIP-8842-新製品発表会-01_03_00-01_18_00'
  );
});

test('formatStartTimeForFilename formats timestamps as HH_MM_SS with 2-digit padding', () => {
  assert.equal(formatStartTimeForFilename('00:04:23'), '00_04_23');
  assert.equal(formatStartTimeForFilename('4:23'), '00_04_23');
  assert.equal(formatStartTimeForFilename(263), '00_04_23');
  assert.equal(formatStartTimeForFilename('01:15:30'), '01_15_30');
  assert.equal(formatStartTimeForFilename('00:00'), '00_00_00');
  assert.equal(formatStartTimeForFilename(0), '00_00_00');
});

test('buildTrimmedFilename formats trimmed downloads with start time and full downloads cleanly', () => {
  assert.equal(buildTrimmedFilename('video1', '00:04:23', 'mp4', true), 'video1.00_04_23.mp4');
  assert.equal(buildTrimmedFilename('video1', 263, 'mp4', true), 'video1.00_04_23.mp4');
  assert.equal(buildTrimmedFilename('video1.mp4', '00:04:23', 'mp4', true), 'video1.00_04_23.mp4');
  assert.equal(
    buildTrimmedFilename('video1.00_04_23', '00:04:23', 'mp4', true),
    'video1.00_04_23.mp4'
  );
  assert.equal(buildTrimmedFilename('video1', '00:04:23', 'mp4', false), 'video1.mp4');
  assert.equal(buildTrimmedFilename('video1', 0, 'mp3', false), 'video1.mp3');
  assert.equal(buildTrimmedFilename('video1', '01:03:15', 'ts', true), 'video1.01_03_15.ts');
});

test('buildPartialFilename formats interrupted downloads with .partial suffix', () => {
  assert.equal(buildPartialFilename('video1.mp4'), 'video1.partial.mp4');
  assert.equal(buildPartialFilename('video1.00_04_23.mp4'), 'video1.00_04_23.partial.mp4');
  assert.equal(buildPartialFilename('video1.partial.mp4'), 'video1.partial.mp4');
  assert.equal(buildPartialFilename('video1', 'mp4'), 'video1.partial.mp4');
  assert.equal(buildPartialFilename('video1.ts', 'mp4'), 'video1.partial.ts');
});
