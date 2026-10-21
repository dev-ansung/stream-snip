/**
 * Background Service Worker for StegoClip.
 *
 * This file only does two things: bootstrap/wire the Catcher module
 * (background/catcher.js — everything about discovering and tracking
 * streams for a tab) and route chrome.runtime messages to it, plus handle
 * the couple of concerns that aren't catching-related (side panel setup,
 * DNR header rules for downloads). See background/catcher.js and
 * lib/stream-sniffer.js for the actual sniffing logic.
 */

try {
  importScripts(
    '/lib/constants.js',
    '/lib/time.js',
    '/lib/stream-sniffer.js',
    '/background/catcher.js'
  );
} catch {
  try {
    importScripts(
      '../lib/constants.js',
      '../lib/time.js',
      '../lib/stream-sniffer.js',
      './catcher.js'
    );
  } catch {
    // Ignored in non-worker environments (e.g. tests)
  }
}

if (typeof Catcher !== 'undefined') {
  Catcher.init();
}

// Configure action button to open side panel
if (typeof chrome !== 'undefined' && chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn('[ServiceWorker] Failed setting sidePanel behavior:', err));
}

// The side panel's connection lifecycle is what arms/disarms the Catcher —
// see armCapture/disarmCapture in catcher.js.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'sidepanel') return;
  Catcher.registerSidePanelPort(port);
});

// Clean up state when a tab is closed. Kept unconditional (unlike the
// capture listeners in catcher.js) since it only frees memory/storage and
// never inspects page content or network traffic.
chrome.tabs.onRemoved.addListener((tabId) => {
  Catcher.clearTab(tabId);
});

// Message listener for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_STREAMS') {
    Catcher.getStreamsForTab(request.tabId).then(sendResponse);
    return true;
  }

  if (request.type === 'ADD_MANUAL_STREAM') {
    Catcher.registerManualStream(request.tabId, request.url).then(sendResponse);
    return true;
  }

  if (request.type === 'DOM_MEDIA_FOUND') {
    const tabId = sender?.tab?.id || request.tabId;
    if (tabId && Array.isArray(request.urls)) {
      Promise.all(request.urls.map((url) => Catcher.registerManualStream(tabId, url))).then(
        (results) => sendResponse({ success: true, count: results.length })
      );
      return true;
    }
    return false;
  }

  if (request.type === 'PAGE_TITLE_CHANGED') {
    const tabId = sender?.tab?.id;
    Catcher.handlePageTitleChanged(
      tabId,
      request.title,
      request.url || sender?.tab?.url,
      request.cleanTitle
    );
    return false;
  }

  if (request.type === 'CLEAR_STREAMS') {
    Catcher.clearTab(request.tabId).then(() => sendResponse({ success: true }));
    return true;
  }

  if (request.type === 'SYNC_FILTERED_STREAMS') {
    if (typeof Catcher !== 'undefined' && Catcher.syncFilteredStreams) {
      Catcher.syncFilteredStreams(request.tabId, request.streams).then(() => {
        sendResponse({ success: true });
      });
      return true;
    }
    sendResponse({ success: false });
    return false;
  }

  if (request.type === 'GET_LOGS') {
    const logs = typeof Catcher !== 'undefined' && Catcher.getLogs ? Catcher.getLogs() : [];
    sendResponse({ success: true, logs });
    return true;
  }

  if (request.type === 'CLEAR_LOGS') {
    if (typeof Catcher !== 'undefined' && Catcher.clearLogs) {
      Catcher.clearLogs();
    }
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'APPLY_DNR_RULES') {
    // Modify headers for extension requests via Declarative Net Request
    const { headers, targetDomain, clearOnly } = request;
    const rules = { removeRuleIds: [1] };

    if (!clearOnly && headers && Object.keys(headers).length > 0) {
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
              ...(targetDomain ? { requestDomains: [targetDomain] } : {}),
              ...(chrome.runtime?.id ? { initiatorDomains: [chrome.runtime.id] } : {}),
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

  if (request.type === 'START_DOWNLOAD') {
    ensureOffscreenDocument()
      .then(() => {
        // Forward directly to ensure offscreen is awake and ready
        chrome.runtime.sendMessage(request).catch(() => {});
        sendResponse({ success: true });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  if (request.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

let offscreenCreating = null;

async function ensureOffscreenDocument() {
  if (typeof chrome === 'undefined' || !chrome.offscreen) return false;
  try {
    if (await chrome.offscreen.hasDocument?.()) return true;
  } catch {
    // Fall through to create
  }

  if (offscreenCreating) {
    await offscreenCreating;
  } else {
    try {
      offscreenCreating = chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['BLOBS', 'WORKERS'],
        justification: 'Background media downloading and transmuxing'
      });
      await offscreenCreating;
    } finally {
      offscreenCreating = null;
    }
  }
  return true;
}
