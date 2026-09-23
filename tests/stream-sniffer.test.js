const test = require('node:test');
const assert = require('node:assert/strict');
const StreamSniffer = require('../lib/stream-sniffer.js');

test('isM3u8Url matches common URL shapes', () => {
  assert.ok(StreamSniffer.isM3u8Url('https://cdn.example.com/video/master.m3u8'));
  assert.ok(StreamSniffer.isM3u8Url('https://cdn.example.com/m3u8/abc123'));
  assert.ok(StreamSniffer.isM3u8Url('https://cdn.example.com/urlset/master?x=1'));
  assert.ok(!StreamSniffer.isM3u8Url('https://cdn.example.com/video.mp4?stream=1'));
  assert.ok(!StreamSniffer.isM3u8Url(''));
  assert.ok(!StreamSniffer.isM3u8Url(undefined));
});

test('isM3u8ContentType matches known HLS MIME types regardless of parameters', () => {
  assert.ok(StreamSniffer.isM3u8ContentType('application/vnd.apple.mpegurl'));
  assert.ok(StreamSniffer.isM3u8ContentType('APPLICATION/X-MPEGURL'));
  assert.ok(StreamSniffer.isM3u8ContentType('application/mpegurl; charset=utf-8'));
  assert.ok(!StreamSniffer.isM3u8ContentType('video/mp4'));
  assert.ok(!StreamSniffer.isM3u8ContentType(''));
  assert.ok(!StreamSniffer.isM3u8ContentType(undefined));
});

test('looksLikeM3u8Request catches signed URLs with no .m3u8 in the path via Content-Type', () => {
  const signedUrl =
    'https://908373595.tapecontent.net/radosgw/kb40awQ/yrHJPcaONcEsSQRH1xbbMJrrGYH0VZXUMru?stream=1';
  assert.ok(
    !StreamSniffer.isM3u8Url(signedUrl),
    'sanity check: this URL shape has no m3u8 marker at all'
  );
  assert.ok(
    StreamSniffer.looksLikeM3u8Request({
      url: signedUrl,
      contentType: 'application/vnd.apple.mpegurl'
    }),
    'must fall back to Content-Type when the URL gives no hint'
  );
});

test('looksLikeM3u8Request still matches on URL alone when Content-Type is missing or wrong', () => {
  assert.ok(
    StreamSniffer.looksLikeM3u8Request({
      url: 'https://cdn.example.com/master.m3u8',
      contentType: undefined
    })
  );
  assert.ok(
    StreamSniffer.looksLikeM3u8Request({
      url: 'https://cdn.example.com/master.m3u8',
      contentType: 'application/octet-stream'
    })
  );
});

test('looksLikeM3u8Request rejects unrelated content', () => {
  assert.ok(
    !StreamSniffer.looksLikeM3u8Request({
      url: 'https://example.com/video.mp4',
      contentType: 'video/mp4'
    })
  );
  assert.ok(!StreamSniffer.looksLikeM3u8Request({}));
});

test('isDirectMediaUrl recognizes direct video/audio extensions, including URL-encoded and query-suffixed paths', () => {
  // Exact shape of a real signed CDN URL that has no ".m3u8" anywhere, ends
  // in a URL-encoded "@" before the extension, and carries a query string.
  const signedMp4 =
    'https://908373595.tapecontent.net/radosgw/kb40awQ/3lwDmLBQNqs40bCZtTiE6t0ENret5Cj/supjav.com%40sqte-406-ub.mp4?stream=1';
  assert.ok(StreamSniffer.isDirectMediaUrl(signedMp4));
  assert.ok(StreamSniffer.isDirectMediaUrl('https://cdn.example.com/clip.webm'));
  assert.ok(!StreamSniffer.isDirectMediaUrl('https://cdn.example.com/master.m3u8'));
  assert.ok(!StreamSniffer.isDirectMediaUrl('https://cdn.example.com/no-extension'));
});

test('isDirectMediaContentType recognizes video/audio MIME types but not HLS ones', () => {
  assert.ok(StreamSniffer.isDirectMediaContentType('video/mp4'));
  assert.ok(StreamSniffer.isDirectMediaContentType('audio/mpeg; charset=binary'));
  assert.ok(!StreamSniffer.isDirectMediaContentType('application/vnd.apple.mpegurl'));
  assert.ok(!StreamSniffer.isDirectMediaContentType('text/html'));
  assert.ok(!StreamSniffer.isDirectMediaContentType(undefined));
});

test('classifyMediaRequest distinguishes hls from direct media and rejects everything else', () => {
  assert.equal(
    StreamSniffer.classifyMediaRequest({ url: 'https://cdn.example.com/master.m3u8' }),
    'hls'
  );
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://908373595.tapecontent.net/radosgw/x/supjav.com%40sqte-406-ub.mp4?stream=1'
    }),
    'direct'
  );
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/signed?token=abc',
      contentType: 'video/mp4'
    }),
    'direct',
    'Content-Type must catch a direct file whose URL gives no extension hint'
  );
  assert.equal(StreamSniffer.classifyMediaRequest({ url: 'https://example.com/page.html' }), null);
});

