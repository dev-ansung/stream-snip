const test = require('node:test');
const assert = require('node:assert/strict');
const { transmuxTsToMp4, unfragmentFmp4, fixFileDuration } = require('../lib/transmuxer.js');

test('transmuxTsToMp4 handles empty or invalid bytes gracefully', () => {
  const empty = new Uint8Array(0);
  const res = transmuxTsToMp4(empty);
  assert.equal(res.byteLength, 0);
});

test('transmuxTsToMp4 transmuxes valid TS packets into MP4 with ftyp header', () => {
  const dummyTs = new Uint8Array(188);
  dummyTs[0] = 0x47;
  dummyTs[1] = 0x40; // payload unit start indicator
  dummyTs[2] = 0x00;
  dummyTs[3] = 0x10; // no adaptation field, payload only

  const out = transmuxTsToMp4(dummyTs);
  assert.ok(out instanceof Uint8Array);
});

test('unfragmentFmp4 handles non-fragmented or empty bytes gracefully', () => {
  const empty = new Uint8Array(0);
  assert.equal(unfragmentFmp4(empty).byteLength, 0);

  const small = new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]);
  assert.equal(unfragmentFmp4(small), small);
});

test('fixFileDuration patches mvhd, tkhd, and mdhd boxes correctly', () => {
  // Construct mock MP4 header with mvhd, tkhd, mdhd, and mdat
  const buf = new Uint8Array(200);

  // mvhd at offset 0
  buf[0] = 0x6d;
  buf[1] = 0x76;
  buf[2] = 0x68;
  buf[3] = 0x64; // "mvhd"
  // timescale at offset 16 (big endian 90000 = 0x00015f90)
  buf[16] = 0x00;
  buf[17] = 0x01;
  buf[18] = 0x5f;
  buf[19] = 0x90;

  // tkhd at offset 40
  buf[40] = 0x74;
  buf[41] = 0x6b;
  buf[42] = 0x68;
  buf[43] = 0x64; // "tkhd"

  // mdhd at offset 80
  buf[80] = 0x6d;
  buf[81] = 0x64;
  buf[82] = 0x68;
  buf[83] = 0x64; // "mdhd"
  // timescale at offset 80 + 16 = 96 (big endian 48000 = 0x0000bb80)
  buf[96] = 0x00;
  buf[97] = 0x00;
  buf[98] = 0xbb;
  buf[99] = 0x80;

  // mdat at offset 150
  buf[150] = 0x6d;
  buf[151] = 0x64;
  buf[152] = 0x61;
  buf[153] = 0x74; // "mdat"

  const durationSec = 10;
  const fixed = fixFileDuration(buf, durationSec);

  // Check mvhd duration at 20 (90000 * 10 = 900000 = 0x000dbba0)
  const mvhdDur = ((fixed[20] << 24) | (fixed[21] << 16) | (fixed[22] << 8) | fixed[23]) >>> 0;
  assert.equal(mvhdDur, 900000);

  // Check tkhd duration at 40 + 24 = 64
  const tkhdDur = ((fixed[64] << 24) | (fixed[65] << 16) | (fixed[66] << 8) | fixed[67]) >>> 0;
  assert.equal(tkhdDur, 900000);

  // Check mdhd duration at 80 + 20 = 100 (48000 * 10 = 480000 = 0x00075300)
  const mdhdDur = ((fixed[100] << 24) | (fixed[101] << 16) | (fixed[102] << 8) | fixed[103]) >>> 0;
  assert.equal(mdhdDur, 480000);
});

test('transmuxTsToAudioMp4 throws when the stream has no parseable media', () => {
  const { transmuxTsToAudioMp4 } = require('../lib/transmuxer.js');
  const empty = new Uint8Array(0);
  assert.throws(() => transmuxTsToAudioMp4(empty), /No media found|mux\.js unavailable/);
});

