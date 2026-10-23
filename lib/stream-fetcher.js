/**
 * StreamFetcher utility for StegoClip.
 * Performs quick metadata probes on media streams to discover duration,
 * resolution, and segment counts, while filtering out streams that fail to load.
 */

const StreamFetcher = (() => {
  /** @type {Map<string, any>} */
  const probeCache = new Map();

  function getParser() {
    if (typeof StegoParser !== 'undefined' && StegoParser.PlaylistParser) {
      return StegoParser.PlaylistParser;
    }
    if (typeof globalThis !== 'undefined' && /** @type {any} */ (globalThis).PlaylistParser) {
      return /** @type {any} */ (globalThis).PlaylistParser;
    }
    return null;
  }

  function getTimeUtil() {
    if (typeof StegoTime !== 'undefined') {
      return StegoTime;
    }
    return null;
  }

  /**
   * Probes an HLS playlist manifest to verify accessibility and calculate duration & quality.
   */
  async function probeHls(url, effectiveHeaders, timeoutMs, { isSniffed = false } = {}) {
    const fetchHeaders = { ...(effectiveHeaders || {}) };
    delete fetchHeaders['referer'];
    delete fetchHeaders['origin'];
    delete fetchHeaders['user-agent'];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp;
    try {
      resp = await fetch(url, {
        headers: Object.keys(fetchHeaders).length > 0 ? fetchHeaders : undefined,
        signal: controller.signal
      });
    } catch {
      // Network/CORS block during extension fetch does not mean the stream is dead
      // (a stream captured from page traffic was already running on the page).
      if (isSniffed) {
        return {
          ok: true,
          kind: 'hls',
          protected: true,
          duration: 0,
          formattedDuration: '',
          resolution: null,
          height: 0,
          bitrate: 0,
          segmentCount: 0
        };
      }
      return { ok: false, error: 'Stream could not be reached' };
    } finally {
      clearTimeout(timer);
    }

    // 401 Unauthorized or 403 Forbidden means hotlink protection / headers required,
    // which our player and offscreen downloader handle via declarativeNetRequest.
    // For sniffed streams, non-200 responses (e.g. 404 on Cloudflare protected endpoints)
    // also indicate hotlink protection requiring page referer.
    if (resp.status === 401 || resp.status === 403 || (!resp.ok && isSniffed)) {
      return {
        ok: true,
        kind: 'hls',
        protected: true,
        duration: 0,
        formattedDuration: '',
        resolution: null,
        height: 0,
        bitrate: 0,
        segmentCount: 0
      };
    }

    if (!resp.ok) {
      return { ok: false, error: `HTTP ${resp.status}` };
    }

    const text = await resp.text();
    const parser = getParser();
    const timeUtil = getTimeUtil();

    if (parser && !parser.looksLikeM3u8(text)) {
      if (isSniffed) {
        return {
          ok: true,
          kind: 'hls',
          protected: true,
          duration: 0,
          formattedDuration: '',
          resolution: null,
          height: 0,
          bitrate: 0,
          segmentCount: 0
        };
      }
      return { ok: false, error: 'Not a valid M3U8 playlist' };
    }

    let duration = 0;
    let segmentCount = 0;
    let resolution = null;
    let height = 0;
    let bitrate = 0;

    if (parser && text.includes('#EXT-X-STREAM-INF')) {
      const variants = parser.parseVariants(text, url);
      if (variants.length > 0) {
        const best = variants[0];
        resolution = best.resolution || (best.height ? `${best.height}p` : null);
        height = best.height || 0;
        bitrate = best.bandwidth || 0;

        try {
          const subCtrl = new AbortController();
          const subTimer = setTimeout(() => subCtrl.abort(), Math.min(timeoutMs, 2500));
          const subResp = await fetch(best.url, {
            headers: Object.keys(fetchHeaders).length > 0 ? fetchHeaders : undefined,
            signal: subCtrl.signal
          });
          clearTimeout(subTimer);

          if (subResp.ok) {
            const subText = await subResp.text();
            const timeline = parser.parseManifest(subText, best.url);
            duration = timeline.totalDuration || 0;
            segmentCount = timeline.segments ? timeline.segments.length : 0;
          }
        } catch {}
      }
    } else if (parser) {
      const timeline = parser.parseManifest(text, url);
      duration = timeline.totalDuration || 0;
      segmentCount = timeline.segments ? timeline.segments.length : 0;
    }

    const formattedDuration =
      duration > 0 && timeUtil?.formatDuration ? timeUtil.formatDuration(duration) : '';

    return {
      ok: true,
      kind: 'hls',
      duration,
      formattedDuration,
      resolution,
      height,
      bitrate,
      segmentCount
    };
  }

  /**
   * Probes a direct media file (e.g. mp4, webm) to verify accessibility and extract size/duration.
   */
  async function probeDirect(url, stream, effectiveHeaders, timeoutMs, { isSniffed = false } = {}) {
    let size = stream.size;
    const timeUtil = getTimeUtil();

    try {
      const headCtrl = new AbortController();
      const headTimer = setTimeout(() => headCtrl.abort(), Math.min(timeoutMs, 2500));
      const headResp = await fetch(url, {
        method: 'HEAD',
        signal: headCtrl.signal
      });
      clearTimeout(headTimer);

      if (
        headResp.status === 401 ||
        headResp.status === 403 ||
        (!headResp.ok && isSniffed && headResp.status !== 405)
      ) {
        return {
          ok: true,
          kind: 'direct',
          protected: true,
          duration: 0,
          formattedDuration: '',
          resolution: null,
          height: 0,
          width: 0,
          size,
          formattedSize: size && timeUtil?.formatBytes ? timeUtil.formatBytes(size) : ''
        };
      }

      if (!headResp.ok && headResp.status !== 405) {
        return { ok: false, error: `HTTP ${headResp.status}` };
      }

      const len = headResp.headers.get('content-length');
      if (len) {
        const parsed = parseInt(len, 10);
        if (!isNaN(parsed) && parsed > 0) size = parsed;
      }
    } catch {
      // HEAD may be blocked by CORS or server; fallback to video element metadata probe
    }

    let duration = 0;
    let width = 0;
    let height = 0;

    if (typeof document !== 'undefined' && document.createElement) {
      const meta = await new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;
        let finished = false;

        const cleanup = (result) => {
          if (finished) return;
          finished = true;
          video.removeAttribute('src');
          video.load();
          resolve(result);
        };

        const timer = setTimeout(() => cleanup(null), Math.min(timeoutMs, 3000));
        video.onloadedmetadata = () => {
          clearTimeout(timer);
          cleanup({
            duration: video.duration && isFinite(video.duration) ? video.duration : 0,
            width: video.videoWidth || 0,
            height: video.videoHeight || 0
          });
        };
        video.onerror = () => {
          clearTimeout(timer);
          cleanup({ error: true });
        };
        video.src = url;
      });

      if (meta?.error && !size) {
        if (isSniffed) {
          return {
            ok: true,
            kind: 'direct',
            protected: true,
            duration: 0,
            formattedDuration: '',
            resolution: null,
            height: 0,
            width: 0,
            size,
            formattedSize: size && timeUtil?.formatBytes ? timeUtil.formatBytes(size) : ''
          };
        }
        return { ok: false, error: 'Media element failed to load stream' };
      }

      if (meta && !meta.error) {
        duration = meta.duration || 0;
        width = meta.width || 0;
        height = meta.height || 0;
      }
    }

    const formattedDuration =
      duration > 0 && timeUtil?.formatDuration ? timeUtil.formatDuration(duration) : '';
    const formattedSize = size && timeUtil?.formatBytes ? timeUtil.formatBytes(size) : '';
    const resolution = width && height ? `${width}x${height}` : height ? `${height}p` : null;

    return {
      ok: true,
      kind: 'direct',
      duration,
      formattedDuration,
      resolution,
      height,
      width,
      size,
      formattedSize
    };
  }

  /**
   * Probes an individual stream and caches the result.
   */
  async function probeStream(stream, { timeoutMs = 1500, fallbackPageUrl = '' } = {}) {
    if (!stream?.url) {
      return { ok: false, error: 'Invalid stream URL' };
    }

    if (
      stream.url.includes('/cdn-cgi/challenge-platform/') ||
      stream.url.includes('challenges.cloudflare.com')
    ) {
      return { ok: false, error: 'Challenge platform URL' };
    }

    if (stream.probed && (stream.duration || stream.protected)) {
      return {
        ok: true,
        duration: stream.duration || 0,
        formattedDuration: stream.formattedDuration || '',
        resolution: stream.resolution || '',
        height: stream.height || 0,
        segmentCount: stream.segmentCount || 0,
        size: stream.size,
        formattedSize: stream.formattedSize || '',
        protected: stream.protected || false
      };
    }

    if (probeCache.has(stream.url)) {
      return probeCache.get(stream.url);
    }

    const effectiveHeaders =
      typeof StreamSniffer !== 'undefined' && StreamSniffer.resolveStreamHeaders
        ? StreamSniffer.resolveStreamHeaders(stream, fallbackPageUrl)
        : stream.headers || {};

    const isSniffed = Boolean(
      stream.sniffed ||
      (!stream.manual &&
        (stream.pageUrl || (stream.headers && Object.keys(stream.headers).length > 0)))
    );

    const isDirect =
      stream.kind === 'direct' ||
      /\.(mp4|webm|m4v|m4a|mp3|ogg|wav|mov|mkv)(\?|$)/i.test(stream.url);

    let result;
    try {
      if (isDirect) {
        result = await probeDirect(stream.url, stream, effectiveHeaders, timeoutMs, { isSniffed });
      } else {
        result = await probeHls(stream.url, effectiveHeaders, timeoutMs, { isSniffed });
      }
    } catch (err) {
      result = { ok: false, error: err.message || 'Stream probe failed' };
    }

    probeCache.set(stream.url, result);
    return result;
  }

  /**
   * Probes multiple streams with bounded concurrency, returning only loadable streams with metadata.
   */
  async function probeAndFilterStreams(streams, options = {}) {
    if (!Array.isArray(streams) || streams.length === 0) return [];

    const loadableStreams = [];
    const concurrency = 4;

    for (let i = 0; i < streams.length; i += concurrency) {
      const batch = streams.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(async (stream) => {
          const probe = await probeStream(stream, options);
          if (!probe.ok) return null;

          return {
            ...stream,
            duration: probe.duration || stream.duration || 0,
            formattedDuration: probe.formattedDuration || stream.formattedDuration || '',
            resolution: probe.resolution || stream.resolution || stream.quality || '',
            height: probe.height || stream.height || 0,
            segmentCount: probe.segmentCount || stream.segmentCount || 0,
            size: probe.size || stream.size,
            formattedSize: probe.formattedSize || stream.formattedSize || '',
            protected: probe.protected || false,
            probed: true
          };
        })
      );

      for (const item of batchResults) {
        if (item) loadableStreams.push(item);
      }
    }

    return loadableStreams;
  }

  function clearCache() {
    probeCache.clear();
  }

  return {
    probeStream,
    probeAndFilterStreams,
    clearCache,
    getCache: () => probeCache
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StreamFetcher;
}
