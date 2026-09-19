const test = require('node:test');
const assert = require('node:assert/strict');
const { PlaylistParser } = require('../lib/parser.js');

test('PlaylistParser resolves sub-playlist from master playlist', () => {
  const masterM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
low/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
high/index.m3u8
`;
  const resolved = PlaylistParser.resolveSubPlaylist(
    masterM3u8,
    'https://cdn.example.com/master.m3u8'
  );
  assert.equal(resolved, 'https://cdn.example.com/high/index.m3u8');

  const variants = PlaylistParser.parseVariants(masterM3u8, 'https://cdn.example.com/master.m3u8');
  assert.equal(variants.length, 2);
  assert.equal(variants[0].resolution, '1280x720');
  assert.equal(variants[0].height, 720);
  assert.ok(variants[0].label.includes('720p'));
  assert.equal(variants[1].resolution, '640x360');
});

test('PlaylistParser parses media playlist segments and builds timeline', () => {
  const mediaM3u8 = `#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:6
#EXTINF:5.000,
seg0.ts
#EXTINF:5.000,
seg1.ts
#EXTINF:4.500,
seg2.ts
#EXT-X-ENDLIST
`;
  const timeline = PlaylistParser.parseManifest(mediaM3u8, 'https://cdn.example.com/stream/');
  assert.equal(timeline.segments.length, 3);
  assert.equal(timeline.totalDuration, 14.5);

  assert.equal(timeline.segments[0].url, 'https://cdn.example.com/stream/seg0.ts');
  assert.equal(timeline.segments[0].startTime, 0.0);
  assert.equal(timeline.segments[0].endTime, 5.0);

  assert.equal(timeline.segments[1].startTime, 5.0);
  assert.equal(timeline.segments[1].endTime, 10.0);

  assert.equal(timeline.segments[2].startTime, 10.0);
  assert.equal(timeline.segments[2].endTime, 14.5);
});

test('Timeline getOverlappingSegments selects correct range', () => {
  const mediaM3u8 = `#EXTM3U
#EXTINF:10.0,
seg0.ts
#EXTINF:10.0,
seg1.ts
#EXTINF:10.0,
seg2.ts
#EXTINF:10.0,
seg3.ts
#EXT-X-ENDLIST
`;
  const timeline = PlaylistParser.parseManifest(mediaM3u8, 'https://cdn.example.com/');

  // Range 12 to 25 overlaps seg1 (10-20) and seg2 (20-30)
  const overlapping = timeline.getOverlappingSegments(12, 25);
  assert.equal(overlapping.length, 2);
  assert.equal(overlapping[0].index, 1);
  assert.equal(overlapping[1].index, 2);

  // Range 0 to 5 overlaps only seg0
  const firstOnly = timeline.getOverlappingSegments(0, 5);
  assert.equal(firstOnly.length, 1);
  assert.equal(firstOnly[0].index, 0);
});

test('PlaylistParser falls back to a single variant when no #EXT-X-STREAM-INF is present', () => {
  const dummyContent = '#EXTM3U\n#EXTINF:10.0,\nseg0.ts\n';

  // Resolution hinted in the URL itself (no variant tags in the playlist)
  const withRes = PlaylistParser.parseVariants(
    dummyContent,
    'https://cdn.example.com/hls/720p/index.m3u8?token=xyz'
  );
  assert.equal(withRes.length, 1);
  assert.equal(withRes[0].height, 720);
  assert.ok(withRes[0].label.includes('720p'));

  // No resolution hint anywhere: generic single-stream fallback
  const noHint = PlaylistParser.parseVariants(
    dummyContent,
    'https://cdn.example.com/hls/stream/index.m3u8?token=xyz'
  );
  assert.equal(noHint.length, 1);
  assert.equal(noHint[0].height, 0);
  assert.equal(noHint[0].label, 'Default (Original Stream)');
});

test('PlaylistParser parseMediaPlaylist alias functions identically to parseManifest', () => {
  const mediaM3u8 = `#EXTM3U
#EXTINF:6.0,
seg0.ts
#EXT-X-ENDLIST
`;
  const timeline = PlaylistParser.parseMediaPlaylist(mediaM3u8, 'https://cdn.example.com/');
  assert.equal(timeline.segments.length, 1);
  assert.equal(timeline.totalDuration, 6.0);
  assert.equal(timeline.segments[0].url, 'https://cdn.example.com/seg0.ts');
});

test('PlaylistParser resolves relative segment URLs matching standard urljoin', () => {
  const mediaM3u8 = `#EXTM3U
#EXTINF:6.0,
seg0.ts
#EXT-X-ENDLIST
`;
  const timeline = PlaylistParser.parseManifest(
    mediaM3u8,
    'https://cdn.example.com/hls/index.m3u8?token=secret123&expires=9999'
  );
  assert.equal(timeline.segments.length, 1);
  assert.equal(timeline.segments[0].url, 'https://cdn.example.com/hls/seg0.ts');
});

test('Timeline getClipPlan computes relative bounded offsets deep in a stream', () => {
  // Simulate a 1-hour stream with 6-second segments
  const segments = [];
  for (let i = 0; i < 600; i++) {
    const start = i * 6.0;
    const dur = 6.0;
    segments.push({
      index: i,
      url: `https://cdn.example.com/seg_${i}.ts`,
      duration: dur,
      startTime: start,
      endTime: start + dur,
      get start() {
        return this.startTime;
      },
      get end() {
        return this.endTime;
      }
    });
  }
  const { Timeline } = require('../lib/parser.js');
  const timeline = new Timeline(segments);

  // Request clip from 35:04.5 (2104.5s) to 37:30.0 (2250.0s)
  const plan = timeline.getClipPlan(2104.5, 2250.0);

  // First overlapping segment is seg 350 (starts at 350 * 6 = 2100.0)
  assert.equal(plan.firstSegmentStart, 2100.0);
  assert.equal(plan.segments[0].index, 350);

  // trimStart must be relative to the first segment (2104.5 - 2100.0 = 4.5s), NOT absolute (2104.5s)
  assert.equal(plan.trimStart, 4.5);
  assert.ok(plan.trimStart < plan.segments[0].duration);
  assert.equal(plan.duration, 145.5);
  assert.equal(plan.trimEnd, 150.0);

  // Alias getters
  assert.equal(plan.segments[0].start, plan.segments[0].startTime);
  assert.equal(plan.segments[0].end, plan.segments[0].endTime);
});
