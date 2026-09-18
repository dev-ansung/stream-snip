/**
 * Content script for StegoClip.
 * Observes HTML5 video elements on the webpage and reports seek and playhead updates
 * to the extension popup/studio for seamless preview synchronization.
 */

(function () {
  const trackedVideos = new WeakSet();

  function isLikelyMainVideo(video) {
    if (!video) return false;
    const width = video.videoWidth || video.clientWidth || 0;
    const height = video.videoHeight || video.clientHeight || 0;
    // Consider it main if it's playing, or has substantial dimensions, or has duration > 10s
    if (!video.paused && video.currentTime > 0) return true;
    if (width >= 240 && height >= 140) return true;
    if (video.duration && video.duration > 10) return true;
    return false;
  }

  function findPrimaryVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    if (videos.length === 0) return null;
    if (videos.length === 1) return videos[0];

    // Priority 1: Currently playing video
    const playing = videos.find((v) => !v.paused && v.currentTime > 0);
    if (playing) return playing;

    // Priority 2: Largest visible video by area
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

  function handleVideoSeek(video) {
    if (!video || !isLikelyMainVideo(video)) return;
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

    try {
      chrome.runtime
        .sendMessage({
          type: 'TAB_MEDIA_SEEK',
          currentTime: video.currentTime,
          duration: video.duration || 0,
          paused: video.paused
        })
        .catch(() => {
          // Ignored when popup is not listening
        });
    } catch {
      // Ignored
    }
  }

  function attachVideoListeners(video) {
    if (!video || trackedVideos.has(video)) return;
    trackedVideos.add(video);

    video.addEventListener('seeked', () => handleVideoSeek(video), { passive: true });
  }

  function observeDOM() {
    // Attach to existing videos
    document.querySelectorAll('video').forEach(attachVideoListeners);

    // Observe dynamically added videos
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.tagName === 'VIDEO') {
            attachVideoListeners(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('video').forEach(attachVideoListeners);
          }
        }
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true });
        }
      });
    }
  }

  // Listen for queries from popup to get current playhead time
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message?.type === 'GET_PAGE_MEDIA_TIME') {
        const primary = findPrimaryVideo();
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
      isLikelyMainVideo,
      findPrimaryVideo,
      handleVideoSeek,
      attachVideoListeners
    };
  }
})();
