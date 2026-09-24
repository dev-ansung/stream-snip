/**
 * Pure decision logic for whether a network request is an HLS manifest or a
 * direct (non-HLS) media file.
 *
 * Deliberately dependency-free (no chrome.* APIs) so it can be unit tested
 * directly and reused from any webRequest stage, independent of the
 * tabStreams/storage bookkeeping that consumes its result (see
 * background/catcher.js).
 *
 * Matching on the URL alone (as this extension originally did) misses a lot
 * of real playlists: many CDNs serve HLS manifests from signed URLs or
 * generic endpoints with no ".m3u8" anywhere in the path. Content-Type,
 * Content-Disposition's filename, and Chrome's own resourceType are checked
 * too — the same set of signals cat-catch uses
 * (https://github.com/xifangczy/cat-catch, js/background.js findMedia()) —
 * with one addition cat-catch doesn't have: a URL whose extension is
 * unambiguously non-media (e.g. ".woff2") is rejected outright even if
 * Content-Type claims otherwise, since ad/tracker domains are known to spoof
 * a video/audio Content-Type on fake "segment" URLs specifically to bait
 * tools like this one.
 *
 * Deliberately NOT handled here: DASH (.mpd/application/dash+xml) and raw
 * fragment files (.m4s/application/m4s). Both are manifest/fragment
 * ecosystems where a single URL isn't a complete, downloadable file — adding
 * them to "direct" would just let a user download a useless fragment or an
 * XML manifest. That's a distinct feature (a DASH parser), not a detection
 * gap to paper over here.
 */

const M3U8_CONTENT_TYPES = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'application/mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl',
  'application/octet-stream-m3u8'
]);

