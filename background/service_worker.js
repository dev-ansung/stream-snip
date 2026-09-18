/**
 * Background Service Worker for StegoClip.
 * Sniffs M3U8 streaming requests and preserves session headers per tab.
 */

try {
  importScripts('/lib/constants.js');
} catch {
  try {
    importScripts('../lib/constants.js');
  } catch {
    // Ignored in non-worker environments (e.g. tests)
  }
}

function getPopupStateKeySafe(tabId) {
  if (typeof StegoConstants !== 'undefined' && StegoConstants.getPopupStateKey) {
    return StegoConstants.getPopupStateKey(tabId);
  }
  return `stego_popup_state_${tabId}`;
}

const tabStreams = new Map();
const tabMetadata = new Map();

let lastActiveMediaTabId = null;

// Helper to extract headers into an object
function headersToObject(headersArray) {
  const headers = {};
  if (!Array.isArray(headersArray)) return headers;
  for (const h of headersArray) {
    if (h.name && h.value) {
      headers[h.name] = h.value;
    }
  }
  return headers;
}

// Persist tabStreams and tabMetadata into chrome.storage.local
async function persistState() {
  try {
    const streamsObj = {};
    for (const [k, v] of tabStreams.entries()) {
      streamsObj[k] = v;
    }
    const metaObj = {};
    for (const [k, v] of tabMetadata.entries()) {
      metaObj[k] = v;
    }
    const storageKeys = typeof StegoConstants !== 'undefined' ? StegoConstants.STORAGE_KEYS : null;
    await chrome.storage.local.set({
      [storageKeys?.TAB_STREAMS || 'tabStreams']: streamsObj,
      [storageKeys?.TAB_METADATA || 'tabMetadata']: metaObj,
      [storageKeys?.LAST_ACTIVE_TAB_ID || 'lastActiveMediaTabId']: lastActiveMediaTabId
    });
  } catch (err) {
    console.error('Failed to persist state:', err);
  }
}

// Restore streams and metadata from chrome.storage.local
async function loadPersistedState() {
  try {
    const data = await chrome.storage.local.get([
      'tabStreams',
      'tabMetadata',
      'lastActiveMediaTabId'
    ]);
    if (data.tabStreams) {
      for (const [tId, sList] of Object.entries(data.tabStreams)) {
        tabStreams.set(Number(tId), sList);
      }
    }
    if (data.tabMetadata) {
      for (const [tId, meta] of Object.entries(data.tabMetadata)) {
        tabMetadata.set(Number(tId), meta);
      }
    }
    if (data.lastActiveMediaTabId) {
      lastActiveMediaTabId = data.lastActiveMediaTabId;
    }
  } catch (err) {
    console.error('Failed to load persisted state:', err);
  }
}

// Load persisted state immediately on service worker bootstrap
loadPersistedState();

// Track tab updates to keep page title in sync
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab?.title) {
    tabMetadata.set(tabId, { title: tab.title, url: tab.url });
    persistState();
  }
});

// Clean up captured streams, badge, and persisted popup state on top-level navigation start
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  if (details.frameId === 0) {
    const { tabId } = details;
    tabStreams.delete(tabId);
    tabMetadata.delete(tabId);
    try {
      chrome.action.setBadgeText({ tabId, text: '' });
    } catch {}
    try {
      const stateKey = getPopupStateKeySafe(tabId);
      await chrome.storage.local.remove([stateKey]);
    } catch {}
    await persistState();
  }
});

// Clean up state when a tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  tabStreams.delete(tabId);
  tabMetadata.delete(tabId);
  try {
    const stateKey = getPopupStateKeySafe(tabId);
    await chrome.storage.local.remove([stateKey]);
  } catch {}
  await persistState();
});

