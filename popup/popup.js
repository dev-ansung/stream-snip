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

// DOM Elements
const videoEl = document.getElementById('previewPlayer');
const streamSelect = document.getElementById('streamSelect');
const streamCountBadge = document.getElementById('streamCount');
const videoInfoEl = document.getElementById('videoInfo');
const activeQualityBadge = document.getElementById('activeQualityBadge');

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
    clipDurationText.textContent = `Clip: ${StegoTime.formatDuration(diff)}`;
  } catch {
    clipDurationText.textContent = 'Clip: --:--';
  }
}

startTimeInput.addEventListener('input', updateClipDuration);
endTimeInput.addEventListener('input', updateClipDuration);

btnSetStart.addEventListener('click', () => {
  if (videoEl && !isNaN(videoEl.currentTime)) {
    startTimeInput.value = StegoTime.formatDuration(videoEl.currentTime);
    updateClipDuration();
  }
});

btnSetEnd.addEventListener('click', () => {
  if (videoEl && !isNaN(videoEl.currentTime)) {
    endTimeInput.value = StegoTime.formatDuration(videoEl.currentTime);
    updateClipDuration();
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
});

if (formatSelect) {
  formatSelect.addEventListener('change', () => {
    const fmt = formatSelect.value;
    btnDownload.textContent = `⬇️ Download ${fmt.toUpperCase()} Clip`;
    if (filenameInput.value) {
      filenameInput.value = filenameInput.value.replace(/\.(mp4|ts)$/i, '') + `.${fmt}`;
    }
  });
}

// Generate sensible default output filename
function updateDefaultFilename() {
  const fmt = formatSelect ? formatSelect.value : 'mp4';
  try {
    const targetUrl = selectedVariant?.url || selectedStream?.url || '';
    const parsedUrl = new URL(targetUrl);
    const parts = parsedUrl.pathname.split('/').filter(Boolean);
    const base = parts.pop() || 'video';
    let cleanBase = base.replace(/\.m3u8$/i, '');
    if (cleanBase === 'master' || cleanBase === 'index') {
      const prev = parts.pop();
      if (prev) cleanBase = `${prev}_${cleanBase}`;
    }

    if (selectedVariant?.height) {
      cleanBase += `_${selectedVariant.height}p`;
    }
    filenameInput.value = `${cleanBase}_clip.${fmt}`;
  } catch {
    filenameInput.value = `video_clip.${fmt}`;
  }
}

// Load media variant playlist (resolution / quality level)
async function loadVariant(variant) {
  selectedVariant = variant;
  activeQualityBadge.textContent = variant.height ? `${variant.height}p` : (variant.resolution || 'Auto');
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

    hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
      videoInfoEl.textContent = 'Ready to preview';
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

    videoInfoEl.textContent = `Duration: ${StegoTime.formatDuration(totalSec)} (${currentTimeline.segments.length} segments)`;
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
    const masterResp = await fetch(stream.url);
    const masterText = await masterResp.text();

    currentVariants = StegoParser.PlaylistParser.parseVariants(masterText, stream.url);

    // Setup Quality / Resolution dropdown
    qualitySelect.innerHTML = '';
    if (currentVariants.length > 1) {
      qualitySection.style.display = 'block';
      currentVariants.forEach((v, idx) => {
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
    let filename = filenameInput.value.trim() || `video_clip.${fmt}`;
    if (!filename.endsWith(`.${fmt}`)) {
      filename = filename.replace(/\.(mp4|ts)$/i, '') + `.${fmt}`;
    }

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
  }

  chrome.runtime.sendMessage({ type: 'GET_STREAMS', tabId: targetId }, response => {
    currentStreams = response?.streams || [];
    currentTabId = response?.tabId || targetId;
    streamCountBadge.textContent = `${currentStreams.length} stream${currentStreams.length === 1 ? '' : 's'}`;

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
