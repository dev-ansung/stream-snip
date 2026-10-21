/**
 * UI controller for the StegoClip Side Panel & Download Manager.
 * Coordinates PlayerController, StateManager, UiFeedback, and SegmentDownloader.
 */

let currentStreams = [];
let selectedStream = null;
let currentVariants = [];
let selectedVariant = null;
let currentTimeline = null;
let currentTabId = null;
let currentDefaultBaseName = '';
let userCustomBaseName = null;
// True when selectedStream is a direct (non-HLS) media file — no segments,
// so no time-range clipping; download is always the whole file.
let isDirectStreamActive = false;

// DOM Elements
const videoEl = /** @type {HTMLVideoElement | null} */ (document.getElementById('previewPlayer'));
const streamSelect = document.getElementById('streamSelect');
const streamCountBadge = document.getElementById('streamCount');
const videoInfoEl = document.getElementById('videoInfo');
const activeQualityBadge = document.getElementById('activeQualityBadge');
const manualStreamUrlInput = document.getElementById('manualStreamUrl');
const btnAddManualStream = document.getElementById('btnAddManualStream');

const mediaResolutionEl = document.getElementById('mediaResolution');
const mediaBitrateEl = document.getElementById('mediaBitrate');
const mediaCodecsEl = document.getElementById('mediaCodecs');
const mediaDurationEl = document.getElementById('mediaDuration');
const mediaSegmentsEl = document.getElementById('mediaSegments');
const mediaEstSizeEl = document.getElementById('mediaEstSize');

const qualitySection = document.getElementById('qualitySection');
const qualitySelect = document.getElementById('qualitySelect');

const startTimeInput = document.getElementById('startTime');
const endTimeInput = document.getElementById('endTime');
const btnSetStart = document.getElementById('btnSetStart');
const btnSetEnd = document.getElementById('btnSetEnd');
const fullVideoToggle = document.getElementById('fullVideoToggle');
const clipDurationText = document.getElementById('clipDurationText');
const btnQuickCut = document.getElementById('btnQuickCut');
const quickCutMinutesInput = document.getElementById('quickCutMinutes');

const filenameInput = document.getElementById('filenameInput');
const formatSelect = document.getElementById('formatSelect');
const btnDownload = document.getElementById('btnDownload');
const btnCancel = document.getElementById('btnCancel');
const progressContainer = document.getElementById('progressContainer');
const downloadProgress = document.getElementById('downloadProgress');
const progressStatus = document.getElementById('progressStatus');
const btnReloadExtension = document.getElementById('btnReloadExtension');
const logTerminal = document.getElementById('logTerminal');
const btnRefreshLogs = document.getElementById('btnRefreshLogs');
const btnCopyLogs = document.getElementById('btnCopyLogs');
const btnClearLogs = document.getElementById('btnClearLogs');

// Tab Navigation Elements
const tabBtns = document.querySelectorAll('.nav-tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const btnBackToVideos = document.getElementById('btnBackToVideos');
const btnPopoutPlayer = document.getElementById('btnPopoutPlayer');
const currentLoadedStreamTitle = document.getElementById('currentLoadedStreamTitle');

// Videos Tab Elements
const streamSearchInput = /** @type {HTMLInputElement | null} */ (
  document.getElementById('streamSearchInput')
);
const btnClearStreams = document.getElementById('btnClearStreams');
const filterChips = document.querySelectorAll('.filter-chip');
const videoCardList = document.getElementById('videoCardList');
const emptyVideosState = document.getElementById('emptyVideosState');

// Downloads Tab Elements
const activeDlBadge = document.getElementById('activeDlBadge');
const activeTasksContainer = document.getElementById('activeTasksContainer');
const _noActiveDlMessage = document.getElementById('noActiveDlMessage');
const downloadHistoryList = document.getElementById('downloadHistoryList');
const noHistoryMessage = document.getElementById('noHistoryMessage');
const btnClearHistory = document.getElementById('btnClearHistory');
const historyCountBadge = document.getElementById('historyCountBadge');
let currentTabUrl = '';
let currentTabFaviconUrl = '';

// Settings Tab Elements
const settingMinSize = /** @type {HTMLInputElement | null} */ (
  document.getElementById('settingMinSize')
);
const settingStegoStrip = /** @type {HTMLInputElement | null} */ (
  document.getElementById('settingStegoStrip')
);
const settingDefaultFormat = /** @type {HTMLSelectElement | null} */ (
  document.getElementById('settingDefaultFormat')
);
const settingMp3Bitrate = /** @type {HTMLSelectElement | null} */ (
  document.getElementById('settingMp3Bitrate')
);
const settingConcurrency = /** @type {HTMLSelectElement | null} */ (
  document.getElementById('settingConcurrency')
);

let _currentTabName = 'videos';
let currentMediaFilter = 'all';
let currentSearchQuery = '';
/** @type {Map<string, any>} */
const activeDownloadTasks = new Map();

// Check display and execution params
const urlParams = new URLSearchParams(window.location.search);
const tabIdFromUrl = urlParams.get('tabId') ? parseInt(urlParams.get('tabId'), 10) : null;
const shouldAutoDownload =
  urlParams.get('download') === '1' || urlParams.get('autoDownload') === 'true';

// Connect side panel port to arm passive capture
if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
  try {
    chrome.runtime.connect({ name: 'sidepanel' });
  } catch {}
}

function getHeightLabel(height) {
  if (height >= 2160) return '4K';
  if (height >= 1440) return '2K';
  if (height >= 1080) return '1080p';
  if (height >= 720) return '720p';
  if (height >= 480) return '480p';
  if (height >= 360) return '360p';
  return `${height}p`;
}

function _getFinalizeStatusLabel(fmt) {
  if (fmt === 'mp4') return 'Transmuxing to MP4...';
  if (fmt === 'mp3') return 'Extracting & encoding MP3...';
  return 'Saving file...';
}

// StegoConstants may not be loaded yet (or at all, in the Node test
// environment) — these fall back to the raw key/default rather than
// repeating the same typeof-guard ternary at every call site.
function getMsgType(key) {
  return (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.[key]) || key;
}

