/**
 * DownloadsManager component for StegoClip Side Panel.
 * Manages in-place live download progress cards, background task tracking,
 * download history storage, and Finder integration.
 */

const DownloadsManager = (() => {
  /** @type {Map<string, any>} */
  const activeDownloadTasks = new Map();
  const DOWNLOAD_HISTORY_KEY = 'stegoclip_download_history';

  // DOM Elements
  const activeDlBadge = document.getElementById('activeDlBadge');
  const _activeTasksContainer = document.getElementById('activeTasksContainer');
  const downloadHistoryList = document.getElementById('downloadHistoryList');
  const noHistoryMessage = document.getElementById('noHistoryMessage');
  const btnClearHistory = document.getElementById('btnClearHistory');
  const historyCountBadge = document.getElementById('historyCountBadge');

  function getMsgType(key) {
    return (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.[key]) || key;
  }

  function escapeHtml(str) {
    if (typeof StreamSniffer !== 'undefined' && StreamSniffer.escapeHtml) {
      return StreamSniffer.escapeHtml(str);
    }
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function extractDomain(urlStr, fallbackUrlStr = '') {
    if (typeof StreamSniffer !== 'undefined' && StreamSniffer.extractDomain) {
      return StreamSniffer.extractDomain(urlStr, fallbackUrlStr);
    }
    try {
      if (urlStr) {
        const u = new URL(urlStr);
        if (u.hostname) return u.hostname.replace(/^www\./, '');
      }
    } catch {}
    try {
      if (fallbackUrlStr) {
        const u = new URL(fallbackUrlStr);
        if (u.hostname) return u.hostname.replace(/^www\./, '');
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
    const deletedTagHtml =
      item.exists === false ? '<span class="badge-deleted">DELETED</span>' : '';

    const faviconSrc =
      item.faviconUrl ||
      (domain
        ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`
        : '');

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
          if (typeof UiFeedback !== 'undefined') {
            UiFeedback.success('Stream URL copied to clipboard!');
          }
        } catch {
          if (typeof UiFeedback !== 'undefined') {
            UiFeedback.error('Failed to copy URL.');
          }
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
            if (typeof UiFeedback !== 'undefined') {
              UiFeedback.warning('This file was moved or deleted from disk.');
            }
            return;
          }
          if (item.downloadId && typeof chrome !== 'undefined' && chrome.downloads?.show) {
            chrome.downloads.show(item.downloadId);
          } else if (typeof UiFeedback !== 'undefined') {
            UiFeedback.warning('File ID not found or browser does not support show in folder.');
          }
        });
      }

      const btnReload = card.querySelector('.cc-btn-reload');
      if (btnReload) {
        btnReload.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof StreamList !== 'undefined' && StreamList.openInPlayer) {
            StreamList.openInPlayer({
              url: item.url,
              kind: item.kind || 'hls',
              cleanTitle: item.filename,
              pageUrl: item.pageUrl || ''
            });
          }
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
            } else if (typeof UiFeedback !== 'undefined') {
              UiFeedback.warning('File ID not found or browser does not support show in folder.');
            }
          });
        }
        const btnReload = footerRight.querySelector('.cc-btn-reload');
        if (btnReload) {
          btnReload.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof StreamList !== 'undefined' && StreamList.openInPlayer) {
              StreamList.openInPlayer({
                url: historyItem.url,
                kind: historyItem.kind || 'hls',
                cleanTitle: historyItem.filename,
                pageUrl: historyItem.pageUrl || ''
              });
            }
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
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.info('Item removed from history.');
      }
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

  function handleDownloadProgress(taskId, progress) {
    if (!progress) return;
    if (activeDownloadTasks.has(taskId)) {
      const currentTask = activeDownloadTasks.get(taskId);
      if (progress.percent != null) {
        currentTask.percent = progress.percent;
      }
      const speedMb = (progress.speedBytesPerSec / (1024 * 1024)).toFixed(1);
      currentTask.speed = `${speedMb} MB/s`;
      updateTaskCardProgress(taskId, progress);
    }
  }

  function handleDownloadComplete(taskId, result) {
    const task = activeDownloadTasks.get(taskId);

    if (result?.success) {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.success(`Saved ${result.filename} successfully!`);
      }
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
          formattedSize: typeof StegoTime !== 'undefined' ? StegoTime.formatBytes(result.size) : '',
          duration: result.duration,
          formattedDuration:
            typeof StegoTime !== 'undefined' ? StegoTime.formatDuration(result.duration) : '',
          completedAt: Date.now(),
          exists: true
        });
      }
    } else if (result?.cancelled) {
      if (result.savedPartial) {
        const sizeStr = typeof StegoTime !== 'undefined' ? StegoTime.formatBytes(result.size) : '';
        if (typeof UiFeedback !== 'undefined') {
          UiFeedback.success(`Cancelled: Saved partial file (${sizeStr})`);
        }
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
            formattedSize: sizeStr,
            duration: result.duration,
            formattedDuration:
              typeof StegoTime !== 'undefined' ? StegoTime.formatDuration(result.duration) : '',
            completedAt: Date.now(),
            exists: true
          });
        }
      } else {
        if (typeof UiFeedback !== 'undefined') {
          UiFeedback.info('Download cancelled.');
        }
        removeTaskCard(taskId);
      }
    } else {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.error(`Download error: ${result?.error || 'Download failed'}`);
      }
      markTaskCardError(taskId, result?.error || 'Download failed');
    }

    activeDownloadTasks.delete(taskId);
    updateDownloadBadge();
  }

  function addActiveTask(taskId, task) {
    if (!activeDownloadTasks.has(taskId)) {
      activeDownloadTasks.set(taskId, task);
      createOrUpdateActiveTaskCard(task);
      updateDownloadBadge();
    }
  }

  async function clearHistory() {
    try {
      await chrome.storage.local.remove([DOWNLOAD_HISTORY_KEY]);
      renderDownloadHistory([]);
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.info('Download history cleared.');
      }
    } catch {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.error('Failed to clear history.');
      }
    }
  }

  function init() {
    if (btnClearHistory) {
      btnClearHistory.addEventListener('click', clearHistory);
    }
    loadDownloadHistory();
  }

  return {
    init,
    createCatCatchCard,
    wireCardEvents,
    createOrUpdateActiveTaskCard,
    updateTaskCardProgress,
    transitionTaskToComplete,
    markTaskCardError,
    removeTaskCard,
    refreshHistoryFileStatus,
    loadDownloadHistory,
    addDownloadHistory,
    removeDownloadHistoryItem,
    clearHistory,
    renderDownloadHistory,
    updateDownloadBadge,
    handleDownloadProgress,
    handleDownloadComplete,
    addActiveTask,
    activeTasks: activeDownloadTasks
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = DownloadsManager;
}