function looksLikeHlsTextPlaylist(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    /(?:master|playlist|index|manifest)\.txt(?:[?#]|$)/i.test(lower) ||
    lower.includes('.urlset/') ||
    /\/hls\d*\/.*\.txt/i.test(lower)
  );
}

function isM3u8Url(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('.m3u8') ||
    lower.includes('/m3u8') ||
    lower.includes('urlset/master') ||
    /\.m3u(?:[?#]|$)/.test(lower) ||
    looksLikeHlsTextPlaylist(url)
  );
}

function isM3u8ContentType(contentType) {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  return M3U8_CONTENT_TYPES.has(base);
}

// The two signals are complementary, not redundant: Content-Type is
// authoritative when the server sets it correctly, but plenty of CDNs
// mislabel it (e.g. serving `application/octet-stream`), so the URL
// heuristic remains as a fallback rather than being replaced outright.
/**
 * @param {{ url?: string, contentType?: string }} [opts]
 */
function looksLikeM3u8Request({ url, contentType } = {}) {
  return isM3u8ContentType(contentType) || isM3u8Url(url);
}

// Direct (non-HLS) media files — progressive MP4/audio/etc — matching
// cat-catch's Ext/Type lists (js/init.js) for the subset that's actually a
// complete single file: recognized by resource Content-Type prefix,
// specific Content-Type, or file extension.
const DIRECT_MEDIA_CONTENT_TYPE_PREFIXES = ['video/', 'audio/'];
const DIRECT_MEDIA_EXACT_CONTENT_TYPES = new Set(['application/ogg']);
const DIRECT_MEDIA_EXTENSIONS = new Set([
  'mp4',
  'm4v',
  'm4a',
  'mov',
  'mkv',
  'webm',
  'flv',
  'hlv',
  'f4v',
  'avi',
  'wmv',
  'asf',
  'mp3',
  'aac',
  'wav',
  'wma',
  'ogg',
  'ogv',
  'opus',
  'weba',
  'flac',
  'mpeg',
  'mpeg4',
  'movie',
  'divx',
  'vid'
]);

function extensionFromFilename(name) {
  if (!name) return '';
  let decoded = name;
  try {
    decoded = decodeURIComponent(name);
  } catch {
    // Malformed percent-encoding — fall back to the raw name.
  }
  const dot = decoded.lastIndexOf('.');
  return dot >= 0
    ? decoded
        .slice(dot + 1)
        .toLowerCase()
        .trim()
    : '';
}

function getUrlExtension(url) {
  try {
    const { pathname } = new URL(url);
    return extensionFromFilename(pathname.split('/').pop() || '');
  } catch {
    return '';
  }
}

// Matches both `filename="x.mp4"` and the RFC 5987 `filename*=UTF-8''x.mp4`
// form.
const CONTENT_DISPOSITION_FILENAME_RE = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i;

function getContentDispositionExtension(contentDisposition) {
  if (!contentDisposition) return '';
  const match = CONTENT_DISPOSITION_FILENAME_RE.exec(contentDisposition);
  return match ? extensionFromFilename(match[1]) : '';
}

function isDirectMediaContentType(contentType) {
  if (!contentType) return false;
  const base = contentType.split(';')[0].trim().toLowerCase();
  if (M3U8_CONTENT_TYPES.has(base)) return false;
  if (DIRECT_MEDIA_EXACT_CONTENT_TYPES.has(base)) return true;
  return DIRECT_MEDIA_CONTENT_TYPE_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function isDirectMediaUrl(url) {
  return DIRECT_MEDIA_EXTENSIONS.has(getUrlExtension(url));
}

/**
 * @param {{ url?: string, contentType?: string }} [opts]
 */
function looksLikeDirectMediaRequest({ url, contentType } = {}) {
  return isDirectMediaContentType(contentType) || isDirectMediaUrl(url);
}

// Extensions that are unambiguously NOT media. A URL ending in one of these
// claiming a video/audio Content-Type isn't a mislabeled server — it's a
// spoofed response (ad/tracker domains disguise beacon traffic as fake
// "segments" with a fake media Content-Type specifically to bait sniffers
// like this one). The extension is what the browser will actually treat the
// resource as; a conflicting Content-Type is the thing that's lying.
const NON_MEDIA_EXTENSIONS = new Set([
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'js',
  'mjs',
  'css',
  'json',
  'xml',
  'html',
  'htm',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'txt',
  'map'
]);

function hasConflictingExtension(url, contentType = '') {
  const ext = getUrlExtension(url);
  if (!ext || !NON_MEDIA_EXTENSIONS.has(ext)) return false;
  // If the extension is txt, do not disqualify if it matches HLS playlist naming
  // or if the server explicitly returned an HLS Content-Type.
  if (ext === 'txt') {
    if (looksLikeHlsTextPlaylist(url) || isM3u8ContentType(contentType)) {
      return false;
    }
  }
  return true;
}

// Single entry point for discovery. Checked in order:
//  1. A conflicting non-media URL extension disqualifies outright, no
//     matter what any other signal says.
//  2. URL / Content-Type (HLS takes priority, since an HLS manifest is
//     occasionally served with a video/* Content-Type by misconfigured
//     servers).
//  3. Content-Disposition's filename, when present.
//  4. Chrome's own resourceType: `media` means the browser fetched this
//     specifically as a <video>/<audio> element's source. Chrome assigns
//     this from the actual DOM/CSS mechanism that triggered the request —
//     a server can't spoof it the way it can a header — so it's trusted
//     even without a matching extension or Content-Type. Matches
//     cat-catch's own `if (data.type == "media") filter = true`.
// null means nothing matched.
/**
 * @param {{ url?: string, contentType?: string, contentDisposition?: string, resourceType?: string }} [opts]
 * @returns {import('../types/domain.js').MediaRequestKind | null}
 */
function classifyMediaRequest({ url, contentType, contentDisposition, resourceType } = {}) {
  if (hasConflictingExtension(url, contentType)) return null;

  if (looksLikeM3u8Request({ url, contentType })) return 'hls';
  if (looksLikeDirectMediaRequest({ url, contentType })) return 'direct';

  const dispositionExt = getContentDispositionExtension(contentDisposition);
  if (dispositionExt) {
    if (NON_MEDIA_EXTENSIONS.has(dispositionExt) && dispositionExt !== 'txt') return null;
    if (dispositionExt === 'm3u8' || dispositionExt === 'm3u') return 'hls';
    if (DIRECT_MEDIA_EXTENSIONS.has(dispositionExt)) return 'direct';
  }

  if (resourceType === 'media') return 'direct';

  return null;
}

/**
 * Resolves effective request headers for media requests, populating Referer
 * and Origin from the stream's pageUrl or fallback page URL when missing.
 *
 * @param {{ headers?: Record<string, string>, pageUrl?: string }} stream
 * @param {string} [fallbackPageUrl]
 * @returns {Record<string, string>}
 */
function resolveStreamHeaders(stream, fallbackPageUrl = '') {
  const headers = { ...(stream?.headers || {}) };
  const pageUrl = fallbackPageUrl || stream?.pageUrl || '';

  const hasReferer = Object.keys(headers).some((k) => k.toLowerCase() === 'referer');
  const hasOrigin = Object.keys(headers).some((k) => k.toLowerCase() === 'origin');

  if (!hasReferer && pageUrl) {
    headers['Referer'] = pageUrl;
  }
  if (!hasOrigin && pageUrl) {
    try {
      headers['Origin'] = new URL(pageUrl).origin;
    } catch {
      // ignore invalid pageUrl
    }
  }
  return headers;
}

const StreamSniffer = {
  M3U8_CONTENT_TYPES,
  DIRECT_MEDIA_EXTENSIONS,
  DIRECT_MEDIA_EXACT_CONTENT_TYPES,
  NON_MEDIA_EXTENSIONS,
  looksLikeHlsTextPlaylist,
  isM3u8Url,
  isM3u8ContentType,
  looksLikeM3u8Request,
  getUrlExtension,
  extensionFromFilename,
  getContentDispositionExtension,
  isDirectMediaContentType,
  isDirectMediaUrl,
  looksLikeDirectMediaRequest,
  hasConflictingExtension,
  classifyMediaRequest,
  resolveStreamHeaders
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StreamSniffer;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StreamSniffer = StreamSniffer;
}
