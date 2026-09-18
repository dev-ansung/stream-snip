const test = require('node:test');
const assert = require('node:assert/strict');
const { SegmentDownloader } = require('../lib/downloader.js');

// StegoDecoder is required by SegmentDownloader in browser / node
globalThis.StegoDecoder = require('../lib/stego.js');

test('SegmentDownloader instantiates with default concurrency', () => {
  const dl = new SegmentDownloader();
  assert.equal(dl.concurrency, 6);

  const customDl = new SegmentDownloader({ concurrency: 3 });
  assert.equal(customDl.concurrency, 3);
});

test('SegmentDownloader downloads, strips stego, and concatenates segments', async () => {
  const originalFetch = globalThis.fetch;
  try {
    // Dummy PNG stego wrapping
    const pngPrefix = [
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a, // PNG Magic
      0x00,
      0x00,
      0x00,
      0x00,
      0x49,
      0x45,
      0x4e,
      0x44,
      0xae,
      0x42,
      0x60,
      0x82 // IEND
    ];

    const fakePayloads = [
      [0x47, 0x10, 0x00, 0x10, 0xaa, 0xbb],
      [0x47, 0x10, 0x00, 0x11, 0xcc, 0xdd]
    ];

    globalThis.fetch = async (url) => {
      const idx = url.includes('seg0') ? 0 : 1;
      const combined = new Uint8Array([...pngPrefix, ...fakePayloads[idx]]);
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength)
      };
    };

    const dl = new SegmentDownloader({ concurrency: 2 });
    const segments = [
      { index: 0, url: 'https://example.com/seg0.ts' },
      { index: 1, url: 'https://example.com/seg1.ts' }
    ];

    const progressUpdates = [];
    const merged = await dl.downloadSegments(segments, { 'User-Agent': 'TestAgent' }, (p) =>
      progressUpdates.push(p)
    );

    assert.ok(merged instanceof Uint8Array);
    // Each segment should be stripped down to 6 bytes, so total 12 bytes
    assert.equal(merged.length, 12);
    // First byte of first segment must be 0x47
    assert.equal(merged[0], 0x47);
    assert.deepEqual(Array.from(merged.subarray(0, 6)), fakePayloads[0]);
    // First byte of second segment must be 0x47
    assert.equal(merged[6], 0x47);
    assert.deepEqual(Array.from(merged.subarray(6, 12)), fakePayloads[1]);
    // Progress callback should have reached 100%
    assert.ok(progressUpdates.length >= 2);
    assert.equal(progressUpdates[progressUpdates.length - 1].percent, 100);
    assert.equal(progressUpdates[progressUpdates.length - 1].completed, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SegmentDownloader handles abort signal cleanly', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const controller = new AbortController();
    globalThis.fetch = async () => {
      controller.abort();
      throw new Error('Download aborted.');
    };

    const dl = new SegmentDownloader();
    const segments = [{ index: 0, url: 'https://example.com/seg0.ts' }];

    await assert.rejects(async () => {
      await dl.downloadSegments(segments, {}, null, controller.signal);
    }, /aborted/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SegmentDownloader retries transient failures before succeeding', async () => {
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  try {
    const fakeChunk = new Uint8Array([0x47, 0x10, 0xaa, 0xbb]);
    globalThis.fetch = async () => {
      attempts++;
      if (attempts < 2) {
        return { ok: false, status: 500, statusText: 'Internal Server Error' };
      }
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          fakeChunk.buffer.slice(fakeChunk.byteOffset, fakeChunk.byteOffset + fakeChunk.byteLength)
      };
    };

    const dl = new SegmentDownloader({ concurrency: 1 });
    const segments = [{ index: 0, url: 'https://example.com/seg0.ts' }];
    const merged = await dl.downloadSegments(segments);

    assert.equal(attempts, 2);
    assert.equal(merged.length, 4);
    assert.deepEqual(Array.from(merged), [0x47, 0x10, 0xaa, 0xbb]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SegmentDownloader fails cleanly and does not produce corrupt output if a segment fails', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found'
    });

    const dl = new SegmentDownloader({ concurrency: 2 });
    const segments = [
      { index: 0, url: 'https://example.com/seg0.ts' },
      { index: 1, url: 'https://example.com/seg1.ts' }
    ];

    await assert.rejects(async () => {
      await dl.downloadSegments(segments);
    }, /Failed downloading segment \d+ after \d+ attempts/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
