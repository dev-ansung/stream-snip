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

        const maxAttempts = 3;
        while (attempts < maxAttempts && !success) {
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
              const err = new Error(`HTTP ${resp.status} ${resp.statusText}`);
              err.status = resp.status;
              throw err;
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
              const remainingSegments = total - completed;
              const etaSec = Math.round((elapsedSec / Math.max(1, completed)) * remainingSegments);
              onProgress({
                completed,
                total,
                percent: Math.round((completed / total) * 100),
                totalBytes,
                speedBytesPerSec,
                elapsedSec,
                etaSec
              });
            }
          } catch (err) {
            lastError = err;
            if (signal && signal.aborted) throw err;
            if (attempts < maxAttempts) {
              // Exponential backoff: 400ms, 900ms, 2000ms
              const backoffMs = Math.floor(400 * Math.pow(2, attempts - 1) + Math.random() * 150);
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }
        }

        if (!success) {
          throw new Error(
            `Failed downloading segment ${segment.index} after ${maxAttempts} attempts: ${lastError?.message}`
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
    return StegoBytes.concatUint8Arrays(results);
  }

  async saveToFile(bytes, filename, format = 'mp4', duration = 0, options = {}) {
    let outputBytes = bytes;
    let mimeType = 'video/mp4';

    if (format === 'mp3' || filename.endsWith('.mp3')) {
      // Unlike the MP4 path below, there is no sensible fallback container
      // here: the user explicitly asked for audio-only output, so a failed
      // extraction/encode should surface as an error rather than silently
      // saving something else (e.g. the full TS with video still in it).
      if (typeof StegoTransmuxer === 'undefined' || !StegoTransmuxer.transmuxTsToAudioMp4) {
        throw new Error('Audio extraction is unavailable (StegoTransmuxer not loaded).');
      }
      if (typeof StegoMp3Encoder === 'undefined' || !StegoMp3Encoder.encodeMp4ToMp3) {
        throw new Error('MP3 encoding is unavailable (StegoMp3Encoder not loaded).');
      }
      const audioMp4 = StegoTransmuxer.transmuxTsToAudioMp4(bytes, duration, options);
      outputBytes = await StegoMp3Encoder.encodeMp4ToMp3(audioMp4, 192, options);
      mimeType = 'audio/mpeg';
    } else if (format === 'mp4' || filename.endsWith('.mp4')) {
      try {
        if (typeof StegoTransmuxer !== 'undefined' && StegoTransmuxer.transmuxTsToMp4) {
          outputBytes = StegoTransmuxer.transmuxTsToMp4(bytes, duration, options);
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
    const saveAs = options.saveAs !== undefined ? Boolean(options.saveAs) : false;

    if (typeof chrome !== 'undefined' && chrome.downloads && chrome.downloads.download) {
      return new Promise((resolve) => {
        chrome.downloads.download(
          {
            url: blobUrl,
            filename: filename,
            saveAs
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
