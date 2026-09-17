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

const StegoTime = { parseTimestamp, formatDuration, formatBitrate, formatBytes };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoTime;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoTime = StegoTime;
}
