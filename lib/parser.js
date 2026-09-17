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

    return this.segments.filter(seg => {
      return seg.startTime < end && seg.endTime > start;
    });
  }
}

class PlaylistParser {
  /**
   * Parses master playlist into an array of quality variants with resolution, bandwidth, and codecs.
   */
  static parseVariants(masterContent, masterUrl) {
    if (!masterContent.includes("#EXT-X-STREAM-INF")) {
      return [{
        url: masterUrl,
        bandwidth: 0,
        resolution: null,
        height: 0,
        label: "Default (Original Stream)"
      }];
    }

    const lines = masterContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const variants = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
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
          if (nextLine && !nextLine.startsWith("#")) {
            const resolvedUrl = new URL(nextLine, masterUrl).href;

            let label = "";
            if (height > 0) {
              label = `${height}p (${resolution})`;
            } else if (resolution) {
              label = resolution;
            } else if (bandwidth > 0) {
              label = `${Math.round(bandwidth / 1000)} kbps`;
            } else {
              label = `Variant ${variants.length + 1}`;
            }

            if (bandwidth > 0 && !label.includes("kbps") && !label.includes("Mbps")) {
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
    return variants.length > 0 ? variants : [{ url: masterUrl, bandwidth: 0, resolution: null, height: 0, label: "Default" }];
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
    const lines = manifestContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const segments = [];

    let cumTime = 0.0;
    let currentDuration = 0.0;
    let segmentIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith("#EXTINF:")) {
        const match = line.match(/#EXTINF:([0-9.]+)/);
        if (match) {
          currentDuration = parseFloat(match[1]);
        }
      } else if (line && !line.startsWith("#")) {
        const resolvedUrl = new URL(line, baseUrl).href;
        segments.push({
          index: segmentIndex,
          url: resolvedUrl,
          duration: currentDuration,
          startTime: cumTime,
          endTime: cumTime + currentDuration
        });
        cumTime += currentDuration;
        segmentIndex++;
      }
    }

    return new Timeline(segments);
  }
}

const StegoParser = { Timeline, PlaylistParser };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoParser;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoParser = StegoParser;
}
