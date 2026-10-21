/**
 * Offscreen Background Downloader for StegoClip.
 *
 * Runs downloads, stego-stripping, and transmuxing in the background so that
 * closing the popup or side panel does not cancel ongoing jobs.
 */

const activeTasks = new Map();

function getMsgType(key) {
  return (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.[key]) || key;
}

function guessDirectFileExtension(url, contentType) {
  if (typeof StreamSniffer !== 'undefined' && StreamSniffer.getUrlExtension) {
    const urlExt = StreamSniffer.getUrlExtension(url);
    if (urlExt) return urlExt;
  }
  if (contentType) {
    const sub = contentType.split(';')[0].split('/')[1];
    if (sub) return sub.replace('x-', '');
  }
  return 'mp4';
}

async function recordDownloadHistory(item) {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    const key =
      (typeof StegoConstants !== 'undefined' && StegoConstants.STORAGE_KEYS?.DOWNLOAD_HISTORY) ||
      'stegoclip_download_history';
    const data = await chrome.storage.local.get([key]);
    const list = Array.isArray(data[key]) ? data[key] : [];
    const existingIndex = list.findIndex((h) => h.id === item.id);
    if (existingIndex >= 0) {
      list[existingIndex] = item;
    } else {
      list.unshift(item);
    }
    if (list.length > 50) list.pop();
    await chrome.storage.local.set({ [key]: list });
  } catch (err) {
    console.warn('[Offscreen] Failed saving download history:', err);
  }
}

