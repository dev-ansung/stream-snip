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

test('SegmentDownloader skips missing 404 segments gracefully and preserves remaining segments', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const fakeChunk0 = new Uint8Array([0x47, 0x10, 0xaa, 0xbb]);
    const fakeChunk2 = new Uint8Array([0x47, 0x10, 0xcc, 0xdd]);

    globalThis.fetch = async (url) => {
      if (url.includes('seg1')) {
        return {
          ok: false,
          status: 404,
          statusText: 'Not Found'
        };
      }
      const chunk = url.includes('seg0') ? fakeChunk0 : fakeChunk2;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () =>
          chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength)
      };
    };

    const dl = new SegmentDownloader({ concurrency: 2 });
    const segments = [
      { index: 0, url: 'https://example.com/seg0.ts' },
      { index: 1, url: 'https://example.com/seg1.ts' },
      { index: 2, url: 'https://example.com/seg2.ts' }
    ];

    const progressUpdates = [];
    const merged = await dl.downloadSegments(segments, {}, (p) => progressUpdates.push(p));

    assert.ok(merged instanceof Uint8Array);
    // seg0 (4 bytes) + seg2 (4 bytes) = 8 bytes total
    assert.equal(merged.length, 8);
    assert.deepEqual(Array.from(merged.subarray(0, 4)), Array.from(fakeChunk0));
    assert.deepEqual(Array.from(merged.subarray(4, 8)), Array.from(fakeChunk2));

    // Completed count should still reach 3 (including the skipped 404 segment)
    const lastProgress = progressUpdates[progressUpdates.length - 1];
    assert.equal(lastProgress.completed, 3);
    assert.equal(lastProgress.percent, 100);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test('SegmentDownloader throws if all segments 404 or fail', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  console.warn = () => {};
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
    }, /No valid segment data could be downloaded/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