test('hasConflictingExtension flags known-non-media extensions regardless of case or query string', () => {
  assert.ok(
    StreamSniffer.hasConflictingExtension('https://cdn.example.com/seg-121-f3-v1-a1.woff2')
  );
  assert.ok(StreamSniffer.hasConflictingExtension('https://cdn.example.com/tracker.WOFF2?x=1'));
  assert.ok(StreamSniffer.hasConflictingExtension('https://cdn.example.com/bundle.js'));
  assert.ok(!StreamSniffer.hasConflictingExtension('https://cdn.example.com/video.mp4'));
  assert.ok(!StreamSniffer.hasConflictingExtension('https://cdn.example.com/master.m3u8'));
  assert.ok(!StreamSniffer.hasConflictingExtension('https://cdn.example.com/no-extension'));
});

test('classifyMediaRequest rejects a spoofed Content-Type on a font/script/style/image URL (ad-fraud "fake segment" pattern)', () => {
  // Real-world case: an ad/tracker domain serves rapid-fire ".woff2"-named
  // URLs (seg-121-f3-v1-a1.woff2, seg-120-..., ...) with a spoofed
  // video/audio Content-Type specifically to bait media sniffers.
  const fakeSegmentUrl = 'https://in1rhjc5cqhz.auroravisionstudios.store/seg-121-f3-v1-a1.woff2';
  assert.equal(
    StreamSniffer.classifyMediaRequest({ url: fakeSegmentUrl, contentType: 'video/mp2t' }),
    null,
    'a .woff2 URL claiming to be video must be rejected even though Content-Type alone would normally match'
  );
  assert.equal(
    StreamSniffer.classifyMediaRequest({ url: fakeSegmentUrl, contentType: 'audio/mp4' }),
    null
  );
  // Legitimate media must be unaffected by the conflict check.
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/clip.mp4',
      contentType: 'video/mp4'
    }),
    'direct'
  );
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/master.m3u8',
      contentType: undefined
    }),
    'hls'
  );
});

test('getContentDispositionExtension extracts filename extension from both disposition forms', () => {
  assert.equal(
    StreamSniffer.getContentDispositionExtension('attachment; filename="clip.mp4"'),
    'mp4'
  );
  assert.equal(
    StreamSniffer.getContentDispositionExtension("attachment; filename*=UTF-8''movie.webm"),
    'webm'
  );
  assert.equal(StreamSniffer.getContentDispositionExtension(''), '');
  assert.equal(StreamSniffer.getContentDispositionExtension(undefined), '');
});

test('classifyMediaRequest catches a stream via Content-Disposition filename when URL/Content-Type give no hint', () => {
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/download?id=abc123',
      contentType: 'application/octet-stream',
      contentDisposition: 'attachment; filename="episode-04.mp4"'
    }),
    'direct'
  );
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/download?id=abc123',
      contentDisposition: 'attachment; filename="playlist.m3u8"'
    }),
    'hls'
  );
  // A conflicting Content-Disposition filename is checked only as a
  // fallback signal — it doesn't retroactively veto a URL/Content-Type
  // match that already independently confirmed the request.
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/download?id=abc123',
      contentDisposition: 'attachment; filename="tracker.woff2"'
    }),
    null,
    'a conflicting disposition filename must not match when nothing else does'
  );
});

test('classifyMediaRequest trusts Chrome\'s own "media" resourceType even without a matching extension/Content-Type', () => {
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/stream?sessionid=xyz',
      resourceType: 'media'
    }),
    'direct'
  );
  // Still rejected if the URL extension conflicts, even for resourceType media
  // (belt and suspenders — this combination shouldn't occur for real media).
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/tracker.js',
      resourceType: 'media'
    }),
    null
  );
  // resourceType alone (no url/contentType/disposition match) must not
  // match for non-media types.
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/page',
      resourceType: 'xmlhttprequest'
    }),
    null
  );
});

test('classifyMediaRequest recognizes the expanded safe extension set (mpeg/mpeg4/movie/divx/vid, application/ogg)', () => {
  assert.equal(
    StreamSniffer.classifyMediaRequest({ url: 'https://cdn.example.com/clip.mpeg' }),
    'direct'
  );
  assert.equal(
    StreamSniffer.classifyMediaRequest({ url: 'https://cdn.example.com/clip.divx' }),
    'direct'
  );
  assert.equal(
    StreamSniffer.classifyMediaRequest({
      url: 'https://cdn.example.com/x',
      contentType: 'application/ogg'
    }),
    'direct'
  );
});

test('isM3u8Url also matches a bare .m3u playlist extension', () => {
  assert.ok(StreamSniffer.isM3u8Url('https://cdn.example.com/audio/playlist.m3u'));
  assert.ok(StreamSniffer.isM3u8Url('https://cdn.example.com/audio/playlist.m3u?x=1'));
});
