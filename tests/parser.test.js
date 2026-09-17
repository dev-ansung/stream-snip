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

test('PlaylistParser infers sibling variants from index-f3 URL', () => {
  const dummyContent = '#EXTM3U\n#EXTINF:10.0,\nseg0.ts\n';
  const url = 'https://fc2stream.tv/hls/123/index-f3-v1-a1.m3u8?token=xyz';
  const variants = PlaylistParser.parseVariants(dummyContent, url);

  assert.equal(variants.length, 4);
  assert.equal(variants[0].height, 1080);
  assert.ok(variants[0].url.includes('index-f1-'));
  assert.ok(variants[0].label.includes('1080p'));

  assert.equal(variants[1].height, 720);
  assert.ok(variants[1].url.includes('index-f2-'));

  assert.equal(variants[2].height, 480);
  assert.ok(variants[2].url.includes('index-f3-'));

  assert.equal(variants[3].height, 360);
  assert.ok(variants[3].url.includes('index-f4-'));
});
