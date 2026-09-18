/**
 * Concurrent HLS Segment Downloader, Steganography Assembler & MP4 Transmuxer.
 */

class SegmentDownloader {
  constructor(options = {}) {
    this.concurrency = options.concurrency || 6;
  }

  async downloadSegments(segments, headers = {}, onProgress = null, signal = null) {
    const total = segments.length;
    let completed = 0;
    let totalBytes = 0;
    const startTime = Date.now();
    const results = new Array(total);

    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < total) {
        if (signal && signal.aborted) {
          throw new Error('Download aborted by user.');
        }

        const currentIndex = nextIndex++;
        const segment = segments[currentIndex];

        let attempts = 0;
        let success = false;
        let lastError = null;

        while (attempts < 3 && !success) {
          if (signal && signal.aborted) throw new Error('Download aborted.');
          attempts++;
          try {
            const reqHeaders = { ...headers };
            delete reqHeaders['host'];
            delete reqHeaders['content-length'];

            const resp = await fetch(segment.url, {
              headers: reqHeaders,
              signal: signal
            });

            if (!resp.ok) {
              throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
            }

            const rawBuffer = await resp.arrayBuffer();
            const cleanBytes = StegoDecoder.stripStego(new Uint8Array(rawBuffer));

            results[currentIndex] = cleanBytes;
            totalBytes += cleanBytes.byteLength;
            completed++;
            success = true;

            if (onProgress) {
              const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
              const speedBytesPerSec = totalBytes / elapsedSec;
              onProgress({
                completed,
                total,
                percent: Math.round((completed / total) * 100),
                totalBytes,
                speedBytesPerSec
              });
            }
          } catch (err) {
            lastError = err;
            if (signal && signal.aborted) throw err;
            await new Promise((r) => setTimeout(r, 400 * attempts));
          }
        }

        if (!success) {
          throw new Error(
            `Failed downloading segment ${segment.index} after 3 attempts: ${lastError?.message}`
          );
        }
      }
    };

    const workers = [];
    const poolSize = Math.min(this.concurrency, total);
    for (let i = 0; i < poolSize; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);

    // Assemble all clean chunks in order
    const merged = new Uint8Array(totalBytes);
    let offset = 0;
    for (let i = 0; i < total; i++) {
      const chunk = results[i];
      if (chunk) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
    }

    return merged;
  }

  async saveToFile(bytes, filename, format = 'mp4', duration = 0) {
    let outputBytes = bytes;
    let mimeType = 'video/mp4';

    if (format === 'mp4' || filename.endsWith('.mp4')) {
      try {
        if (typeof StegoTransmuxer !== 'undefined' && StegoTransmuxer.transmuxTsToMp4) {
          outputBytes = StegoTransmuxer.transmuxTsToMp4(bytes, duration);
          mimeType = 'video/mp4';
        }
      } catch (err) {
        console.warn('Transmux to MP4 failed, falling back to TS container:', err);
        mimeType = 'video/mp2t';
      }
    } else {
      mimeType = 'video/mp2t';
    }

    const blob = new Blob([outputBytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);

    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      return new Promise((resolve) => {
        chrome.downloads.download(
          {
            url: blobUrl,
            filename: filename,
            saveAs: true
          },
          (downloadId) => {
            if (typeof chrome.downloads.onChanged !== 'undefined') {
              const onChangedListener = (delta) => {
                if (
                  delta.id === downloadId &&
                  (delta.state?.current === 'complete' || delta.state?.current === 'interrupted')
                ) {
                  chrome.downloads.onChanged.removeListener(onChangedListener);
                  try {
                    URL.revokeObjectURL(blobUrl);
                  } catch {}
                }
              };
              chrome.downloads.onChanged.addListener(onChangedListener);
            }
            setTimeout(() => {
              try {
                URL.revokeObjectURL(blobUrl);
              } catch {}
            }, 30000);
            resolve(downloadId);
          }
        );
      });
    } else {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      return null;
    }
  }
}

const StegoDownloader = { SegmentDownloader };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoDownloader;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoDownloader = StegoDownloader;
}
