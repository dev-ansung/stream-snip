/**
 * UI controller for the StegoClip Popup & Full-Page Studio.
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

// DOM Elements
const videoEl = document.getElementById('previewPlayer');
const streamSelect = document.getElementById('streamSelect');
const streamCountBadge = document.getElementById('streamCount');
const videoInfoEl = document.getElementById('videoInfo');
const activeQualityBadge = document.getElementById('activeQualityBadge');

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

const filenameInput = document.getElementById('filenameInput');
const formatSelect = document.getElementById('formatSelect');
const btnDownload = document.getElementById('btnDownload');
const btnCancel = document.getElementById('btnCancel');
const progressContainer = document.getElementById('progressContainer');
const downloadProgress = document.getElementById('downloadProgress');
const progressStatus = document.getElementById('progressStatus');
const btnOpenTab = document.getElementById('btnOpenTab');
const btnClearStreams = document.getElementById('btnClearStreams');

// Check display and execution mode
const urlParams = new URLSearchParams(window.location.search);
const isDownloadMode = urlParams.get('mode') === 'download';
const isFullPageMode =
  !isDownloadMode && (urlParams.get('mode') === 'full' || window.innerWidth > 500);
const tabIdFromUrl = urlParams.get('tabId') ? parseInt(urlParams.get('tabId'), 10) : null;
const shouldAutoDownload =
  urlParams.get('download') === '1' || urlParams.get('autoDownload') === 'true';

if (isDownloadMode) {
  document.body.classList.add('download-mode');
  if (btnOpenTab) btnOpenTab.style.display = 'none';
  if (btnClearStreams) btnClearStreams.style.display = 'none';
} else if (isFullPageMode) {
  document.body.classList.add('full-page');
  if (btnOpenTab) btnOpenTab.style.display = 'none';
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

function savePopupState() {
  if (!currentTabId) return;
  StateManager.saveState(currentTabId, {
    streamUrl: selectedStream?.url || '',
    variantUrl: selectedVariant?.url || '',
    startTime: startTimeInput?.value || '',
    endTime: endTimeInput?.value || '',
    isFull: fullVideoToggle?.checked || false,
    filename: filenameInput?.value || '',
    userCustomBaseName: userCustomBaseName || '',
    isUserCustomFilename: Boolean(userCustomBaseName),
    format: formatSelect?.value || 'mp4'
  });
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
    const subText = await subResp.text();
    currentTimeline = StegoParser.PlaylistParser.parseManifest(subText, variant.url);
    const totalSec = currentTimeline.totalDuration;

    PlayerController.mediaInfo.totalDuration = totalSec;
    PlayerController.mediaInfo.segmentCount = currentTimeline.segments.length;
    PlayerController.mediaInfo.avgSegmentDuration =
      currentTimeline.segments.length > 0 ? totalSec / currentTimeline.segments.length : 0;
    renderMediaDetails();
    sendSyncStateToPage(true);

    if (!startTimeInput.value || startTimeInput.value === '00:00') {
      startTimeInput.value = '00:00';
    }
    endTimeInput.value = StegoTime.formatDuration(totalSec);
    updateClipDuration();
    updateDefaultFilename();
  } catch (err) {
    videoInfoEl.textContent = `Manifest error: ${err.message}`;
    UiFeedback.error(`Failed loading variant playlist: ${err.message}`);
  }
}

async function loadStream(stream) {
  selectedStream = stream;
  videoInfoEl.textContent = 'Discovering media qualities...';

  const msgType =
    typeof StegoConstants !== 'undefined'
      ? StegoConstants.MSG_TYPES.APPLY_DNR_RULES
      : 'APPLY_DNR_RULES';
  chrome.runtime.sendMessage({
    type: msgType,
    headers: stream.headers
  });

  try {
    let manifestUrl = stream.url;
    if (
      stream.url.includes('index-f') ||
      (!stream.url.includes('master') && stream.url.includes('index'))
    ) {
      const masterCandidate = currentStreams.find((s) => s.url.includes('master'));
      if (masterCandidate) manifestUrl = masterCandidate.url;
    }

    const masterResp = await fetch(manifestUrl);
    const masterText = await masterResp.text();
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
    videoInfoEl.textContent = `Failed fetching stream: ${err.message}`;
    UiFeedback.error(`Failed to load stream: ${err.message}`);
  }
}

async function executeDownload() {
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

  const overlapping = currentTimeline.getOverlappingSegments(startSec, endSec);
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
  const concurrency =
    typeof StegoConstants !== 'undefined' ? StegoConstants.CONFIG.DEFAULT_CONCURRENCY : 6;
  const downloader = new StegoDownloader.SegmentDownloader({ concurrency });
  const fmt = formatSelect ? formatSelect.value : 'mp4';

  try {
    const mergedBytes = await downloader.downloadSegments(
      overlapping,
      selectedStream.headers,
      (progress) => {
        downloadProgress.value = progress.percent;
        const mb = (progress.totalBytes / (1024 * 1024)).toFixed(1);
        const speedMb = (progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
        progressStatus.textContent = `Downloaded ${progress.completed}/${progress.total} segments (${progress.percent}%) • ${mb} MB (${speedMb} MB/s)`;
      },
      activeAbortController.signal
    );

    progressStatus.textContent = fmt === 'mp4' ? 'Transmuxing to MP4...' : 'Saving file...';
    const base = filenameInput.value.trim().replace(/\.(mp4|ts)$/i, '') || 'video_clip';
    const filename = `${base}.${fmt}`;
    const clipDuration = overlapping.reduce((sum, s) => sum + (s.duration || 0), 0);
    await downloader.saveToFile(mergedBytes, filename, fmt, clipDuration);
    progressStatus.textContent = `✅ Saved ${filename} successfully!`;
    UiFeedback.success(`Saved ${filename} successfully!`);
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
  }
}

function formatStreamTitle(stream, idx) {
  try {
    const u = new URL(stream.url);
    const parts = u.pathname.split('/').filter(Boolean);
    const file = parts.pop() || 'master.m3u8';

    if (file.includes('master') || stream.url.includes('urlset/master')) {
      return `[Master] Multi-Quality Stream • ${u.hostname}`;
    }

    const fc2 = file.match(/index-f([1-4])-/i);
    if (fc2) {
      const tierMap = { 1: '1080p Full HD', 2: '720p HD', 3: '480p SD', 4: '360p Low' };
      const quality = tierMap[fc2[1]] || `F${fc2[1]}`;
      return `[${quality}] ${u.hostname} • ${file}`;
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

// Event Listeners Wiring
if (btnOpenTab) {
  btnOpenTab.addEventListener('click', () => {
    const tabParam = currentTabId ? `&tabId=${currentTabId}` : '';
    chrome.tabs.create({
      url: chrome.runtime.getURL(`popup/popup.html?mode=full${tabParam}`)
    });
  });
}

if (btnClearStreams) {
  btnClearStreams.addEventListener('click', async () => {
    const msgType =
      typeof StegoConstants !== 'undefined'
        ? StegoConstants.MSG_TYPES.CLEAR_STREAMS
        : 'CLEAR_STREAMS';
    await chrome.runtime.sendMessage({ type: msgType, tabId: currentTabId });
    if (currentTabId) {
      await StateManager.clearState(currentTabId);
    }
    currentStreams = [];
    selectedStream = null;
    selectedVariant = null;
    currentTimeline = null;
    userCustomBaseName = null;
    streamCountBadge.textContent = '0 streams';
    streamSelect.innerHTML = '<option value="">No M3U8 streams detected on this tab</option>';
    videoInfoEl.textContent = 'Play a video on the page to intercept its stream.';
    btnDownload.disabled = true;
    PlayerController.destroy();
    startTimeInput.value = '00:00';
    endTimeInput.value = '00:00';
    clipDurationText.textContent = 'Clip: --:--';
    filenameInput.value = 'video_clip';
    UiFeedback.info('Cleared captured streams for this tab.');
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
      filenameInput.value = filenameInput.value.replace(/\.(mp4|ts)$/i, '');
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
      filenameInput.value = filenameInput.value.replace(/\.(mp4|ts)$/i, '');
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
  if (!isFullPageMode && !isDownloadMode) {
    savePopupState();
    const tabParam = currentTabId ? `&tabId=${currentTabId}` : '';
    chrome.tabs.create({
      url: chrome.runtime.getURL(`popup/popup.html?mode=download${tabParam}&download=1`),
      active: true
    });
    UiFeedback.info('Download task opened in new tab', 2500);
    return;
  }
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

async function sendSyncStateToPage(enabled, tabId = currentTabId) {
  if (!tabId || typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) return;
  const expectedDuration = PlayerController.getDuration();
  const type = enabled
    ? typeof StegoConstants !== 'undefined'
      ? StegoConstants.MSG_TYPES.ENABLE_TAB_SEEK_SYNC
      : 'ENABLE_TAB_SEEK_SYNC'
    : typeof StegoConstants !== 'undefined'
      ? StegoConstants.MSG_TYPES.DISABLE_TAB_SEEK_SYNC
      : 'DISABLE_TAB_SEEK_SYNC';

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

// Synchronize preview player when seek occurs on the host webpage player, or reload on STREAM_DETECTED / title updates
chrome.runtime.onMessage.addListener(async (message, sender) => {
  const isTitleUpdateMsg =
    message?.type === 'STREAM_METADATA_UPDATED' ||
    message?.type === 'PAGE_TITLE_CHANGED' ||
    (typeof StegoConstants !== 'undefined' &&
      (message?.type === StegoConstants.MSG_TYPES.STREAM_METADATA_UPDATED ||
        message?.type === StegoConstants.MSG_TYPES.PAGE_TITLE_CHANGED));

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

  const isStreamDetectedMsg =
    message?.type === 'STREAM_DETECTED' ||
    (typeof StegoConstants !== 'undefined' &&
      message?.type === StegoConstants.MSG_TYPES.STREAM_DETECTED);

  if (isStreamDetectedMsg) {
    if (!currentTabId || message.tabId === currentTabId || currentStreams.length === 0) {
      requestStreams(currentTabId || message.tabId);
    }
    return;
  }

  const isSeekMsg =
    message?.type === 'TAB_MEDIA_SEEK' ||
    (typeof StegoConstants !== 'undefined' &&
      message?.type === StegoConstants.MSG_TYPES.TAB_MEDIA_SEEK);

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

    const didSeek = PlayerController.seekTo(message.currentTime);
    if (didSeek) {
      UiFeedback.info(`Synced to tab (${StegoTime.formatDuration(message.currentTime)})`, 1200);
    }
  }
});

async function requestStreams(targetId) {
  const getStreamsType =
    typeof StegoConstants !== 'undefined' ? StegoConstants.MSG_TYPES.GET_STREAMS : 'GET_STREAMS';
  chrome.runtime.sendMessage({ type: getStreamsType, tabId: targetId }, async (response) => {
    const received = response?.streams || [];
    if (received.length > 0 || currentStreams.length === 0) {
      currentStreams = received;
    }
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

    streamSelect.innerHTML = '';

    if (currentStreams.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No M3U8 streams detected on this tab';
      streamSelect.appendChild(opt);
      videoInfoEl.textContent = 'Play a video on the page to intercept its stream.';
      btnDownload.disabled = true;
      return;
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

    if (currentTabId) {
      await sendSyncStateToPage(true);
      const getMediaTimeType =
        typeof StegoConstants !== 'undefined'
          ? StegoConstants.MSG_TYPES.GET_PAGE_MEDIA_TIME
          : 'GET_PAGE_MEDIA_TIME';
      try {
        const previewDuration = PlayerController.getDuration();
        chrome.tabs.sendMessage(
          currentTabId,
          { type: getMediaTimeType, expectedDuration: previewDuration },
          (response) => {
            if (
              !chrome.runtime.lastError &&
              response?.success &&
              typeof response.currentTime === 'number'
            ) {
              PlayerController.seekTo(response.currentTime);
            }
          }
        );
      } catch {}
    }

    if (shouldAutoDownload) {
      await executeDownload();
    }
  });
}

async function executeDownloadTaskMode(targetId) {
  const downloadCard = document.getElementById('downloadManagerCard');
  const dlTaskSubtitle = document.getElementById('dlTaskSubtitle');
  const dlStatusBadge = document.getElementById('dlStatusBadge');
  const dlFilename = document.getElementById('dlFilename');
  const dlQuality = document.getElementById('dlQuality');
  const dlClipRange = document.getElementById('dlClipRange');
  const dlProgressPercentage = document.getElementById('dlProgressPercentage');
  const dlProgressSpeed = document.getElementById('dlProgressSpeed');
  const dlProgressBar = document.getElementById('dlProgressBar');
  const dlProgressSegments = document.getElementById('dlProgressSegments');
  const dlProgressEta = document.getElementById('dlProgressEta');
  const dlSuccessBanner = document.getElementById('dlSuccessBanner');
  const dlAutoCloseToggle = document.getElementById('dlAutoCloseToggle');
  const btnCancelDownloadTab = document.getElementById('btnCancelDownloadTab');
  const btnCloseDownloadTab = document.getElementById('btnCloseDownloadTab');

  if (downloadCard) downloadCard.style.display = 'flex';

  activeAbortController = new AbortController();

  if (btnCancelDownloadTab) {
    btnCancelDownloadTab.addEventListener('click', () => {
      if (activeAbortController) {
        activeAbortController.abort();
      }
    });
  }

  if (btnCloseDownloadTab) {
    btnCloseDownloadTab.addEventListener('click', () => {
      window.close();
    });
  }

  if (dlTaskSubtitle) dlTaskSubtitle.textContent = 'Loading stream configuration...';

  // Load state saved by side panel
  let savedState = targetId ? await StateManager.loadState(targetId) : null;

  if (!savedState || !savedState.streamUrl) {
    const getStreamsType =
      typeof StegoConstants !== 'undefined' ? StegoConstants.MSG_TYPES.GET_STREAMS : 'GET_STREAMS';
    const streamsResp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: getStreamsType, tabId: targetId }, resolve);
    });
    const fallbackTabId = streamsResp?.tabId;
    if (fallbackTabId && fallbackTabId !== targetId) {
      savedState = await StateManager.loadState(fallbackTabId);
    }
  }

  if (!savedState || !savedState.streamUrl) {
    if (dlTaskSubtitle) dlTaskSubtitle.textContent = 'Failed: Stream configuration not found.';
    if (dlStatusBadge) {
      dlStatusBadge.textContent = 'Error';
      dlStatusBadge.style.backgroundColor = '#fecaca';
      dlStatusBadge.style.color = '#991b1b';
    }
    return;
  }

  const getStreamsType =
    typeof StegoConstants !== 'undefined' ? StegoConstants.MSG_TYPES.GET_STREAMS : 'GET_STREAMS';
  const streamsResp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: getStreamsType, tabId: targetId }, resolve);
  });

  const stream = (streamsResp?.streams || []).find((s) => s.url === savedState.streamUrl) || {
    url: savedState.streamUrl,
    headers: {}
  };

  const applyDnrType =
    typeof StegoConstants !== 'undefined'
      ? StegoConstants.MSG_TYPES.APPLY_DNR_RULES
      : 'APPLY_DNR_RULES';
  chrome.runtime.sendMessage({
    type: applyDnrType,
    headers: stream.headers
  });

  const variantUrl = savedState.variantUrl || savedState.streamUrl;
  const fmt = savedState.format || 'mp4';
  const rawBase = (savedState.filename || 'video_clip').replace(/\.(mp4|ts)$/i, '');
  const finalFilename = `${rawBase}.${fmt}`;

  document.title = `📥 Downloading ${finalFilename}`;
  if (dlFilename) dlFilename.textContent = finalFilename;

  if (dlTaskSubtitle) dlTaskSubtitle.textContent = 'Parsing stream playlist...';

  let mediaPlaylistUrl = variantUrl;
  try {
    const resp = await fetch(variantUrl);
    const text = await resp.text();

    if (text.includes('#EXT-X-STREAM-INF')) {
      const variants = StegoParser.PlaylistParser.parseVariants(text, variantUrl);
      if (variants.length > 0) {
        mediaPlaylistUrl = variants[0].url;
        if (dlQuality) dlQuality.textContent = variants[0].label;
      }
    } else {
      if (dlQuality) dlQuality.textContent = 'Direct Stream';
    }
  } catch (err) {
    console.warn('[Downloader] Failed parsing playlist variants:', err);
  }

  const mediaResp = await fetch(mediaPlaylistUrl);
  const mediaText = await mediaResp.text();
  const timeline = StegoParser.PlaylistParser.parseMediaPlaylist(mediaText, mediaPlaylistUrl);

  let startSec = 0;
  let endSec = timeline.totalDuration;

  if (!savedState.isFull && savedState.startTime && savedState.endTime) {
    try {
      startSec = StegoTime.parseTimestamp(savedState.startTime);
      endSec = StegoTime.parseTimestamp(savedState.endTime);
    } catch {}
  }

  const overlapping = timeline.getOverlappingSegments(startSec, endSec);
  if (overlapping.length === 0) {
    if (dlTaskSubtitle)
      dlTaskSubtitle.textContent = 'Error: No video segments found in selected range.';
    return;
  }

  const clipDuration = overlapping.reduce((sum, s) => sum + (s.duration || 0), 0);
  if (dlClipRange) {
    dlClipRange.textContent = `${StegoTime.formatDuration(startSec)} - ${StegoTime.formatDuration(
      endSec
    )} (${StegoTime.formatDuration(clipDuration)})`;
  }

  if (dlTaskSubtitle) dlTaskSubtitle.textContent = `Downloading ${overlapping.length} segments...`;

  const concurrency =
    typeof StegoConstants !== 'undefined' ? StegoConstants.CONFIG.DEFAULT_CONCURRENCY : 6;
  const downloader = new StegoDownloader.SegmentDownloader({ concurrency });

  try {
    const mergedBytes = await downloader.downloadSegments(
      overlapping,
      stream.headers,
      (progress) => {
        if (dlProgressBar) dlProgressBar.value = progress.percent;
        if (dlProgressPercentage) dlProgressPercentage.textContent = `${progress.percent}%`;
        const mb = (progress.totalBytes / (1024 * 1024)).toFixed(1);
        const speedMb = (progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
        if (dlProgressSpeed) dlProgressSpeed.textContent = `${speedMb} MB/s (${mb} MB)`;
        if (dlProgressSegments) {
          dlProgressSegments.textContent = `${progress.completed} / ${progress.total} segments`;
        }
        if (dlProgressEta && typeof progress.etaSec === 'number') {
          dlProgressEta.textContent = `ETA: ~${StegoTime.formatDuration(progress.etaSec)}`;
        }
      },
      activeAbortController.signal
    );

    if (dlTaskSubtitle) {
      dlTaskSubtitle.textContent = fmt === 'mp4' ? 'Transmuxing to MP4...' : 'Saving file...';
    }
    if (dlStatusBadge) dlStatusBadge.textContent = 'Finalizing';

    await downloader.saveToFile(mergedBytes, finalFilename, fmt, clipDuration);

    document.title = `✅ Finished ${finalFilename}`;
    if (dlTaskSubtitle) dlTaskSubtitle.textContent = 'Download completed successfully!';
    if (dlStatusBadge) {
      dlStatusBadge.textContent = 'Complete';
      dlStatusBadge.style.backgroundColor = '#dcfce7';
      dlStatusBadge.style.color = '#15803d';
    }
    if (dlSuccessBanner) dlSuccessBanner.style.display = 'block';
    if (btnCancelDownloadTab) btnCancelDownloadTab.style.display = 'none';
    if (btnCloseDownloadTab) btnCloseDownloadTab.style.display = 'block';

    if (dlAutoCloseToggle && dlAutoCloseToggle.checked) {
      setTimeout(() => {
        window.close();
      }, 1500);
    }
  } catch (err) {
    if (activeAbortController?.signal.aborted) {
      document.title = 'Cancelled Download';
      if (dlTaskSubtitle) dlTaskSubtitle.textContent = 'Download was cancelled.';
      if (dlStatusBadge) {
        dlStatusBadge.textContent = 'Cancelled';
        dlStatusBadge.style.backgroundColor = '#f1f5f9';
        dlStatusBadge.style.color = '#64748b';
      }
    } else {
      document.title = 'Download Failed';
      if (dlTaskSubtitle) dlTaskSubtitle.textContent = `Error: ${err.message}`;
      if (dlStatusBadge) {
        dlStatusBadge.textContent = 'Failed';
        dlStatusBadge.style.backgroundColor = '#fecaca';
        dlStatusBadge.style.color = '#991b1b';
      }
    }
    if (btnCancelDownloadTab) btnCancelDownloadTab.style.display = 'none';
    if (btnCloseDownloadTab) btnCloseDownloadTab.style.display = 'block';
  } finally {
    activeAbortController = null;
  }
}

// Bootstrap Popup
document.addEventListener('DOMContentLoaded', async () => {
  if (isDownloadMode) {
    let targetId = tabIdFromUrl;
    if (!targetId && typeof chrome !== 'undefined' && chrome.tabs?.query) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetId = tab?.id || null;
    }
    await executeDownloadTaskMode(targetId);
    return;
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
    const live = await resolveDocumentTitle(targetId);
    if (live && !StegoTime.isGenericBase(live)) {
      currentDefaultBaseName = live;
      updateFilenameTimestamps();
    }
  }

  requestStreams(targetId);

  // If running in side panel, switch stream focus when user switches browser tabs
  if (!tabIdFromUrl && typeof chrome !== 'undefined' && chrome.tabs?.onActivated) {
    chrome.tabs.onActivated.addListener(async (activeInfo) => {
      // Avoid interrupting active downloads
      if (activeAbortController) return;

      try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        // Ignore extension pages (e.g. StegoClip download tab) and system URLs
        if (
          !tab?.url ||
          tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('chrome://') ||
          tab.url.startsWith('devtools://') ||
          tab.url.startsWith('edge://') ||
          tab.url.startsWith('about:')
        ) {
          console.info('[StegoClip:Popup] Ignoring non-content tab activation:', tab?.url);
          return;
        }

        if (currentTabId && currentTabId !== activeInfo.tabId) {
          sendSyncStateToPage(false, currentTabId);
        }
        currentDefaultBaseName = '';
        userCustomBaseName = null;
        const live = await resolveDocumentTitle(activeInfo.tabId);
        if (live && !StegoTime.isGenericBase(live)) {
          currentDefaultBaseName = live;
        } else if (tab?.title) {
          const detected = StegoTime.cleanTitleForFilename(tab.title);
          if (detected) currentDefaultBaseName = detected;
        }
        requestStreams(activeInfo.tabId);
        sendSyncStateToPage(true, activeInfo.tabId);
      } catch {}
    });
  }

  // If streams are still empty, retry once after 1200ms in case video player was still initializing
  setTimeout(() => {
    if (currentStreams.length === 0) {
      requestStreams(targetId);
    }
  }, 1200);
});
