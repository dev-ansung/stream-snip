/**
 * M3U8 Playlist and Manifest Parser.
 */

class Timeline {
  constructor(segments = []) {
    this.segments = segments;
    this.totalDuration = segments.reduce((sum, seg) => sum + (seg.duration || 0), 0);
  }

  getOverlappingSegments(startSec, endSec) {
    const start = Math.max(0, startSec);
    const end = Math.max(start, endSec);

    return this.segments.filter((seg) => {
      return seg.startTime < end && seg.endTime > start;
    });
  }

  /**
   * Computes a safe, bounded clip plan for a requested start and end time.
   * Encapsulates segment selection and relative trim calculation.
   *
   * @param {number} startSec
   * @param {number} endSec
   * @returns {import('../types/domain').ClipPlan}
   */
  getClipPlan(startSec, endSec) {
    const start = Math.max(0, startSec);
    const end = Math.max(start, endSec);
    const segments = this.getOverlappingSegments(start, end);

    if (segments.length === 0) {
      return {
        segments: [],
        firstSegmentStart: 0,
        trimStart: 0,
        trimEnd: 0,
        duration: 0
      };
    }

    const firstSegmentStart = segments[0].startTime;
    // Relative start offset within the first segment: bounded to [0, segment.duration)
    const rawTrimStart = start - firstSegmentStart;
    const trimStart = Math.min(Math.max(0, rawTrimStart), segments[0].duration || 0);
    const duration = Math.max(0, end - start);
    const trimEnd = trimStart + duration;

    return {
      segments,
      firstSegmentStart,
      trimStart,
      trimEnd,
      duration
    };
  }
}

class PlaylistParser {
  /**
   * Parses master playlist into an array of quality variants with resolution, bandwidth, and codecs.
   */
  static parseVariants(masterContent, masterUrl) {
    if (!masterContent.includes('#EXT-X-STREAM-INF')) {
      const resMatch = masterUrl.match(/(2160|1440|1080|720|480|360)p/i);
      if (resMatch) {
        const h = parseInt(resMatch[1], 10);
        return [
          {
            url: masterUrl,
            bandwidth: 0,
            resolution: `${Math.round((h * 16) / 9)}x${h}`,
            height: h,
            label: `${h}p (${Math.round((h * 16) / 9)}x${h})`
          }
        ];
      }

      return [
        {
          url: masterUrl,
          bandwidth: 0,
          resolution: null,
          height: 0,
          label: 'Default (Original Stream)'
        }
      ];
    }

    const lines = masterContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const variants = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const resolutionMatch = line.match(/RESOLUTION=(\d+x\d+)/);
        const codecsMatch = line.match(/CODECS="([^"]+)"/);
        const frameRateMatch = line.match(/FRAME-RATE=([0-9.]+)/);

        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
        const resolution = resolutionMatch ? resolutionMatch[1] : null;
        const codecs = codecsMatch ? codecsMatch[1] : null;
        const frameRate = frameRateMatch ? parseFloat(frameRateMatch[1]) : null;

        let height = 0;
        if (resolution) {
          const parts = resolution.split('x');
          height = parseInt(parts[1], 10) || 0;
        }

        // Next non-comment line is the URI
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (nextLine && !nextLine.startsWith('#')) {
            const resolvedUrl = new URL(nextLine, masterUrl).href;

            let label;
            if (height > 0) {
              label = `${height}p (${resolution})`;
            } else if (resolution) {
              label = resolution;
            } else if (bandwidth > 0) {
              label = `${Math.round(bandwidth / 1000)} kbps`;
            } else {
              label = `Variant ${variants.length + 1}`;
            }

            if (bandwidth > 0 && !label.includes('kbps') && !label.includes('Mbps')) {
              const kbps = Math.round(bandwidth / 1000);
              const mbps = (bandwidth / 1000000).toFixed(1);
              label += bandwidth >= 1000000 ? ` • ${mbps} Mbps` : ` • ${kbps} kbps`;
            }

            if (frameRate && frameRate > 30) {
              label += ` • ${Math.round(frameRate)}fps`;
            }

            variants.push({
              url: resolvedUrl,
              bandwidth,
              resolution,
              height,
              frameRate,
              codecs,
              label
            });
            i = j;
            break;
          }
        }
      }
    }

    variants.sort((a, b) => (b.height || 0) - (a.height || 0) || b.bandwidth - a.bandwidth);
    return variants.length > 0
      ? variants
      : [{ url: masterUrl, bandwidth: 0, resolution: null, height: 0, label: 'Default' }];
  }

  /**
   * Resolves the highest quality media playlist URL from a master playlist text.
   */
  static resolveSubPlaylist(masterContent, masterUrl) {
    const variants = PlaylistParser.parseVariants(masterContent, masterUrl);
    return variants[0].url;
  }

  /**
   * Parses media playlist manifest into a Timeline with indexed media segments.
   */
  static parseManifest(manifestContent, baseUrl) {
    const lines = manifestContent
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const segments = [];

    let cumTime = 0.0;
    let currentDuration = 0.0;
    let segmentIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('#EXTINF:')) {
        const match = line.match(/#EXTINF:([0-9.]+)/);
        if (match) {
          currentDuration = parseFloat(match[1]);
        }
      } else if (line && !line.startsWith('#')) {
        const resolvedUrl = new URL(line, baseUrl).href;
        segments.push({
          index: segmentIndex,
          url: resolvedUrl,
          duration: currentDuration,
          startTime: cumTime,
          endTime: cumTime + currentDuration,
          get start() {
            return this.startTime;
          },
          get end() {
            return this.endTime;
          }
        });
        cumTime += currentDuration;
        segmentIndex++;
      }
    }

    return new Timeline(segments);
  }

  /**
   * Alias for parseManifest for media playlists.
   */
  static parseMediaPlaylist(manifestContent, baseUrl) {
    return PlaylistParser.parseManifest(manifestContent, baseUrl);
  }
}

const StegoParser = { Timeline, PlaylistParser };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoParser;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoParser = StegoParser;
}
