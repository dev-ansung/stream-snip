/**
 * The Catcher: everything about discovering and tracking streams for a tab —
 * webRequest sniffing, manual URL entry, per-tab bookkeeping, arm/disarm —
 * lives here, separate from service_worker.js's job of routing messages and
 * handling non-catching concerns (DNR header rules, side panel setup).
 *
 * Detection itself (is this URL/response an HLS manifest or a direct media
 * file?) is further separated into lib/stream-sniffer.js — pure functions
 * with no chrome.* dependency, so they're unit-testable on their own. This
 * module is the stateful wiring around that decision: caching request
 * headers, deciding when to arm/disarm the webRequest listeners, and owning
 * the tabStreams/tabMetadata/streamMetadata maps.
 */

const Catcher = (() => {
  const tabStreams = new Map();
  const tabMetadata = new Map();
  const streamMetadata = new Map();
  const pendingRequestHeaders = new Map();
  const sidePanelPorts = new Set();

  const MAX_LOGS = 150;
  const diagnosticLogs = [];

  function addLog(category, message, meta = null) {
    const timestamp = Date.now();
    const entry = {
      id: timestamp + Math.random(),
      timestamp,
      time: new Date(timestamp).toLocaleTimeString(),
      category,
      message,
      ...(meta ? { meta } : {})
    };
    diagnosticLogs.push(entry);
    if (diagnosticLogs.length > MAX_LOGS) {
      diagnosticLogs.shift();
    }
  }

  function getLogs() {
    return [...diagnosticLogs];
  }

  function clearLogs() {
    diagnosticLogs.length = 0;
  }

  let lastActiveMediaTabId = null;
  let isArmed = false;

  function getMsgTypeSafe(key) {
    return (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.[key]) || key;
  }

  // The real sanitization rule lives in lib/time.js. This only degrades if
  // that load-order contract is somehow broken.
  function getCleanTitleSafe(title) {
    if (!title) return '';
    if (typeof StegoTime !== 'undefined' && StegoTime.cleanTitleForFilename) {
      return StegoTime.cleanTitleForFilename(title);
    }
    console.warn('[Catcher] StegoTime unavailable, using raw title as fallback.');
    return title.trim();
  }

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

  function getHeaderValue(responseHeadersArray, name) {
    if (!Array.isArray(responseHeadersArray)) return undefined;
    const header = responseHeadersArray.find((h) => h.name?.toLowerCase() === name);
    return header?.value;
  }

  // Stamps a tab's known streams with freshly-resolved page title/URL and
  // keeps streamMetadata in sync. Returns the tab's stream list (possibly
  // empty) so the caller can decide whether anything actually changed.
  function applyTabMetadataToStreams(tabId, pageTitle, pageUrl, cleanTitle) {
    const streams = tabStreams.get(tabId) || [];
    for (const s of streams) {
      if (!s.pageTitle || s.pageUrl === pageUrl) {
        s.pageTitle = pageTitle;
        s.pageUrl = pageUrl;
        s.cleanTitle = cleanTitle;
        streamMetadata.set(s.url, {
          url: s.url,
          tabId,
          pageTitle,
          pageUrl,
          cleanTitle,
          timestamp: s.timestamp || Date.now()
        });
      }
    }
    return streams;
  }

  function notifyStreamMetadataUpdated(tabId, pageTitle, cleanTitle, streams) {
    try {
      chrome.runtime
        .sendMessage({
          type: getMsgTypeSafe('STREAM_METADATA_UPDATED'),
          tabId,
          tabTitle: pageTitle,
          cleanTitle,
          streams
        })
        .catch(() => {});
    } catch {}
  }

  async function persistState() {
    try {
      const streamsObj = {};
      for (const [k, v] of tabStreams.entries()) streamsObj[k] = v;
      const metaObj = {};
      for (const [k, v] of tabMetadata.entries()) metaObj[k] = v;
      const streamMetaObj = {};
      for (const [k, v] of streamMetadata.entries()) streamMetaObj[k] = v;
      const storageKeys =
        typeof StegoConstants !== 'undefined' ? StegoConstants.STORAGE_KEYS : null;
      await chrome.storage.local.set({
        [storageKeys?.TAB_STREAMS || 'tabStreams']: streamsObj,
        [storageKeys?.TAB_METADATA || 'tabMetadata']: metaObj,
        [storageKeys?.STREAM_METADATA || 'streamMetadata']: streamMetaObj,
        [storageKeys?.LAST_ACTIVE_TAB_ID || 'lastActiveMediaTabId']: lastActiveMediaTabId
      });
    } catch (err) {
      console.error('[Catcher] Failed to persist state:', err);
    }
  }

  async function loadPersistedState() {
    try {
      const data = await chrome.storage.local.get([
        'tabStreams',
        'tabMetadata',
        'streamMetadata',
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
      if (data.streamMetadata) {
        for (const [sUrl, sMeta] of Object.entries(data.streamMetadata)) {
          streamMetadata.set(sUrl, sMeta);
        }
      }
      if (data.lastActiveMediaTabId) {
        lastActiveMediaTabId = data.lastActiveMediaTabId;
      }
    } catch (err) {
      console.error('[Catcher] Failed to load persisted state:', err);
    }
  }

  // Wipes everything tracked for a tab: captured streams, metadata, and badge.
  // Shared by tab close, manual clear, and the stale-data check below.
  async function wipeTab(tabId) {
    const existing = tabStreams.get(tabId) || [];
    for (const s of existing) streamMetadata.delete(s.url);
    tabStreams.delete(tabId);
    tabMetadata.delete(tabId);
    try {
      chrome.action.setBadgeText({ tabId, text: '' });
    } catch {}
    await persistState();
  }

  // Streams are preserved across navigations so users browsing multiple pages
  // or episodes can access all previously captured streams grouped by page.
  async function _pruneIfNavigatedAway(_tabId, _liveUrl) {
    // Zero auto-wipe: streams are preserved across page changes
  }

  // Shared by both discovery paths — the webRequest sniffer and manual URL
  // entry — so tabStreams/streamMetadata/badge bookkeeping lives in exactly
  // one place instead of being duplicated per path.
  /**
   * @param {number} tabId
   * @param {string} url
   * @param {Record<string, string>} headers
   * @param {{ manual?: boolean, kind?: import('../types/domain.js').MediaRequestKind, size?: number }} [options]
   */
  async function registerStream(tabId, url, headers, { manual = false, kind, size } = {}) {
    let pageTitle = '';
    let pageUrl = '';
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab?.title) {
        pageTitle = tab.title;
        pageUrl = tab.url || '';
        tabMetadata.set(tabId, { title: pageTitle, url: pageUrl });
      }
    } catch {}

    const cleanTitle = getCleanTitleSafe(pageTitle);
    const streams = tabStreams.get(tabId) || [];

    const normalizedUrl =
      kind === 'hls' && typeof StreamSniffer !== 'undefined' && StreamSniffer.normalizeHlsUrl
        ? StreamSniffer.normalizeHlsUrl(url)
        : url;

    const formattedSize =
      size && size > 0
        ? typeof StegoTime !== 'undefined' && StegoTime.formatBytes
          ? StegoTime.formatBytes(size)
          : `${Math.round(size / 1024)} KB`
        : undefined;

    // "kind" ('hls' | 'direct') is best-effort at discovery time —
    // Content-Type is authoritative when known, but for manual entries
    // we've only got the URL to go on. When undetermined, the popup falls
    // back to live detection (see readManifestText/NotHlsError in
    // popup.js) once it actually loads the stream, so an undefined kind
    // here is not a bug.
    const streamItem = {
      url: normalizedUrl,
      headers,
      timestamp: Date.now(),
      pageTitle,
      pageUrl,
      cleanTitle,
      ...(size ? { size } : {}),
      ...(formattedSize ? { formattedSize } : {}),
      ...(manual ? { manual: true } : {}),
      ...(kind ? { kind } : {})
    };
    streamMetadata.set(normalizedUrl, streamItem);

    const existsIndex = streams.findIndex((s) => s.url === normalizedUrl);
    if (existsIndex >= 0) {
      streams[existsIndex] = { ...streams[existsIndex], ...streamItem };
      await persistState();
    } else {
      streams.unshift(streamItem);
      // Cap at 50 streams per tab across pages
      if (streams.length > 50) {
        const removed = streams.pop();
        if (removed) streamMetadata.delete(removed.url);
      }
      tabStreams.set(tabId, streams);

      await persistState();

      chrome.action.setBadgeText({ tabId, text: String(streams.length) });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#3B82F6' });

      try {
        chrome.runtime
          .sendMessage({
            type: getMsgTypeSafe('STREAM_DETECTED'),
            tabId,
            streamUrl: normalizedUrl,
            pageTitle,
            cleanTitle
          })
          .catch(() => {});
      } catch {}
    }

    lastActiveMediaTabId = tabId;
    return streams;
  }

  // --- Passive activation ---------------------------------------------
  // No webRequest sniffing, no tab bookkeeping, until a side panel is
  // actually open. Single global switch — no per-tab state, no
  // tab-activation tracking.

  const SEND_HEADERS_EXTRA_INFO_SPEC = /** @type {any} */ (
    [
      'requestHeaders',
      (typeof chrome !== 'undefined' &&
        chrome.webRequest?.OnBeforeSendHeadersOptions?.EXTRA_HEADERS) ||
        'extraHeaders'
    ].filter(Boolean)
  );
  const RESPONSE_HEADERS_EXTRA_INFO_SPEC = /** @type {any} */ (
    [
      'responseHeaders',
      (typeof chrome !== 'undefined' &&
        chrome.webRequest?.OnResponseStartedOptions?.EXTRA_HEADERS) ||
        'extraHeaders'
    ].filter(Boolean)
  );

  // Stage 1: cache each request's headers by requestId as it goes out. The
  // actual media/not-media decision can't be made yet — the response
  // hasn't arrived, so there's no Content-Type to check.
  function cacheRequestHeaders(details) {
    if (details.tabId < 0) return;
    pendingRequestHeaders.set(details.requestId, headersToObject(details.requestHeaders));
  }

  // A request that errors out never reaches onResponseStarted, so its
  // cached headers would otherwise leak for the life of the service worker.
  function handleRequestError(details) {
    pendingRequestHeaders.delete(details.requestId);
    if (details.error) {
      addLog('WARN', `Request error on ${details.url}: ${details.error}`);
    }
  }

  // Stage 2: once the response headers are in, decide whether this looks
  // like an HLS manifest or a direct video/audio file (see
  // lib/stream-sniffer.js) and register it using the same path as manual
  // entry.
  async function handleResponseStarted(details) {
    const { url, tabId, requestId, responseHeaders, type } = details;
    const headers = pendingRequestHeaders.get(requestId) || {};
    pendingRequestHeaders.delete(requestId);

    if (tabId < 0) return;

    const contentType = getHeaderValue(responseHeaders, 'content-type');
    const contentDisposition = getHeaderValue(responseHeaders, 'content-disposition');
    const contentLengthStr = getHeaderValue(responseHeaders, 'content-length');
    const size = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined;

    const kind = StreamSniffer.classifyMediaRequest({
      url,
      contentType,
      contentDisposition,
      resourceType: type
    });
    if (!kind) {
      if (type === 'media' || type === 'xmlhttprequest' || /m3u|mp4|webm|avi|flv|hls/i.test(url)) {
        addLog('SKIP', `Skipped non-media: ${url}`, { contentType, type });
      }
      return;
    }

    // Filter out tiny direct media (< 50KB) to prevent junk/tracker/audio pings
    if (kind === 'direct' && typeof size === 'number' && !isNaN(size) && size < 51200) {
      addLog('SKIP', `Skipped small direct file (<50KB): ${url} (${size} B)`);
      return;
    }

    // Filter out media fragments (LL-HLS or CMAF sub-second chunks)
    if (kind === 'direct' && StreamSniffer.isMediaFragment && StreamSniffer.isMediaFragment(url)) {
      addLog('SKIP', `Skipped media fragment: ${url}`);
      return;
    }

    addLog('SNIFF', `Captured ${kind.toUpperCase()}: ${url}`, { contentType, size });
    await registerStream(tabId, url, headers, { kind, size });
  }

  // Track tab updates to keep page title in sync. Only registered while armed.
  async function handleTabsUpdated(tabId, changeInfo, tab) {
    if (tab?.title) {
      const pageTitle = tab.title;
      const pageUrl = tab.url || '';
      const cleanTitle = getCleanTitleSafe(pageTitle);
      tabMetadata.set(tabId, { title: pageTitle, url: pageUrl });

      const streams = applyTabMetadataToStreams(tabId, pageTitle, pageUrl, cleanTitle);
      await persistState();

      if (streams.length > 0) {
        notifyStreamMetadataUpdated(tabId, pageTitle, cleanTitle, streams);
      }
    }
  }

  // When a tab navigates, keep captured streams intact so users browsing
  // multiple pages/episodes can still access previously captured streams.
  async function handleBeforeNavigate(_details) {
    // Zero auto-wipe: streams are preserved across navigations
  }

  function armCapture() {
    if (isArmed) return;
    isArmed = true;
    addLog('WORKER', 'Capture armed: webRequest & navigation listeners active');
    chrome.tabs.onUpdated.addListener(handleTabsUpdated);
    chrome.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate);
    chrome.webRequest.onSendHeaders.addListener(
      cacheRequestHeaders,
      { urls: ['<all_urls>'] },
      SEND_HEADERS_EXTRA_INFO_SPEC
    );
    chrome.webRequest.onResponseStarted.addListener(
      handleResponseStarted,
      { urls: ['<all_urls>'] },
      RESPONSE_HEADERS_EXTRA_INFO_SPEC
    );
    chrome.webRequest.onErrorOccurred.addListener(handleRequestError, { urls: ['<all_urls>'] });
  }

  function disarmCapture() {
    if (!isArmed) return;
    isArmed = false;
    addLog('WORKER', 'Capture disarmed');
    chrome.tabs.onUpdated.removeListener(handleTabsUpdated);
    chrome.webNavigation.onBeforeNavigate.removeListener(handleBeforeNavigate);
    chrome.webRequest.onSendHeaders.removeListener(cacheRequestHeaders);
    chrome.webRequest.onResponseStarted.removeListener(handleResponseStarted);
    chrome.webRequest.onErrorOccurred.removeListener(handleRequestError);
    pendingRequestHeaders.clear();
  }

  // The side panel opens a long-lived port on load; it disconnects
  // automatically when the panel closes. We track active panel ports and
  // ensure background capture is armed.
  function registerSidePanelPort(port) {
    sidePanelPorts.add(port);
    armCapture();
    port.onDisconnect.addListener(() => {
      sidePanelPorts.delete(port);
    });
  }

  // --- Public API for message routing in service_worker.js ---------------

  async function getStreamsForTab(requestedTabId) {
    if (tabStreams.size === 0) {
      await loadPersistedState();
    }

    const knowsExactTab = Boolean(requestedTabId);
    let tabId = requestedTabId;
    if (!knowsExactTab) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      } catch {}
    }

    let liveTab = null;
    if (tabId) {
      try {
        liveTab = await chrome.tabs.get(tabId);
      } catch {}
    }

    const streams = tabId ? tabStreams.get(tabId) || [] : [];
    const meta = tabId ? tabMetadata.get(tabId) : null;

    let title = meta?.title || liveTab?.title || '';
    let url = meta?.url || liveTab?.url || '';

    if (tabId) {
      try {
        const tab = liveTab?.id === tabId ? liveTab : await chrome.tabs.get(tabId);
        if (tab?.title) {
          title = tab.title;
          url = tab.url;
          tabMetadata.set(tabId, { title, url });
          await persistState();
        }
      } catch {}
    }

    // Enrich streams with streamMetadata if any field is missing
    for (const s of streams) {
      const meta2 = streamMetadata.get(s.url);
      if (meta2) {
        if (!s.cleanTitle && meta2.cleanTitle) s.cleanTitle = meta2.cleanTitle;
        if (!s.pageTitle && meta2.pageTitle) s.pageTitle = meta2.pageTitle;
        if (!s.pageUrl && meta2.pageUrl) s.pageUrl = meta2.pageUrl;
      } else if (title && !s.cleanTitle) {
        s.pageTitle = title;
        s.pageUrl = url;
        s.cleanTitle = getCleanTitleSafe(title);
      }
    }

    return {
      streams,
      tabId,
      tabTitle: title,
      tabUrl: url,
      streamMetadata: Object.fromEntries(streamMetadata)
    };
  }

  async function registerManualStream(tabId, url) {
    if (!tabId || !url) {
      return { success: false, error: 'Missing tabId or url' };
    }
    // No Content-Type available yet for a pasted URL — classify by
    // extension only. Undetermined is fine; popup.js falls back to live
    // detection once it actually fetches the URL.
    const kind = StreamSniffer.classifyMediaRequest({ url }) || undefined;
    const streams = await registerStream(tabId, url, {}, { manual: true, kind });
    return { success: true, streams };
  }

  async function handlePageTitleChanged(tabId, title, url, cleanTitleIn) {
    if (!tabId || !title) return;
    const cleanTitle = cleanTitleIn || getCleanTitleSafe(title);
    tabMetadata.set(tabId, { title, url: url || '' });
    const streams = applyTabMetadataToStreams(tabId, title, url || '', cleanTitle);
    await persistState();
    notifyStreamMetadataUpdated(tabId, title, cleanTitle, streams);
  }

  async function clearTab(tabId) {
    if (tabId) {
      await wipeTab(tabId);
    } else {
      tabStreams.clear();
      tabMetadata.clear();
      streamMetadata.clear();
      await persistState();
    }
  }

  async function syncFilteredStreams(tabId, streams) {
    if (!tabId || !Array.isArray(streams)) return;
    tabStreams.set(tabId, streams);
    await persistState();
    const count = streams.length;
    try {
      chrome.action.setBadgeText({ tabId, text: count > 0 ? String(count) : '' });
      if (count > 0) {
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#3B82F6' });
      }
    } catch {}
  }

  function init() {
    loadPersistedState();
    armCapture();
  }

  return {
    init,
    armCapture,
    disarmCapture,
    registerSidePanelPort,
    getStreamsForTab,
    registerManualStream,
    handlePageTitleChanged,
    clearTab,
    syncFilteredStreams,
    getLogs,
    clearLogs,
    addLog
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Catcher;
}
if (typeof globalThis !== 'undefined') {
  globalThis.Catcher = Catcher;
}
