/**
 * Content script for StegoClip.
 * Observes HTML5 video elements on the webpage and reports seek and playhead updates
 * to the extension popup/studio for seamless preview synchronization.
 */

(function () {
  const trackedVideos = new Map();
  let seekingDebounceTimer = null;

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

  /**
   * Dispatches the video seek/playhead time to the extension background and side panel.
   */
  function handleVideoSeek(video) {
    if (!video) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    const currentTime = typeof video.currentTime === 'number' ? video.currentTime : 0;
    const duration = typeof video.duration === 'number' ? video.duration : 0;
    const paused = Boolean(video.paused);

    console.info('[StegoClip:Content] Video seek detected:', {
      currentTime,
      duration,
      paused
    });

    try {
      chrome.runtime
        .sendMessage({
          type: 'TAB_MEDIA_SEEK',
          currentTime,
          duration,
          paused
        })
        .catch(() => {
          // Ignored when side panel / popup is not actively listening
        });
    } catch {
      // Ignored
    }
  }

  function onVideoSeeking(video) {
    if (seekingDebounceTimer) clearTimeout(seekingDebounceTimer);
    seekingDebounceTimer = setTimeout(() => {
      handleVideoSeek(video);
    }, 80);
  }

  function onVideoSeeked(video) {
    if (seekingDebounceTimer) {
      clearTimeout(seekingDebounceTimer);
      seekingDebounceTimer = null;
    }
    handleVideoSeek(video);
  }

  /**
   * Attaches seek listeners to a video element if not already observed.
   */
  function attachVideoListeners(video) {
    if (!video || trackedVideos.has(video)) return;

    const seekedHandler = () => onVideoSeeked(video);
    const seekingHandler = () => onVideoSeeking(video);

    trackedVideos.set(video, { seekedHandler, seekingHandler });
    console.info('[StegoClip:Content] Attached seek listeners to video element:', video);

    video.addEventListener('seeked', seekedHandler, { passive: true });
    video.addEventListener('seeking', seekingHandler, { passive: true });
  }

  let activeObserver = null;
  let isSyncActive = false;

  function startSync(expectedDuration = 0) {
    if (isSyncActive) return;
    isSyncActive = true;
    console.info(
      '[StegoClip:Content] Enabling seek sync on demand. expectedDuration:',
      expectedDuration
    );

    const videos = findAllVideos(document);
    videos.forEach((v) => {
      // If expectedDuration is known and video duration is known, verify match
      if (expectedDuration > 0 && v.duration && Math.abs(v.duration - expectedDuration) > 2.0) {
        return;
      }
      attachVideoListeners(v);
    });

    if (!activeObserver && typeof MutationObserver !== 'undefined') {
      activeObserver = new MutationObserver((mutations) => {
        if (!isSyncActive) return;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.tagName === 'VIDEO') {
              attachVideoListeners(node);
            } else if (node.querySelectorAll) {
              findAllVideos(node).forEach(attachVideoListeners);
            }
          }
        }
      });

      const target = document.body || document.documentElement;
      if (target) {
        activeObserver.observe(target, { childList: true, subtree: true });
      }
    }
  }

  function stopSync() {
    if (!isSyncActive) return;
    isSyncActive = false;
    console.info('[StegoClip:Content] Disabling seek sync, cleaning up observers & listeners');

    if (activeObserver) {
      activeObserver.disconnect();
      activeObserver = null;
    }

    for (const [video, handlers] of trackedVideos.entries()) {
      try {
        video.removeEventListener('seeked', handlers.seekedHandler);
        video.removeEventListener('seeking', handlers.seekingHandler);
      } catch {}
    }
    trackedVideos.clear();
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

  // Listen for control queries and sync toggle messages from extension side panel
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'ENABLE_TAB_SEEK_SYNC') {
        startSync(message?.expectedDuration || 0);
        sendResponse({ success: true, active: true });
        return false;
      }

      if (message?.type === 'DISABLE_TAB_SEEK_SYNC') {
        stopSync();
        sendResponse({ success: true, active: false });
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

      if (message?.type === 'GET_PAGE_MEDIA_TIME') {
        const primary = findPrimaryVideo(message?.expectedDuration || 0);
        if (primary) {
          sendResponse({
            success: true,
            currentTime: primary.currentTime,
            duration: primary.duration || 0,
            paused: primary.paused
          });
        } else {
          sendResponse({ success: false });
        }
        return false;
      }
    });
  }

  // Automatically observe title changes in top-level window
  if (typeof window !== 'undefined' && window === window.top) {
    startTitleObserver();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      findAllVideos,
      findPrimaryVideo,
      handleVideoSeek,
      attachVideoListeners,
      startSync,
      stopSync,
      isSyncActive: () => isSyncActive,
      startTitleObserver,
      stopTitleObserver,
      reportTitleChange,
      getCleanTitle
    };
  }
})();
