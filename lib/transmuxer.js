/**
 * Transmuxer to convert clean MPEG-TS streams into standard MP4
 * using mux.js without re-encoding video or audio.
 */

function createBox(type, ...children) {
  let len = 8;
  for (const c of children) {
    if (c) len += c.byteLength;
  }
  const b = new Uint8Array(len);
  const view = new DataView(b.buffer);
  view.setUint32(0, len);
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

function createFullBox(type, version, flags, ...children) {
  let len = 12;
  for (const c of children) {
    if (c) len += c.byteLength;
  }
  const b = new Uint8Array(len);
  const view = new DataView(b.buffer);
  view.setUint32(0, len);
  for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
  view.setUint8(8, version);
  view.setUint8(9, (flags >> 16) & 0xff);
  view.setUint8(10, (flags >> 8) & 0xff);
  view.setUint8(11, flags & 0xff);
  let off = 12;
  for (const c of children) {
    if (c) {
      b.set(c, off);
      off += c.byteLength;
    }
  }
  return b;
}

function findBoxes(bytes, start, end) {
  const list = [];
  let off = start;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (off + 8 <= end) {
    const size = view.getUint32(off);
    if (size === 0 || off + size > end) break;
    let type = '';
    for (let i = 0; i < 4; i++) type += String.fromCharCode(bytes[off + 4 + i]);
    list.push({ type, offset: off, size, start: off + 8, end: off + size });
    off += size;
  }
  return list;
}

function findBox(bytes, start, end, targetType) {
  return findBoxes(bytes, start, end).find((b) => b.type === targetType);
}

/**
 * Unfragments an fMP4 (fragmented MP4) stream into a standard progressive MP4
 * container with a single moov atom containing full sample tables (stts, stss,
 * ctts, stsz, stsc, stco) followed by a single interleaved mdat.
 * Compatible with macOS QuickTime Player and native video engines.
 *
 * @param {Uint8Array} bytes - Fragmented MP4 bytes
 * @param {number} duration - Clip duration in seconds (optional)
 * @returns {Uint8Array} - Progressive MP4 bytes
 */
function unfragmentFmp4(bytes, duration = 0) {
  if (!bytes || bytes.byteLength < 32) return bytes;
  try {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const topBoxes = findBoxes(bytes, 0, bytes.byteLength);
    const ftypBox = topBoxes.find((b) => b.type === 'ftyp');
    const moovBox = topBoxes.find((b) => b.type === 'moov');
    const moofBoxes = topBoxes.filter((b) => b.type === 'moof');

    if (!ftypBox || !moovBox || moofBoxes.length === 0) {
      return bytes;
    }

    const ftypRaw = bytes.slice(ftypBox.offset, ftypBox.offset + ftypBox.size);
    const traks = findBoxes(bytes, moovBox.start, moovBox.end).filter((b) => b.type === 'trak');
    const trackMeta = {};

    for (const trak of traks) {
      const tkhdBox = findBox(bytes, trak.start, trak.end, 'tkhd');
      if (!tkhdBox) continue;
      const tkhdVer = view.getUint8(tkhdBox.start);
      const trackId =
        tkhdVer === 1 ? view.getUint32(tkhdBox.start + 20) : view.getUint32(tkhdBox.start + 12);
      const width = view.getUint32(tkhdBox.end - 8);
      const height = view.getUint32(tkhdBox.end - 4);

      const mdiaBox = findBox(bytes, trak.start, trak.end, 'mdia');
      if (!mdiaBox) continue;
      const mdhdBox = findBox(bytes, mdiaBox.start, mdiaBox.end, 'mdhd');
      if (!mdhdBox) continue;
      const mdhdVer = view.getUint8(mdhdBox.start);
      const timescale =
        mdhdVer === 1 ? view.getUint32(mdhdBox.start + 20) : view.getUint32(mdhdBox.start + 12);

      const hdlrBox = findBox(bytes, mdiaBox.start, mdiaBox.end, 'hdlr');
      let handlerType = '';
      if (hdlrBox) {
        for (let i = 0; i < 4; i++) {
          handlerType += String.fromCharCode(bytes[hdlrBox.start + 8 + i]);
        }
      }

      const minfBox = findBox(bytes, mdiaBox.start, mdiaBox.end, 'minf');
      const stblBox = minfBox ? findBox(bytes, minfBox.start, minfBox.end, 'stbl') : null;
      const stsdBox = stblBox ? findBox(bytes, stblBox.start, stblBox.end, 'stsd') : null;
      if (!stsdBox) continue;
      const stsdRaw = bytes.slice(stsdBox.offset, stsdBox.offset + stsdBox.size);

      trackMeta[trackId] = {
        trackId,
        timescale: timescale || (handlerType === 'vide' ? 90000 : 48000),
        handlerType,
        width,
        height,
        stsdRaw,
        samples: []
      };
    }

    let curMoof = null;
    for (const b of topBoxes) {
      if (b.type === 'moof') {
        curMoof = b;
        const trafs = findBoxes(bytes, b.start, b.end).filter((x) => x.type === 'traf');
        for (const traf of trafs) {
          const tfhdBox = findBoxes(bytes, traf.start, traf.end).find((x) => x.type === 'tfhd');
          if (!tfhdBox) continue;
          const tfhdFlags = view.getUint32(tfhdBox.start) & 0x00ffffff;
          const trackId = view.getUint32(tfhdBox.start + 4);
          let tfhdCur = tfhdBox.start + 8;
          if (tfhdFlags & 0x01) tfhdCur += 8;
          if (tfhdFlags & 0x02) tfhdCur += 4;
          const defaultDuration = tfhdFlags & 0x08 ? view.getUint32(tfhdCur) : 0;
          if (tfhdFlags & 0x08) tfhdCur += 4;
          const defaultSize = tfhdFlags & 0x10 ? view.getUint32(tfhdCur) : 0;
          if (tfhdFlags & 0x10) tfhdCur += 4;
          const defaultFlags = tfhdFlags & 0x20 ? view.getUint32(tfhdCur) : 0;

          const trunBox = findBoxes(bytes, traf.start, traf.end).find((x) => x.type === 'trun');
          if (!trunBox) continue;
          const trunFlags = view.getUint32(trunBox.start) & 0x00ffffff;
          const sampleCount = view.getUint32(trunBox.start + 4);
          let trunCur = trunBox.start + 8;
          const dataOffset = trunFlags & 0x01 ? view.getInt32(trunCur) : curMoof.size + 8;
          if (trunFlags & 0x01) trunCur += 4;
          const firstSampleFlags = trunFlags & 0x04 ? view.getUint32(trunCur) : defaultFlags;
          if (trunFlags & 0x04) trunCur += 4;

          let samplePayloadOffset = curMoof.offset + dataOffset;

          for (let s = 0; s < sampleCount; s++) {
            const dur = trunFlags & 0x100 ? view.getUint32(trunCur) : defaultDuration;
            if (trunFlags & 0x100) trunCur += 4;
            const size = trunFlags & 0x200 ? view.getUint32(trunCur) : defaultSize;
            if (trunFlags & 0x200) trunCur += 4;
            const sflags =
              trunFlags & 0x400
                ? view.getUint32(trunCur)
                : s === 0 && trunFlags & 0x04
                  ? firstSampleFlags
                  : defaultFlags;
            if (trunFlags & 0x400) trunCur += 4;
            const cto = trunFlags & 0x800 ? view.getInt32(trunCur) : 0;
            if (trunFlags & 0x800) trunCur += 4;

            const isKeyframe = ((sflags >> 16) & 1) === 0;
            const data = bytes.slice(samplePayloadOffset, samplePayloadOffset + size);
            samplePayloadOffset += size;

            if (trackMeta[trackId]) {
              trackMeta[trackId].samples.push({ dur, size, cto, isKeyframe, data });
            }
          }
        }
      }
    }

    const trackIds = Object.keys(trackMeta).map(Number);
    const videoTrack = trackMeta[trackIds.find((id) => trackMeta[id].handlerType === 'vide')];
    const audioTrack = trackMeta[trackIds.find((id) => trackMeta[id].handlerType === 'soun')];

    if (!videoTrack && !audioTrack) {
      return bytes;
    }

    function makeChunks(track, targetDurationTicks) {
      const chunks = [];
      let curChunk = { trackId: track.trackId, samples: [], duration: 0, size: 0 };
      for (const s of track.samples) {
        curChunk.samples.push(s);
        curChunk.duration += s.dur;
        curChunk.size += s.size;
        if (curChunk.duration >= targetDurationTicks) {
          chunks.push(curChunk);
          curChunk = { trackId: track.trackId, samples: [], duration: 0, size: 0 };
        }
      }
      if (curChunk.samples.length > 0) {
        chunks.push(curChunk);
      }
      return chunks;
    }

    const vChunks = videoTrack ? makeChunks(videoTrack, videoTrack.timescale) : [];
    const aChunks = audioTrack ? makeChunks(audioTrack, audioTrack.timescale) : [];

    const interleavedChunks = [];
    const maxChunks = Math.max(vChunks.length, aChunks.length);
    for (let i = 0; i < maxChunks; i++) {
      if (i < vChunks.length) interleavedChunks.push(vChunks[i]);
      if (i < aChunks.length) interleavedChunks.push(aChunks[i]);
    }

    const movieTimescale = 1000;
    const vTotalDur = videoTrack ? videoTrack.samples.reduce((s, x) => s + x.dur, 0) : 0;
    const movieDuration =
      duration > 0
        ? Math.round(duration * movieTimescale)
        : Math.round((vTotalDur / (videoTrack ? videoTrack.timescale : 1)) * movieTimescale);

    function buildMvhd() {
      const b = new Uint8Array(96);
      const v = new DataView(b.buffer);
      v.setUint32(8, movieTimescale);
      v.setUint32(12, movieDuration);
      v.setUint32(16, 0x00010000);
      v.setUint16(20, 0x0100);
      v.setInt32(32, 0x00010000);
      v.setInt32(48, 0x00010000);
      v.setInt32(64, 0x40000000);
      v.setUint32(92, 3);
      return createFullBox('mvhd', 0, 0, b);
    }

    function buildTkhd(track, isVideo) {
      const b = new Uint8Array(80);
      const v = new DataView(b.buffer);
      v.setUint32(8, track.trackId);
      const trackDur = Math.round(
        (track.samples.reduce((s, x) => s + x.dur, 0) / track.timescale) * movieTimescale
      );
      v.setUint32(16, trackDur);
      v.setInt16(32, isVideo ? 0 : 0x0100);
      v.setInt32(36, 0x00010000);
      v.setInt32(52, 0x00010000);
      v.setInt32(68, 0x40000000);
      v.setUint32(72, isVideo ? track.width : 0);
      v.setUint32(76, isVideo ? track.height : 0);
      return createFullBox('tkhd', 0, 3, b);
    }

    function buildMdhd(track) {
      const b = new Uint8Array(20);
      const v = new DataView(b.buffer);
      v.setUint32(8, track.timescale);
      const totalDur = track.samples.reduce((s, x) => s + x.dur, 0);
      v.setUint32(12, totalDur);
      v.setUint16(16, 0x55c4);
      return createFullBox('mdhd', 0, 0, b);
    }

    function buildHdlr(handlerType, name) {
      const nameBytes = new TextEncoder().encode(name + '\0');
      const b = new Uint8Array(20 + nameBytes.length);
      for (let i = 0; i < 4; i++) b[4 + i] = handlerType.charCodeAt(i);
      b.set(nameBytes, 20);
      return createFullBox('hdlr', 0, 0, b);
    }

    function buildVmhd() {
      const b = new Uint8Array(8);
      return createFullBox('vmhd', 0, 1, b);
    }

    function buildSmhd() {
      const b = new Uint8Array(4);
      return createFullBox('smhd', 0, 0, b);
    }

    function buildDinf() {
      const urlBox = createFullBox('url ', 0, 1);
      const drefPayload = new Uint8Array(4);
      new DataView(drefPayload.buffer).setUint32(0, 1);
      const drefBox = createFullBox('dref', 0, 0, drefPayload, urlBox);
      return createBox('dinf', drefBox);
    }

    function buildStts(samples) {
      const entries = [];
      for (const s of samples) {
        if (entries.length > 0 && entries[entries.length - 1].delta === s.dur) {
          entries[entries.length - 1].count++;
        } else {
          entries.push({ count: 1, delta: s.dur });
        }
      }
      const b = new Uint8Array(4 + entries.length * 8);
      const v = new DataView(b.buffer);
      v.setUint32(0, entries.length);
      let off = 4;
      for (const e of entries) {
        v.setUint32(off, e.count);
        v.setUint32(off + 4, e.delta);
        off += 8;
      }
      return createFullBox('stts', 0, 0, b);
    }

    function buildStss(samples) {
      const keyframes = [];
      for (let i = 0; i < samples.length; i++) {
        if (samples[i].isKeyframe) keyframes.push(i + 1);
      }
      const b = new Uint8Array(4 + keyframes.length * 4);
      const v = new DataView(b.buffer);
      v.setUint32(0, keyframes.length);
      let off = 4;
      for (const k of keyframes) {
        v.setUint32(off, k);
        off += 4;
      }
      return createFullBox('stss', 0, 0, b);
    }

    function buildCtts(samples) {
      const hasCto = samples.some((s) => s.cto !== 0);
      if (!hasCto) return null;
      const entries = [];
      for (const s of samples) {
        if (entries.length > 0 && entries[entries.length - 1].offset === s.cto) {
          entries[entries.length - 1].count++;
        } else {
          entries.push({ count: 1, offset: s.cto });
        }
      }
      const b = new Uint8Array(4 + entries.length * 8);
      const v = new DataView(b.buffer);
      v.setUint32(0, entries.length);
      let off = 4;
      for (const e of entries) {
        v.setUint32(off, e.count);
        v.setInt32(off + 4, e.offset);
        off += 8;
      }
      return createFullBox('ctts', 0, 0, b);
    }

    function buildStsz(samples) {
      const b = new Uint8Array(8 + samples.length * 4);
      const v = new DataView(b.buffer);
      v.setUint32(4, samples.length);
      let off = 8;
      for (const s of samples) {
        v.setUint32(off, s.size);
        off += 4;
      }
      return createFullBox('stsz', 0, 0, b);
    }

    function buildStsc(chunks) {
      const entries = [];
      for (let i = 0; i < chunks.length; i++) {
        const spc = chunks[i].samples.length;
        if (entries.length === 0 || entries[entries.length - 1].samplesPerChunk !== spc) {
          entries.push({ firstChunk: i + 1, samplesPerChunk: spc, sdi: 1 });
        }
      }
      const b = new Uint8Array(4 + entries.length * 12);
      const v = new DataView(b.buffer);
      v.setUint32(0, entries.length);
      let off = 4;
      for (const e of entries) {
        v.setUint32(off, e.firstChunk);
        v.setUint32(off + 4, e.samplesPerChunk);
        v.setUint32(off + 8, e.sdi);
        off += 12;
      }
      return createFullBox('stsc', 0, 0, b);
    }

    function buildStco(chunkCount, offsets = null) {
      const b = new Uint8Array(4 + chunkCount * 4);
      const v = new DataView(b.buffer);
      v.setUint32(0, chunkCount);
      if (offsets) {
        let off = 4;
        for (let i = 0; i < chunkCount; i++) {
          v.setUint32(off, offsets[i]);
          off += 4;
        }
      }
      return createFullBox('stco', 0, 0, b);
    }

    function buildTrak(track, chunks, isVideo, chunkOffsets = null) {
      const tkhd = buildTkhd(track, isVideo);
      const mdhd = buildMdhd(track);
      const hdlr = buildHdlr(isVideo ? 'vide' : 'soun', isVideo ? 'VideoHandler' : 'SoundHandler');
      const xmhd = isVideo ? buildVmhd() : buildSmhd();
      const dinf = buildDinf();

      const stblChildren = [track.stsdRaw, buildStts(track.samples)];
      if (isVideo) {
        stblChildren.push(buildStss(track.samples));
        const ctts = buildCtts(track.samples);
        if (ctts) stblChildren.push(ctts);
      }
      stblChildren.push(buildStsz(track.samples));
      stblChildren.push(buildStsc(chunks));
      stblChildren.push(buildStco(chunks.length, chunkOffsets));

      const stbl = createBox('stbl', ...stblChildren);
      const minf = createBox('minf', xmhd, dinf, stbl);
      const mdia = createBox('mdia', mdhd, hdlr, minf);
      return createBox('trak', tkhd, mdia);
    }

    const dummyVOffsets = new Array(vChunks.length).fill(0);
    const dummyAOffsets = new Array(aChunks.length).fill(0);

    const mvhd = buildMvhd();
    const dummyVTrak = videoTrack ? buildTrak(videoTrack, vChunks, true, dummyVOffsets) : null;
    const dummyATrak = audioTrack ? buildTrak(audioTrack, aChunks, false, dummyAOffsets) : null;
    const dummyMoov = createBox('moov', mvhd, dummyVTrak, dummyATrak);

    const mdatHeaderSize = 8;
    let currentOffset = ftypRaw.byteLength + dummyMoov.byteLength + mdatHeaderSize;

    const vChunkOffsets = [];
    const aChunkOffsets = [];

    for (const chunk of interleavedChunks) {
      if (chunk.trackId === (videoTrack ? videoTrack.trackId : 256)) {
        vChunkOffsets.push(currentOffset);
      } else {
        aChunkOffsets.push(currentOffset);
      }
      currentOffset += chunk.size;
    }

    const finalVTrak = videoTrack ? buildTrak(videoTrack, vChunks, true, vChunkOffsets) : null;
    const finalATrak = audioTrack ? buildTrak(audioTrack, aChunks, false, aChunkOffsets) : null;
    const finalMoov = createBox('moov', mvhd, finalVTrak, finalATrak);

    const totalMdatPayloadSize = interleavedChunks.reduce((s, c) => s + c.size, 0);
    const mdatHeader = new Uint8Array(8);
    new DataView(mdatHeader.buffer).setUint32(0, totalMdatPayloadSize + 8);
    for (let i = 0; i < 4; i++) mdatHeader[4 + i] = 'mdat'.charCodeAt(i);

    const totalFileSize =
      ftypRaw.byteLength + finalMoov.byteLength + mdatHeader.byteLength + totalMdatPayloadSize;
    const out = new Uint8Array(totalFileSize);
    let outOff = 0;
    out.set(ftypRaw, outOff);
    outOff += ftypRaw.byteLength;
    out.set(finalMoov, outOff);
    outOff += finalMoov.byteLength;
    out.set(mdatHeader, outOff);
    outOff += mdatHeader.byteLength;

    for (const chunk of interleavedChunks) {
      for (const s of chunk.samples) {
        out.set(s.data, outOff);
        outOff += s.data.byteLength;
      }
    }

    return out;
  } catch (err) {
    console.warn('Unfragment failed, falling back to fMP4 with patched duration:', err);
    return bytes;
  }
}

/**
 * Fixes MP4 container display duration in mvhd, tkhd, and mdhd boxes.
 * Based on CatCatch's duration patching technique for mux.js fMP4 streams.
 *
 * @param {Uint8Array} data - MP4 data
 * @param {number} duration - Video duration in seconds
 * @returns {Uint8Array} - Patched MP4 data
 */
function fixFileDuration(data, duration) {
  if (!duration || duration <= 0 || !data || data.length < 32) {
    return data;
  }

  let mvhdBoxDuration = Math.round(duration * 90000);

  function getBoxDuration(buffer, dur, index) {
    const timescaleIndex = index + 16;
    if (timescaleIndex + 4 > buffer.length) return Math.round(dur * 90000);
    const timescale =
      ((buffer[timescaleIndex] << 24) |
        (buffer[timescaleIndex + 1] << 16) |
        (buffer[timescaleIndex + 2] << 8) |
        buffer[timescaleIndex + 3]) >>>
      0;
    return Math.round((timescale || 90000) * dur);
  }

  function writeUint32(buffer, index, val) {
    if (index + 4 > buffer.length) return;
    buffer[index] = (val >>> 24) & 0xff;
    buffer[index + 1] = (val >>> 16) & 0xff;
    buffer[index + 2] = (val >>> 8) & 0xff;
    buffer[index + 3] = val & 0xff;
  }

  for (let i = 0; i < data.length - 8; i++) {
    // mvhd
    if (data[i] === 0x6d && data[i + 1] === 0x76 && data[i + 2] === 0x68 && data[i + 3] === 0x64) {
      mvhdBoxDuration = getBoxDuration(data, duration, i);
      if (i + 11 < data.length) {
        data[i + 11] = 0; // Clear creation date
      }
      writeUint32(data, i + 20, mvhdBoxDuration);
      i += 24;
      continue;
    }
    // tkhd
    if (data[i] === 0x74 && data[i + 1] === 0x6b && data[i + 2] === 0x68 && data[i + 3] === 0x64) {
      writeUint32(data, i + 24, mvhdBoxDuration);
      i += 28;
      continue;
    }
    // mdhd
    if (data[i] === 0x6d && data[i + 1] === 0x64 && data[i + 2] === 0x68 && data[i + 3] === 0x64) {
      const mdhdBoxDuration = getBoxDuration(data, duration, i);
      writeUint32(data, i + 20, mdhdBoxDuration);
      i += 24;
      continue;
    }
    // stop when media data (mdat) begins
    if (data[i] === 0x6d && data[i + 1] === 0x64 && data[i + 2] === 0x61 && data[i + 3] === 0x74) {
      return data;
    }
  }

  return data;
}

function transmuxTsToMp4(tsBytes, duration = 0) {
  let mux = null;
  if (typeof globalThis !== 'undefined' && globalThis.muxjs) {
    mux = globalThis.muxjs;
  } else if (typeof window !== 'undefined' && window.muxjs) {
    mux = window.muxjs;
  } else if (typeof require !== 'undefined') {
    try {
      mux = require('mux.js');
    } catch {
      // Ignore
    }
  }

  if (!mux || !mux.mp4 || !mux.mp4.Transmuxer) {
    console.warn('mux.js Transmuxer not found, skipping MP4 transmuxing.');
    return tsBytes;
  }

  const transmuxer = new mux.mp4.Transmuxer({
    keepOriginalTimestamps: false,
    remux: true
  });

  const parts = [];

  transmuxer.on('data', (segment) => {
    if (segment.initSegment) {
      parts.push(segment.initSegment);
    }
    if (segment.data) {
      parts.push(segment.data);
    }
  });

  const bytes = tsBytes instanceof Uint8Array ? tsBytes : new Uint8Array(tsBytes);
  transmuxer.push(bytes);
  transmuxer.flush();

  if (parts.length === 0) {
    return bytes;
  }

  const totalLength = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const mergedMp4 = new Uint8Array(totalLength);
  let offset = 0;
  for (const p of parts) {
    mergedMp4.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  }

  // Attempt to unfragment into a classic, progressive faststart MP4
  const unfragmented = unfragmentFmp4(mergedMp4, duration);
  if (unfragmented && unfragmented !== mergedMp4) {
    return unfragmented;
  }

  if (duration > 0) {
    return fixFileDuration(mergedMp4, duration);
  }

  return mergedMp4;
}

const StegoTransmuxer = { transmuxTsToMp4, unfragmentFmp4, fixFileDuration };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoTransmuxer;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoTransmuxer = StegoTransmuxer;
}
