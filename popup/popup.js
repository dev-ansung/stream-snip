/**
 * UI controller for the StegoClip Side Panel & Download Manager.
 * Coordinates PlayerController, StateManager, UiFeedback, and SegmentDownloader.
 */

let currentStreams = [];
let selectedStream = null;
let currentVariants = [];
let selectedVariant = null;
let currentTimeline = null;
let activeAbortController = null;
let currentTabId = null;
let currentDefaultBaseName = '';
let userCustomBaseName = null;
// True when selectedStream is a direct (non-HLS) media file — no segments,
// so no time-range clipping; download is always the whole file.
let isDirectStreamActive = false;

// DOM Elements
const videoEl = document.getElementById('previewPlayer');
const streamSelect = document.getElementById('streamSelect');
const streamCountBadge = document.getElementById('streamCount');
const videoInfoEl = document.getElementById('videoInfo');
const activeQualityBadge = document.getElementById('activeQualityBadge');
const btnSyncTimeline = document.getElementById('btnSyncTimeline');
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
const btnRefreshStreams = document.getElementById('btnRefreshStreams');

// Tab Navigation Elements
const tabBtns = document.querySelectorAll('.nav-tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const btnBackToVideos = document.getElementById('btnBackToVideos');
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
const noActiveDlMessage = document.getElementById('noActiveDlMessage');
const downloadHistoryList = document.getElementById('downloadHistoryList');
const noHistoryMessage = document.getElementById('noHistoryMessage');
const btnClearHistory = document.getElementById('btnClearHistory');

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

function getFinalizeStatusLabel(fmt) {
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

  const msgType = getMsgType('APPLY_DNR_RULES');
  chrome.runtime.sendMessage({ type: msgType, headers: stream.headers });

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

  const msgType = getMsgType('APPLY_DNR_RULES');
  chrome.runtime.sendMessage({
    type: msgType,
    headers: stream.headers
  });

  try {
    let manifestUrl = stream.url;
    if (!stream.url.includes('master') && stream.url.includes('index')) {
      const masterCandidate = currentStreams.find((s) => s.url.includes('master'));
      if (masterCandidate) manifestUrl = masterCandidate.url;
    }

    const masterResp = await fetch(manifestUrl);
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
async function executeDirectDownload() {
  if (!selectedStream) {
    UiFeedback.error('Please select a valid stream first.');
    return;
  }

  btnDownload.disabled = true;
  btnCancel.style.display = 'block';
  progressContainer.style.display = 'block';
  downloadProgress.value = 0;
  progressStatus.textContent = 'Downloading file (0%)...';

  activeAbortController = new AbortController();
  const downloader = new StegoDownloader.SegmentDownloader();

  const taskId = `task_${Date.now()}`;
  const base = filenameInput.value.trim().replace(/\.\w+$/i, '') || 'video_clip';
  const guessedExt = guessDirectFileExtension(selectedStream.url);
  const taskFilename = `${base}.${guessedExt}`;

  activeDownloadTasks.set(taskId, {
    id: taskId,
    filename: taskFilename,
    percent: 0,
    speed: '0.0 MB/s',
    abortController: activeAbortController
  });
  updateDownloadBadge();
  renderActiveTasks();

  try {
    const { bytes, contentType } = await downloader.downloadDirectFile(
      selectedStream.url,
      selectedStream.headers,
      (progress) => {
        const mb = (progress.totalBytes / (1024 * 1024)).toFixed(1);
        const speedMb = (progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
        if (progress.percent != null) {
          downloadProgress.value = progress.percent;
          progressStatus.textContent = `Downloading (${progress.percent}%) • ${mb} MB (${speedMb} MB/s)`;
        } else {
          progressStatus.textContent = `Downloading... ${mb} MB (${speedMb} MB/s)`;
        }

        const task = activeDownloadTasks.get(taskId);
        if (task) {
          if (progress.percent != null) task.percent = progress.percent;
          task.speed = `${speedMb} MB/s`;
          renderActiveTasks();
        }
      },
      activeAbortController.signal
    );

    const ext = guessDirectFileExtension(selectedStream.url, contentType);
    const filename = `${base}.${ext}`;
    await downloader.saveDirectFile(bytes, filename, contentType || 'application/octet-stream');
    progressStatus.textContent = `✅ Saved ${filename} successfully!`;
    UiFeedback.success(`Saved ${filename} successfully!`);

    addDownloadHistory({
      id: taskId,
      url: selectedStream.url,
      filename,
      format: ext,
      size: bytes.byteLength,
      completedAt: Date.now()
    });
  } catch (err) {
    if (activeAbortController?.signal.aborted) {
      progressStatus.textContent = 'Download cancelled.';
      UiFeedback.info('Download cancelled.');
    } else {
      progressStatus.textContent = `❌ Error: ${err.message}`;
      UiFeedback.error(`Download error: ${err.message}`);
    }
  } finally {
    btnDownload.disabled = false;
    btnCancel.style.display = 'none';
    activeAbortController = null;
    activeDownloadTasks.delete(taskId);
    updateDownloadBadge();
    renderActiveTasks();
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

  activeAbortController = new AbortController();
  const concurrency = getConcurrency();
  const downloader = new StegoDownloader.SegmentDownloader({ concurrency });
  const fmt = formatSelect ? formatSelect.value : 'mp4';
  const base = filenameInput.value.trim().replace(/\.(mp4|ts|mp3)$/i, '') || 'video_clip';
  const filename = `${base}.${fmt}`;

  const taskId = `task_${Date.now()}`;
  activeDownloadTasks.set(taskId, {
    id: taskId,
    filename,
    percent: 0,
    speed: '0.0 MB/s',
    completedSegments: 0,
    totalSegments: overlapping.length,
    abortController: activeAbortController
  });
  updateDownloadBadge();
  renderActiveTasks();

  try {
    const mergedBytes = await downloader.downloadSegments(
      overlapping,
      selectedStream.headers,
      (progress) => {
        downloadProgress.value = progress.percent;
        const mb = (progress.totalBytes / (1024 * 1024)).toFixed(1);
        const speedMb = (progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
        progressStatus.textContent = `Downloaded ${progress.completed}/${progress.total} segments (${progress.percent}%) • ${mb} MB (${speedMb} MB/s)`;

        const task = activeDownloadTasks.get(taskId);
        if (task) {
          task.percent = progress.percent;
          task.speed = `${speedMb} MB/s`;
          task.completedSegments = progress.completed;
          task.totalSegments = progress.total;
          renderActiveTasks();
        }
      },
      activeAbortController.signal
    );

    progressStatus.textContent = getFinalizeStatusLabel(fmt);
    await downloader.saveToFile(mergedBytes, filename, fmt, clipPlan.duration, {
      trimStart: clipPlan.trimStart,
      trimEnd: clipPlan.trimEnd,
      duration: clipPlan.duration
    });
    progressStatus.textContent = `✅ Saved ${filename} successfully!`;
    UiFeedback.success(`Saved ${filename} successfully!`);

    addDownloadHistory({
      id: taskId,
      url: selectedStream.url,
      filename,
      format: fmt,
      size: mergedBytes.byteLength,
      completedAt: Date.now()
    });
  } catch (err) {
    if (activeAbortController?.signal.aborted) {
      progressStatus.textContent = 'Download cancelled.';
      UiFeedback.info('Download cancelled.');
    } else {
      progressStatus.textContent = `❌ Error: ${err.message}`;
      UiFeedback.error(`Download error: ${err.message}`);
    }
  } finally {
    btnDownload.disabled = false;
    btnCancel.style.display = 'none';
    activeAbortController = null;
    activeDownloadTasks.delete(taskId);
    updateDownloadBadge();
    renderActiveTasks();
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
async function focusTab(tabId) {
  if (!tabId || activeAbortController) return;
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

    if (currentTabId) {
      sendSyncStateToPage(false, currentTabId);
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

// Event Listeners Wiring
if (btnRefreshStreams) {
  btnRefreshStreams.addEventListener('click', async () => {
    btnRefreshStreams.disabled = true;
    try {
      let targetId = null;
      if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        targetId = tab?.id || null;
      }
      if (!targetId) targetId = currentTabId;
      await focusTab(targetId);
      UiFeedback.info('Sidebar refreshed.');
    } catch (err) {
      console.warn('[StegoClip:Popup] Failed to refresh streams:', err);
      UiFeedback.error('Failed to refresh streams.');
    } finally {
      setTimeout(() => {
        btnRefreshStreams.disabled = false;
      }, 400);
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
  if (activeAbortController) {
    activeAbortController.abort();
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

async function sendSyncStateToPage(enabled, tabId = currentTabId) {
  if (!tabId || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) return;
  const expectedDuration = PlayerController.getDuration();
  const type = getMsgType(enabled ? 'ENABLE_TAB_SEEK_SYNC' : 'DISABLE_TAB_SEEK_SYNC');

  try {
    await chrome.tabs.sendMessage(tabId, {
      type,
      expectedDuration
    });
    console.info(
      `[StegoClip:Popup] Dispatched ${type} (expectedDuration: ${expectedDuration.toFixed(2)}s) to tab ${tabId}`
    );
  } catch {
    // Ignored if tab does not have content script running
  }
}

window.addEventListener('beforeunload', () => {
  if (currentTabId) {
    sendSyncStateToPage(false);
  }
});

// Manual, one-shot: attaches seek-mirroring on the page's video for this
// tab and immediately jumps the preview to its current playback position.
// Replaces the old automatic behavior (which used to fire on every stream
// load / tab switch) with an explicit user action.
async function syncTimelineWithPage() {
  if (!currentTabId) {
    UiFeedback.error('No active tab to sync with.');
    return;
  }

  await sendSyncStateToPage(true, currentTabId);

  const getMediaTimeType = getMsgType('GET_PAGE_MEDIA_TIME');
  const previewDuration = PlayerController.getDuration();
  chrome.tabs.sendMessage(
    currentTabId,
    { type: getMediaTimeType, expectedDuration: previewDuration },
    (response) => {
      if (chrome.runtime.lastError || !response?.success) {
        UiFeedback.error('Could not find a playing video on that page.');
        return;
      }
      if (typeof response.currentTime === 'number') {
        PlayerController.seekTo(response.currentTime);
      }
      UiFeedback.info('Synced preview to page playback.', 2000);
    }
  );
}

if (btnSyncTimeline) {
  btnSyncTimeline.addEventListener('click', syncTimelineWithPage);
}

// Synchronize preview player when seek occurs on the host webpage player, or reload on STREAM_DETECTED / title updates
chrome.runtime.onMessage.addListener(async (message, sender) => {
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

  const isSeekMsg = message?.type === 'TAB_MEDIA_SEEK';

  if (isSeekMsg && typeof message.currentTime === 'number') {
    console.info(
      '[StegoClip:Popup] Received TAB_MEDIA_SEEK:',
      message,
      'sender tab:',
      sender?.tab?.id,
      'currentTabId:',
      currentTabId
    );

    if (sender?.tab?.id && currentTabId && sender.tab.id !== currentTabId) {
      // Check if the sender is actually the user's currently active tab
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id === sender.tab.id) {
          console.info('[StegoClip:Popup] Adopting sender as active currentTabId:', sender.tab.id);
          currentTabId = sender.tab.id;
        } else {
          console.info('[StegoClip:Popup] Ignored seek from background tab:', sender.tab.id);
          return;
        }
      } catch {
        return;
      }
    }

    // Verify video duration matches the preview player duration within tolerance
    const previewDuration = PlayerController.getDuration();
    if (previewDuration > 0 && typeof message.duration === 'number' && message.duration > 0) {
      const durationDiff = Math.abs(message.duration - previewDuration);
      if (durationDiff > 2.0) {
        console.info(
          `[StegoClip:Popup] Ignored seek from unrelated video (page duration: ${message.duration.toFixed(
            2
          )}s vs preview: ${previewDuration.toFixed(2)}s)`
        );
        return;
      }
    }

    PlayerController.seekTo(message.currentTime);
  }
});

async function requestStreams(targetId) {
  const getStreamsType = getMsgType('GET_STREAMS');
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: getStreamsType, tabId: targetId }, async (response) => {
      const received = response?.streams || [];
      currentStreams = [...received];
      currentTabId = response?.tabId || targetId;
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

  filtered.forEach((stream, idx) => {
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

    videoCardList.appendChild(card);
  });
}

function renderActiveTasks() {
  if (!activeTasksContainer) return;
  activeTasksContainer.innerHTML = '';

  if (activeDownloadTasks.size === 0) {
    if (noActiveDlMessage) {
      activeTasksContainer.appendChild(noActiveDlMessage);
      noActiveDlMessage.style.display = 'block';
    }
    return;
  }

  activeDownloadTasks.forEach((task) => {
    const card = document.createElement('div');
    card.className = 'task-item-card';
    card.innerHTML = `
      <div class="task-header">
        <span class="task-filename">${escapeHtml(task.filename)}</span>
        <button type="button" class="danger-btn btn-cancel-task" style="width: auto; padding: 2px 8px; font-size: 11px; margin: 0;">Cancel</button>
      </div>
      <progress class="task-progress-bar" value="${task.percent || 0}" max="100"></progress>
      <div class="task-meta">
        <span>${task.percent || 0}% ${task.totalSegments ? `(${task.completedSegments}/${task.totalSegments})` : ''}</span>
        <span>${task.speed || ''}</span>
      </div>
    `;

    const btnCancelTask = card.querySelector('.btn-cancel-task');
    if (btnCancelTask) {
      btnCancelTask.addEventListener('click', () => {
        if (task.abortController) task.abortController.abort();
      });
    }

    activeTasksContainer.appendChild(card);
  });
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

const DOWNLOAD_HISTORY_KEY = 'stegoclip_download_history';

async function loadDownloadHistory() {
  try {
    const data = await chrome.storage.local.get([DOWNLOAD_HISTORY_KEY]);
    const list = Array.isArray(data[DOWNLOAD_HISTORY_KEY]) ? data[DOWNLOAD_HISTORY_KEY] : [];
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
    list.unshift(item);
    if (list.length > 30) list.pop();
    await chrome.storage.local.set({ [DOWNLOAD_HISTORY_KEY]: list });
    renderDownloadHistory(list);
  } catch {}
}

function renderDownloadHistory(list) {
  if (!downloadHistoryList) return;
  downloadHistoryList.innerHTML = '';

  if (!list || list.length === 0) {
    if (noHistoryMessage) {
      downloadHistoryList.appendChild(noHistoryMessage);
      noHistoryMessage.style.display = 'block';
    }
    return;
  }

  list.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'history-item-card';

    const timeStr = item.completedAt ? new Date(item.completedAt).toLocaleTimeString() : '';
    const sizeStr =
      item.size && typeof StegoTime !== 'undefined' ? StegoTime.formatBytes(item.size) : '';

    row.innerHTML = `
      <span class="history-item-name" title="${escapeHtml(item.filename)}">💾 ${escapeHtml(item.filename)}</span>
      <div class="history-item-meta">
        ${sizeStr ? `<span>${sizeStr}</span>` : ''}
        <span>${timeStr}</span>
      </div>
    `;
    downloadHistoryList.appendChild(row);
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