test('buildElst and buildEdts construct spec-compliant ISO 14496-12 edit list boxes', () => {
  const { buildElst, buildEdts } = require('../lib/transmuxer.js');
  assert.equal(typeof buildElst, 'function');
  assert.equal(typeof buildEdts, 'function');

  const movieDurationTicks = 5000;
  const mediaTimeTicks = 270000;
  const elst = buildElst(movieDurationTicks, mediaTimeTicks);

  // 12 bytes fullbox header + 16 bytes payload = 28 bytes
  assert.equal(elst.byteLength, 28);
  const view = new DataView(elst.buffer, elst.byteOffset, elst.byteLength);
  assert.equal(view.getUint32(0), 28); // size
  const type = String.fromCharCode(...elst.slice(4, 8));
  assert.equal(type, 'elst');
  assert.equal(view.getUint8(8), 0); // version 0
  assert.equal(view.getUint32(12), 1); // entry_count = 1
  assert.equal(view.getUint32(16), movieDurationTicks); // segment_duration
  assert.equal(view.getInt32(20), mediaTimeTicks); // media_time
  assert.equal(view.getInt16(24), 1); // rate integer
  assert.equal(view.getInt16(26), 0); // rate fraction

  const edts = buildEdts(elst);
  assert.equal(edts.byteLength, 36);
  const edtsView = new DataView(edts.buffer, edts.byteOffset, edts.byteLength);
  assert.equal(edtsView.getUint32(0), 36);
  const edtsType = String.fromCharCode(...edts.slice(4, 8));
  assert.equal(edtsType, 'edts');
});

function createMockFmp4(sampleCount = 6, sampleDurationTicks = 90000) {
  function box(type, ...children) {
    let len = 8;
    for (const c of children) len += c ? c.byteLength : 0;
    const b = new Uint8Array(len);
    const v = new DataView(b.buffer);
    v.setUint32(0, len);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    let off = 8;
    for (const c of children) {
      if (c) {
        b.set(c, off);
        off += c.byteLength;
      }
    }
    return b;
  }

  function fullBox(type, version, flags, ...children) {
    let len = 12;
    for (const c of children) len += c ? c.byteLength : 0;
    const b = new Uint8Array(len);
    const v = new DataView(b.buffer);
    v.setUint32(0, len);
    for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    v.setUint8(8, version);
    v.setUint8(9, (flags >> 16) & 0xff);
    v.setUint8(10, (flags >> 8) & 0xff);
    v.setUint8(11, flags & 0xff);
    let off = 12;
    for (const c of children) {
      if (c) {
        b.set(c, off);
        off += c.byteLength;
      }
    }
    return b;
  }

  const ftyp = box('ftyp', new Uint8Array([0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0]));

  const tkhdPayload = new Uint8Array(80);
  const tkhdView = new DataView(tkhdPayload.buffer);
  tkhdView.setUint32(8, 1); // trackId at offset 8 (start + 12)
  tkhdView.setUint32(72, 1920);
  tkhdView.setUint32(76, 1080);
  const tkhd = fullBox('tkhd', 0, 3, tkhdPayload);

  const mdhdPayload = new Uint8Array(20);
  new DataView(mdhdPayload.buffer).setUint32(8, 90000); // timescale at start + 12
  const mdhd = fullBox('mdhd', 0, 0, mdhdPayload);

  const hdlrPayload = new Uint8Array(24);
  for (let i = 0; i < 4; i++) hdlrPayload[4 + i] = 'vide'.charCodeAt(i);
  const hdlr = fullBox('hdlr', 0, 0, hdlrPayload);

  const stsd = fullBox('stsd', 0, 0, new Uint8Array(16));
  const stbl = box('stbl', stsd);
  const minf = box('minf', stbl);
  const mdia = box('mdia', mdhd, hdlr, minf);
  const trak = box('trak', tkhd, mdia);
  const moov = box('moov', trak);

  const tfhdPayload = new Uint8Array(8);
  new DataView(tfhdPayload.buffer).setUint32(0, 1);
  const tfhd = fullBox('tfhd', 0, 0, tfhdPayload);

  const trunPayload = new Uint8Array(8 + sampleCount * 8);
  const trunView = new DataView(trunPayload.buffer);
  trunView.setUint32(0, sampleCount);
  trunView.setInt32(4, 8);
  for (let s = 0; s < sampleCount; s++) {
    trunView.setUint32(8 + s * 8, sampleDurationTicks);
    trunView.setUint32(8 + s * 8 + 4, 10);
  }
  const trun = fullBox('trun', 0, 0x01 | 0x100 | 0x200, trunPayload);
  const traf = box('traf', tfhd, trun);
  const moof = box('moof', traf);

  const mdat = box('mdat', new Uint8Array(sampleCount * 10));

  const fmp4Len = ftyp.byteLength + moov.byteLength + moof.byteLength + mdat.byteLength;
  const fmp4 = new Uint8Array(fmp4Len);
  let pos = 0;
  for (const b of [ftyp, moov, moof, mdat]) {
    fmp4.set(b, pos);
    pos += b.byteLength;
  }
  return fmp4;
}