function getConcurrency() {
  if (settingConcurrency?.value) {
    const parsed = parseInt(settingConcurrency.value, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return (typeof StegoConstants !== 'undefined' && StegoConstants.CONFIG?.DEFAULT_CONCURRENCY) || 5;
}

function formatCodecName(c) {
  if (!c) return '';
  if (c.startsWith('avc1') || c.startsWith('avc3')) return 'H.264 (AVC)';
  if (c.startsWith('hvc1') || c.startsWith('hev1')) return 'H.265 (HEVC)';
  if (c.startsWith('mp4a')) return 'AAC';
  if (c.startsWith('vp09')) return 'VP9';
  if (c.startsWith('av01')) return 'AV1';
  if (c.startsWith('opus')) return 'Opus';
  return c;
}

function formatCodecString(codecStr) {
  if (!codecStr) return 'H.264 / AAC';
  return codecStr
    .split(',')
    .map((s) => formatCodecName(s.trim()))
    .join(' / ');
}

function renderMediaDetails(info = PlayerController.getMediaInfo()) {
  if (info.width > 0 && info.height > 0) {
    const label = getHeightLabel(info.height);
    mediaResolutionEl.textContent = `${info.width} × ${info.height} (${label})`;
    activeQualityBadge.textContent = `${label} (${info.width}x${info.height})`;
  } else if (selectedVariant?.height > 0) {
    const label = getHeightLabel(selectedVariant.height);
    const res = selectedVariant.resolution || `${selectedVariant.height}p`;
    mediaResolutionEl.textContent = `${res} (${label})`;
    activeQualityBadge.textContent = label;
  } else if (selectedVariant?.resolution) {
    mediaResolutionEl.textContent = selectedVariant.resolution;
    activeQualityBadge.textContent = selectedVariant.resolution;
  } else {
    mediaResolutionEl.textContent = 'Detecting...';
    activeQualityBadge.textContent = 'Auto';
  }

  const bps = info.bitrate || selectedVariant?.bandwidth || 0;
  mediaBitrateEl.textContent = bps > 0 ? StegoTime.formatBitrate(bps) : '--';

  let codecStr = '';
  if (info.videoCodec || info.audioCodec) {
    const v = formatCodecName(info.videoCodec);
    const a = formatCodecName(info.audioCodec);
    codecStr = [v, a].filter(Boolean).join(' / ');
  } else if (selectedVariant?.codecs) {
    codecStr = formatCodecString(selectedVariant.codecs);
  }
  mediaCodecsEl.textContent = codecStr || 'H.264 / AAC';

  if (info.totalDuration > 0) {
    mediaDurationEl.textContent = StegoTime.formatDuration(info.totalDuration);
    videoInfoEl.textContent = `Duration: ${StegoTime.formatDuration(info.totalDuration)} (${info.segmentCount} segments)`;
  } else {
    mediaDurationEl.textContent = '--:--';
  }

  if (info.segmentCount > 0) {
    const avg = info.avgSegmentDuration > 0 ? ` (~${info.avgSegmentDuration.toFixed(1)}s/seg)` : '';
    mediaSegmentsEl.textContent = `${info.segmentCount}${avg}`;
  } else {
    mediaSegmentsEl.textContent = '--';
  }

  updateEstimatedSizes(info);
}

function updateEstimatedSizes(info = PlayerController.getMediaInfo()) {
  const bps = info.bitrate || selectedVariant?.bandwidth || 0;
  if (bps > 0 && info.totalDuration > 0) {
    const fullBytes = (bps / 8) * info.totalDuration;
    let clipSec = info.totalDuration;
    if (!fullVideoToggle.checked) {
      try {
        const s = StegoTime.parseTimestamp(startTimeInput.value);
        const e = StegoTime.parseTimestamp(endTimeInput.value);
        if (e > s) clipSec = e - s;
      } catch {}
    }
    const clipBytes = (bps / 8) * clipSec;
    mediaEstSizeEl.textContent = `Full: ~${StegoTime.formatBytes(fullBytes)}`;
    clipDurationText.textContent = `Clip: ${StegoTime.formatDuration(clipSec)} (~${StegoTime.formatBytes(clipBytes)})`;
  } else {
    mediaEstSizeEl.textContent = '--';
  }
}

function updateStreamOptionWithResolution(streamUrl, width, height) {
  if (!streamUrl || !width || !height) return;
  const label = getHeightLabel(height);
  for (const opt of streamSelect.options) {
    if (
      opt.value === streamUrl &&
      !opt.textContent.includes('×') &&
      !opt.textContent.includes(`${height}p`)
    ) {
      opt.textContent = `[${label} • ${width}x${height}] ${opt.textContent}`;
    }
  }
}

function getPopupStatePayload() {
  return {
    streamUrl: selectedStream?.url || '',
    variantUrl: selectedVariant?.url || '',
    headers: selectedStream?.headers || {},
    startTime: startTimeInput?.value || '',
    endTime: endTimeInput?.value || '',
    isFull: fullVideoToggle?.checked || false,
    filename: filenameInput?.value || '',
    userCustomBaseName: userCustomBaseName || '',
    isUserCustomFilename: Boolean(userCustomBaseName),
    format: formatSelect?.value || 'mp4'
  };
}

function savePopupState() {
  if (!currentTabId) return;
  StateManager.saveState(currentTabId, getPopupStatePayload());
}

async function savePopupStateImmediate() {
  if (!currentTabId) return;
  await StateManager.saveStateImmediate(currentTabId, getPopupStatePayload());
}

// Quick Cut window size is a user preference, not tab state, so it lives
// under its own global storage key rather than in StateManager.
async function loadQuickCutMinutes() {
  const key = getStorageKey('QUICK_CUT_MINUTES', 'stego_quick_cut_minutes');
  const fallback = getConfigDefault('DEFAULT_QUICK_CUT_MINUTES', 10);
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return fallback;
  try {
    const res = await chrome.storage.local.get([key]);
    const stored = Number(res[key]);
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

function saveQuickCutMinutes(minutes) {
  const key = getStorageKey('QUICK_CUT_MINUTES', 'stego_quick_cut_minutes');
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  chrome.storage.local.set({ [key]: minutes }).catch(() => {});
}

function getStorageKey(name, fallback) {
  return (typeof StegoConstants !== 'undefined' && StegoConstants.STORAGE_KEYS?.[name]) || fallback;
}

function getConfigDefault(name, fallback) {
  return (typeof StegoConstants !== 'undefined' && StegoConstants.CONFIG?.[name]) ?? fallback;
}

function updateClipDuration() {
  try {
    const startSec = StegoTime.parseTimestamp(startTimeInput.value);
    const endSec = StegoTime.parseTimestamp(endTimeInput.value);
    const diff = Math.max(0, endSec - startSec);
    const bps = PlayerController.getMediaInfo().bitrate || selectedVariant?.bandwidth || 0;
    if (bps > 0) {
      const clipBytes = (bps / 8) * diff;
      clipDurationText.textContent = `Clip: ${StegoTime.formatDuration(diff)} (~${StegoTime.formatBytes(clipBytes)})`;
    } else {
      clipDurationText.textContent = `Clip: ${StegoTime.formatDuration(diff)}`;
    }
  } catch {
    clipDurationText.textContent = 'Clip: --:--';
  }
}

async function resolveDocumentTitle(targetTabId) {
  if (!targetTabId || typeof chrome === 'undefined' || !chrome.tabs) return null;
  // Priority 1: Query active in-page document.title via content script
  try {
    const liveTitle = await new Promise((resolve) => {
      chrome.tabs.sendMessage(targetTabId, { type: 'GET_PAGE_TITLE' }, (res) => {
        if (!chrome.runtime.lastError && res?.success && res.cleanTitle) {
          resolve(res.cleanTitle);
        } else {
          resolve(null);
        }
      });
    });
    if (liveTitle && !StegoTime.isGenericBase(liveTitle)) return liveTitle;
  } catch {}

  // Priority 2: Fall back to chrome.tabs.get
  try {
    const tab = await chrome.tabs.get(targetTabId);
    if (tab?.title) {
      const clean = StegoTime.cleanTitleForFilename(tab.title);
      if (clean && !StegoTime.isGenericBase(clean)) return clean;
    }
  } catch {}
  return null;
}

function getBestStreamBaseName(stream, fallbackTitle = '') {
  if (stream?.cleanTitle && !StegoTime.isGenericBase(stream.cleanTitle)) {
    return stream.cleanTitle;
  }
  if (fallbackTitle && !StegoTime.isGenericBase(fallbackTitle)) {
    return fallbackTitle;
  }
  const targetUrl = stream?.url || '';
  if (targetUrl) {
    try {
      const parsed = new URL(targetUrl);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const base = parts.pop() || 'video';
      let cleanBase = base.replace(/\.m3u8$/i, '');
      if (cleanBase === 'master' || cleanBase === 'index' || cleanBase.startsWith('index-')) {
        const prev = parts.pop();
        if (prev) cleanBase = `${prev}-${cleanBase}`;
      }
      if (cleanBase && !StegoTime.isGenericBase(cleanBase)) {
        return cleanBase;
      }
    } catch {}
  }
  return 'video_clip';
}

function updateFilenameTimestamps() {
  const base = userCustomBaseName || currentDefaultBaseName || 'video_clip';
  const isFull = fullVideoToggle.checked;
  const startStr = startTimeInput.value || '00:00';
  const endStr = endTimeInput.value || '00:00';
  filenameInput.value = StegoTime.buildClipFilename(base, startStr, endStr, isFull, '-');
}

async function updateFilenameForSelectedStream(stream, overrideCustom = false) {
  if (!stream) return;
  if (userCustomBaseName && !overrideCustom) {
    updateFilenameTimestamps();
    return;
  }

  let liveTitle = null;
  if (currentTabId) {
    liveTitle = await resolveDocumentTitle(currentTabId);
  }

  const bestBase = liveTitle || getBestStreamBaseName(stream, currentDefaultBaseName);
  if (bestBase && !StegoTime.isGenericBase(bestBase)) {
    currentDefaultBaseName = bestBase;
    if (stream) {
      stream.cleanTitle = bestBase;
    }
  }
  updateFilenameTimestamps();
}

function updateDefaultFilename() {
  if (userCustomBaseName) {
    updateFilenameTimestamps();
    return;
  }
  const stream = selectedStream || currentStreams[0];
  const bestBase = getBestStreamBaseName(stream, currentDefaultBaseName);
  if (bestBase && !StegoTime.isGenericBase(bestBase)) {
    currentDefaultBaseName = bestBase;
  }
  updateFilenameTimestamps();
}

async function loadVariant(variant) {
  selectedVariant = variant;
  PlayerController.loadVariant(variant);

  try {
    const subResp = await fetch(variant.url);
    const subText = await readManifestText(subResp);
    currentTimeline = StegoParser.PlaylistParser.parseManifest(subText, variant.url);
    const totalSec = currentTimeline.totalDuration;

    PlayerController.mediaInfo.totalDuration = totalSec;
    PlayerController.mediaInfo.segmentCount = currentTimeline.segments.length;
    PlayerController.mediaInfo.avgSegmentDuration =
      currentTimeline.segments.length > 0 ? totalSec / currentTimeline.segments.length : 0;
    renderMediaDetails();

    if (!startTimeInput.value || startTimeInput.value === '00:00') {
      startTimeInput.value = '00:00';
    }
    endTimeInput.value = StegoTime.formatDuration(totalSec);
    updateClipDuration();
    updateDefaultFilename();
    // Only now is currentTimeline actually populated — Quick Cut/Set
    // Start/Set End would fail before this point, so they stay disabled
    // (see lockRangeControlsForLoading in loadStream) until here.
    resetRangeControlsForHls();
  } catch (err) {
    // Let loadStream's catch decide whether to fall back to direct-media
    // handling — swallowing it here would hide that signal.
    if (err instanceof NotHlsError) throw err;
    resetRangeControlsForHls();
    videoInfoEl.textContent = `Manifest error: ${err.message}`;
    UiFeedback.error(`Failed loading variant playlist: ${err.message}`);
  }
}

// Reads a fetch Response as text, but bails out (canceling the rest of the
// download) as soon as enough bytes have arrived to tell it isn't an HLS
// playlist. Without this, pasting a direct video/audio link (instead of its
// .m3u8 manifest) silently tries to read the entire file — potentially
// hundreds of MB — as text before failing, which looks like the extension
// hung ("nothing happens").
const M3U8_SNIFF_BYTES = 512;

// Thrown by readManifestText when the response clearly isn't an HLS
// playlist. Callers use this specifically (rather than a generic Error) to
// tell "this is broken" apart from "this is actually a direct media file,
// fall back to loadDirectStream" — see loadStream/loadVariant below.
class NotHlsError extends Error {}

async function readManifestText(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    // Environment without a streaming body (shouldn't happen in Chrome) —
    // fall back to reading it all, then validate.
    const text = await response.text();
    if (!StegoParser.PlaylistParser.looksLikeM3u8(text)) {
      throw new NotHlsError(
        "Doesn't look like an HLS playlist (missing #EXTM3U) — likely a direct video/audio file, not an .m3u8 manifest URL."
      );
    }
    return text;
  }

  const decoder = new TextDecoder();
  let text = '';
  let checked = false;

  while (true) {
    const { done, value } = await reader.read();
    if (value) text += decoder.decode(value, { stream: true });

    if (!checked && (text.length >= M3U8_SNIFF_BYTES || done)) {
      checked = true;
      if (!StegoParser.PlaylistParser.looksLikeM3u8(text)) {
        try {
          await reader.cancel();
        } catch {}
        throw new NotHlsError(
          "Doesn't look like an HLS playlist (missing #EXTM3U) — likely a direct video/audio file, not an .m3u8 manifest URL."
        );
      }
    }

    if (done) break;
  }

  text += decoder.decode();
  return text;
}

// Disables the range/quick-cut/format controls while a stream's manifest is
// being fetched — there's no currentTimeline yet, so Quick Cut/Set
// Start/Set End would just fail. Previously these stayed clickable the
// whole time and silently no-op'd (via an easily-missed toast) if clicked
// before the manifest resolved; this makes "not ready yet" visible instead.
function lockRangeControlsForLoading() {
  fullVideoToggle.disabled = true;
  startTimeInput.disabled = true;
  endTimeInput.disabled = true;
  btnSetStart.disabled = true;
  btnSetEnd.disabled = true;
  if (btnQuickCut) btnQuickCut.disabled = true;
  if (formatSelect) formatSelect.disabled = true;
}

// Enables the range controls once a stream's timeline is actually ready
// (currentTimeline populated) — called after a successful HLS load, or to
// recover from an error, so controls never stay stuck disabled.
function resetRangeControlsForHls() {
  isDirectStreamActive = false;
  fullVideoToggle.disabled = false;
  if (!fullVideoToggle.checked) {
    startTimeInput.disabled = false;
    endTimeInput.disabled = false;
    btnSetStart.disabled = false;
    btnSetEnd.disabled = false;
  }
  if (btnQuickCut) btnQuickCut.disabled = false;
  if (formatSelect) formatSelect.disabled = false;
}

function resolveStreamHeaders(stream, fallbackPageUrl = '') {
  if (typeof StreamSniffer !== 'undefined' && StreamSniffer.resolveStreamHeaders) {
    return StreamSniffer.resolveStreamHeaders(stream, fallbackPageUrl);
  }
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
      // ignore invalid URL
    }
  }
  return headers;
}

async function applyDnrRulesAsync(headers) {
  const msgType = getMsgType('APPLY_DNR_RULES');
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return null;
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: msgType, headers }, (res) => {
        if (chrome.runtime?.lastError) {
          // ignore context errors
        }
        resolve(res);
      });
    } catch {
      resolve(null);
    }
  });
}

