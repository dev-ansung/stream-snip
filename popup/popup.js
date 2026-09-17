/**
 * UI controller for the StegoClip Popup & Full-Page Studio.
 */

let hlsInstance = null;
let currentStreams = [];
let selectedStream = null;
let currentVariants = [];
let selectedVariant = null;
let currentTimeline = null;
let activeAbortController = null;
let currentTabId = null;
let currentDefaultBaseName = '';

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

// Media information state
const mediaInfoState = {
  width: 0,
  height: 0,
  bitrate: 0,
  videoCodec: '',
  audioCodec: '',
  totalDuration: 0,
  segmentCount: 0,
  avgSegmentDuration: 0
};

function resetMediaInfo() {
  mediaInfoState.width = 0;
  mediaInfoState.height = 0;
  mediaInfoState.bitrate = 0;
  mediaInfoState.videoCodec = '';
  mediaInfoState.audioCodec = '';
  mediaInfoState.totalDuration = 0;
  mediaInfoState.segmentCount = 0;
  mediaInfoState.avgSegmentDuration = 0;
  renderMediaDetails();
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
  return codecStr.split(',').map(s => formatCodecName(s.trim())).join(' / ');
}

function renderMediaDetails() {
  // 1. Resolution
  if (mediaInfoState.width > 0 && mediaInfoState.height > 0) {
    const label = getHeightLabel(mediaInfoState.height);
    mediaResolutionEl.textContent = `${mediaInfoState.width} × ${mediaInfoState.height} (${label})`;
    activeQualityBadge.textContent = `${label} (${mediaInfoState.width}x${mediaInfoState.height})`;
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

  // 2. Bitrate
  const bps = mediaInfoState.bitrate || selectedVariant?.bandwidth || 0;
  mediaBitrateEl.textContent = bps > 0 ? StegoTime.formatBitrate(bps) : '--';

  // 3. Codecs
  let codecStr = '';
  if (mediaInfoState.videoCodec || mediaInfoState.audioCodec) {
    const v = formatCodecName(mediaInfoState.videoCodec);
    const a = formatCodecName(mediaInfoState.audioCodec);
    codecStr = [v, a].filter(Boolean).join(' / ');
  } else if (selectedVariant?.codecs) {
    codecStr = formatCodecString(selectedVariant.codecs);
  }
  mediaCodecsEl.textContent = codecStr || 'H.264 / AAC';

  // 4. Duration
  if (mediaInfoState.totalDuration > 0) {
    mediaDurationEl.textContent = StegoTime.formatDuration(mediaInfoState.totalDuration);
    videoInfoEl.textContent = `Duration: ${StegoTime.formatDuration(mediaInfoState.totalDuration)} (${mediaInfoState.segmentCount} segments)`;
  } else {
    mediaDurationEl.textContent = '--:--';
  }

  // 5. Segments
  if (mediaInfoState.segmentCount > 0) {
    const avg = mediaInfoState.avgSegmentDuration > 0 
      ? ` (~${mediaInfoState.avgSegmentDuration.toFixed(1)}s/seg)`
      : '';
    mediaSegmentsEl.textContent = `${mediaInfoState.segmentCount}${avg}`;
  } else {
    mediaSegmentsEl.textContent = '--';
  }

  // 6. Estimated file size
  updateEstimatedSizes();
}

function updateEstimatedSizes() {
  const bps = mediaInfoState.bitrate || selectedVariant?.bandwidth || 0;
  if (bps > 0 && mediaInfoState.totalDuration > 0) {
    const fullBytes = (bps / 8) * mediaInfoState.totalDuration;
    let clipSec = mediaInfoState.totalDuration;
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

// Update stream dropdown option text when resolution is discovered
function updateStreamOptionWithResolution(streamUrl, width, height) {
  if (!streamUrl || !width || !height) return;
  const label = getHeightLabel(height);
  for (const opt of streamSelect.options) {
    if (opt.value === streamUrl && !opt.textContent.includes('×') && !opt.textContent.includes(`${height}p`)) {
      opt.textContent = `[${label} • ${width}x${height}] ${opt.textContent}`;
    }
  }
}

// Video dimensions listener
function onVideoDimensionsChanged() {
  if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
    mediaInfoState.width = videoEl.videoWidth;
    mediaInfoState.height = videoEl.videoHeight;
    renderMediaDetails();
    updateDefaultFilename();
    updateStreamOptionWithResolution(selectedStream?.url, videoEl.videoWidth, videoEl.videoHeight);
  }
}

videoEl.addEventListener('loadedmetadata', onVideoDimensionsChanged);
videoEl.addEventListener('resize', onVideoDimensionsChanged);
videoEl.addEventListener('canplay', onVideoDimensionsChanged);
videoEl.addEventListener('playing', onVideoDimensionsChanged);

// Check if running in full-page mode
const urlParams = new URLSearchParams(window.location.search);
const isFullPageMode = urlParams.get('mode') === 'full' || window.innerWidth > 500;
const tabIdFromUrl = urlParams.get('tabId') ? parseInt(urlParams.get('tabId'), 10) : null;

if (isFullPageMode) {
  document.body.classList.add('full-page');
  if (btnOpenTab) {
    btnOpenTab.style.display = 'none';
  }
}

if (btnOpenTab) {
  btnOpenTab.addEventListener('click', () => {
    const tabParam = currentTabId ? `&tabId=${currentTabId}` : '';
    chrome.tabs.create({
      url: chrome.runtime.getURL(`popup/popup.html?mode=full${tabParam}`)
    });
  });
}

// Update clip duration display
function updateClipDuration() {
  try {
    const startSec = StegoTime.parseTimestamp(startTimeInput.value);
    const endSec = StegoTime.parseTimestamp(endTimeInput.value);
    const diff = Math.max(0, endSec - startSec);
    const bps = mediaInfoState.bitrate || selectedVariant?.bandwidth || 0;
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

startTimeInput.addEventListener('input', () => {
  updateClipDuration();
  updateFilenameTimestamps();
});

endTimeInput.addEventListener('input', () => {
  updateClipDuration();
  updateFilenameTimestamps();
});

btnSetStart.addEventListener('click', () => {
  if (videoEl && !isNaN(videoEl.currentTime)) {
    startTimeInput.value = StegoTime.formatDuration(videoEl.currentTime);
    updateClipDuration();
    updateFilenameTimestamps();
  }
});

btnSetEnd.addEventListener('click', () => {
  if (videoEl && !isNaN(videoEl.currentTime)) {
    endTimeInput.value = StegoTime.formatDuration(videoEl.currentTime);
    updateClipDuration();
    updateFilenameTimestamps();
  }
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
});

if (filenameInput) {
  filenameInput.addEventListener('blur', () => {
    if (filenameInput.value) {
      filenameInput.value = filenameInput.value.replace(/\.(mp4|ts)$/i, '');
    }
  });
}

if (formatSelect) {
  formatSelect.addEventListener('change', () => {
    const fmt = formatSelect.value;
    btnDownload.textContent = `⬇️ Download ${fmt.toUpperCase()} Clip`;
    if (filenameInput.value) {
      filenameInput.value = filenameInput.value.replace(/\.(mp4|ts)$/i, '');
    }
  });
}

function isGenericBase(name) {
  if (!name) return true;
  const n = name.toLowerCase();
  return n === 'video' || n === 'video_clip' || n.startsWith('master') || n.startsWith('index');
}

// Resolve base name directly from tab document.title
async function resolveDocumentTitle(targetTabId) {
  if (!targetTabId) return null;
  try {
    const tab = await chrome.tabs.get(targetTabId);
    if (tab?.title) {
      return StegoTime.detectBaseNameFromTitle(tab.title);
    }
  } catch (e) {}
  return null;
}

// Dynamically update the filename based on current timestamps without .mp4
function updateFilenameTimestamps() {
  const currentVal = filenameInput.value ? filenameInput.value.trim().replace(/\.(mp4|ts)$/i, '') : '';
  const { base, sep } = StegoTime.extractBaseName(currentVal, currentDefaultBaseName || 'video_clip');

  const isFull = fullVideoToggle.checked;
  const startStr = startTimeInput.value || '00:00';
  const endStr = endTimeInput.value || '00:00';

  filenameInput.value = StegoTime.buildClipFilename(base, startStr, endStr, isFull, sep);
}

// Generate sensible default output filename base (without extension)
function updateDefaultFilename() {
  if (!currentDefaultBaseName || isGenericBase(currentDefaultBaseName)) {
    try {
      const targetUrl = selectedVariant?.url || selectedStream?.url || '';
      const parsedUrl = new URL(targetUrl);
      const parts = parsedUrl.pathname.split('/').filter(Boolean);
      const base = parts.pop() || 'video';
      let cleanBase = base.replace(/\.m3u8$/i, '');
      if (cleanBase === 'master' || cleanBase === 'index' || cleanBase.startsWith('index-')) {
        const prev = parts.pop();
        if (prev) cleanBase = `${prev}_${cleanBase}`;
      }
      if (!currentDefaultBaseName) {
        currentDefaultBaseName = cleanBase;
      }
    } catch {
      if (!currentDefaultBaseName) {
        currentDefaultBaseName = 'video_clip';
      }
    }
  }

  updateFilenameTimestamps();
}

// Load media variant playlist (resolution / quality level)
async function loadVariant(variant) {
  resetMediaInfo();
  selectedVariant = variant;
  if (variant.height) mediaInfoState.height = variant.height;
  if (variant.resolution) {
    const [w, h] = variant.resolution.split('x').map(Number);
    if (w && h) {
      mediaInfoState.width = w;
      mediaInfoState.height = h;
    }
  }
  if (variant.bandwidth) mediaInfoState.bitrate = variant.bandwidth;
  if (variant.codecs) {
    const [v, a] = variant.codecs.split(',');
    if (v) mediaInfoState.videoCodec = v.trim();
    if (a) mediaInfoState.audioCodec = a.trim();
  }
  renderMediaDetails();
  videoInfoEl.textContent = 'Loading manifest...';
  currentTimeline = null;

  // 1. Attach to preview player
  if (hlsInstance) {
    hlsInstance.destroy();
    hlsInstance = null;
  }

  if (Hls.isSupported()) {
    hlsInstance = new Hls({
      fLoader: StegoFragmentLoader,
      enableWorker: true,
      lowLatencyMode: false
    });

    hlsInstance.loadSource(variant.url);
    hlsInstance.attachMedia(videoEl);

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
      videoInfoEl.textContent = 'Preview ready';
      if (data.levels && data.levels[0]) {
        const lvl = data.levels[0];
        if (lvl.width && lvl.height) {
          mediaInfoState.width = lvl.width;
          mediaInfoState.height = lvl.height;
        }
        if (lvl.bitrate && !mediaInfoState.bitrate) {
          mediaInfoState.bitrate = lvl.bitrate;
        }
        renderMediaDetails();
      }
    });

    hlsInstance.on(Hls.Events.BUFFER_CREATED, (event, data) => {
      if (data.tracks) {
        if (data.tracks.video?.metadata) {
          mediaInfoState.width = data.tracks.video.metadata.width || mediaInfoState.width;
          mediaInfoState.height = data.tracks.video.metadata.height || mediaInfoState.height;
        }
        if (data.tracks.video?.codec) {
          mediaInfoState.videoCodec = data.tracks.video.codec;
        }
        if (data.tracks.audio?.codec) {
          mediaInfoState.audioCodec = data.tracks.audio.codec;
        }
        renderMediaDetails();
        updateDefaultFilename();
      }
    });

    hlsInstance.on(Hls.Events.LEVEL_LOADED, (event, data) => {
      if (data.details) {
        if (data.details.totalduration) {
          mediaInfoState.totalDuration = data.details.totalduration;
        }
        if (data.details.fragments) {
          mediaInfoState.segmentCount = data.details.fragments.length;
          mediaInfoState.avgSegmentDuration = data.details.targetduration || (data.details.totalduration / data.details.fragments.length);
        }
      }
      const lvl = hlsInstance.levels[data.level];
      if (lvl) {
        if (lvl.bitrate && !mediaInfoState.bitrate) mediaInfoState.bitrate = lvl.bitrate;
        if (lvl.width && lvl.height) {
          mediaInfoState.width = lvl.width;
          mediaInfoState.height = lvl.height;
        }
      }
      renderMediaDetails();
    });

    hlsInstance.on(Hls.Events.FRAG_LOADED, (event, data) => {
      if (data.frag && data.frag.stats && data.frag.duration > 0) {
        const fragBytes = data.frag.stats.total;
        const dur = data.frag.duration;
        if (fragBytes > 0 && dur > 0) {
          const measuredBps = Math.round((fragBytes * 8) / dur);
          if (!mediaInfoState.bitrate || mediaInfoState.bitrate === 0) {
            mediaInfoState.bitrate = measuredBps;
            renderMediaDetails();
          }
        }
      }
    });

    hlsInstance.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn('HLS preview error:', data);
      }
    });
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = variant.url;
  }

  // 2. Parse sub-manifest timeline for clipping calculations
  try {
    const subResp = await fetch(variant.url);
    const subText = await subResp.text();

    currentTimeline = StegoParser.PlaylistParser.parseManifest(subText, variant.url);
    const totalSec = currentTimeline.totalDuration;
    mediaInfoState.totalDuration = totalSec;
    mediaInfoState.segmentCount = currentTimeline.segments.length;
    mediaInfoState.avgSegmentDuration = currentTimeline.segments.length > 0
      ? totalSec / currentTimeline.segments.length
      : 0;

    renderMediaDetails();

    if (!startTimeInput.value || startTimeInput.value === '00:00') {
      startTimeInput.value = '00:00';
    }
    endTimeInput.value = StegoTime.formatDuration(totalSec);
    updateClipDuration();
    updateDefaultFilename();
  } catch (err) {
    videoInfoEl.textContent = `Manifest error: ${err.message}`;
  }
}

