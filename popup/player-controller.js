/**
 * Video player and HLS lifecycle controller for StegoClip.
 */

class PlayerControllerClass {
  constructor() {
    this.videoEl = null;
    this.hls = null;
    this.callbacks = {};
    this.boundVideoListeners = [];

    this.mediaInfo = {
      width: 0,
      height: 0,
      bitrate: 0,
      videoCodec: '',
      audioCodec: '',
      totalDuration: 0,
      segmentCount: 0,
      avgSegmentDuration: 0
    };
  }

  init(videoEl, callbacks = {}) {
    this.videoEl = videoEl;
    this.callbacks = callbacks;
    this.pendingSeekTime = null;

    if (this.videoEl) {
      const metadataHandler = () => {
        if (this.videoEl.duration && !isNaN(this.videoEl.duration)) {
          this.mediaInfo.totalDuration = this.videoEl.duration;
        }
        this.handleDimensionsChange();
        this.applyPendingSeek();
      };
      const events = ['loadedmetadata', 'resize', 'canplay', 'playing'];
      events.forEach((ev) => {
        this.videoEl.addEventListener(ev, metadataHandler);
        this.boundVideoListeners.push({ event: ev, handler: metadataHandler });
      });
    }
  }

  applyPendingSeek() {
    if (typeof this.pendingSeekTime === 'number' && this.videoEl && this.videoEl.readyState >= 1) {
      const target = this.pendingSeekTime;
      this.pendingSeekTime = null;
      try {
        this.videoEl.currentTime = target;
        console.info(`[StegoClip:PlayerController] Applied queued seek: ${target}s`);
      } catch (err) {
        console.warn('[StegoClip:PlayerController] Error applying queued seek:', err);
      }
    }
  }

  handleDimensionsChange() {
    if (!this.videoEl) return;
    if (this.videoEl.videoWidth > 0 && this.videoEl.videoHeight > 0) {
      this.mediaInfo.width = this.videoEl.videoWidth;
      this.mediaInfo.height = this.videoEl.videoHeight;
      this.notifyMediaInfo();
    }
  }

  notifyMediaInfo() {
    if (typeof this.callbacks.onMediaInfoChanged === 'function') {
      this.callbacks.onMediaInfoChanged({ ...this.mediaInfo });
    }
  }

  notifyStatus(status) {
    if (typeof this.callbacks.onStatusChanged === 'function') {
      this.callbacks.onStatusChanged(status);
    }
  }

  resetMediaInfo() {
    this.pendingSeekTime = null;
    this.mediaInfo.width = 0;
    this.mediaInfo.height = 0;
    this.mediaInfo.bitrate = 0;
    this.mediaInfo.videoCodec = '';
    this.mediaInfo.audioCodec = '';
    this.mediaInfo.totalDuration = 0;
    this.mediaInfo.segmentCount = 0;
    this.mediaInfo.avgSegmentDuration = 0;
    this.notifyMediaInfo();
  }

  getMediaInfo() {
    return { ...this.mediaInfo };
  }

  getDuration() {
    if (this.videoEl && !isNaN(this.videoEl.duration) && this.videoEl.duration > 0) {
      return this.videoEl.duration;
    }
    return this.mediaInfo.totalDuration || 0;
  }

  getCurrentTime() {
    return this.videoEl && !isNaN(this.videoEl.currentTime) ? this.videoEl.currentTime : 0;
  }

  setCurrentTime(seconds) {
    if (this.videoEl && !isNaN(seconds)) {
      this.videoEl.currentTime = seconds;
    }
  }

  seekTo(seconds, driftThreshold = 0.5) {
    if (!this.videoEl || isNaN(seconds)) return false;

    // Queue seek if video stream metadata is not yet available
    if (this.videoEl.readyState < 1) {
      console.info(
        `[StegoClip:PlayerController] Preview not ready (readyState: ${this.videoEl.readyState}). Queued seek: ${seconds}s`
      );
      this.pendingSeekTime = seconds;
      return true;
    }

    const cur = this.videoEl.currentTime || 0;
    if (Math.abs(cur - seconds) > driftThreshold) {
      try {
        this.videoEl.currentTime = seconds;
        console.info(`[StegoClip:PlayerController] Preview seek applied to: ${seconds}s`);
        return true;
      } catch (err) {
        console.warn('[StegoClip:PlayerController] Error seeking preview video:', err);
      }
    }
    return false;
  }