// Direct (non-HLS) media files have no segments to select a time range
// from, so there's no clipping — just preview + full-file download. Reached
// either because the sniffer already classified the stream as "direct" at
// discovery time, or because loadStream/loadVariant tried the HLS path and
// got a NotHlsError back.
async function loadDirectStream(stream) {
  selectedStream = stream;
  isDirectStreamActive = true;
  selectedVariant = null;
  currentVariants = [];
  currentTimeline = null;
  qualitySelect.innerHTML = '';
  qualitySection.style.display = 'none';
  videoInfoEl.textContent = 'Loading direct media file...';

  if (currentLoadedStreamTitle) {
    currentLoadedStreamTitle.textContent =
      stream.cleanTitle || stream.pageTitle || formatStreamTitle(stream, 0);
  }

  fullVideoToggle.checked = true;
  fullVideoToggle.disabled = true;
  startTimeInput.disabled = true;
  endTimeInput.disabled = true;
  btnSetStart.disabled = true;
  btnSetEnd.disabled = true;
  if (btnQuickCut) btnQuickCut.disabled = true;
  if (formatSelect) formatSelect.disabled = true;
  btnDownload.textContent = '⬇️ Download File';

  const effectiveHeaders = resolveStreamHeaders(stream, currentTabUrl);
  await applyDnrRulesAsync(effectiveHeaders);

  PlayerController.loadDirectMedia(stream.url);

  // Duration/dimensions arrive once the browser loads video metadata —
  // don't hang forever if that never fires (e.g. a broken/expired URL).
  await new Promise((resolve) => {
    const done = () => {
      videoEl.removeEventListener('loadedmetadata', done);
      videoEl.removeEventListener('error', done);
      resolve(undefined);
    };
    videoEl.addEventListener('loadedmetadata', done, { once: true });
    videoEl.addEventListener('error', done, { once: true });
    setTimeout(done, 8000);
  });

  const totalSec = PlayerController.getDuration();
  startTimeInput.value = '00:00';
  endTimeInput.value = StegoTime.formatDuration(totalSec);
  updateClipDuration();
  updateDefaultFilename();
  videoInfoEl.textContent = totalSec
    ? 'Direct media file — full download only (no time-range clipping).'
    : 'Direct media file (duration unavailable) — full download only.';
}

async function loadStream(stream) {
  if (stream.kind === 'direct') {
    await loadDirectStream(stream);
    return;
  }

  lockRangeControlsForLoading();
  isDirectStreamActive = false;
  btnDownload.textContent = `⬇️ Download ${(formatSelect?.value || 'mp4').toUpperCase()} Clip`;
  selectedStream = stream;
  videoInfoEl.textContent = 'Discovering media qualities...';

  if (currentLoadedStreamTitle) {
    currentLoadedStreamTitle.textContent =
      stream.cleanTitle || stream.pageTitle || formatStreamTitle(stream, 0);
  }

  const effectiveHeaders = resolveStreamHeaders(stream, currentTabUrl);
  await applyDnrRulesAsync(effectiveHeaders);

  try {
    let manifestUrl = stream.url;
    if (!stream.url.includes('master') && stream.url.includes('index')) {
      const masterCandidate = currentStreams.find((s) => s.url.includes('master'));
      if (masterCandidate) manifestUrl = masterCandidate.url;
    }

    const fetchHeaders = { ...(effectiveHeaders || {}) };
    delete fetchHeaders['referer'];
    delete fetchHeaders['origin'];
    delete fetchHeaders['user-agent'];
    const masterResp = await fetch(manifestUrl, {
      headers: Object.keys(fetchHeaders).length > 0 ? fetchHeaders : undefined
    });
    const masterText = await readManifestText(masterResp);
    currentVariants = StegoParser.PlaylistParser.parseVariants(masterText, manifestUrl);

    qualitySelect.innerHTML = '';
    if (currentVariants.length > 1) {
      qualitySection.style.display = 'block';
      currentVariants.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v.url;
        opt.textContent = v.label;
        qualitySelect.appendChild(opt);
      });
    } else {
      qualitySection.style.display = 'none';
    }

    await loadVariant(currentVariants[0]);
  } catch (err) {
    if (err instanceof NotHlsError) {
      await loadDirectStream(stream);
      return;
    }
    // Don't leave controls stuck disabled on failure — there's nothing to
    // clip yet, but the user should be able to retry rather than see a
    // permanently greyed-out panel.
    resetRangeControlsForHls();
    videoInfoEl.textContent = `Failed fetching stream: ${err.message}`;
    UiFeedback.error(`Failed to load stream: ${err.message}`);
  }
}

// Best-effort filename extension for a direct file: the URL's own
// extension when it has one recognized StreamSniffer would accept, else a
// guess from Content-Type, else a generic fallback.
function guessDirectFileExtension(url, contentType) {
  const urlExt = typeof StreamSniffer !== 'undefined' ? StreamSniffer.getUrlExtension(url) : '';
  if (urlExt) return urlExt;
  if (contentType) {
    const sub = contentType.split(';')[0].split('/')[1];
    if (sub) return sub.replace('x-', '');
  }
  return 'mp4';
}

// Direct (non-HLS) files have no segments — the whole response body is the
// file. No transmuxing, no time-range clipping: fetch once, save as-is.
// Background offscreen ensures partialBytes && partialBytes.byteLength > 0 is finalized on abort.
async function executeDirectDownload() {
  if (!selectedStream) {
    UiFeedback.error('Please select a valid stream first.');
    return;
  }

  btnDownload.disabled = true;
  btnCancel.style.display = 'block';
  progressContainer.style.display = 'block';
  downloadProgress.value = 0;
  progressStatus.textContent = 'Preparing direct download...';

  const taskId = `task_${Date.now()}`;
  const base = filenameInput.value.trim().replace(/\.\w+$/i, '') || 'video_clip';
  const guessedExt = guessDirectFileExtension(selectedStream.url);
  const taskFilename = `${base}.${guessedExt}`;
  const domain = extractDomain(currentTabUrl || selectedStream.pageUrl, selectedStream.url);

  const task = {
    id: taskId,
    url: selectedStream.url,
    pageUrl: currentTabUrl || selectedStream.pageUrl || '',
    domain,
    filename: taskFilename,
    format: guessedExt,
    kind: 'direct',
    quality: selectedStream.quality || '',
    faviconUrl: currentTabFaviconUrl || '',
    hasVideo: selectedStream.hasVideo ?? !/\.(mp3|aac|m4a|wav|ogg)$/i.test(selectedStream.url),
    hasAudio: selectedStream.hasAudio ?? true,
    status: 'downloading',
    percent: 0,
    speed: '0.0 MB/s',
    startedAt: Date.now()
  };

  activeDownloadTasks.set(taskId, task);
  updateDownloadBadge();
  createOrUpdateActiveTaskCard(task);

  const effectiveHeaders = resolveStreamHeaders(selectedStream, currentTabUrl);
  await applyDnrRulesAsync(effectiveHeaders);

  try {
    chrome.runtime.sendMessage({
      type: getMsgType('START_DOWNLOAD'),
      taskId,
      task,
      effectiveHeaders,
      isDirect: true
    });
  } catch (err) {
    progressStatus.textContent = `❌ Error: ${err.message}`;
    UiFeedback.error(`Download error: ${err.message}`);
    markTaskCardError(taskId, err.message);
    btnDownload.disabled = false;
    btnCancel.style.display = 'none';
    activeDownloadTasks.delete(taskId);
    updateDownloadBadge();
  }
}

async function executeDownload() {
  if (isDirectStreamActive) {
    await executeDirectDownload();
    return;
  }

  if (!selectedVariant || !currentTimeline) {
    UiFeedback.error('Please select a valid stream and quality first.');
    return;
  }

  let startSec = 0;
  let endSec = currentTimeline.totalDuration;

  if (!fullVideoToggle.checked) {
    try {
      startSec = StegoTime.parseTimestamp(startTimeInput.value);
      endSec = StegoTime.parseTimestamp(endTimeInput.value);
    } catch (e) {
      UiFeedback.error(`Invalid time input: ${e.message}`);
      return;
    }
  }

  if (startSec >= endSec) {
    UiFeedback.warning('Start time must be less than end time.');
    return;
  }

  const clipPlan = currentTimeline.getClipPlan(startSec, endSec);
  const overlapping = clipPlan.segments;
  if (overlapping.length === 0) {
    UiFeedback.warning('No video segments found in the specified range.');
    return;
  }

  btnDownload.disabled = true;
  btnCancel.style.display = 'block';
  progressContainer.style.display = 'block';
  downloadProgress.value = 0;
  progressStatus.textContent = `Downloading 0/${overlapping.length} segments (0%)...`;

  const concurrency = getConcurrency();
  const fmt = formatSelect ? formatSelect.value : 'mp4';
  const base = filenameInput.value.trim().replace(/\.(mp4|ts|mp3)$/i, '') || 'video_clip';
  const filename = `${base}.${fmt}`;

  const taskId = `task_${Date.now()}`;
  const domain = extractDomain(currentTabUrl || selectedStream.pageUrl, selectedStream.url);
  const task = {
    id: taskId,
    url: selectedStream.url,
    pageUrl: currentTabUrl || selectedStream.pageUrl || '',
    domain,
    filename,
    format: fmt,
    kind: 'hls',
    quality: selectedVariant?.resolution || '',
    faviconUrl: currentTabFaviconUrl || '',
    hasVideo: selectedStream.hasVideo ?? true,
    hasAudio: selectedStream.hasAudio ?? true,
    status: 'downloading',
    percent: 0,
    speed: '0.0 MB/s',
    completedSegments: 0,
    totalSegments: overlapping.length,
    duration: clipPlan.duration,
    formattedDuration: StegoTime.formatDuration(clipPlan.duration),
    startedAt: Date.now()
  };

  activeDownloadTasks.set(taskId, task);
  updateDownloadBadge();
  createOrUpdateActiveTaskCard(task);

  const effectiveHeaders = resolveStreamHeaders(selectedStream, currentTabUrl);
  await applyDnrRulesAsync(effectiveHeaders);

  try {
    chrome.runtime.sendMessage({
      type: getMsgType('START_DOWNLOAD'),
      taskId,
      task,
      segments: overlapping,
      effectiveHeaders,
      clipPlan,
      isDirect: false,
      concurrency
    });
  } catch (err) {
    progressStatus.textContent = `❌ Error: ${err.message}`;
    UiFeedback.error(`Download error: ${err.message}`);
    markTaskCardError(taskId, err.message);
    btnDownload.disabled = false;
    btnCancel.style.display = 'none';
    activeDownloadTasks.delete(taskId);
    updateDownloadBadge();
  }
}