// Load a stream: resolve master playlist variants and populate quality selector
async function loadStream(stream) {
  selectedStream = stream;
  videoInfoEl.textContent = 'Discovering media qualities...';

  // Apply DNR session rules to authenticate CDN requests
  chrome.runtime.sendMessage({
    type: 'APPLY_DNR_RULES',
    headers: stream.headers
  });

  try {
    let manifestUrl = stream.url;
    // Check if a master playlist is available in currentStreams
    if (stream.url.includes('index-f') || (!stream.url.includes('master') && stream.url.includes('index'))) {
      const masterCandidate = currentStreams.find(s => s.url.includes('master'));
      if (masterCandidate) {
        manifestUrl = masterCandidate.url;
      }
    }

    const masterResp = await fetch(manifestUrl);
    const masterText = await masterResp.text();

    currentVariants = StegoParser.PlaylistParser.parseVariants(masterText, manifestUrl);

    // Setup Quality / Resolution dropdown
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

    // Default to highest quality variant
    await loadVariant(currentVariants[0]);
  } catch (err) {
    videoInfoEl.textContent = `Failed fetching stream: ${err.message}`;
  }
}

qualitySelect.addEventListener('change', () => {
  const chosenUrl = qualitySelect.value;
  const variant = currentVariants.find(v => v.url === chosenUrl);
  if (variant) {
    loadVariant(variant);
  }
});

