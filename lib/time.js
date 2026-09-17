/**
 * Utility functions for parsing and formatting media timestamps.
 */

function parseTimestamp(str) {
  if (typeof str === 'number') return str;
  if (!str || typeof str !== 'string') return 0;

  const trimmed = str.trim();
  const parts = trimmed.split(':');

  if (parts.length === 1) {
    const sec = parseFloat(parts[0]);
    if (isNaN(sec)) throw new Error(`Invalid timestamp: ${str}`);
    return Math.max(0, sec);
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]);
    const s = parseFloat(parts[1]);
    if (isNaN(m) || isNaN(s)) throw new Error(`Invalid timestamp: ${str}`);
    return Math.max(0, m * 60 + s);
  } else if (parts.length === 3) {
    const h = parseFloat(parts[0]);
    const m = parseFloat(parts[1]);
    const s = parseFloat(parts[2]);
    if (isNaN(h) || isNaN(m) || isNaN(s)) throw new Error(`Invalid timestamp: ${str}`);
    return Math.max(0, h * 3600 + m * 60 + s);
  }

  throw new Error(`Invalid timestamp format: ${str}`);
}

function formatDuration(sec) {
  if (isNaN(sec) || sec < 0) return "00:00";
  const totalSec = Math.floor(sec);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  const mStr = String(m).padStart(2, '0');
  const sStr = String(s).padStart(2, '0');

  if (h > 0) {
    const hStr = String(h).padStart(2, '0');
    return `${hStr}:${mStr}:${sStr}`;
  }
  return `${mStr}:${sStr}`;
}

function formatBitrate(bps) {
  if (!bps || isNaN(bps) || bps <= 0) return '--';
  if (bps >= 1000 * 1000) {
    return (bps / (1000 * 1000)).toFixed(2) + ' Mbps';
  }
  return Math.round(bps / 1000) + ' kbps';
}

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes <= 0) return '--';
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(1) + ' KB';
  } else if (bytes < 1024 * 1024 * 1024) {
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  } else {
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }
}

function formatTimestampForFilename(str) {
  if (!str) return '00_00';
  return str.trim().replace(/:/g, '_');
}

function extractBaseName(currentVal, defaultBase = 'video_clip') {
  if (!currentVal) return { base: defaultBase, sep: '_' };

  // Strip any accidental .mp4 or .ts
  let val = currentVal.trim().replace(/\.(mp4|ts)$/i, '');

  // Match existing timestamp suffix or _full / _clip
  const timestampRegex = /([._])(?:\d{1,2}_\d{2}(?:_\d{2})?[-_]\d{1,2}_\d{2}(?:_\d{2})?|full|clip)$/i;
  const match = val.match(timestampRegex);
  if (match) {
    const sep = match[1];
    let base = val.slice(0, match.index);
    if ((!base || base === 'video' || base === 'video_clip' || base.startsWith('master') || base.startsWith('index')) && defaultBase) {
      base = defaultBase;
    }
    return { base: base || defaultBase, sep };
  }

  if ((val === 'video' || val === 'video_clip' || val.startsWith('master') || val.startsWith('index')) && defaultBase) {
    return { base: defaultBase, sep: '_' };
  }

  return { base: val, sep: '_' };
}

function buildClipFilename(base, startTimeStr, endTimeStr, isFull = false, sep = '_') {
  const cleanBase = (base || 'video_clip').trim().replace(/\.(mp4|ts)$/i, '') || 'video_clip';
  if (isFull) {
    return `${cleanBase}${sep}full`;
  }
  const start = formatTimestampForFilename(startTimeStr);
  const end = formatTimestampForFilename(endTimeStr);
  return `${cleanBase}${sep}${start}-${end}`;
}

function detectBaseNameFromTitle(title) {
  if (!title) return '';
  const codeMatch = title.match(/(?:^|[^A-Za-z0-9])([A-Za-z0-9]{2,10}(?:[-_][A-Za-z0-9]{2,10})*[-_]\d{2,8})(?:[^A-Za-z0-9]|$)/i);
  if (codeMatch) {
    return codeMatch[1].toUpperCase();
  }
  let cleaned = title
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/【[^】]*】/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[\\/*?:"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .trim()
    .replace(/^_+|_+$/g, '');
  if (cleaned.length > 40) {
    cleaned = cleaned.slice(0, 40).replace(/_+$/g, '');
  }
  return cleaned;
}

const StegoTime = {
  parseTimestamp,
  formatDuration,
  formatBitrate,
  formatBytes,
  formatTimestampForFilename,
  extractBaseName,
  buildClipFilename,
  detectBaseNameFromTitle
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoTime;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoTime = StegoTime;
}