function formatStreamTitle(stream, idx) {
  try {
    const u = new URL(stream.url);
    const parts = u.pathname.split('/').filter(Boolean);
    const file = parts.pop() || 'master.m3u8';

    if (file.includes('master')) {
      return `[Master] Multi-Quality Stream • ${u.hostname}`;
    }

    const resMatch = file.match(/(2160|1440|1080|720|480|360)p/i);
    if (resMatch) {
      return `[${resMatch[1]}p] ${u.hostname} • ${file}`;
    }

    return `[${idx + 1}] ${u.hostname} • ${file}`;
  } catch {
    return `Stream ${idx + 1}`;
  }
}

// Rebuilds the stream <select> and related UI from currentStreams as they
// already are in memory. Does not touch chrome.runtime/chrome.tabs, the
// title, or sync state — pure re-render of already-known data.
function renderStreamList() {
  streamCountBadge.textContent = `${currentStreams.length} stream${currentStreams.length === 1 ? '' : 's'}`;
  renderVideoCards();

  streamSelect.innerHTML = '';

  if (currentStreams.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No M3U8 streams detected on this tab';
    streamSelect.appendChild(opt);
    videoInfoEl.textContent = 'Play a video on the page to intercept its stream.';
    btnDownload.disabled = true;
    return false;
  }

  currentStreams.sort((a, b) => {
    const aIsMaster = a.url.includes('master') ? 1 : 0;
    const bIsMaster = b.url.includes('master') ? 1 : 0;
    return bIsMaster - aIsMaster;
  });

  btnDownload.disabled = false;
  currentStreams.forEach((s, idx) => {
    const opt = document.createElement('option');
    opt.value = s.url;
    opt.textContent = formatStreamTitle(s, idx);
    streamSelect.appendChild(opt);
  });

  const previousSelection = selectedStream?.url;
  const matched = previousSelection && currentStreams.find((s) => s.url === previousSelection);
  if (matched) {
    streamSelect.value = matched.url;
  }

  return true;
}

// Points the sidebar at tabId exactly like switching browser tabs does:
// stop sync on whatever tab it was previously pointed at (so the content
// script drops its stale video reference instead of no-op'ing on restart),
// reset the detected title/filename, and re-fetch streams for tabId (which
// reloads the player against the current stream). Sync itself is one-shot
// and manual now (see btnSyncTimeline below), so it's not re-enabled here.
async function _focusTab(tabId) {
  if (!tabId || activeDownloadTasks.size > 0) return;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (
      !tab?.url ||
      tab.url.startsWith('chrome-extension://') ||
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('devtools://') ||
      tab.url.startsWith('edge://') ||
      tab.url.startsWith('about:')
    ) {
      console.info('[StegoClip:Popup] Ignoring non-content tab:', tab?.url);
      return;
    }
    currentDefaultBaseName = '';
    userCustomBaseName = null;
    const live = await resolveDocumentTitle(tabId);
    if (live && !StegoTime.isGenericBase(live)) {
      currentDefaultBaseName = live;
    } else if (tab?.title) {
      const detected = StegoTime.cleanTitleForFilename(tab.title);
      if (detected) currentDefaultBaseName = detected;
    }
    await requestStreams(tabId);
  } catch (err) {
    console.warn('[StegoClip:Popup] Failed to focus tab:', err);
  }
}

// Extension Maintenance & Diagnostic Logs
async function loadDiagnosticLogs() {
  if (!logTerminal) return;
  try {
    const res = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_LOGS' }, resolve);
    });
    if (!res || !Array.isArray(res.logs) || res.logs.length === 0) {
      logTerminal.innerHTML = '<div class="log-empty">No sniffer logs recorded yet.</div>';
      return;
    }
    logTerminal.innerHTML = '';
    res.logs.forEach((entry) => {
      const line = document.createElement('div');
      line.className = 'log-line';

      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-time';
      const d = new Date(entry.timestamp);
      timeSpan.textContent =
        d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');

      const badge = document.createElement('span');
      const catLower = (entry.category || 'info').toLowerCase();
      badge.className = `log-badge badge-${catLower}`;
      badge.textContent = `[${entry.category || 'INFO'}]`;

      const msgSpan = document.createElement('span');
      msgSpan.className = 'log-msg';
      msgSpan.textContent = entry.message || '';

      line.appendChild(timeSpan);
      line.appendChild(badge);
      line.appendChild(msgSpan);
      logTerminal.appendChild(line);
    });
    logTerminal.scrollTop = logTerminal.scrollHeight;
  } catch (err) {
    console.warn('[StegoClip:Popup] Failed to load diagnostic logs:', err);
  }
}

if (btnReloadExtension) {
  btnReloadExtension.addEventListener('click', () => {
    btnReloadExtension.disabled = true;
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.reload) {
        chrome.runtime.reload();
      }
    } catch (err) {
      console.warn('[StegoClip:Popup] Failed to reload extension:', err);
      btnReloadExtension.disabled = false;
    }
  });
}

if (btnRefreshLogs) {
  btnRefreshLogs.addEventListener('click', async () => {
    await loadDiagnosticLogs();
    UiFeedback.info('Logs refreshed.');
  });
}

if (btnClearLogs) {
  btnClearLogs.addEventListener('click', async () => {
    try {
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' }, resolve);
      });
      await loadDiagnosticLogs();
      UiFeedback.info('Logs cleared.');
    } catch {
      UiFeedback.error('Failed to clear logs.');
    }
  });
}

if (btnCopyLogs) {
  btnCopyLogs.addEventListener('click', async () => {
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_LOGS' }, resolve);
      });
      if (!res || !Array.isArray(res.logs) || res.logs.length === 0) {
        UiFeedback.warning('No logs to copy.');
        return;
      }
      const text = res.logs
        .map((l) => `[${new Date(l.timestamp).toISOString()}] [${l.category}] ${l.message}`)
        .join('\n');
      await navigator.clipboard.writeText(text);
      UiFeedback.success('Diagnostic logs copied to clipboard!');
    } catch {
      UiFeedback.error('Failed to copy logs.');
    }
  });
}

startTimeInput.addEventListener('input', () => {
  updateClipDuration();
  try {
    StegoTime.parseTimestamp(startTimeInput.value);
    updateFilenameTimestamps();
    savePopupState();
  } catch {}
});

startTimeInput.addEventListener('blur', () => {
  try {
    const sec = StegoTime.parseTimestamp(startTimeInput.value);
    startTimeInput.value = StegoTime.formatDuration(sec);
  } catch {}
  updateClipDuration();
  updateFilenameTimestamps();
  savePopupState();
});

endTimeInput.addEventListener('input', () => {
  updateClipDuration();
  try {
    StegoTime.parseTimestamp(endTimeInput.value);
    updateFilenameTimestamps();
    savePopupState();
  } catch {}
});

endTimeInput.addEventListener('blur', () => {
  try {
    const sec = StegoTime.parseTimestamp(endTimeInput.value);
    endTimeInput.value = StegoTime.formatDuration(sec);
  } catch {}
  updateClipDuration();
  updateFilenameTimestamps();
  savePopupState();
});

btnSetStart.addEventListener('click', () => {
  const cur = PlayerController.getCurrentTime();
  startTimeInput.value = StegoTime.formatDuration(cur);
  updateClipDuration();
  updateFilenameTimestamps();
  savePopupState();
});

btnSetEnd.addEventListener('click', () => {
  const cur = PlayerController.getCurrentTime();
  endTimeInput.value = StegoTime.formatDuration(cur);
  updateClipDuration();
  updateFilenameTimestamps();
  savePopupState();
});

if (quickCutMinutesInput) {
  loadQuickCutMinutes().then((minutes) => {
    quickCutMinutesInput.value = minutes;
  });

  quickCutMinutesInput.addEventListener('change', () => {
    const min = getConfigDefault('MIN_QUICK_CUT_MINUTES', 1);
    const max = getConfigDefault('MAX_QUICK_CUT_MINUTES', 180);
    let minutes = parseInt(quickCutMinutesInput.value, 10);
    if (!Number.isFinite(minutes)) minutes = getConfigDefault('DEFAULT_QUICK_CUT_MINUTES', 10);
    minutes = Math.min(max, Math.max(min, minutes));
    quickCutMinutesInput.value = minutes;
    saveQuickCutMinutes(minutes);
  });
}

if (btnQuickCut) {
  btnQuickCut.addEventListener('click', () => {
    if (!currentTimeline) {
      UiFeedback.error('Please select a valid stream first.');
      return;
    }

    const minutes =
      parseInt(quickCutMinutesInput?.value, 10) ||
      getConfigDefault('DEFAULT_QUICK_CUT_MINUTES', 10);
    const total = currentTimeline.totalDuration;
    const cur = PlayerController.getCurrentTime();
    const half = (minutes * 60) / 2;

    let start = cur - half;
    let end = cur + half;

    // Keep the full requested window length by shifting the slack from a
    // clamped edge onto the opposite side, when there's room to do so.
    if (start < 0) {
      end += -start;
      start = 0;
    }
    if (end > total) {
      start -= end - total;
      end = total;
    }
    start = Math.max(0, start);
    end = Math.min(total, end);

    if (fullVideoToggle.checked) {
      fullVideoToggle.checked = false;
      startTimeInput.disabled = false;
      endTimeInput.disabled = false;
      btnSetStart.disabled = false;
      btnSetEnd.disabled = false;
    }

    startTimeInput.value = StegoTime.formatDuration(start);
    endTimeInput.value = StegoTime.formatDuration(end);
    updateClipDuration();
    updateFilenameTimestamps();
    savePopupState();
    UiFeedback.info(`Quick cut: ${minutes} min around ${StegoTime.formatDuration(cur)}`, 2000);
  });
}

