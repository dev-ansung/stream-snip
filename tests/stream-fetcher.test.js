const test = require('node:test');
const assert = require('node:assert/strict');

// Dependencies required by StreamFetcher
globalThis.StegoParser = require('../lib/parser.js');
globalThis.StreamSniffer = require('../lib/stream-sniffer.js');
globalThis.StegoTime = require('../lib/time.js');

const StreamFetcher = require('../lib/stream-fetcher.js');

test('StreamFetcher.probeStream extracts duration and segment count from media playlist', async () => {
  StreamFetcher.clearCache();
  const sampleManifest = `
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:9.009,
seg0.ts
#EXTINF:9.009,
seg1.ts
#EXTINF:4.500,
seg2.ts
#EXT-X-ENDLIST
  `.trim();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(url.includes('stream.m3u8'));
    return {
      ok: true,
      status: 200,
      text: async () => sampleManifest
    };
  };

  try {
    const stream = { url: 'https://example.com/stream.m3u8', kind: 'hls' };
    const res = await StreamFetcher.probeStream(stream);

    assert.equal(res.ok, true);
    assert.equal(res.kind, 'hls');
    assert.equal(res.segmentCount, 3);
    assert.ok(Math.abs(res.duration - 22.518) < 0.01);
    assert.equal(res.formattedDuration, '00:22');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream resolves master playlist variants and fetches sub-playlist duration', async () => {
  StreamFetcher.clearCache();
  const masterContent = `
#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p.m3u8
  `.trim();

  const subContent = `
#EXTM3U
#EXTINF:10.0,
chunk1.ts
#EXTINF:10.0,
chunk2.ts
#EXT-X-ENDLIST
  `.trim();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('master.m3u8')) {
      return { ok: true, status: 200, text: async () => masterContent };
    }
    if (url.includes('1080p.m3u8')) {
      return { ok: true, status: 200, text: async () => subContent };
    }
    return { ok: false, status: 404 };
  };

  try {
    const stream = { url: 'https://example.com/video/master.m3u8', kind: 'hls' };
    const res = await StreamFetcher.probeStream(stream);

    assert.equal(res.ok, true);
    assert.equal(res.resolution, '1920x1080');
    assert.equal(res.height, 1080);
    assert.equal(res.bitrate, 2500000);
    assert.equal(res.duration, 20.0);
    assert.equal(res.segmentCount, 2);
    assert.equal(res.formattedDuration, '00:20');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream returns ok: false for 404 or server error streams', async () => {
  StreamFetcher.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return { ok: false, status: 404 };
  };

  try {
    const stream = { url: 'https://example.com/broken.m3u8', kind: 'hls' };
    const res = await StreamFetcher.probeStream(stream);

    assert.equal(res.ok, false);
    assert.ok(res.error.includes('404'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream marks 403 or CORS-restricted streams as protected without dropping them', async () => {
  StreamFetcher.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return { ok: false, status: 403 };
  };

  try {
    const stream = { url: 'https://example.com/hotlink-protected.m3u8', kind: 'hls' };
    const res = await StreamFetcher.probeStream(stream);

    assert.equal(res.ok, true);
    assert.equal(res.protected, true);
    assert.equal(res.kind, 'hls');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream returns ok: false for non-M3U8 responses', async () => {
  StreamFetcher.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return { ok: true, status: 200, text: async () => '<html>404 Not Found</html>' };
  };

  try {
    const stream = { url: 'https://example.com/fake.m3u8', kind: 'hls' };
    const res = await StreamFetcher.probeStream(stream);

    assert.equal(res.ok, false);
    assert.ok(res.error.includes('Not a valid M3U8'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream caches results and avoids duplicate network requests', async () => {
  StreamFetcher.clearCache();
  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCount++;
    return {
      ok: true,
      status: 200,
      text: async () => '#EXTM3U\n#EXTINF:5.0,\nseg.ts\n#EXT-X-ENDLIST'
    };
  };

  try {
    const stream = { url: 'https://example.com/cached.m3u8', kind: 'hls' };
    const res1 = await StreamFetcher.probeStream(stream);
    const res2 = await StreamFetcher.probeStream(stream);

    assert.equal(res1.ok, true);
    assert.equal(res2.ok, true);
    assert.equal(fetchCount, 1, 'Subsequent probe must use cache');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeAndFilterStreams hides unloadable streams and enriches valid ones', async () => {
  StreamFetcher.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('valid.m3u8')) {
      return {
        ok: true,
        status: 200,
        text: async () => '#EXTM3U\n#EXTINF:60.0,\nseg.ts\n#EXT-X-ENDLIST'
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const streams = [
      { url: 'https://example.com/broken-1.m3u8', kind: 'hls' },
      { url: 'https://example.com/valid.m3u8', kind: 'hls' },
      { url: 'https://example.com/broken-2.m3u8', kind: 'hls' }
    ];

    const loadable = await StreamFetcher.probeAndFilterStreams(streams);

    assert.equal(loadable.length, 1, 'Must hide streams that do not load');
    assert.equal(loadable[0].url, 'https://example.com/valid.m3u8');
    assert.equal(loadable[0].duration, 60.0);
    assert.equal(loadable[0].formattedDuration, '01:00');
    assert.equal(loadable[0].probed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream rejects Cloudflare challenge URLs without fetching', async () => {
  StreamFetcher.clearCache();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, text: async () => '' };
  };

  try {
    const res = await StreamFetcher.probeStream({
      url: 'https://example.com/cdn-cgi/challenge-platform/h/b/scripts/p.js',
      kind: 'direct'
    });
    assert.equal(res.ok, false);
    assert.equal(fetchCalled, false, 'Must not issue network fetch for challenge URL');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream respects already-probed stream objects without fetching', async () => {
  StreamFetcher.clearCache();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, text: async () => '' };
  };

  try {
    const res = await StreamFetcher.probeStream({
      url: 'https://example.com/already-probed.m3u8',
      probed: true,
      duration: 120,
      formattedDuration: '02:00'
    });
    assert.equal(res.ok, true);
    assert.equal(res.duration, 120);
    assert.equal(fetchCalled, false, 'Must not issue network fetch for already probed stream');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream marks sniffed or referer-bearing HLS streams returning 404 as protected', async () => {
  StreamFetcher.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return { ok: false, status: 404 };
  };

  try {
    const stream = {
      url: 'https://wpvsahsvl0yo.spacetechnologydev.space/hls/master.txt',
      kind: 'hls',
      sniffed: true,
      pageUrl: 'https://evsishere.xyz/video-page',
      headers: { referer: 'https://evsishere.xyz/' }
    };
    const res = await StreamFetcher.probeStream(stream);

    assert.equal(res.ok, true);
    assert.equal(res.protected, true);
    assert.equal(res.kind, 'hls');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeStream marks sniffed HLS streams returning HTML challenge as protected', async () => {
  StreamFetcher.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    return {
      ok: true,
      status: 200,
      text: async () => '<html><title>Just a moment...</title>Cloudflare challenge</html>'
    };
  };

  try {
    const stream = {
      url: 'https://wpvsahsvl0yo.spacetechnologydev.space/hls/index-f3-v1-a1.txt',
      kind: 'hls',
      sniffed: true,
      pageUrl: 'https://evsishere.xyz/video-page'
    };
    const res = await StreamFetcher.probeStream(stream);

    assert.equal(res.ok, true);
    assert.equal(res.protected, true);
    assert.equal(res.kind, 'hls');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('StreamFetcher.probeAndFilterStreams retains sniffed referer-protected HLS streams when unauthenticated probe returns 404', async () => {
  StreamFetcher.clearCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url.includes('valid.m3u8')) {
      return {
        ok: true,
        status: 200,
        text: async () => '#EXTM3U\n#EXTINF:60.0,\nseg.ts\n#EXT-X-ENDLIST'
      };
    }
    return { ok: false, status: 404 };
  };

  try {
    const streams = [
      { url: 'https://example.com/broken-manual.m3u8', kind: 'hls', manual: true },
      { url: 'https://example.com/valid.m3u8', kind: 'hls' },
      {
        url: 'https://wpvsahsvl0yo.spacetechnologydev.space/master.txt',
        kind: 'hls',
        sniffed: true,
        pageUrl: 'https://evsishere.xyz/'
      }
    ];

    const loadable = await StreamFetcher.probeAndFilterStreams(streams);

    assert.equal(loadable.length, 2, 'Must retain valid stream and protected sniffed stream');
    const valid = loadable.find((s) => s.url.includes('valid.m3u8'));
    const sniffed = loadable.find((s) => s.url.includes('spacetechnologydev.space'));

    assert.ok(valid);
    assert.equal(valid.duration, 60.0);
    assert.ok(sniffed);
    assert.equal(sniffed.protected, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