async function handleStartDownload(request, sendResponse) {
  const {
    taskId,
    task,
    segments,
    effectiveHeaders = {},
    clipPlan = { trimStart: 0, trimEnd: 0, duration: 0 },
    isDirect = false,
    concurrency = 6
  } = request;

  if (!taskId) {
    sendResponse?.({ success: false, error: 'Missing taskId' });
    return;
  }

  if (activeTasks.has(taskId)) {
    sendResponse?.({ success: true, taskId, duplicate: true });
    return;
  }

  const abortController = new AbortController();
  const downloader = new StegoDownloader.SegmentDownloader({ concurrency });

  activeTasks.set(taskId, {
    taskId,
    task,
    downloader,
    abortController,
    startedAt: Date.now()
  });

  sendResponse?.({ success: true, taskId });

  const fmt = task?.format || 'mp4';
  const filename = task?.filename || 'video_clip.mp4';
  const duration = clipPlan?.duration || task?.duration || 0;

  try {
    let resultBytes;
    let downloadId;

    if (isDirect) {
      const res = await downloader.downloadDirectFile(
        task.url,
        effectiveHeaders,
        (progress) => {
          chrome.runtime
            .sendMessage({
              type: getMsgType('DOWNLOAD_PROGRESS'),
              taskId,
              progress
            })
            .catch(() => {});
        },
        abortController.signal
      );
      resultBytes = res.bytes;
      downloadId = await downloader.saveDirectFile(resultBytes, filename, res.contentType);
    } else {
      resultBytes = await downloader.downloadSegments(
        segments,
        effectiveHeaders,
        (progress) => {
          chrome.runtime
            .sendMessage({
              type: getMsgType('DOWNLOAD_PROGRESS'),
              taskId,
              progress
            })
            .catch(() => {});
        },
        abortController.signal
      );

      downloadId = await downloader.saveToFile(resultBytes, filename, fmt, duration, {
        trimStart: clipPlan?.trimStart || 0,
        trimEnd: clipPlan?.trimEnd || 0,
        duration
      });
    }

    activeTasks.delete(taskId);

    const historyItem = {
      id: taskId,
      downloadId: typeof downloadId === 'number' ? downloadId : undefined,
      url: task?.url,
      pageUrl: task?.pageUrl,
      domain: task?.domain || '',
      filename,
      format: fmt,
      kind: task?.kind || (isDirect ? 'direct' : 'hls'),
      quality: task?.quality || '',
      faviconUrl: task?.faviconUrl || '',
      hasVideo: task?.hasVideo,
      hasAudio: task?.hasAudio,
      size: resultBytes.byteLength,
      formattedSize:
        typeof StegoTime !== 'undefined'
          ? StegoTime.formatBytes(resultBytes.byteLength)
          : undefined,
      duration,
      formattedDuration:
        duration && typeof StegoTime !== 'undefined'
          ? StegoTime.formatDuration(duration)
          : undefined,
      completedAt: Date.now(),
      exists: true
    };
    await recordDownloadHistory(historyItem);

    chrome.runtime
      .sendMessage({
        type: getMsgType('DOWNLOAD_COMPLETE'),
        taskId,
        result: {
          success: true,
          downloadId: typeof downloadId === 'number' ? downloadId : undefined,
          size: resultBytes.byteLength,
          filename,
          format: fmt,
          duration
        }
      })
      .catch(() => {});
  } catch (err) {
    activeTasks.delete(taskId);

    if (abortController.signal.aborted || err?.aborted) {
      const partialBytes = err?.partialBytes;
      let partialDownloadId;

      if (partialBytes && partialBytes.byteLength > 0) {
        try {
          if (isDirect) {
            const ext = guessDirectFileExtension(task?.url || '', err.contentType || '');
            const partialFilename = `${filename.replace(/\.[^/.]+$/, '')}.${ext}`;
            partialDownloadId = await downloader.saveDirectFile(
              partialBytes,
              partialFilename,
              err.contentType || 'application/octet-stream'
            );

            const partialHistoryItem = {
              id: taskId,
              downloadId: typeof partialDownloadId === 'number' ? partialDownloadId : undefined,
              url: task?.url,
              pageUrl: task?.pageUrl,
              domain: task?.domain || '',
              filename: partialFilename,
              format: ext,
              kind: 'direct',
              quality: task?.quality || '',
              faviconUrl: task?.faviconUrl || '',
              hasVideo: task?.hasVideo,
              hasAudio: task?.hasAudio,
              size: partialBytes.byteLength,
              formattedSize:
                typeof StegoTime !== 'undefined'
                  ? StegoTime.formatBytes(partialBytes.byteLength)
                  : undefined,
              completedAt: Date.now(),
              exists: true
            };
            await recordDownloadHistory(partialHistoryItem);

            chrome.runtime
              .sendMessage({
                type: getMsgType('DOWNLOAD_COMPLETE'),
                taskId,
                result: {
                  success: false,
                  cancelled: true,
                  savedPartial: true,
                  downloadId: typeof partialDownloadId === 'number' ? partialDownloadId : undefined,
                  size: partialBytes.byteLength,
                  filename: partialFilename,
                  format: ext,
                  duration: 0
                }
              })
              .catch(() => {});
            return;
          }

          const partialDuration = err.partialDuration || 0;
          const partialFilename = filename.replace(/\.(ts|mp3|mp4)$/i, '') + '.mp4';
          partialDownloadId = await downloader.saveToFile(
            partialBytes,
            partialFilename,
            'mp4',
            partialDuration,
            { duration: partialDuration }
          );

          const partialHistoryItem = {
            id: taskId,
            downloadId: typeof partialDownloadId === 'number' ? partialDownloadId : undefined,
            url: task?.url,
            pageUrl: task?.pageUrl,
            domain: task?.domain || '',
            filename: partialFilename,
            format: 'mp4',
            kind: 'hls',
            quality: task?.quality || '',
            faviconUrl: task?.faviconUrl || '',
            hasVideo: task?.hasVideo,
            hasAudio: task?.hasAudio,
            size: partialBytes.byteLength,
            formattedSize:
              typeof StegoTime !== 'undefined'
                ? StegoTime.formatBytes(partialBytes.byteLength)
                : undefined,
            duration: partialDuration,
            formattedDuration:
              partialDuration && typeof StegoTime !== 'undefined'
                ? StegoTime.formatDuration(partialDuration)
                : undefined,
            completedAt: Date.now(),
            exists: true
          };
          await recordDownloadHistory(partialHistoryItem);

          chrome.runtime
            .sendMessage({
              type: getMsgType('DOWNLOAD_COMPLETE'),
              taskId,
              result: {
                success: false,
                cancelled: true,
                savedPartial: true,
                downloadId: typeof partialDownloadId === 'number' ? partialDownloadId : undefined,
                size: partialBytes.byteLength,
                filename: partialFilename,
                format: 'mp4',
                duration: partialDuration
              }
            })
            .catch(() => {});
          return;
        } catch (saveErr) {
          console.warn('[Offscreen] Failed saving partial download on cancel:', saveErr);
        }
      }

      chrome.runtime
        .sendMessage({
          type: getMsgType('DOWNLOAD_COMPLETE'),
          taskId,
          result: {
            success: false,
            cancelled: true,
            error: 'Download aborted by user.'
          }
        })
        .catch(() => {});
      return;
    }

    console.error('[Offscreen] Download failed:', err);
    chrome.runtime
      .sendMessage({
        type: getMsgType('DOWNLOAD_COMPLETE'),
        taskId,
        result: {
          success: false,
          error: err?.message || 'Download failed'
        }
      })
      .catch(() => {});
  }
}

function handleCancelDownload(request, sendResponse) {
  const { taskId } = request;
  if (!taskId || !activeTasks.has(taskId)) {
    sendResponse?.({ success: false, error: 'Task not found' });
    return;
  }

  const active = activeTasks.get(taskId);
  active.abortController.abort();
  sendResponse?.({ success: true, taskId });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === getMsgType('START_DOWNLOAD')) {
      handleStartDownload(message, sendResponse);
      return true;
    }

    if (message?.type === getMsgType('CANCEL_DOWNLOAD')) {
      handleCancelDownload(message, sendResponse);
      return false;
    }

    if (message?.type === 'GET_ACTIVE_DOWNLOADS') {
      const activeList = Array.from(activeTasks.values()).map((t) => ({
        taskId: t.taskId,
        task: t.task,
        startedAt: t.startedAt
      }));
      sendResponse({ success: true, active: activeList });
      return false;
    }
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    activeTasks,
    guessDirectFileExtension,
    recordDownloadHistory,
    handleStartDownload,
    handleCancelDownload
  };
}