  loadVariant(variant) {
    this.resetMediaInfo();

    if (variant.height) this.mediaInfo.height = variant.height;
    if (variant.resolution) {
      const [w, h] = variant.resolution.split('x').map(Number);
      if (w && h) {
        this.mediaInfo.width = w;
        this.mediaInfo.height = h;
      }
    }
    if (variant.bandwidth) this.mediaInfo.bitrate = variant.bandwidth;
    if (variant.codecs) {
      const [v, a] = variant.codecs.split(',');
      if (v) this.mediaInfo.videoCodec = v.trim();
      if (a) this.mediaInfo.audioCodec = a.trim();
    }
    this.notifyMediaInfo();
    this.notifyStatus('Loading manifest...');

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const config = {
        enableWorker: true,
        lowLatencyMode: false
      };
      if (typeof StegoFragmentLoader !== 'undefined') {
        config.fLoader = StegoFragmentLoader;
      }

      this.hls = new Hls(config);
      this.hls.loadSource(variant.url);
      if (this.videoEl) {
        this.hls.attachMedia(this.videoEl);
      }

      this.hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        this.notifyStatus('Preview ready');
        if (data.levels && data.levels[0]) {
          const lvl = data.levels[0];
          if (lvl.width && lvl.height) {
            this.mediaInfo.width = lvl.width;
            this.mediaInfo.height = lvl.height;
          }
          if (lvl.bitrate && !this.mediaInfo.bitrate) {
            this.mediaInfo.bitrate = lvl.bitrate;
          }
          this.notifyMediaInfo();
        }
      });

      this.hls.on(Hls.Events.BUFFER_CREATED, (_event, data) => {
        if (data.tracks) {
          if (data.tracks.video?.metadata) {
            this.mediaInfo.width = data.tracks.video.metadata.width || this.mediaInfo.width;
            this.mediaInfo.height = data.tracks.video.metadata.height || this.mediaInfo.height;
          }
          if (data.tracks.video?.codec) {
            this.mediaInfo.videoCodec = data.tracks.video.codec;
          }
          if (data.tracks.audio?.codec) {
            this.mediaInfo.audioCodec = data.tracks.audio.codec;
          }
          this.notifyMediaInfo();
        }
      });

      this.hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        if (data.details) {
          if (data.details.totalduration) {
            this.mediaInfo.totalDuration = data.details.totalduration;
          }
          if (data.details.fragments) {
            this.mediaInfo.segmentCount = data.details.fragments.length;
            this.mediaInfo.avgSegmentDuration =
              data.details.targetduration ||
              data.details.totalduration / data.details.fragments.length;
          }
        }
        const lvl = this.hls.levels[data.level];
        if (lvl) {
          if (lvl.bitrate && !this.mediaInfo.bitrate) this.mediaInfo.bitrate = lvl.bitrate;
          if (lvl.width && lvl.height) {
            this.mediaInfo.width = lvl.width;
            this.mediaInfo.height = lvl.height;
          }
        }
        this.notifyMediaInfo();
      });

      this.hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
        if (data.frag && data.frag.stats && data.frag.duration > 0) {
          const fragBytes = data.frag.stats.total;
          const dur = data.frag.duration;
          if (fragBytes > 0 && dur > 0) {
            const measuredBps = Math.round((fragBytes * 8) / dur);
            if (!this.mediaInfo.bitrate || this.mediaInfo.bitrate === 0) {
              this.mediaInfo.bitrate = measuredBps;
              this.notifyMediaInfo();
            }
          }
        }
      });

      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          console.warn('[PlayerController] HLS fatal error:', data);
          if (typeof this.callbacks.onError === 'function') {
            this.callbacks.onError(data);
          }
        }
      });
    } else if (this.videoEl && this.videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      this.videoEl.src = variant.url;
    }
  }

  destroy() {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.videoEl) {
      this.boundVideoListeners.forEach(({ event, handler }) => {
        this.videoEl.removeEventListener(event, handler);
      });
      this.boundVideoListeners = [];
      this.videoEl.src = '';
    }
    this.resetMediaInfo();
  }
}

const PlayerController = new PlayerControllerClass();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PlayerControllerClass, PlayerController };
}
if (typeof globalThis !== 'undefined') {
  globalThis.PlayerController = PlayerController;
}
