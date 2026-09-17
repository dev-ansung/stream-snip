/**
 * Background Service Worker for StegoClip.
 * Sniffs M3U8 streaming requests and preserves session headers per tab.
 */

const tabStreams = new Map();

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

// Sniff M3U8 requests before sending
chrome.webRequest.onSendHeaders.addListener(
  details => {
    const { url, tabId, requestHeaders } = details;
    if (tabId < 0) return;

    const isM3u8 = url.includes('.m3u8') || url.includes('/m3u8') || url.includes('urlset/master');
    if (!isM3u8) return;

    lastActiveMediaTabId = tabId;
    const headers = headersToObject(requestHeaders);
    let streams = tabStreams.get(tabId) || [];

    // Avoid duplicate URL registrations
    const exists = streams.some(s => s.url === url);
    if (!exists) {
      streams.unshift({
        url,
        headers,
        timestamp: Date.now()
      });
      // Cap at 10 streams per tab
      if (streams.length > 10) streams.pop();
      tabStreams.set(tabId, streams);

      // Update badge on extension icon
      chrome.action.setBadgeText({ tabId, text: String(streams.length) });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#3B82F6' });
    }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders', chrome.webRequest.OnBeforeSendHeadersOptions.EXTRA_HEADERS].filter(Boolean)
);

// Reset stream cache on top-level navigation
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId === 0) {
    tabStreams.delete(details.tabId);
    chrome.action.setBadgeText({ tabId: details.tabId, text: '' });
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener(tabId => {
  tabStreams.delete(tabId);
});

// Message listener for popup communication
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_STREAMS') {
    const tabId = request.tabId || lastActiveMediaTabId;
    const streams = tabStreams.get(tabId) || [];
    if (tabId) {
      chrome.tabs.get(tabId, tab => {
        const err = chrome.runtime.lastError;
        sendResponse({
          streams,
          tabId,
          tabTitle: (!err && tab?.title) ? tab.title : ''
        });
      });
      return true;
    }
    sendResponse({ streams, tabId, tabTitle: '' });
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
        rules.addRules = [{
          id: 1,
          priority: 1,
          action: {
            type: 'modifyHeaders',
            requestHeaders: modifyHeaders
          },
          condition: {
            resourceTypes: ['xmlhttprequest', 'media', 'image']
          }
        }];
      }
    }

    chrome.declarativeNetRequest.updateSessionRules(rules, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