fullVideoToggle.addEventListener('change', () => {
  const isFull = fullVideoToggle.checked;
  startTimeInput.disabled = isFull;
  endTimeInput.disabled = isFull;
  btnSetStart.disabled = isFull;
  btnSetEnd.disabled = isFull;

  if (isFull && currentTimeline) {
    startTimeInput.value = '00:00';
    endTimeInput.value = StegoTime.formatDuration(currentTimeline.totalDuration);
  }
  updateClipDuration();
  updateFilenameTimestamps();
  savePopupState();
});

if (filenameInput) {
  filenameInput.addEventListener('input', () => {
    if (filenameInput.value) {
      const extracted = StegoTime.extractBaseName(filenameInput.value, currentDefaultBaseName);
      userCustomBaseName = extracted.base;
    } else {
      userCustomBaseName = null;
    }
    savePopupState();
  });

  filenameInput.addEventListener('blur', () => {
    if (filenameInput.value) {
      filenameInput.value = filenameInput.value.replace(/\.(mp4|ts|mp3)$/i, '');
      const extracted = StegoTime.extractBaseName(filenameInput.value, currentDefaultBaseName);
      userCustomBaseName = extracted.base;
    }
    savePopupState();
  });
}

if (formatSelect) {
  formatSelect.addEventListener('change', () => {
    const fmt = formatSelect.value;
    btnDownload.textContent = `⬇️ Download ${fmt.toUpperCase()} Clip`;
    if (filenameInput.value) {
      filenameInput.value = filenameInput.value.replace(/\.(mp4|ts|mp3)$/i, '');
    }
    savePopupState();
  });
}

qualitySelect.addEventListener('change', () => {
  const chosenUrl = qualitySelect.value;
  const variant = currentVariants.find((v) => v.url === chosenUrl);
  if (variant) {
    loadVariant(variant).then(() => savePopupState());
  }
});

btnDownload.addEventListener('click', async () => {
  await savePopupStateImmediate();
  switchTab('downloads');
  await executeDownload();
});

btnCancel.addEventListener('click', () => {
  for (const taskId of activeDownloadTasks.keys()) {
    chrome.runtime
      .sendMessage({
        type: getMsgType('CANCEL_DOWNLOAD'),
        taskId
      })
      .catch(() => {});
  }
});

streamSelect.addEventListener('change', () => {
  const selectedUrl = streamSelect.value;
  const stream = currentStreams.find((s) => s.url === selectedUrl);
  if (stream) {
    if (!userCustomBaseName) {
      updateFilenameForSelectedStream(stream);
    }
    loadStream(stream).then(() => savePopupState());
  }
});

// Fallback for when auto-detection misses a stream (e.g. it loads before the
// side panel is armed, or the site fetches it in a way webRequest doesn't
// see). Registers the URL with the background the same way a sniffed one
// would be, so it persists and shows up in the dropdown like any other.
async function addManualStream() {
  const raw = manualStreamUrlInput?.value?.trim();
  if (!raw) return;

  let parsed;
  try {
    parsed = new URL(raw);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('not http(s)');
  } catch {
    UiFeedback.error('Enter a valid http(s) stream URL.');
    return;
  }

  if (!currentTabId) {
    UiFeedback.error('No active tab to attach this stream to.');
    return;
  }

  btnAddManualStream.disabled = true;
  try {
    const type = getMsgType('ADD_MANUAL_STREAM');
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type, tabId: currentTabId, url: parsed.href }, resolve);
    });

    if (!response?.success) {
      UiFeedback.error(response?.error || 'Could not add that stream.');
      return;
    }

    currentStreams = response.streams || currentStreams;
    manualStreamUrlInput.value = '';
    renderStreamList();
    streamSelect.value = parsed.href;

    const stream = currentStreams.find((s) => s.url === parsed.href);
    if (stream) {
      if (!userCustomBaseName) {
        updateFilenameForSelectedStream(stream);
      }
      await loadStream(stream);
      savePopupState();
    }
    UiFeedback.success('Stream added.');
  } finally {
    btnAddManualStream.disabled = false;
  }
}

if (btnAddManualStream) {
  btnAddManualStream.addEventListener('click', addManualStream);
}
if (manualStreamUrlInput) {
  manualStreamUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addManualStream();
    }
  });
}

// Reload on STREAM_DETECTED / title updates
chrome.runtime.onMessage.addListener(async (message, _sender) => {
  const isTitleUpdateMsg =
    message?.type === 'STREAM_METADATA_UPDATED' || message?.type === 'PAGE_TITLE_CHANGED';

  if (isTitleUpdateMsg) {
    if (!currentTabId || !message.tabId || message.tabId === currentTabId) {
      const cleanTitle =
        message.cleanTitle ||
        (message.tabTitle ? StegoTime.cleanTitleForFilename(message.tabTitle) : '');
      if (cleanTitle && !StegoTime.isGenericBase(cleanTitle)) {
        if (!userCustomBaseName) {
          currentDefaultBaseName = cleanTitle;
          if (selectedStream) {
            selectedStream.cleanTitle = cleanTitle;
          }
          updateFilenameTimestamps();
        }
      }
      if (Array.isArray(message.streams)) {
        for (const s of message.streams) {
          const local = currentStreams.find((cs) => cs.url === s.url);
          if (local) {
            if (s.cleanTitle) local.cleanTitle = s.cleanTitle;
            if (s.pageTitle) local.pageTitle = s.pageTitle;
          }
        }
      }
    }
    return;
  }

  const isStreamDetectedMsg = message?.type === 'STREAM_DETECTED';

  if (isStreamDetectedMsg) {
    if (message.tabId && currentTabId && message.tabId !== currentTabId) {
      return;
    }
    requestStreams(message.tabId);
    return;
  }

  if (message?.type === getMsgType('DOWNLOAD_PROGRESS')) {
    const { taskId, progress } = message;
    if (progress) {
      if (activeDownloadTasks.has(taskId)) {
        const currentTask = activeDownloadTasks.get(taskId);
        if (progress.percent != null) {
          downloadProgress.value = progress.percent;
          currentTask.percent = progress.percent;
        }
        const mb = (progress.totalBytes / (1024 * 1024)).toFixed(1);
        const speedMb = (progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
        progressStatus.textContent = `Downloading (${progress.percent || 0}%) • ${mb} MB (${speedMb} MB/s)`;
        currentTask.speed = `${speedMb} MB/s`;
        updateTaskCardProgress(taskId, progress);
      }
    }
    return;
  }

  if (message?.type === getMsgType('DOWNLOAD_COMPLETE')) {
    const { taskId, result } = message;
    const task = activeDownloadTasks.get(taskId);
    btnDownload.disabled = false;
    btnCancel.style.display = 'none';

    if (result?.success) {
      progressStatus.textContent = `✅ Saved ${result.filename} successfully!`;
      UiFeedback.success(`Saved ${result.filename} successfully!`);
      if (task) {
        transitionTaskToComplete(taskId, {
          id: taskId,
          downloadId: result.downloadId,
          url: task.url,
          pageUrl: task.pageUrl,
          domain: task.domain,
          filename: result.filename,
          format: result.format,
          kind: task.kind,
          quality: task.quality,
          hasVideo: task.hasVideo,
          hasAudio: task.hasAudio,
          size: result.size,
          formattedSize: StegoTime.formatBytes(result.size),
          duration: result.duration,
          formattedDuration: StegoTime.formatDuration(result.duration),
          completedAt: Date.now(),
          exists: true
        });
      }
    } else if (result?.cancelled) {
      if (result.savedPartial) {
        progressStatus.textContent = `⚠️ Cancelled: Saved ${result.filename}!`;
        UiFeedback.success(`Cancelled: Saved partial file (${StegoTime.formatBytes(result.size)})`);
        if (task) {
          transitionTaskToComplete(taskId, {
            id: taskId,
            downloadId: result.downloadId,
            url: task.url,
            pageUrl: task.pageUrl,
            domain: task.domain,
            filename: result.filename,
            format: result.format,
            kind: task.kind,
            quality: task.quality,
            hasVideo: task.hasVideo,
            hasAudio: task.hasAudio,
            size: result.size,
            formattedSize: StegoTime.formatBytes(result.size),
            duration: result.duration,
            formattedDuration: StegoTime.formatDuration(result.duration),
            completedAt: Date.now(),
            exists: true
          });
        }
      } else {
        progressStatus.textContent = 'Download cancelled.';
        UiFeedback.info('Download cancelled.');
        removeTaskCard(taskId);
      }
    } else {
      progressStatus.textContent = `❌ Error: ${result?.error || 'Download failed'}`;
      UiFeedback.error(`Download error: ${result?.error || 'Download failed'}`);
      markTaskCardError(taskId, result?.error || 'Download failed');
    }

    activeDownloadTasks.delete(taskId);
    updateDownloadBadge();
    return;
  }
});

async function requestStreams(targetId) {
  const getStreamsType = getMsgType('GET_STREAMS');
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: getStreamsType, tabId: targetId }, async (response) => {
      const received = response?.streams || [];
      currentStreams = [...received];
      currentTabId = response?.tabId || targetId;
      if (currentTabId && typeof chrome !== 'undefined' && chrome.tabs?.get) {
        try {
          const tab = await chrome.tabs.get(currentTabId);
          if (tab) {
            currentTabUrl = tab.url || '';
            currentTabFaviconUrl = tab.favIconUrl || '';
          }
        } catch {}
      }
      streamCountBadge.textContent = `${currentStreams.length} stream${currentStreams.length === 1 ? '' : 's'}`;

      if (!userCustomBaseName) {
        let liveTitle = null;
        if (currentTabId) {
          liveTitle = await resolveDocumentTitle(currentTabId);
        }
        if (liveTitle && !StegoTime.isGenericBase(liveTitle)) {
          currentDefaultBaseName = liveTitle;
        } else if (response?.tabTitle) {
          const detected = StegoTime.cleanTitleForFilename(response.tabTitle);
          if (detected && !StegoTime.isGenericBase(detected)) {
            currentDefaultBaseName = detected;
          }
        }
        if (currentDefaultBaseName && !StegoTime.isGenericBase(currentDefaultBaseName)) {
          updateFilenameTimestamps();
        }
      }

      if (!renderStreamList()) {
        PlayerController.destroy();
        resolve(undefined);
        return;
      }

      const state = await StateManager.loadState(currentTabId);

      let targetStream = currentStreams[0];
      if (state?.streamUrl) {
        const matched = currentStreams.find((s) => s.url === state.streamUrl);
        if (matched) {
          targetStream = matched;
          streamSelect.value = matched.url;
        }
      }

      await loadStream(targetStream);

      if (state?.variantUrl && currentVariants.length > 1) {
        const matchedVariant = currentVariants.find((v) => v.url === state.variantUrl);
        if (matchedVariant) {
          qualitySelect.value = matchedVariant.url;
          await loadVariant(matchedVariant);
        }
      }

      if (state) {
        if (state.startTime) startTimeInput.value = state.startTime;
        if (state.endTime) endTimeInput.value = state.endTime;
        if (state.isFull) {
          fullVideoToggle.checked = true;
          startTimeInput.disabled = true;
          endTimeInput.disabled = true;
          btnSetStart.disabled = true;
          btnSetEnd.disabled = true;
        }
        if (state.userCustomBaseName) {
          userCustomBaseName = state.userCustomBaseName;
        }
        if (state.isUserCustomFilename && state.filename) {
          filenameInput.value = state.filename;
        } else {
          updateFilenameTimestamps();
        }
        if (state.format && formatSelect) {
          formatSelect.value = state.format;
          btnDownload.textContent = `⬇️ Download ${state.format.toUpperCase()} Clip`;
        }
        updateClipDuration();
      }

      if (shouldAutoDownload) {
        await executeDownload();
      }
      resolve(undefined);
    });
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function switchTab(tabName) {
  const tabs = ['videos', 'preview', 'downloads', 'settings'];
  if (!tabs.includes(tabName)) return;
  _currentTabName = tabName;

  tabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle(
      'active',
      panel.id === `panel${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`
    );
  });

  if (tabName === 'settings') {
    loadDiagnosticLogs();
  }
}

