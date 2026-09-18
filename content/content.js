/**
 * Content script for StegoClip.
 * Observes HTML5 video elements on the webpage and reports seek and playhead updates
 * to the extension popup/studio for seamless preview synchronization.
 */

(function () {
  const trackedVideos = new WeakSet();
  let seekingDebounceTimer = null;

  /**
   * Recursively finds all HTML5 video elements in a root or document,
   * including those nested within Shadow DOM roots.
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
    trackedVideos.add(video);

    console.info('[StegoClip:Content] Attached seek listeners to video element:', video);

    video.addEventListener('seeked', () => onVideoSeeked(video), { passive: true });
    video.addEventListener('seeking', () => onVideoSeeking(video), { passive: true });
  }

  function observeDOM() {
    // Attach to existing videos across DOM and Shadow DOM
    findAllVideos(document).forEach(attachVideoListeners);

    // Observe dynamically added videos
    const observer = new MutationObserver((mutations) => {
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
      observer.observe(target, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        const t = document.body || document.documentElement;
        if (t) observer.observe(t, { childList: true, subtree: true });
      });
    }
  }

  // Listen for queries from popup to get current playhead time
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
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

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', observeDOM);
    } else {
      observeDOM();
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      findAllVideos,
      findPrimaryVideo,
      handleVideoSeek,
      attachVideoListeners
    };
  }
})();
