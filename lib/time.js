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
  if (isNaN(sec) || sec < 0) return '00:00';
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

function isGenericBase(name) {
  if (!name) return true;
  const lower = name.toLowerCase();
  return (
    lower === 'video' ||
    lower === 'video_clip' ||
    lower === 'clip' ||
    lower === 'master' ||
    lower === 'index' ||
    lower.startsWith('master') ||
    lower.startsWith('index')
  );
}

function formatTimestampForFilename(str) {
  if (!str) return '00_00';
  try {
    const totalSeconds = parseTimestamp(str);
    return formatDuration(totalSeconds).replace(/:/g, '_');
  } catch {
    return str
      .trim()
      .replace(/[:\s]+/g, '_')
      .replace(/[^A-Za-z0-9_]/g, '');
  }
}

function extractBaseName(currentVal, defaultBase = 'video_clip') {
  if (!currentVal) return { base: defaultBase, sep: '-' };

  // Strip any accidental .mp4 or .ts
  let val = currentVal.trim().replace(/\.(mp4|ts)$/i, '');

  // Strip trailing timestamp / full / clip suffixes repeatedly FIRST
  const suffixRegex =
    /([._-])(?:full|clip|\d{1,2}(?:[:_]\d{1,2})*[-_]\d{1,2}(?:[:_]\d{1,2})*|\d{1,2}(?:[:_]\d{1,2})+.*)$/i;
  let sep = '-';
  while (true) {
    const match = val.match(suffixRegex);
    if (match && match.index > 0) {
      sep = match[1] === '.' ? '.' : match[1] === '_' ? '_' : '-';
      val = val.slice(0, match.index);
    } else {
      break;
    }
  }

  // If defaultBase is provided and non-generic, check if val starts with it or equals it
  if (defaultBase && !isGenericBase(defaultBase)) {
    if (
      val === defaultBase ||
      val.startsWith(defaultBase + '-') ||
      val.startsWith(defaultBase + '_') ||
      val.startsWith(defaultBase + '.')
    ) {
      return { base: defaultBase, sep };
    }
  }

  // If defaultBase is generic, but val contains a clear video code, use the extracted code
  if (isGenericBase(defaultBase)) {
    const code = extractCode(val);
    if (code) {
      return { base: code, sep };
    }
  }

  if ((!val || isGenericBase(val)) && defaultBase) {
    return { base: defaultBase, sep: '-' };
  }

  return { base: val || defaultBase, sep };
}

function extractCode(str) {
  if (!str) return null;
  const match = str.match(
    /(?:^|[^A-Za-z0-9])([A-Za-z]{2,10}(?:[-_][A-Za-z0-9]{2,10})*[-_]\d{2,8})(?:[^A-Za-z0-9]|$)/i
  );
  return match ? match[1].toUpperCase() : null;
}

function cleanTitleForFilename(title) {
  if (!title) return '';
  let cleaned = title
    .replace(/[\\/*?:"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
    .replace(/^-+|-+$/g, '');
  if (cleaned.length > 80) {
    cleaned = cleaned.slice(0, 80).replace(/-+$/g, '');
  }
  return cleaned;
}

function detectBaseNameFromTitle(title) {
  return cleanTitleForFilename(title);
}

function buildClipFilename(base, startTimeStr, endTimeStr, isFull = false, sep = '-') {
  const cleanBase = (base || 'video_clip').trim().replace(/\.(mp4|ts)$/i, '') || 'video_clip';
  if (isFull) {
    return `${cleanBase}${sep}full`;
  }
  const start = formatTimestampForFilename(startTimeStr);
  const end = formatTimestampForFilename(endTimeStr);
  return `${cleanBase}${sep}${start}-${end}`;
}

const StegoTime = {
  parseTimestamp,
  formatDuration,
  formatBitrate,
  formatBytes,
  formatTimestampForFilename,
  extractBaseName,
  buildClipFilename,
  detectBaseNameFromTitle,
  cleanTitleForFilename,
  isGenericBase
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoTime;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoTime = StegoTime;
}
