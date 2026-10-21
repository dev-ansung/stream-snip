/**
 * UI Coordinator for the StegoClip Side Panel.
 * Orchestrates StreamList, DownloadsManager, and SettingsController modules.
 */

let currentTabId = null;
let currentTabUrl = '';
let currentTabFaviconUrl = '';
let _currentDefaultBaseName = '';

// Tab Navigation Elements
const tabBtns = document.querySelectorAll('.nav-tab');
const tabPanels = document.querySelectorAll('.tab-panel');

function switchTab(tabName) {
  const tabs = ['videos', 'downloads', 'settings'];
  if (!tabs.includes(tabName)) return;

  tabBtns.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle(
      'active',
      panel.id === `panel${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`
    );
  });

  if (tabName === 'settings' && typeof SettingsController !== 'undefined') {
    SettingsController.loadDiagnosticLogs();
  }
}

async function resolveDocumentTitle(targetTabId) {
  if (!targetTabId || typeof chrome === 'undefined' || !chrome.tabs) return null;
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
    if (liveTitle && typeof StegoTime !== 'undefined' && !StegoTime.isGenericBase(liveTitle)) {
      return liveTitle;
    }
  } catch {}

  try {
    const tab = await chrome.tabs.get(targetTabId);
    if (tab?.title && typeof StegoTime !== 'undefined') {
      const clean = StegoTime.cleanTitleForFilename(tab.title);
      if (clean && !StegoTime.isGenericBase(clean)) return clean;
    }
  } catch {}
  return null;
}

async function requestStreams(targetId) {
  const getStreamsType =
    (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.GET_STREAMS) ||
    'GET_STREAMS';
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: getStreamsType, tabId: targetId }, async (response) => {
      const received = response?.streams || [];
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

      let liveTitle = null;
      if (currentTabId) {
        liveTitle = await resolveDocumentTitle(currentTabId);
      }
      if (liveTitle && typeof StegoTime !== 'undefined' && !StegoTime.isGenericBase(liveTitle)) {
        _currentDefaultBaseName = liveTitle;
      } else if (response?.tabTitle && typeof StegoTime !== 'undefined') {
        const detected = StegoTime.cleanTitleForFilename(response.tabTitle);
        if (detected && !StegoTime.isGenericBase(detected)) {
          _currentDefaultBaseName = detected;
        }
      }

      if (typeof StreamList !== 'undefined') {
        await StreamList.setStreams(received, currentTabUrl, currentTabFaviconUrl, currentTabId);
      }
      resolve(undefined);
    });
  });
}

let _refreshTimer = null;
function scheduleRefresh(targetId, delayMs = 100) {
  if (_refreshTimer) clearTimeout(_refreshTimer);
  _refreshTimer = setTimeout(() => {
    _refreshTimer = null;
    requestStreams(targetId || currentTabId);
  }, delayMs);
}

// Runtime message dispatcher
chrome.runtime.onMessage.addListener(async (message, _sender) => {
  const isTitleUpdateMsg =
    message?.type === 'STREAM_METADATA_UPDATED' || message?.type === 'PAGE_TITLE_CHANGED';

  if (isTitleUpdateMsg) {
    if (!currentTabId || !message.tabId || message.tabId === currentTabId) {
      if (Array.isArray(message.streams) && typeof StreamList !== 'undefined') {
        StreamList.updateStreamMetadata(message.streams);
      }
    }
    return;
  }

  const isStreamDetectedMsg = message?.type === 'STREAM_DETECTED';
  if (isStreamDetectedMsg) {
    if (message.tabId && currentTabId && message.tabId !== currentTabId) {
      return;
    }
    scheduleRefresh(message.tabId || currentTabId, 50);
    return;
  }

  const downloadProgressType =
    (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.DOWNLOAD_PROGRESS) ||
    'DOWNLOAD_PROGRESS';
  if (message?.type === downloadProgressType) {
    if (typeof DownloadsManager !== 'undefined') {
      DownloadsManager.handleDownloadProgress(message.taskId, message.progress);
    }
    return;
  }

  const downloadCompleteType =
    (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.DOWNLOAD_COMPLETE) ||
    'DOWNLOAD_COMPLETE';
  if (message?.type === downloadCompleteType) {
    if (typeof DownloadsManager !== 'undefined') {
      DownloadsManager.handleDownloadComplete(message.taskId, message.result);
    }
    return;
  }
});

// React dynamically to active tab switches in the browser
if (typeof chrome !== 'undefined' && chrome.tabs?.onActivated) {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    currentTabId = activeInfo.tabId;
    try {
      const tab = await chrome.tabs.get(currentTabId);
      if (tab) {
        currentTabUrl = tab.url || '';
        currentTabFaviconUrl = tab.favIconUrl || '';
      }
    } catch {}
    scheduleRefresh(currentTabId, 30);
  });
}

// React dynamically to tab URL changes and page loads
if (typeof chrome !== 'undefined' && chrome.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (tabId === currentTabId && (changeInfo.status === 'complete' || changeInfo.url)) {
      scheduleRefresh(currentTabId, 100);
    }
  });
}

// React dynamically to storage changes if Catcher persisted new streams
if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.tabStreams && currentTabId) {
      const newStreams = changes.tabStreams.newValue;
      if (newStreams && newStreams[currentTabId]) {
        scheduleRefresh(currentTabId, 50);
      }
    }
  });
}

// Bootstrap on DOMContentLoaded
document.addEventListener('DOMContentLoaded', async () => {
  // Connect side panel port to arm passive capture in service worker
  if (typeof chrome !== 'undefined' && chrome.runtime?.connect) {
    try {
      chrome.runtime.connect({ name: 'sidepanel' });
    } catch {}
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabName = btn.getAttribute('data-tab');
      if (tabName) switchTab(tabName);
    });
  });

  const urlParams = new URLSearchParams(window.location.search);
  let targetId = urlParams.get('tabId') ? parseInt(urlParams.get('tabId'), 10) : null;

  if (!targetId && typeof chrome !== 'undefined' && chrome.tabs?.query) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetId = tab?.id || null;
      if (tab) {
        currentTabUrl = tab.url || '';
        currentTabFaviconUrl = tab.favIconUrl || '';
      }
    } catch {}
  }

  if (typeof StreamList !== 'undefined') {
    StreamList.init({ tabId: targetId, tabUrl: currentTabUrl });
  }
  if (typeof DownloadsManager !== 'undefined') {
    DownloadsManager.init();
  }
  if (typeof SettingsController !== 'undefined') {
    SettingsController.init();
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'GET_ACTIVE_DOWNLOADS' }, (res) => {
      if (chrome.runtime?.lastError) return;
      if (res?.success && Array.isArray(res.active) && typeof DownloadsManager !== 'undefined') {
        for (const item of res.active) {
          DownloadsManager.addActiveTask(item.taskId, item.task);
        }
      }
    });
  }

  if (targetId) {
    currentTabId = targetId;
    try {
      chrome.tabs.sendMessage(targetId, { type: 'SCAN_DOM_MEDIA' }).catch(() => {});
    } catch {}
  }

  await requestStreams(targetId);

  setTimeout(() => {
    if (typeof StreamList !== 'undefined' && StreamList.getStreams().length === 0) {
      requestStreams(targetId);
    }
  }, 1200);
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    switchTab,
    requestStreams,
    resolveDocumentTitle
  };
}
