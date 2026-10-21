/**
 * Content script for StegoClip.
 * Observes HTML5 video elements on the webpage and reports seek and playhead updates
 * to the extension popup/studio for seamless preview synchronization.
 */

(function () {
  /**
   * Recursively finds all HTML5 video elements in a root or document,
   * including those nested within Shadow DOM roots.
   * @param {any} [root]
   */
  function findAllVideos(root = document) {
    const videos = [];
    if (!root) return videos;

    try {
      if (root.querySelectorAll) {
        root.querySelectorAll('video').forEach((v) => videos.push(v));

        // Traverse shadow roots for custom Web Components / video wrappers
        root.querySelectorAll('*').forEach((el) => {
          if (el.shadowRoot) {
            videos.push(...findAllVideos(el.shadowRoot));
          }
        });
      }
    } catch {
      // Ignored if querying restricted elements
    }
    return videos;
  }

  /**
   * Finds the most relevant video element on the current frame or page.
   * If expectedDuration is provided, prioritizes the video matching that duration.
   */
  function findPrimaryVideo(expectedDuration = 0) {
    const videos = findAllVideos(document);
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];

    // Priority 1: Match by duration of the preview video (within 2s tolerance)
    if (expectedDuration > 0) {
      const match = videos.find(
        (v) => v.duration && Math.abs(v.duration - expectedDuration) <= 2.0
      );
      if (match) return match;
    }

    // Priority 2: Currently playing video
    const playing = videos.find((v) => !v.paused && v.currentTime > 0);
    if (playing) return playing;

    // Priority 3: Largest visible video by area
    let largest = null;
    let maxArea = 0;
    for (const v of videos) {
      const area = (v.videoWidth || v.clientWidth || 0) * (v.videoHeight || v.clientHeight || 0);
      if (area > maxArea) {
        maxArea = area;
        largest = v;
      }
    }
    return largest || videos[0];
  }

  let titleObserver = null;
  let lastReportedTitle = '';

  // The real sanitization rule lives in lib/time.js (loaded before this
  // script per manifest.json's content_scripts order) so it isn't
  // duplicated here. This only degrades if that load-order contract is
  // somehow broken.
  function getCleanTitle(raw) {
    if (typeof StegoTime !== 'undefined' && StegoTime.cleanTitleForFilename) {
      return StegoTime.cleanTitleForFilename(raw);
    }
    console.warn('[StegoClip:Content] StegoTime unavailable, using raw title as fallback.');
    return (raw || '').trim();
  }

  function reportTitleChange() {
    if (typeof document === 'undefined') return;
    const currentTitle = document.title || '';
    if (!currentTitle || currentTitle === lastReportedTitle) return;
    lastReportedTitle = currentTitle;
    const clean = getCleanTitle(currentTitle);
    console.info(`[StegoClip:Content] Page title changed: "${currentTitle}" (clean: "${clean}")`);
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        const msgType =
          (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.PAGE_TITLE_CHANGED) ||
          'PAGE_TITLE_CHANGED';
        chrome.runtime
          .sendMessage({
            type: msgType,
            title: currentTitle,
            cleanTitle: clean,
            url: typeof location !== 'undefined' ? location.href : ''
          })
          .catch(() => {});
      } catch {}
    }
  }

  function startTitleObserver() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
    if (titleObserver) return;
    lastReportedTitle = document.title || '';

    const titleEl = document.querySelector('title');
    if (titleEl) {
      titleObserver = new MutationObserver(() => {
        reportTitleChange();
      });
      try {
        titleObserver.observe(titleEl, {
          characterData: true,
          childList: true
        });
      } catch {}
      return;
    }

    if (document.head) {
      titleObserver = new MutationObserver(() => {
        const t = document.querySelector('title');
        if (t) {
          stopTitleObserver();
          startTitleObserver();
          reportTitleChange();
        }
      });
      try {
        titleObserver.observe(document.head, {
          childList: true
        });
      } catch {}
    }
  }

  function stopTitleObserver() {
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }
  }

  const reportedMediaUrls = new Set();

  function scanDomMedia() {
    if (typeof document === 'undefined') return;
    try {
      const mediaNodes = document.querySelectorAll('video, audio, source');
      const urls = [];

      for (const node of mediaNodes) {
        /** @type {any} */
        const el = node;
        const rawSrc = el.currentSrc || el.src;
        if (!rawSrc || typeof rawSrc !== 'string') continue;
        if (rawSrc.startsWith('blob:') || rawSrc.startsWith('data:')) continue;

        let absoluteUrl = rawSrc;
        try {
          absoluteUrl = new URL(rawSrc, location.href).href;
        } catch {}

        if (absoluteUrl && !reportedMediaUrls.has(absoluteUrl)) {
          reportedMediaUrls.add(absoluteUrl);
          urls.push(absoluteUrl);
        }
      }

      if (urls.length > 0 && typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime
          .sendMessage({
            type: 'DOM_MEDIA_FOUND',
            urls
          })
          .catch(() => {});
      }
    } catch {}
  }

  // Listen for control queries and sync toggle messages from extension side panel
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'SCAN_DOM_MEDIA') {
        scanDomMedia();
        sendResponse({ success: true, count: reportedMediaUrls.size });
        return false;
      }

      if (message?.type === 'GET_PAGE_TITLE') {
        const rawTitle = (typeof document !== 'undefined' ? document.title : '') || '';
        const cleanTitle = getCleanTitle(rawTitle);
        sendResponse({
          success: true,
          title: rawTitle,
          cleanTitle,
          url: typeof location !== 'undefined' ? location.href : ''
        });
        return false;
      }
    });
  }

  // Automatically observe title changes in top-level window, and scan DOM media in all frames
  if (typeof window !== 'undefined') {
    if (window === window.top) {
      startTitleObserver();
    }
    setTimeout(scanDomMedia, 500);
    setTimeout(scanDomMedia, 2000);
    window.addEventListener('load', () => scanDomMedia(), { once: true });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      findAllVideos,
      findPrimaryVideo,
      startTitleObserver,
      stopTitleObserver,
      reportTitleChange,
      getCleanTitle
    };
  }
})();
