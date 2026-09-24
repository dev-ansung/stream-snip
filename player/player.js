/**
 * Dedicated Fullscreen Video.js Player Controller for StegoClip.
 */

function getMsgType(key) {
  return (typeof StegoConstants !== 'undefined' && StegoConstants.MSG_TYPES?.[key]) || key;
}

(async () => {
  const params = new URLSearchParams(window.location.search);
  const streamUrl = params.get('url') || '';
  const streamTitle = params.get('title') || 'StegoClip Video Player';
  const pageUrl = params.get('pageUrl') || '';
  const kindParam = params.get('kind') || '';
  const initialTime = parseFloat(params.get('t') || '0');

  // Update Header UI
  const titleEl = document.getElementById('playerTitle');
  const domainEl = document.getElementById('playerDomain');
  const btnToggleFs = document.getElementById('btnToggleFs');

  if (titleEl) {
    titleEl.textContent = streamTitle;
    document.title = `${streamTitle} - StegoClip Player`;
  }

  const effectivePageUrl = pageUrl || document.referrer || '';
  if (domainEl && effectivePageUrl) {
    try {
      const hostname = new URL(effectivePageUrl).hostname.replace(/^www\./, '');
      domainEl.textContent = hostname;
      domainEl.style.display = 'inline-block';
    } catch {
      domainEl.style.display = 'none';
    }
  }

  // Load stream headers from storage if available
  let streamHeaders = {};
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    try {
      const stored = await chrome.storage.session.get('active_player_stream');
      if (stored?.active_player_stream?.headers) {
        streamHeaders = stored.active_player_stream.headers;
      }
    } catch {
      // fallback to query headers or pageUrl
    }
  }

  // Resolve headers and apply DNR session rules before playback
  if (typeof StreamSniffer !== 'undefined' && StreamSniffer.resolveStreamHeaders) {
    const effectiveHeaders = StreamSniffer.resolveStreamHeaders(
      { headers: streamHeaders, pageUrl: effectivePageUrl },
      effectivePageUrl
    );

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const msgType =
        typeof getMsgType === 'function' ? getMsgType('APPLY_DNR_RULES') : 'APPLY_DNR_RULES';
      await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: msgType, headers: effectiveHeaders }, () => {
            if (chrome.runtime?.lastError) {
              // ignore context error
            }
            resolve(null);
          });
        } catch {
          resolve(null);
        }
      });
    }
  }

  if (!streamUrl) {
    if (titleEl) titleEl.textContent = 'No stream URL provided.';
    return;
  }

  // Initialize Video.js Player
  const player = videojs('videoPlayer', {
    fluid: false,
    autoplay: true,
    controls: true,
    preload: 'auto',
    playbackRates: [0.5, 0.75, 1, 1.25, 1.5, 2],
    controlBar: {
      children: [
        'playToggle',
        'volumePanel',
        'currentTimeDisplay',
        'timeDivider',
        'durationDisplay',
        'progressControl',
        'playbackRateMenuButton',
        'pictureInPictureToggle',
        'fullscreenToggle'
      ]
    }
  });

  const isHls =
    kindParam === 'hls' ||
    (typeof StreamSniffer !== 'undefined' && StreamSniffer.isM3u8Url(streamUrl));

  if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({
      fLoader: typeof StegoFragmentLoader !== 'undefined' ? StegoFragmentLoader : undefined,
      enableWorker: true
    });

    hls.loadSource(streamUrl);
    hls.attachMedia(player.tech().el_);

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (initialTime > 0) {
        player.currentTime(initialTime);
      }
      player.play().catch(() => {});
    });

    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) {
        console.warn('[StegoClip:Player] Hls fatal error encountered:', data.type);
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      }
    });
  } else {
    // Direct file or native HLS fallback
    const directType = isHls ? 'application/x-mpegURL' : 'video/mp4';
    player.src({ src: streamUrl, type: directType });
    if (initialTime > 0) {
      player.one('loadedmetadata', () => {
        player.currentTime(initialTime);
        player.play().catch(() => {});
      });
    }
  }

  // Fullscreen Button wiring
  if (btnToggleFs) {
    btnToggleFs.addEventListener('click', () => {
      if (player.isFullscreen()) {
        player.exitFullscreen();
      } else {
        player.requestFullscreen();
      }
    });

    player.on('fullscreenchange', () => {
      btnToggleFs.textContent = player.isFullscreen() ? '↙ Exit Fullscreen' : '⛶ Fullscreen';
    });
  }

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    // Avoid interfering if user is focused on an input element
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return;
    }

    switch (e.key) {
      case ' ':
      case 'k':
      case 'K':
        e.preventDefault();
        if (player.paused()) player.play();
        else player.pause();
        break;
      case 'f':
      case 'F':
        e.preventDefault();
        if (player.isFullscreen()) player.exitFullscreen();
        else player.requestFullscreen();
        break;
      case 'm':
      case 'M':
        e.preventDefault();
        player.muted(!player.muted());
        break;
      case 'ArrowLeft':
        e.preventDefault();
        player.currentTime(Math.max(0, player.currentTime() - 5));
        break;
      case 'ArrowRight':
        e.preventDefault();
        player.currentTime(Math.min(player.duration() || 0, player.currentTime() + 5));
        break;
      case 'ArrowUp':
        e.preventDefault();
        player.volume(Math.min(1, player.volume() + 0.1));
        break;
      case 'ArrowDown':
        e.preventDefault();
        player.volume(Math.max(0, player.volume() - 0.1));
        break;
    }
  });
})();
