/**
 * Dedicated Fullscreen Video.js Player & Clipper Controller for StegoClip.
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

  // UI Elements
  const titleEl = document.getElementById('playerTitle');
  const domainEl = document.getElementById('playerDomain');
  const btnToggleFs = document.getElementById('btnToggleFs');

  const playerResolutionEl = document.getElementById('playerResolution');
  const playerDurationEl = document.getElementById('playerDuration');

  const clipStartInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('clipStart')
  );
  const clipEndInput = /** @type {HTMLInputElement | null} */ (document.getElementById('clipEnd'));
  const btnSetStart = document.getElementById('btnSetStart');
  const btnSetEnd = document.getElementById('btnSetEnd');
  const fullVideoToggle = /** @type {HTMLInputElement | null} */ (
    document.getElementById('fullVideoToggle')
  );

  const qualityField = document.getElementById('qualityField');
  const qualitySelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('qualitySelect')
  );
  const formatSelect = /** @type {HTMLSelectElement | null} */ (
    document.getElementById('formatSelect')
  );
  const clipFilenameInput = /** @type {HTMLInputElement | null} */ (
    document.getElementById('clipFilename')
  );

  const btnDownload = /** @type {HTMLButtonElement | null} */ (
    document.getElementById('btnDownload')
  );
  const btnCancel = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnCancel'));

  const progressContainer = document.getElementById('progressContainer');
  const downloadProgress = /** @type {HTMLProgressElement | null} */ (
    document.getElementById('downloadProgress')
  );
  const progressPercent = document.getElementById('progressPercent');
  const progressStatus = document.getElementById('progressStatus');
  const progressSpeed = document.getElementById('progressSpeed');

  if (titleEl) {
    titleEl.textContent = streamTitle;
    document.title = `${streamTitle} - StegoClip Player`;
  }

  // Pre-fill sanitized filename
  if (clipFilenameInput) {
    const clean =
      typeof StegoTime !== 'undefined' && StegoTime.cleanTitleForFilename
        ? StegoTime.cleanTitleForFilename(streamTitle)
        : streamTitle.replace(/[^\w.-]/g, '_');
    clipFilenameInput.value = clean || 'video_clip';
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

  // Load stream headers from session storage if available
  let streamHeaders = {};
  if (typeof chrome !== 'undefined' && chrome.storage?.session) {
    try {
      const stored = await chrome.storage.session.get('active_player_stream');
      if (stored?.active_player_stream?.headers) {
        streamHeaders = stored.active_player_stream.headers;
      }
    } catch {
      // fallback
    }
  }

  let effectiveHeaders = {};
  if (typeof StreamSniffer !== 'undefined' && StreamSniffer.resolveStreamHeaders) {
    effectiveHeaders = StreamSniffer.resolveStreamHeaders(
      { headers: streamHeaders, pageUrl: effectivePageUrl },
      effectivePageUrl
    );

    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      const msgType = getMsgType('APPLY_DNR_RULES');
      await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: msgType, headers: effectiveHeaders }, () =>
            resolve(null)
          );
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

  let parsedTimeline = null;
  let activeVariantUrl = streamUrl;
  let activeTaskId = null;
  let mediaDurationSec = 0;

  function updateDurationDisplay(dur) {
    if (!dur || isNaN(dur) || dur <= 0) return;
    mediaDurationSec = dur;
    if (playerDurationEl) {
      playerDurationEl.textContent =
        typeof StegoTime !== 'undefined' ? StegoTime.formatDuration(dur) : `${Math.round(dur)}s`;
    }
    if (fullVideoToggle?.checked && clipEndInput) {
      clipEndInput.value =
        typeof StegoTime !== 'undefined' ? StegoTime.formatDuration(dur) : `${Math.round(dur)}`;
    }
  }

  function updateResolutionDisplay(w, h) {
    if (w && h && playerResolutionEl) {
      playerResolutionEl.textContent = `${w}x${h}`;
    }
  }

  // Full Video Toggle synchronization
  if (fullVideoToggle) {
    fullVideoToggle.addEventListener('change', () => {
      if (fullVideoToggle.checked) {
        if (clipStartInput) clipStartInput.value = '00:00';
        if (clipEndInput && mediaDurationSec > 0) {
          clipEndInput.value =
            typeof StegoTime !== 'undefined'
              ? StegoTime.formatDuration(mediaDurationSec)
              : String(Math.round(mediaDurationSec));
        }
      }
    });
  }

  // Set Start / Set End buttons
  if (btnSetStart) {
    btnSetStart.addEventListener('click', () => {
      const cur = player.currentTime() || 0;
      if (clipStartInput) {
        clipStartInput.value =
          typeof StegoTime !== 'undefined'
            ? StegoTime.formatDuration(cur)
            : String(Math.round(cur));
      }
      if (fullVideoToggle) fullVideoToggle.checked = false;
    });
  }

  if (btnSetEnd) {
    btnSetEnd.addEventListener('click', () => {
      const cur = player.currentTime() || 0;
      if (clipEndInput) {
        clipEndInput.value =
          typeof StegoTime !== 'undefined'
            ? StegoTime.formatDuration(cur)
            : String(Math.round(cur));
      }
      if (fullVideoToggle) fullVideoToggle.checked = false;
    });
  }

  // Range text inputs clear Full Video toggle when edited
  if (clipStartInput) {
    clipStartInput.addEventListener('input', () => {
      if (fullVideoToggle) fullVideoToggle.checked = false;
    });
  }
  if (clipEndInput) {
    clipEndInput.addEventListener('input', () => {
      if (fullVideoToggle) fullVideoToggle.checked = false;
    });
  }

  if (isHls && typeof Hls !== 'undefined' && Hls.isSupported()) {
    const hls = new Hls({
      fLoader: typeof StegoFragmentLoader !== 'undefined' ? StegoFragmentLoader : undefined,
      enableWorker: true
    });

    hls.loadSource(streamUrl);
    hls.attachMedia(player.tech().el_);

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      if (initialTime > 0) {
        player.currentTime(initialTime);
      }
      player.play().catch(() => {});

      if (data?.levels && data.levels.length > 0) {
        if (qualitySelect && qualityField) {
          qualitySelect.innerHTML = '';
          data.levels.forEach((lvl, idx) => {
            const opt = document.createElement('option');
            opt.value = String(idx);
            const res = lvl.height ? `${lvl.height}p` : `${lvl.width}x${lvl.height}`;
            const kbps = lvl.bitrate ? ` (${Math.round(lvl.bitrate / 1000)} kbps)` : '';
            opt.textContent = `${res}${kbps}`;
            qualitySelect.appendChild(opt);
          });
          if (data.levels.length > 1) {
            qualityField.style.display = 'flex';
          }
        }
        const lvl0 = data.levels[0];
        if (lvl0.width && lvl0.height) {
          updateResolutionDisplay(lvl0.width, lvl0.height);
        }
      }
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
      if (data.details?.totalduration) {
        updateDurationDisplay(data.details.totalduration);
      }
    });

    if (qualitySelect) {
      qualitySelect.addEventListener('change', () => {
        const lvlIdx = parseInt(qualitySelect.value, 10);
        if (!isNaN(lvlIdx) && hls.levels[lvlIdx]) {
          hls.currentLevel = lvlIdx;
          const lvl = hls.levels[lvlIdx];
          if (lvl.url) activeVariantUrl = lvl.url;
          if (lvl.width && lvl.height) updateResolutionDisplay(lvl.width, lvl.height);
        }
      });
    }

    hls.on(Hls.Events.ERROR, (_event, data) => {
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

  player.on('loadedmetadata', () => {
    const dur = player.duration();
    if (dur && !isNaN(dur)) updateDurationDisplay(dur);
    const techEl = player.tech().el_;
    if (techEl && techEl.videoWidth > 0 && techEl.videoHeight > 0) {
      updateResolutionDisplay(techEl.videoWidth, techEl.videoHeight);
    }
  });

  // Parse HLS timeline for clipping if needed
  async function fetchAndParseTimeline(targetUrl) {
    if (parsedTimeline) return parsedTimeline;
    try {
      const resp = await fetch(targetUrl, { headers: effectiveHeaders });
      const manifestText = await resp.text();
      let mediaManifestUrl = targetUrl;
      let mediaManifestText = manifestText;

      if (typeof PlaylistParser !== 'undefined') {
        if (manifestText.includes('#EXT-X-STREAM-INF')) {
          mediaManifestUrl = PlaylistParser.resolveSubPlaylist(manifestText, targetUrl);
          const subResp = await fetch(mediaManifestUrl, { headers: effectiveHeaders });
          mediaManifestText = await subResp.text();
        }
        parsedTimeline = PlaylistParser.parseManifest(mediaManifestText, mediaManifestUrl);
        return parsedTimeline;
      }
    } catch (err) {
      console.warn('[StegoClip:Player] Failed parsing timeline manifest:', err);
    }
    return null;
  }

  // Download Trigger
  if (btnDownload) {
    btnDownload.addEventListener('click', async () => {
      let startSec = 0;
      let endSec = mediaDurationSec || player.duration() || 0;

      if (!fullVideoToggle?.checked) {
        try {
          if (clipStartInput?.value && typeof StegoTime !== 'undefined') {
            startSec = StegoTime.parseTimestamp(clipStartInput.value);
          }
          if (clipEndInput?.value && typeof StegoTime !== 'undefined') {
            endSec = StegoTime.parseTimestamp(clipEndInput.value);
          }
        } catch (err) {
          alert(`Invalid time input: ${err.message}`);
          return;
        }
      }

      if (endSec > 0 && startSec >= endSec) {
        alert('Start time must be less than end time.');
        return;
      }

      btnDownload.disabled = true;
      if (btnCancel) btnCancel.style.display = 'inline-flex';
      if (progressContainer) progressContainer.style.display = 'flex';
      if (downloadProgress) downloadProgress.value = 0;
      if (progressPercent) progressPercent.textContent = '0%';
      if (progressStatus) progressStatus.textContent = 'Preparing download...';
      if (progressSpeed) progressSpeed.textContent = '';

      activeTaskId = `task_${Date.now()}`;
      const fmt = formatSelect ? formatSelect.value : 'mp4';
      const baseName =
        (clipFilenameInput?.value || '').trim().replace(/\.(mp4|ts|mp3)$/i, '') || 'video_clip';
      const filename = `${baseName}.${fmt}`;

      const taskMeta = {
        id: activeTaskId,
        url: activeVariantUrl,
        pageUrl: effectivePageUrl,
        filename,
        format: fmt,
        kind: isHls ? 'hls' : 'direct',
        status: 'downloading',
        duration: endSec - startSec
      };

      try {
        if (isHls) {
          const timeline = await fetchAndParseTimeline(activeVariantUrl);
          if (!timeline) {
            throw new Error('Could not parse HLS media playlist.');
          }

          const clipPlan = timeline.getClipPlan(startSec, endSec);
          if (!clipPlan.segments || clipPlan.segments.length === 0) {
            throw new Error('No segments found in the selected range.');
          }

          chrome.runtime.sendMessage({
            type: getMsgType('START_DOWNLOAD'),
            taskId: activeTaskId,
            task: taskMeta,
            segments: clipPlan.segments,
            effectiveHeaders,
            clipPlan,
            isDirect: false,
            concurrency: 6
          });
        } else {
          chrome.runtime.sendMessage({
            type: getMsgType('START_DOWNLOAD'),
            taskId: activeTaskId,
            task: taskMeta,
            effectiveHeaders,
            isDirect: true
          });
        }
      } catch (err) {
        alert(`Download start failed: ${err.message}`);
        btnDownload.disabled = false;
        if (btnCancel) btnCancel.style.display = 'none';
        if (progressContainer) progressContainer.style.display = 'none';
      }
    });
  }

  // Cancel Trigger
  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      if (activeTaskId) {
        chrome.runtime.sendMessage({
          type: getMsgType('CANCEL_DOWNLOAD'),
          taskId: activeTaskId
        });
        if (progressStatus) progressStatus.textContent = 'Cancelling download...';
      }
    });
  }

  // Listen for progress & completion from background offscreen runner
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (!msg || msg.taskId !== activeTaskId) return;

      if (msg.type === getMsgType('DOWNLOAD_PROGRESS') && msg.progress) {
        const p = msg.progress;
        if (downloadProgress && p.percent != null) {
          downloadProgress.value = p.percent;
        }
        if (progressPercent && p.percent != null) {
          progressPercent.textContent = `${p.percent}%`;
        }
        const mb = (p.totalBytes / (1024 * 1024)).toFixed(1);
        const speedMb = ((p.speedBytesPerSec || 0) / (1024 * 1024)).toFixed(1);

        if (progressStatus) {
          if (p.completed && p.total) {
            progressStatus.textContent = `Downloaded ${p.completed}/${p.total} segments • ${mb} MB`;
          } else {
            progressStatus.textContent = `Downloaded ${mb} MB`;
          }
        }
        if (progressSpeed) {
          progressSpeed.textContent = `${speedMb} MB/s`;
        }
      }

      if (msg.type === getMsgType('DOWNLOAD_COMPLETE')) {
        const res = msg.result || {};
        if (btnDownload) btnDownload.disabled = false;
        if (btnCancel) btnCancel.style.display = 'none';

        if (res.success) {
          if (downloadProgress) downloadProgress.value = 100;
          if (progressPercent) progressPercent.textContent = '100%';
          if (progressStatus) {
            progressStatus.textContent = `✅ Saved ${res.filename || 'file'} successfully!`;
          }
          if (progressSpeed) progressSpeed.textContent = '';
        } else if (res.cancelled) {
          if (res.savedPartial) {
            if (progressStatus) {
              progressStatus.textContent = `⚠️ Cancelled: Saved partial MP4 (${res.filename})`;
            }
          } else {
            if (progressStatus) progressStatus.textContent = '⚠️ Download cancelled.';
          }
          if (progressSpeed) progressSpeed.textContent = '';
        } else {
          if (progressStatus) {
            progressStatus.textContent = `❌ Download failed: ${res.error || 'Unknown error'}`;
          }
        }
        activeTaskId = null;
      }
    });
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
      case '[':
        e.preventDefault();
        if (btnSetStart) btnSetStart.click();
        break;
      case ']':
        e.preventDefault();
        if (btnSetEnd) btnSetEnd.click();
        break;
    }
  });
})();