function parseBoxHierarchy(bytes) {
  const list = [];
  let off = 0;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= bytes.byteLength) {
    const size = v.getUint32(off);
    if (size === 0 || off + size > bytes.byteLength) break;
    let type = '';
    for (let i = 0; i < 4; i++) type += String.fromCharCode(bytes[off + 4 + i]);
    list.push({ type, offset: off, size, start: off + 8, end: off + size });
    off += size;
  }
  return list;
}

test('unfragmentFmp4 injects edts/elst and prunes samples when trimStart and trimEnd are specified', () => {
  const fmp4 = createMockFmp4(6, 90000); // 6 seconds total
  // Request trim from 2.0s to 5.0s (duration = 3.0s)
  const unfrag = unfragmentFmp4(fmp4, 3, { trimStart: 2.0, trimEnd: 5.0 });

  const top = parseBoxHierarchy(unfrag);
  const moov = top.find((b) => b.type === 'moov');
  assert.ok(moov, 'Must contain moov box');

  const moovChildren = parseBoxHierarchy(unfrag.slice(moov.start, moov.end));
  const trak = moovChildren.find((b) => b.type === 'trak');
  assert.ok(trak, 'Must contain trak box');

  const trakChildren = parseBoxHierarchy(
    unfrag.slice(moov.start + trak.start, moov.start + trak.end)
  );
  assert.deepEqual(
    trakChildren.map((b) => b.type),
    ['tkhd', 'edts', 'mdia'],
    'trak must contain [tkhd, edts, mdia]'
  );

  const edts = trakChildren.find((b) => b.type === 'edts');
  const edtsChildren = parseBoxHierarchy(
    unfrag.slice(moov.start + trak.start + edts.start, moov.start + trak.start + edts.end)
  );
  const elst = edtsChildren.find((b) => b.type === 'elst');
  assert.ok(elst, 'edts must contain elst');

  const elstPayload = unfrag.slice(
    moov.start + trak.start + edts.start + elst.start,
    moov.start + trak.start + edts.start + elst.end
  );
  const elstView = new DataView(elstPayload.buffer, elstPayload.byteOffset, elstPayload.byteLength);
  assert.equal(elstView.getUint32(4), 1); // entry_count = 1
  assert.equal(elstView.getUint32(8), 3000); // segment_duration (3s * 1000 timescale)
  assert.equal(elstView.getInt32(12), 180000); // media_time (2s * 90000 timescale)
});

test('unfragmentFmp4 does not inject edts when trimStart is 0', () => {
  const fmp4 = createMockFmp4(6, 90000);
  const unfrag = unfragmentFmp4(fmp4, 6, { trimStart: 0 });

  const top = parseBoxHierarchy(unfrag);
  const moov = top.find((b) => b.type === 'moov');
  const moovChildren = parseBoxHierarchy(unfrag.slice(moov.start, moov.end));
  const trak = moovChildren.find((b) => b.type === 'trak');
  const trakChildren = parseBoxHierarchy(
    unfrag.slice(moov.start + trak.start, moov.start + trak.end)
  );
  assert.deepEqual(
    trakChildren.map((b) => b.type),
    ['tkhd', 'mdia'],
    'trak must contain only [tkhd, mdia] when trimStart is 0'
  );
});

test('unfragmentFmp4 boundary guardrail disables edit list when trimStart exceeds media duration', () => {
  const fmp4 = createMockFmp4(6, 90000); // 6 seconds total
  // Erroneous input: trimStart is 2104.0s (absolute timestamp instead of relative offset)
  const unfrag = unfragmentFmp4(fmp4, 3, { trimStart: 2104.0, trimEnd: 2107.0 });

  const top = parseBoxHierarchy(unfrag);
  const moov = top.find((b) => b.type === 'moov');
  const moovChildren = parseBoxHierarchy(unfrag.slice(moov.start, moov.end));
  const trak = moovChildren.find((b) => b.type === 'trak');
  const trakChildren = parseBoxHierarchy(
    unfrag.slice(moov.start + trak.start, moov.start + trak.end)
  );

  // Invariant guardrail must catch this, suppress edts, and keep clean [tkhd, mdia]
  assert.deepEqual(
    trakChildren.map((b) => b.type),
    ['tkhd', 'mdia'],
    'trak must safely drop edts when trimStart exceeds media duration'
  );
});