function createVideoCardElement(stream, idx) {
  const card = document.createElement('div');
  card.className = 'video-card';

  const isHls = stream.kind === 'hls' || stream.url.toLowerCase().includes('.m3u8');
  const badgeClass = isHls ? 'video-badge-hls' : 'video-badge-direct';
  const ext = StreamSniffer?.getUrlExtension ? StreamSniffer.getUrlExtension(stream.url) : '';
  const badgeText = isHls ? 'HLS' : ext ? ext.toUpperCase() : 'DIRECT';
  const titleText = stream.cleanTitle || stream.pageTitle || formatStreamTitle(stream, idx);
  const sizeText =
    stream.formattedSize ||
    (stream.size && typeof StegoTime !== 'undefined' ? StegoTime.formatBytes(stream.size) : '');

  card.innerHTML = `
    <div class="video-card-header">
      <div class="video-card-title">${escapeHtml(titleText)}</div>
      <div class="video-card-meta">
        <span class="${badgeClass}">${badgeText}</span>
        ${sizeText ? `<span class="badge-subtle">${sizeText}</span>` : ''}
      </div>
    </div>
    <div class="video-card-url" title="${escapeHtml(stream.url)}">${escapeHtml(stream.url)}</div>
    <div class="video-card-actions">
      <button type="button" class="btn-card-action primary btn-preview-clip" title="Open player and trim clip">
        ✂️ Preview & Clip
      </button>
      <button type="button" class="btn-card-action btn-card-download" title="Download media">
        ⬇️ Download
      </button>
      <button type="button" class="btn-card-action btn-card-copy" title="Copy stream URL">
        📋 Copy
      </button>
    </div>
  `;

  const btnPreview = card.querySelector('.btn-preview-clip');
  if (btnPreview) {
    btnPreview.addEventListener('click', async () => {
      await loadStream(stream);
      if (streamSelect) streamSelect.value = stream.url;
      switchTab('preview');
    });
  }

  const btnCardDl = card.querySelector('.btn-card-download');
  if (btnCardDl) {
    btnCardDl.addEventListener('click', async () => {
      await loadStream(stream);
      if (fullVideoToggle) fullVideoToggle.checked = true;
      updateClipDuration();
      switchTab('downloads');
      await executeDownload();
    });
  }

  const btnCardCopy = card.querySelector('.btn-card-copy');
  if (btnCardCopy) {
    btnCardCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(stream.url);
        UiFeedback.success('Stream URL copied to clipboard!');
      } catch {
        UiFeedback.error('Failed to copy URL.');
      }
    });
  }

  return card;
}

function renderVideoCards() {
  if (!videoCardList) return;
  videoCardList.innerHTML = '';

  const query = currentSearchQuery.trim().toLowerCase();
  const filtered = currentStreams.filter((stream) => {
    const isHls = stream.kind === 'hls' || stream.url.toLowerCase().includes('.m3u8');
    if (currentMediaFilter === 'hls' && !isHls) return false;
    if (currentMediaFilter === 'direct' && isHls) return false;

    if (query) {
      const title = (stream.cleanTitle || stream.pageTitle || '').toLowerCase();
      const url = stream.url.toLowerCase();
      if (!title.includes(query) && !url.includes(query)) return false;
    }
    return true;
  });

  if (emptyVideosState) {
    emptyVideosState.style.display = filtered.length === 0 ? 'block' : 'none';
  }

  if (filtered.length === 0) return;

  /** @type {Map<string, { pageUrl: string, pageTitle: string, domain: string, latestTimestamp: number, streams: any[] }>} */
  const groupsMap = new Map();

  filtered.forEach((stream) => {
    const key = stream.pageUrl || stream.pageTitle || 'Other Media';
    if (!groupsMap.has(key)) {
      const domain = extractDomain(stream.pageUrl, stream.url);
      groupsMap.set(key, {
        pageUrl: stream.pageUrl || '',
        pageTitle: stream.pageTitle || '',
        domain,
        latestTimestamp: stream.timestamp || 0,
        streams: []
      });
    }
    const grp = groupsMap.get(key);
    grp.streams.push(stream);
    if ((stream.timestamp || 0) > grp.latestTimestamp) {
      grp.latestTimestamp = stream.timestamp || 0;
    }
    if (!grp.pageTitle && stream.pageTitle) {
      grp.pageTitle = stream.pageTitle;
    }
  });

  const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => {
    const aIsCurrent = Boolean(currentTabUrl && a.pageUrl && currentTabUrl.startsWith(a.pageUrl));
    const bIsCurrent = Boolean(currentTabUrl && b.pageUrl && currentTabUrl.startsWith(b.pageUrl));
    if (aIsCurrent && !bIsCurrent) return -1;
    if (!aIsCurrent && bIsCurrent) return 1;
    return b.latestTimestamp - a.latestTimestamp;
  });

  let globalIdx = 0;
  sortedGroups.forEach((group) => {
    const details = document.createElement('details');
    details.className = 'video-group';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'video-group-header';

    const leftDiv = document.createElement('div');
    leftDiv.className = 'video-group-left';

    const chevron = document.createElement('span');
    chevron.className = 'group-chevron';
    chevron.textContent = '▼';
    leftDiv.appendChild(chevron);

    if (group.domain) {
      const domainBadge = document.createElement('span');
      domainBadge.className = 'group-domain';
      domainBadge.textContent = group.domain;
      leftDiv.appendChild(domainBadge);
    }

    const titleEl = document.createElement('span');
    titleEl.className = 'group-title';
    const displayTitle =
      group.pageTitle ||
      (group.pageUrl ? group.pageUrl.replace(/^https?:\/\//, '') : 'Captured Streams');
    titleEl.textContent = displayTitle;
    titleEl.title = displayTitle;
    leftDiv.appendChild(titleEl);

    const rightDiv = document.createElement('div');
    rightDiv.className = 'video-group-right';

    const countEl = document.createElement('span');
    countEl.className = 'group-count';
    const count = group.streams.length;
    countEl.textContent = `${count} stream${count === 1 ? '' : 's'}`;
    rightDiv.appendChild(countEl);

    summary.appendChild(leftDiv);
    summary.appendChild(rightDiv);
    details.appendChild(summary);

    const itemsContainer = document.createElement('div');
    itemsContainer.className = 'video-group-items';

    group.streams.forEach((stream) => {
      const card = createVideoCardElement(stream, globalIdx++);
      itemsContainer.appendChild(card);
    });

    details.appendChild(itemsContainer);
    videoCardList.appendChild(details);
  });
}

function _renderActiveTasks() {
  if (!activeTasksContainer) return;
  activeTasksContainer.innerHTML = '';
}

function updateDownloadBadge() {
  if (!activeDlBadge) return;
  const count = activeDownloadTasks.size;
  if (count > 0) {
    activeDlBadge.textContent = String(count);
    activeDlBadge.style.display = 'inline-block';
  } else {
    activeDlBadge.style.display = 'none';
  }
}

function extractDomain(urlStr, fallbackUrlStr = '') {
  try {
    if (urlStr) {
      const u = new URL(urlStr);
      if (u.hostname) return u.hostname;
    }
  } catch {}
  try {
    if (fallbackUrlStr) {
      const u = new URL(fallbackUrlStr);
      if (u.hostname) return u.hostname;
    }
  } catch {}
  return '';
}

function formatCardDate(timestamp) {
  const d = new Date(timestamp || Date.now());
  const monthNames = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
  ];
  const month = monthNames[d.getMonth()];
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${month} ${day}, ${hours}:${minutes}`;
}

function createCatCatchCard(item, isLiveTask = false) {
  const card = document.createElement('div');
  const statusClass = isLiveTask
    ? 'status-active'
    : item.exists === false
      ? 'status-deleted'
      : item.status === 'failed'
        ? 'status-error'
        : 'status-complete';

  card.className = `catcatch-card ${statusClass}`;
  card.id = `card-${item.id}`;
  card.setAttribute('data-id', item.id);

  const dateStr = formatCardDate(item.completedAt || item.startedAt);
  const domain = item.domain || extractDomain(item.url, item.pageUrl);
  const sizeStr =
    item.formattedSize ||
    (item.size && typeof StegoTime !== 'undefined' ? StegoTime.formatBytes(item.size) : '');
  const durationStr =
    item.formattedDuration ||
    (item.duration && typeof StegoTime !== 'undefined'
      ? StegoTime.formatDuration(item.duration)
      : '');
  const protocolStr = (item.format || (item.kind === 'direct' ? 'DIRECT' : 'HLS')).toUpperCase();

  const videoTrackHtml =
    item.hasVideo !== false ? '<span class="cc-track-icon" title="Video Track">🎬</span>' : '';
  const audioTrackHtml =
    item.hasAudio !== false ? '<span class="cc-track-icon" title="Audio Track">🔊</span>' : '';
  const deletedTagHtml = item.exists === false ? '<span class="badge-deleted">DELETED</span>' : '';

  const faviconSrc =
    item.faviconUrl ||
    (domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32` : '');

  const domainHtml = domain
    ? `<span class="cc-domain-tag" title="${escapeHtml(domain)}">
        ${faviconSrc ? `<img class="cc-domain-favicon" src="${escapeHtml(faviconSrc)}" alt="" onerror="this.style.display='none'" />` : ''}
        ${escapeHtml(domain)}
      </span>`
    : '';

  card.innerHTML = `
    <div class="cc-header">
      <div class="cc-header-left">
        <span class="cc-date">📅 ${dateStr}</span>
        <button type="button" class="cc-icon-btn cc-btn-copy-url" title="Copy Stream URL">🔗</button>
        ${videoTrackHtml}
        ${audioTrackHtml}
        ${deletedTagHtml}
      </div>
      <div class="cc-header-right">
        ${domainHtml}
        ${!isLiveTask ? '<button type="button" class="cc-btn-dismiss" title="Remove from history">✕</button>' : ''}
      </div>
    </div>

    <div class="cc-body">
      <div class="cc-title" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</div>
      ${
        isLiveTask
          ? `<div class="cc-progress-wrap">
              <progress class="cc-progress-bar" value="${item.percent || 0}" max="100"></progress>
              <div class="cc-progress-meta">
                <span class="cc-progress-percent">${item.percent || 0}% ${item.totalSegments ? `(${item.completedSegments || 0}/${item.totalSegments})` : ''}</span>
                <span class="cc-progress-speed">${item.speed || ''}</span>
              </div>
            </div>`
          : ''
      }
    </div>

    <div class="cc-footer">
      <div class="cc-footer-left">
        <span class="badge-protocol">${escapeHtml(protocolStr)}</span>
        ${item.quality ? `<span class="cc-bullet">• ${escapeHtml(item.quality)}</span>` : ''}
        ${sizeStr ? `<span class="cc-bullet cc-meta-size"><span class="cc-dot-green">●</span> ${sizeStr}</span>` : ''}
        ${durationStr ? `<span class="cc-bullet cc-meta-duration"><span class="cc-dot-orange">●</span> ${durationStr}</span>` : ''}
      </div>
      <div class="cc-footer-right">
        ${
          isLiveTask
            ? '<button type="button" class="danger-btn cc-btn-cancel-task" style="width: auto; padding: 2px 8px; font-size: 11px; margin: 0;">Cancel</button>'
            : `<button type="button" class="cc-btn-action cc-btn-finder" title="Show in Finder" ${item.exists === false ? 'disabled' : ''}>📁</button>
               <button type="button" class="cc-btn-action cc-btn-reload" title="Re-clip / Redownload">↺</button>`
        }
      </div>
    </div>
  `;

  wireCardEvents(card, item, isLiveTask);
  return card;
}