// Sniff M3U8 requests before sending
chrome.webRequest.onSendHeaders.addListener(
  async (details) => {
    const { url, tabId, requestHeaders } = details;
    if (tabId < 0) return;

    const isM3u8 = url.includes('.m3u8') || url.includes('/m3u8') || url.includes('urlset/master');
    if (!isM3u8) return;

    lastActiveMediaTabId = tabId;

    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.title) {
        tabMetadata.set(tabId, { title: tab.title, url: tab.url });
      }
    } catch {}

    const headers = headersToObject(requestHeaders);
    const streams = tabStreams.get(tabId) || [];

    // Avoid duplicate URL registrations
    const exists = streams.some((s) => s.url === url);
    if (!exists) {
      streams.unshift({
        url,
        headers,
        timestamp: Date.now()
      });
      // Cap at 20 streams per tab
      if (streams.length > 20) streams.pop();
      tabStreams.set(tabId, streams);

      await persistState();

      // Update badge on extension icon
      chrome.action.setBadgeText({ tabId, text: String(streams.length) });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#3B82F6' });

      // Notify open popup if listening
      try {
        const streamDetectedType =
          typeof StegoConstants !== 'undefined'
            ? StegoConstants.MSG_TYPES.STREAM_DETECTED
            : 'STREAM_DETECTED';
        chrome.runtime
          .sendMessage({
            type: streamDetectedType,
            tabId,
            streamUrl: url
          })
          .catch(() => {});
      } catch {}
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS].filter(Boolean)
);

// Message listener for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_STREAMS') {
    (async () => {
      if (tabStreams.size === 0) {
        await loadPersistedState();
      }

      let tabId = request.tabId || lastActiveMediaTabId;
      let streams = tabId ? tabStreams.get(tabId) || [] : [];
      let meta = tabId ? tabMetadata.get(tabId) : null;

      // Robust fallback: if requested tab has no streams, check lastActiveMediaTabId
      if (streams.length === 0 && lastActiveMediaTabId && lastActiveMediaTabId !== tabId) {
        const fallbackStreams = tabStreams.get(lastActiveMediaTabId) || [];
        if (fallbackStreams.length > 0) {
          tabId = lastActiveMediaTabId;
          streams = fallbackStreams;
          meta = tabMetadata.get(tabId);
        }
      }

      // If still no streams, check any tab with captured streams
      if (streams.length === 0) {
        for (const [tId, sList] of tabStreams.entries()) {
          if (sList && sList.length > 0) {
            tabId = tId;
            streams = sList;
            meta = tabMetadata.get(tId);
            break;
          }
        }
      }

      let title = meta?.title || '';
      let url = meta?.url || '';

      if (tabId) {
        try {
          const tab = await chrome.tabs.get(tabId);
          if (tab?.title) {
            title = tab.title;
            url = tab.url;
            tabMetadata.set(tabId, { title, url });
            await persistState();
          }
        } catch {}
      }

      sendResponse({ streams, tabId, tabTitle: title, tabUrl: url });
    })();
    return true;
  }

  if (request.type === 'CLEAR_STREAMS') {
    (async () => {
      const tabId = request.tabId;
      if (tabId) {
        tabStreams.delete(tabId);
        tabMetadata.delete(tabId);
        try {
          chrome.action.setBadgeText({ tabId, text: '' });
        } catch {}
        try {
          const stateKey = getPopupStateKeySafe(tabId);
          await chrome.storage.local.remove([stateKey]);
        } catch {}
      } else {
        tabStreams.clear();
        tabMetadata.clear();
      }
      await persistState();
      sendResponse({ success: true });
    })();
    return true;
  }

  if (request.type === 'APPLY_DNR_RULES') {
    // Modify headers for extension requests via Declarative Net Request
    const { headers } = request;
    const rules = { removeRuleIds: [1] };

    if (headers && Object.keys(headers).length > 0) {
      const modifyHeaders = [];
      for (const [k, v] of Object.entries(headers)) {
        if (['referer', 'origin', 'user-agent'].includes(k.toLowerCase())) {
          modifyHeaders.push({ header: k, operation: 'set', value: v });
        }
      }

      if (modifyHeaders.length > 0) {
        rules.addRules = [
          {
            id: 1,
            priority: 1,
            action: {
              type: 'modifyHeaders',
              requestHeaders: modifyHeaders
            },
            condition: {
              resourceTypes: ['xmlhttprequest', 'media', 'image']
            }
          }
        ];
      }
    }

    chrome.declarativeNetRequest.updateSessionRules(rules, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
