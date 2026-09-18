/**
 * Offscreen Document script for StegoClip.
 * Executes background segment downloading and transmuxing so downloads
 * continue uninterrupted even when the popup collapses.
 */

const activeControllers = new Map();

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.type === 'OFFSCREEN_START_DOWNLOAD') {
    handleStartDownload(request);
    sendResponse({ started: true });
    return true;
  }
  if (request.type === 'OFFSCREEN_CANCEL_DOWNLOAD') {
    handleCancelDownload(request);
    sendResponse({ cancelled: true });
    return true;
  }
});

async function handleStartDownload(request) {
  const { tabId, segments, headers, filename, format } = request;
  if (!tabId || !segments || segments.length === 0) return;

  // Cancel any existing download for this tab
  if (activeControllers.has(tabId)) {
    activeControllers.get(tabId).abort();
    activeControllers.delete(tabId);
  }

  const abortController = new AbortController();
  activeControllers.set(tabId, abortController);

  const storageKey = `stego_download_${tabId}`;
  const initialStatus = {
    status: 'downloading',
    percent: 0,
    completed: 0,
    total: segments.length,
    totalBytes: 0,
    speedBytesPerSec: 0,
    filename,
    format,
    tabId
  };

  await chrome.storage.local.set({ [storageKey]: initialStatus });
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_PROGRESS',
    tabId,
    progress: initialStatus
  });

  const downloader = new StegoDownloader.SegmentDownloader({ concurrency: 6 });

  try {
    const mergedBytes = await downloader.downloadSegments(
      segments,
      headers,
      (progress) => {
        const update = {
          status: 'downloading',
          percent: progress.percent,
          completed: progress.completed,
          total: progress.total,
          totalBytes: progress.totalBytes,
          speedBytesPerSec: progress.speedBytesPerSec,
          filename,
          format,
          tabId
        };
        chrome.storage.local.set({ [storageKey]: update });
        chrome.runtime.sendMessage({
          type: 'DOWNLOAD_PROGRESS',
          tabId,
          progress: update
        });
      },
      abortController.signal
    );

    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_TRANSMUXING',
      tabId,
      format
    });

    await downloader.saveToFile(mergedBytes, filename, format);

    const completedStatus = {
      status: 'completed',
      percent: 100,
      filename,
      tabId
    };
    await chrome.storage.local.set({ [storageKey]: completedStatus });
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_COMPLETED',
      tabId,
      filename
    });
  } catch (err) {
    if (abortController.signal.aborted) {
      const cancelledStatus = {
        status: 'cancelled',
        tabId
      };
      await chrome.storage.local.set({ [storageKey]: cancelledStatus });
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_CANCELLED',
        tabId
      });
    } else {
      console.error('Download error:', err);
      const errorStatus = {
        status: 'error',
        error: err.message || 'Unknown error',
        tabId
      };
      await chrome.storage.local.set({ [storageKey]: errorStatus });
      chrome.runtime.sendMessage({
        type: 'DOWNLOAD_ERROR',
        tabId,
        error: err.message || 'Unknown error'
      });
    }
  } finally {
    activeControllers.delete(tabId);
  }
}

function handleCancelDownload(request) {
  const { tabId } = request;
  if (tabId && activeControllers.has(tabId)) {
    activeControllers.get(tabId).abort();
    activeControllers.delete(tabId);
  }
}