function wireCardEvents(card, item, isLiveTask) {
  const btnCopy = card.querySelector('.cc-btn-copy-url');
  if (btnCopy) {
    btnCopy.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(item.url);
        UiFeedback.success('Stream URL copied to clipboard!');
      } catch {
        UiFeedback.error('Failed to copy URL.');
      }
    });
  }

  const btnDismiss = card.querySelector('.cc-btn-dismiss');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', async (e) => {
      e.stopPropagation();
      await removeDownloadHistoryItem(item.id);
    });
  }

  if (isLiveTask) {
    const btnCancelTask = card.querySelector('.cc-btn-cancel-task');
    if (btnCancelTask) {
      btnCancelTask.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.abortController) item.abortController.abort();
        chrome.runtime
          .sendMessage({
            type: getMsgType('CANCEL_DOWNLOAD'),
            taskId: item.id
          })
          .catch(() => {});
      });
    }
  } else {
    const btnFinder = card.querySelector('.cc-btn-finder');
    if (btnFinder) {
      btnFinder.addEventListener('click', (e) => {
        e.stopPropagation();
        if (item.exists === false) {
          UiFeedback.warning('This file was moved or deleted from disk.');
          return;
        }
        if (item.downloadId && typeof chrome !== 'undefined' && chrome.downloads?.show) {
          chrome.downloads.show(item.downloadId);
        } else {
          UiFeedback.warning('File ID not found or browser does not support show in folder.');
        }
      });
    }

    const btnReload = card.querySelector('.cc-btn-reload');
    if (btnReload) {
      btnReload.addEventListener('click', async (e) => {
        e.stopPropagation();
        const stream = currentStreams.find((s) => s.url === item.url) || {
          url: item.url,
          kind: item.kind || 'hls',
          cleanTitle: item.filename
        };
        switchTab('preview');
        await loadStream(stream);
      });
    }
  }
}

function createOrUpdateActiveTaskCard(task) {
  if (!downloadHistoryList) return;
  if (noHistoryMessage) noHistoryMessage.style.display = 'none';

  let card = document.getElementById(`card-${task.id}`);
  if (!card) {
    card = createCatCatchCard(task, true);
    downloadHistoryList.insertBefore(card, downloadHistoryList.firstChild);
  }
}

