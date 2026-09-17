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
   * Resolves a variant media playlist URL from a master playlist text.
   * If master_content does not contain #EXT-X-STREAM-INF, returns master_url directly.
   */
  static resolveSubPlaylist(masterContent, masterUrl) {
    if (!masterContent.includes("#EXT-X-STREAM-INF")) {
      return masterUrl;
    }

    const lines = masterContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const variants = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        const bandwidth = bandwidthMatch ? parseInt(bandwidthMatch[1], 10) : 0;
        
        // Next non-comment line is the URI
        for (let j = i + 1; j < lines.length; j++) {
          const nextLine = lines[j];
          if (nextLine && !nextLine.startsWith("#")) {
            const resolvedUrl = new URL(nextLine, masterUrl).href;
            variants.push({ bandwidth, url: resolvedUrl });
            i = j;
            break;
          }
        }
      }
    }

    if (variants.length > 0) {
      // Sort descending by bandwidth
      variants.sort((a, b) => b.bandwidth - a.bandwidth);
      return variants[0].url;
    }

    return masterUrl;
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
