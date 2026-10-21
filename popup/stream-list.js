/**
 * StreamList component for StegoClip Side Panel.
 * Handles video stream discovery cards, domain grouping, search filtering,
 * manual stream URL entry, and launching the dedicated Video.js player tab.
 */

const StreamList = (() => {
  let currentStreams = [];
  let currentTabUrl = '';
  let _currentTabFaviconUrl = '';
  let currentMediaFilter = 'all';
  let currentSearchQuery = '';
  let currentTabId = null;

  // DOM Elements
  const videoCardList = document.getElementById('videoCardList');
  const emptyVideosState = document.getElementById('emptyVideosState');
  const streamCountBadge = document.getElementById('streamCount');
  const streamSearchInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('streamSearchInput')
  );
  const filterChips = document.querySelectorAll('.filter-chip');
  const btnClearStreams = document.getElementById('btnClearStreams');
  const manualStreamUrlInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('manualStreamUrl')
  );
  const btnAddManualStream = /** @type {HTMLButtonElement | null} */ (
    document.getElementById('btnAddManualStream')
  );

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

  function formatStreamTitle(stream, idx) {
    try {
      const u = new URL(stream.url);
      const parts = u.pathname.split('/').filter(Boolean);
      const file = parts.pop() || 'master.m3u8';

      if (file.includes('master')) {
        return `[Master] Multi-Quality Stream • ${u.hostname}`;
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

  function openInPlayer(stream) {
    if (!stream?.url) return;
    const effectiveHeaders =
      typeof StreamSniffer !== 'undefined' && StreamSniffer.resolveStreamHeaders
        ? StreamSniffer.resolveStreamHeaders(stream, currentTabUrl)
        : stream.headers || {};

    const title =
      stream.cleanTitle || stream.pageTitle || formatStreamTitle(stream, 0) || 'StegoClip Video';
    const pageUrl = stream.pageUrl || currentTabUrl || '';

    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      try {
        chrome.storage.session.set({
          active_player_stream: {
            url: stream.url,
            pageUrl,
            headers: effectiveHeaders,
            title,
            kind: stream.kind || 'hls',
            time: 0
          }
        });
      } catch {}
    }

    const playerParams = new URLSearchParams({
      url: stream.url,
      title,
      pageUrl,
      kind: stream.kind || 'hls',
      t: '0'
    });

    const playerUrl = chrome.runtime.getURL(`player/player.html?${playerParams.toString()}`);
    if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
      chrome.tabs.create({ url: playerUrl });
    }
  }

  function createVideoCardElement(stream, idx) {
    const card = document.createElement('div');
    card.className = 'video-card';

    const isHls = stream.kind === 'hls' || stream.url.toLowerCase().includes('.m3u8');
    const isDirect = stream.kind === 'direct' || !isHls;
    const badgeClass = isHls ? 'video-badge-hls' : 'video-badge-direct';
    const ext =
      typeof StreamSniffer !== 'undefined' && StreamSniffer.getUrlExtension
        ? StreamSniffer.getUrlExtension(stream.url)
        : '';
    const badgeText = isHls ? 'HLS' : ext ? ext.toUpperCase() : isDirect ? 'DIRECT' : 'MEDIA';
    const titleText = stream.cleanTitle || stream.pageTitle || formatStreamTitle(stream, idx);
    const sizeText =
      stream.formattedSize ||
      (stream.size && typeof StegoTime !== 'undefined' ? StegoTime.formatBytes(stream.size) : '');

    card.innerHTML = `
      <div class="video-card-header">
        <div class="video-card-title">${escapeHtml(titleText)}</div>
        <div class="video-card-meta">
          <span class="${badgeClass}">${badgeText}</span>
          ${sizeText ? `<span class="badge-subtle">${sizeText}</span>` : ''}
        </div>
      </div>
      <div class="video-card-url" title="${escapeHtml(stream.url)}">${escapeHtml(stream.url)}</div>
      <div class="video-card-actions">
        <button type="button" class="btn-card-action primary btn-open-player" title="Open player to preview, clip, and download">
          ✂️ Open in Player
        </button>
        <button type="button" class="btn-card-action btn-card-copy" title="Copy stream URL">
          📋 Copy URL
        </button>
      </div>
    `;

    const btnOpen = card.querySelector('.btn-open-player');
    if (btnOpen) {
      btnOpen.addEventListener('click', (e) => {
        e.stopPropagation();
        openInPlayer(stream);
      });
    }

    const btnCopy = card.querySelector('.btn-card-copy');
    if (btnCopy) {
      btnCopy.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(stream.url);
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

    card.addEventListener('click', () => {
      openInPlayer(stream);
    });

    return card;
  }

  function renderVideoCards() {
    if (!videoCardList) return;
    videoCardList.innerHTML = '';

    const query = currentSearchQuery.trim().toLowerCase();
    const filtered = currentStreams.filter((stream) => {
      const isHls = stream.kind === 'hls' || stream.url.toLowerCase().includes('.m3u8');
      if (currentMediaFilter === 'hls' && !isHls) return false;
      if (currentMediaFilter === 'direct' && isHls) return false;

      if (query) {
        const title = (stream.cleanTitle || stream.pageTitle || '').toLowerCase();
        const url = stream.url.toLowerCase();
        if (!title.includes(query) && !url.includes(query)) return false;
      }
      return true;
    });

    if (emptyVideosState) {
      emptyVideosState.style.display = filtered.length === 0 ? 'block' : 'none';
    }

    if (filtered.length === 0) return;

    /** @type {Map<string, { pageUrl: string, pageTitle: string, domain: string, latestTimestamp: number, streams: any[] }>} */
    const groupsMap = new Map();

    filtered.forEach((stream) => {
      const key = stream.pageUrl || stream.pageTitle || 'Other Media';
      if (!groupsMap.has(key)) {
        const domain = extractDomain(stream.pageUrl, stream.url);
        groupsMap.set(key, {
          pageUrl: stream.pageUrl || '',
          pageTitle: stream.pageTitle || '',
          domain,
          latestTimestamp: stream.timestamp || 0,
          streams: []
        });
      }
      const grp = groupsMap.get(key);
      grp.streams.push(stream);
      if ((stream.timestamp || 0) > grp.latestTimestamp) {
        grp.latestTimestamp = stream.timestamp || 0;
      }
      if (!grp.pageTitle && stream.pageTitle) {
        grp.pageTitle = stream.pageTitle;
      }
    });

    const sortedGroups = Array.from(groupsMap.values()).sort((a, b) => {
      const aIsCurrent = Boolean(currentTabUrl && a.pageUrl && currentTabUrl.startsWith(a.pageUrl));
      const bIsCurrent = Boolean(currentTabUrl && b.pageUrl && currentTabUrl.startsWith(b.pageUrl));
      if (aIsCurrent && !bIsCurrent) return -1;
      if (!aIsCurrent && bIsCurrent) return 1;
      return b.latestTimestamp - a.latestTimestamp;
    });

    let globalIdx = 0;
    sortedGroups.forEach((group) => {
      const details = document.createElement('details');
      details.className = 'video-group';
      details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'video-group-header';

      const leftDiv = document.createElement('div');
      leftDiv.className = 'video-group-left';

      const chevron = document.createElement('span');
      chevron.className = 'group-chevron';
      chevron.textContent = '▼';
      leftDiv.appendChild(chevron);

      if (group.domain) {
        const domainBadge = document.createElement('span');
        domainBadge.className = 'group-domain';
        domainBadge.textContent = group.domain;
        leftDiv.appendChild(domainBadge);
      }

      const titleEl = document.createElement('span');
      titleEl.className = 'group-title';
      const displayTitle =
        group.pageTitle ||
        (group.pageUrl ? group.pageUrl.replace(/^https?:\/\//, '') : 'Captured Streams');
      titleEl.textContent = displayTitle;
      titleEl.title = displayTitle;
      leftDiv.appendChild(titleEl);

      const rightDiv = document.createElement('div');
      rightDiv.className = 'video-group-right';

      const countEl = document.createElement('span');
      countEl.className = 'group-count';
      const count = group.streams.length;
      countEl.textContent = `${count} stream${count === 1 ? '' : 's'}`;
      rightDiv.appendChild(countEl);

      summary.appendChild(leftDiv);
      summary.appendChild(rightDiv);
      details.appendChild(summary);

      const itemsContainer = document.createElement('div');
      itemsContainer.className = 'video-group-items';

      group.streams.forEach((stream) => {
        const card = createVideoCardElement(stream, globalIdx++);
        itemsContainer.appendChild(card);
      });

      details.appendChild(itemsContainer);
      videoCardList.appendChild(details);
    });
  }

  function updateBadge() {
    if (streamCountBadge) {
      streamCountBadge.textContent = `${currentStreams.length} stream${currentStreams.length === 1 ? '' : 's'}`;
    }
  }

  function setStreams(streams, tabUrl = '', tabFavicon = '', tabId = null) {
    currentStreams = Array.isArray(streams) ? [...streams] : [];
    if (tabUrl) currentTabUrl = tabUrl;
    if (tabFavicon) _currentTabFaviconUrl = tabFavicon;
    if (tabId !== null) currentTabId = tabId;
    updateBadge();
    renderVideoCards();
  }

  function updateStreamMetadata(streams) {
    if (!Array.isArray(streams)) return;
    for (const s of streams) {
      const local = currentStreams.find((cs) => cs.url === s.url);
      if (local) {
        if (s.cleanTitle) local.cleanTitle = s.cleanTitle;
        if (s.pageTitle) local.pageTitle = s.pageTitle;
      }
    }
    renderVideoCards();
  }

  async function addManualStream() {
    const raw = manualStreamUrlInput?.value?.trim();
    if (!raw) return;

    let parsed;
    try {
      parsed = new URL(raw);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('not http(s)');
    } catch {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.error('Enter a valid http(s) stream URL.');
      }
      return;
    }

    if (!currentTabId) {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.error('No active tab to attach this stream to.');
      }
      return;
    }

    if (btnAddManualStream) btnAddManualStream.disabled = true;
    try {
      const type =
        (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.ADD_MANUAL_STREAM) ||
        'ADD_MANUAL_STREAM';
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type, tabId: currentTabId, url: parsed.href }, resolve);
      });

      if (!response?.success) {
        if (typeof UiFeedback !== 'undefined') {
          UiFeedback.error(response?.error || 'Could not add that stream.');
        }
        return;
      }

      currentStreams = response.streams || currentStreams;
      if (manualStreamUrlInput) manualStreamUrlInput.value = '';
      updateBadge();
      renderVideoCards();
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.success('Stream added.');
      }
    } finally {
      if (btnAddManualStream) btnAddManualStream.disabled = false;
    }
  }

  async function clearStreams() {
    try {
      const clearType =
        (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.CLEAR_STREAMS) ||
        'CLEAR_STREAMS';
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: clearType, tabId: currentTabId }, resolve);
      });
      currentStreams = [];
      updateBadge();
      renderVideoCards();
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.info('Cleared streams for this tab.');
      }
    } catch {
      if (typeof UiFeedback !== 'undefined') {
        UiFeedback.error('Failed to clear streams.');
      }
    }
  }

  function init({ tabId = null, tabUrl = '' } = {}) {
    currentTabId = tabId;
    currentTabUrl = tabUrl;

    filterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        filterChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        currentMediaFilter = chip.getAttribute('data-filter') || 'all';
        renderVideoCards();
      });
    });

    if (streamSearchInput) {
      streamSearchInput.addEventListener('input', () => {
        currentSearchQuery = streamSearchInput.value;
        renderVideoCards();
      });
    }

    if (btnClearStreams) {
      btnClearStreams.addEventListener('click', clearStreams);
    }

    if (btnAddManualStream) {
      btnAddManualStream.addEventListener('click', addManualStream);
    }
    if (manualStreamUrlInput) {
      manualStreamUrlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addManualStream();
        }
      });
    }
  }

  return {
    init,
    setStreams,
    updateStreamMetadata,
    renderVideoCards,
    openInPlayer,
    getStreams: () => currentStreams,
    createVideoCardElement
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StreamList;
}