function updateTaskCardProgress(taskId, progress) {
  const card = document.getElementById(`card-${taskId}`);
  if (!card) return;
  const progressBar = /** @type {HTMLProgressElement | null} */ (
    card.querySelector('.cc-progress-bar')
  );
  if (progressBar && progress.percent != null) {
    progressBar.value = progress.percent;
  }
  const percentSpan = card.querySelector('.cc-progress-percent');
  if (percentSpan && progress.percent != null) {
    const segText = progress.total ? ` (${progress.completed}/${progress.total} segments)` : '';
    percentSpan.textContent = `${progress.percent}%${segText}`;
  }
  const speedSpan = card.querySelector('.cc-progress-speed');
  if (speedSpan) {
    const mb = progress.totalBytes
      ? ` • ${(progress.totalBytes / (1024 * 1024)).toFixed(1)} MB`
      : '';
    const speedMb = progress.speedBytesPerSec
      ? `${(progress.speedBytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
      : '';
    speedSpan.textContent = `${speedMb}${mb}`;
  }
}

function transitionTaskToComplete(taskId, historyItem) {
  const card = document.getElementById(`card-${taskId}`);
  if (card) {
    card.classList.remove('status-active');
    card.classList.add('status-complete');

    const progressWrap = card.querySelector('.cc-progress-wrap');
    if (progressWrap) progressWrap.remove();

    const headerRight = card.querySelector('.cc-header-right');
    if (headerRight && !headerRight.querySelector('.cc-btn-dismiss')) {
      const btnDismiss = document.createElement('button');
      btnDismiss.type = 'button';
      btnDismiss.className = 'cc-btn-dismiss';
      btnDismiss.title = 'Remove from history';
      btnDismiss.textContent = '✕';
      btnDismiss.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeDownloadHistoryItem(historyItem.id);
      });
      headerRight.appendChild(btnDismiss);
    }

    const footerLeft = card.querySelector('.cc-footer-left');
    if (footerLeft) {
      const sizeStr =
        historyItem.formattedSize ||
        (historyItem.size && typeof StegoTime !== 'undefined'
          ? StegoTime.formatBytes(historyItem.size)
          : '');
      const durationStr =
        historyItem.formattedDuration ||
        (historyItem.duration && typeof StegoTime !== 'undefined'
          ? StegoTime.formatDuration(historyItem.duration)
          : '');

      let sizeBullet = footerLeft.querySelector('.cc-meta-size');
      if (!sizeBullet && sizeStr) {
        sizeBullet = document.createElement('span');
        sizeBullet.className = 'cc-bullet cc-meta-size';
        sizeBullet.innerHTML = `<span class="cc-dot-green">●</span> ${sizeStr}`;
        footerLeft.appendChild(sizeBullet);
      } else if (sizeBullet && sizeStr) {
        sizeBullet.innerHTML = `<span class="cc-dot-green">●</span> ${sizeStr}`;
      }

      let durBullet = footerLeft.querySelector('.cc-meta-duration');
      if (!durBullet && durationStr) {
        durBullet = document.createElement('span');
        durBullet.className = 'cc-bullet cc-meta-duration';
        durBullet.innerHTML = `<span class="cc-dot-orange">●</span> ${durationStr}`;
        footerLeft.appendChild(durBullet);
      }
    }

    const footerRight = card.querySelector('.cc-footer-right');
    if (footerRight) {
      footerRight.innerHTML = `
        <button type="button" class="cc-btn-action cc-btn-finder" title="Show in Finder">📁</button>
        <button type="button" class="cc-btn-action cc-btn-reload" title="Re-clip / Redownload">↺</button>
      `;
      const btnFinder = footerRight.querySelector('.cc-btn-finder');
      if (btnFinder) {
        btnFinder.addEventListener('click', (e) => {
          e.stopPropagation();
          if (historyItem.downloadId && typeof chrome !== 'undefined' && chrome.downloads?.show) {
            chrome.downloads.show(historyItem.downloadId);
          } else {
            UiFeedback.warning('File ID not found or browser does not support show in folder.');
          }
        });
      }
      const btnReload = footerRight.querySelector('.cc-btn-reload');
      if (btnReload) {
        btnReload.addEventListener('click', async (e) => {
          e.stopPropagation();
          const stream = currentStreams.find((s) => s.url === historyItem.url) || {
            url: historyItem.url,
            kind: historyItem.kind || 'hls',
            cleanTitle: historyItem.filename
          };
          switchTab('preview');
          await loadStream(stream);
        });
      }
    }
  }

  addDownloadHistory(historyItem);
}

function removeTaskCard(taskId) {
  const card = document.getElementById(`card-${taskId}`);
  if (card) {
    card.style.opacity = '0';
    card.style.transform = 'scale(0.95)';
    setTimeout(() => {
      card.remove();
      if (downloadHistoryList && downloadHistoryList.children.length === 0) {
        if (noHistoryMessage) {
          downloadHistoryList.appendChild(noHistoryMessage);
          noHistoryMessage.style.display = 'block';
        }
      }
    }, 200);
  }
}

function markTaskCardError(taskId, errorMsg) {
  const card = document.getElementById(`card-${taskId}`);
  if (!card) return;
  card.classList.remove('status-active');
  card.classList.add('status-error');
  const progressWrap = card.querySelector('.cc-progress-wrap');
  if (progressWrap) {
    progressWrap.innerHTML = `<span style="color: #ef4444; font-size: 11px;">❌ ${escapeHtml(errorMsg || 'Download failed')}</span>`;
  }
}

const DOWNLOAD_HISTORY_KEY = 'stegoclip_download_history';

async function refreshHistoryFileStatus(list) {
  if (typeof chrome === 'undefined' || !chrome.downloads?.search) return list;
  for (const item of list) {
    if (item.downloadId) {
      try {
        const [dlItem] = await chrome.downloads.search({ id: item.downloadId });
        if (dlItem) {
          item.exists = dlItem.exists ?? true;
          if (dlItem.state === 'interrupted') {
            item.exists = false;
          }
        } else {
          item.exists = false;
        }
      } catch {
        item.exists = false;
      }
    }
  }
  return list;
}

async function loadDownloadHistory() {
  try {
    const data = await chrome.storage.local.get([DOWNLOAD_HISTORY_KEY]);
    let list = Array.isArray(data[DOWNLOAD_HISTORY_KEY]) ? data[DOWNLOAD_HISTORY_KEY] : [];
    list = await refreshHistoryFileStatus(list);
    renderDownloadHistory(list);
  } catch {}
}

/**
 * @param {import("../types/domain.js").DownloadHistoryItem} item
 */
async function addDownloadHistory(item) {
  try {
    const data = await chrome.storage.local.get([DOWNLOAD_HISTORY_KEY]);
    const list = Array.isArray(data[DOWNLOAD_HISTORY_KEY]) ? data[DOWNLOAD_HISTORY_KEY] : [];
    const existingIndex = list.findIndex((h) => h.id === item.id);
    if (existingIndex >= 0) {
      list[existingIndex] = item;
    } else {
      list.unshift(item);
    }
    if (list.length > 50) list.pop();
    await chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: list });
    if (historyCountBadge) {
      historyCountBadge.textContent = String(list.length);
    }
  } catch {}
}

async function removeDownloadHistoryItem(id) {
  try {
    const data = await chrome.storage.local.get([DOWNLOAD_HISTORY_KEY]);
    const list = Array.isArray(data[DOWNLOAD_HISTORY_KEY]) ? data[DOWNLOAD_HISTORY_KEY] : [];
    const filtered = list.filter((item) => item.id !== id);
    await chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: filtered });
    const card = document.getElementById(`card-${id}`);
    if (card) {
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => {
        card.remove();
        if (downloadHistoryList && downloadHistoryList.children.length === 0) {
          if (noHistoryMessage) {
            downloadHistoryList.appendChild(noHistoryMessage);
            noHistoryMessage.style.display = 'block';
          }
        }
      }, 200);
    }
    if (historyCountBadge) {
      historyCountBadge.textContent = String(filtered.length);
    }
    UiFeedback.info('Item removed from history.');
  } catch {}
}

function renderDownloadHistory(list) {
  if (!downloadHistoryList) return;
  downloadHistoryList.innerHTML = '';

  if (historyCountBadge) {
    historyCountBadge.textContent = String(list?.length || 0);
  }

  if (!list || list.length === 0) {
    if (noHistoryMessage) {
      downloadHistoryList.appendChild(noHistoryMessage);
      noHistoryMessage.style.display = 'block';
    }
    return;
  }

  list.forEach((item) => {
    const card = createCatCatchCard(item, false);
    downloadHistoryList.appendChild(card);
  });
}

if (btnClearHistory) {
  btnClearHistory.addEventListener('click', async () => {
    try {
      await chrome.storage.local.remove([DOWNLOAD_HISTORY_KEY]);
      renderDownloadHistory([]);
      UiFeedback.info('Download history cleared.');
    } catch {
      UiFeedback.error('Failed to clear history.');
    }
  });
}

const SETTINGS_KEY = 'stegoclip_settings';

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get([SETTINGS_KEY]);
    const settings = /** @type {Record<string, any>} */ (data[SETTINGS_KEY] || {});
    if (settingMinSize && settings.minSize !== undefined) settingMinSize.value = settings.minSize;
    if (settingStegoStrip && settings.stegoStrip !== undefined)
      settingStegoStrip.checked = settings.stegoStrip;
    if (settingDefaultFormat && settings.defaultFormat)
      settingDefaultFormat.value = settings.defaultFormat;
    if (settingMp3Bitrate && settings.mp3Bitrate) settingMp3Bitrate.value = settings.mp3Bitrate;
    if (settingConcurrency && settings.concurrency) settingConcurrency.value = settings.concurrency;

    if (formatSelect && settings.defaultFormat) {
      formatSelect.value = settings.defaultFormat;
    }
  } catch {}
}

async function saveSettings() {
  try {
    const settings = {
      minSize: settingMinSize ? parseInt(settingMinSize.value, 10) || 50 : 50,
      stegoStrip: settingStegoStrip ? settingStegoStrip.checked : true,
      defaultFormat: settingDefaultFormat ? settingDefaultFormat.value : 'mp4',
      mp3Bitrate: settingMp3Bitrate ? settingMp3Bitrate.value : '192',
      concurrency: settingConcurrency ? settingConcurrency.value : '5'
    };
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  } catch {}
}

// Bootstrap Popup
document.addEventListener('DOMContentLoaded', async () => {
  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      if (tabName) switchTab(tabName);
    });
  });

  if (btnBackToVideos) {
    btnBackToVideos.addEventListener('click', () => switchTab('videos'));
  }

  if (btnPopoutPlayer) {
    btnPopoutPlayer.addEventListener('click', async () => {
      if (!selectedStream) {
        UiFeedback.warning('Please select or load a video first.');
        return;
      }

      if (videoEl && !videoEl.paused) {
        videoEl.pause();
      }

      const streamToOpen = selectedStream;
      const effectiveHeaders = resolveStreamHeaders(streamToOpen, currentTabUrl);
      const currentTime = videoEl?.currentTime || 0;
      const title =
        streamToOpen.cleanTitle ||
        streamToOpen.pageTitle ||
        currentDefaultBaseName ||
        'StegoClip Video';
      const pageUrl = streamToOpen.pageUrl || currentTabUrl || '';

      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        try {
          await chrome.storage.session.set({
            active_player_stream: {
              url: streamToOpen.url,
              pageUrl,
              headers: effectiveHeaders,
              title,
              kind: streamToOpen.kind || 'hls',
              time: currentTime
            }
          });
        } catch {
          // ignore storage error
        }
      }

      const playerParams = new URLSearchParams({
        url: streamToOpen.url,
        title,
        pageUrl,
        kind: streamToOpen.kind || 'hls',
        t: String(currentTime)
      });

      const playerUrl = chrome.runtime.getURL(`player/player.html?${playerParams.toString()}`);
      if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
        chrome.tabs.create({ url: playerUrl });
      }
    });
  }

  filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      filterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentMediaFilter = chip.getAttribute('data-filter') || 'all';
      renderVideoCards();
    });
  });

  if (streamSearchInput) {
    streamSearchInput.addEventListener('input', () => {
      currentSearchQuery = streamSearchInput.value;
      renderVideoCards();
    });
  }

  if (btnClearStreams) {
    btnClearStreams.addEventListener('click', async () => {
      try {
        const clearType = getMsgType('CLEAR_STREAMS');
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: clearType, tabId: currentTabId }, resolve);
        });
        currentStreams = [];
        renderStreamList();
        renderVideoCards();
        PlayerController.destroy();
        UiFeedback.info('Cleared streams for this tab.');
      } catch {
        UiFeedback.error('Failed to clear streams.');
      }
    });
  }

  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', async () => {
      try {
        await chrome.storage.local.remove([DOWNLOAD_HISTORY_KEY]);
        renderDownloadHistory([]);
        UiFeedback.info('Download history cleared.');
      } catch {}
    });
  }

  [
    settingMinSize,
    settingStegoStrip,
    settingDefaultFormat,
    settingMp3Bitrate,
    settingConcurrency
  ].forEach((el) => {
    if (el) {
      el.addEventListener('change', () => {
        saveSettings();
        UiFeedback.info('Settings saved.');
      });
    }
  });

  await loadSettings();
  await loadDownloadHistory();

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_DOWNLOADS' }, (res) => {
      if (chrome.runtime?.lastError) return;
      if (res?.success && Array.isArray(res.active)) {
        for (const item of res.active) {
          if (!activeDownloadTasks.has(item.taskId)) {
            activeDownloadTasks.set(item.taskId, item.task);
            createOrUpdateActiveTaskCard(item.task);
          }
        }
        updateDownloadBadge();
      }
    });
  }

  PlayerController.init(videoEl, {
    onMediaInfoChanged: (info) => {
      renderMediaDetails(info);
      updateDefaultFilename();
      if (selectedStream && info.width && info.height) {
        updateStreamOptionWithResolution(selectedStream.url, info.width, info.height);
      }
    },
    onStatusChanged: (status) => {
      videoInfoEl.textContent = status;
    }
  });

  let targetId = tabIdFromUrl;

  if (!targetId && typeof chrome !== 'undefined' && chrome.tabs?.query) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetId = tab?.id || null;
  }

  if (targetId) {
    currentTabId = targetId;
    const live = await resolveDocumentTitle(targetId);
    if (live && !StegoTime.isGenericBase(live)) {
      currentDefaultBaseName = live;
      updateFilenameTimestamps();
    }
    try {
      chrome.tabs.sendMessage(targetId, { type: 'SCAN_DOM_MEDIA' }).catch(() => {});
    } catch {}
  }

  requestStreams(targetId);

  setTimeout(() => {
    if (currentStreams.length === 0) {
      requestStreams(targetId);
    }
  }, 1200);
});