// Download Button Handler
btnDownload.addEventListener('click', async () => {
  if (!selectedVariant || !currentTimeline) {
    alert('Please select a valid stream and quality first.');
    return;
  }

  let startSec = 0;
  let endSec = currentTimeline.totalDuration;

  if (!fullVideoToggle.checked) {
    try {
      startSec = StegoTime.parseTimestamp(startTimeInput.value);
      endSec = StegoTime.parseTimestamp(endTimeInput.value);
    } catch (e) {
      alert(`Invalid time input: ${e.message}`);
      return;
    }
  }

  if (startSec >= endSec) {
    alert('Start time must be less than end time.');
    return;
  }

  const overlapping = currentTimeline.getOverlappingSegments(startSec, endSec);
  if (overlapping.length === 0) {
    alert('No video segments found in the specified range.');
    return;
  }

  // Update UI to downloading state
  btnDownload.disabled = true;
  btnCancel.style.display = 'block';
  progressContainer.style.display = 'block';
  downloadProgress.value = 0;
  progressStatus.textContent = `Downloading 0/${overlapping.length} segments (0%)...`;

  activeAbortController = new AbortController();
  const downloader = new StegoDownloader.SegmentDownloader({ concurrency: 6 });
  const fmt = formatSelect ? formatSelect.value : 'mp4';

  try {
    const mergedBytes = await downloader.downloadSegments(
      overlapping,
      selectedStream.headers,
      progress => {
        downloadProgress.value = progress.percent;
        const mb = (progress.totalBytes / (1024 * 1024)).toFixed(1);
        const speedMb = (progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
        progressStatus.textContent = `Downloaded ${progress.completed}/${progress.total} segments (${progress.percent}%) • ${mb} MB (${speedMb} MB/s)`;
      },
      activeAbortController.signal
    );

    progressStatus.textContent = fmt === 'mp4' ? 'Transmuxing to MP4...' : 'Saving file...';
    let base = filenameInput.value.trim().replace(/\.(mp4|ts)$/i, '') || 'video_clip';
    let filename = `${base}.${fmt}`;

    await downloader.saveToFile(mergedBytes, filename, fmt);
    progressStatus.textContent = `✅ Saved ${filename} successfully!`;
  } catch (err) {
    if (activeAbortController?.signal.aborted) {
      progressStatus.textContent = 'Download cancelled.';
    } else {
      progressStatus.textContent = `❌ Error: ${err.message}`;
    }
  } finally {
    btnDownload.disabled = false;
    btnCancel.style.display = 'none';
    activeAbortController = null;
  }
});

btnCancel.addEventListener('click', () => {
  if (activeAbortController) {
    activeAbortController.abort();
  }
});

streamSelect.addEventListener('change', () => {
  const selectedUrl = streamSelect.value;
  const stream = currentStreams.find(s => s.url === selectedUrl);
  if (stream) {
    loadStream(stream);
  }
});

// Format informative label for each stream in the selector
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
      const tierMap = { '1': '1080p Full HD', '2': '720p HD', '3': '480p SD', '4': '360p Low' };
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

// Initialize popup on open
document.addEventListener('DOMContentLoaded', async () => {
  let targetId = tabIdFromUrl;

  if (!targetId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    targetId = tab?.id || null;
    if (tab?.title) {
      const detected = StegoTime.detectBaseNameFromTitle(tab.title);
      if (detected) {
        currentDefaultBaseName = detected;
        updateFilenameTimestamps();
      }
    }
  }

  // Resolve base name from tab document.title
  if (targetId && !currentDefaultBaseName) {
    resolveDocumentTitle(targetId).then(code => {
      if (code) {
        currentDefaultBaseName = code;
        updateFilenameTimestamps();
      }
    });
  }

  chrome.runtime.sendMessage({ type: 'GET_STREAMS', tabId: targetId }, async response => {
    currentStreams = response?.streams || [];
    currentTabId = response?.tabId || targetId;
    streamCountBadge.textContent = `${currentStreams.length} stream${currentStreams.length === 1 ? '' : 's'}`;

    if (!currentDefaultBaseName || isGenericBase(currentDefaultBaseName)) {
      if (response?.tabTitle) {
        const detected = StegoTime.detectBaseNameFromTitle(response.tabTitle);
        if (detected) currentDefaultBaseName = detected;
      }
      if ((!currentDefaultBaseName || isGenericBase(currentDefaultBaseName)) && currentTabId) {
        const code = await resolveDocumentTitle(currentTabId);
        if (code) currentDefaultBaseName = code;
      }
      if (currentDefaultBaseName && !isGenericBase(currentDefaultBaseName)) {
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

    // Prioritize master playlists first
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

    // Auto-select first stream
    loadStream(currentStreams[0]);
  });
});
