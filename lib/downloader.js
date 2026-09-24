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
          return;
        }

        const currentIndex = nextIndex++;
        const segment = segments[currentIndex];

        let attempts = 0;
        let success = false;
        let lastError = null;

        const maxAttempts = 3;
        while (attempts < maxAttempts && !success) {
          if (signal && signal.aborted) return;
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
            if (signal && signal.aborted) return;
            if (attempts < maxAttempts) {
              // Exponential backoff: 400ms, 900ms, 2000ms
              const backoffMs = Math.floor(400 * Math.pow(2, attempts - 1) + Math.random() * 150);
              await new Promise((r) => setTimeout(r, backoffMs));
            }
          }
        }

        if (!success) {
          if (signal && signal.aborted) return;
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

    if (signal && signal.aborted) {
      let partialBytes = null;
      let completedCount = 0;
      let partialDuration = 0;
      const validChunks = [];
      for (let i = 0; i < total; i++) {
        if (!results[i]) break;
        validChunks.push(results[i]);
        completedCount++;
        if (segments[i]?.duration) {
          partialDuration += segments[i].duration;
        }
      }
      if (validChunks.length === 0) {
        for (let i = 0; i < total; i++) {
          if (results[i]) {
            validChunks.push(results[i]);
            completedCount++;
            if (segments[i]?.duration) {
              partialDuration += segments[i].duration;
            }
          }
        }
      }
      if (validChunks.length > 0) {
        const validTotalBytes = validChunks.reduce((acc, c) => acc + c.byteLength, 0);
        partialBytes =
          typeof StegoBytes !== 'undefined' && StegoBytes.concatUint8Arrays
            ? StegoBytes.concatUint8Arrays(validChunks)
            : concatChunks(validChunks, validTotalBytes);
      }
      const abortErr = new Error('Download aborted by user.');
      abortErr.name = 'AbortError';
      /** @type {any} */ (abortErr).aborted = true;
      /** @type {any} */ (abortErr).partialBytes = partialBytes;
      /** @type {any} */ (abortErr).completedSegments = completedCount;
      /** @type {any} */ (abortErr).partialDuration = partialDuration;
      throw abortErr;
    }

    // Assemble all clean chunks in order
    if (typeof StegoBytes !== 'undefined' && StegoBytes.concatUint8Arrays) {
      return StegoBytes.concatUint8Arrays(results);
    }
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

  async saveToFile(bytes, filename, format = 'mp4', duration = 0, options = {}) {
    let outputBytes = bytes;
    let mimeType = 'video/mp4';

    if (format === 'mp3' || filename.endsWith('.mp3')) {
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

    return this._downloadBlob(outputBytes, filename, mimeType, options.saveAs);
  }

  /**
   * Fetches a direct (non-HLS) media URL in full — no segments, no
   * transmuxing, since it's already a complete, valid container. Used for
   * streams the sniffer classifies as "direct" (see lib/stream-sniffer.js).
   */
  async downloadDirectFile(url, headers = {}, onProgress = null, signal = null) {
    const reqHeaders = { ...headers };
    delete reqHeaders['host'];
    delete reqHeaders['content-length'];

    const resp = await fetch(url, { headers: reqHeaders, signal });
    if (!resp.ok) {
      const err = new Error(`HTTP ${resp.status} ${resp.statusText}`);
      err.status = resp.status;
      throw err;
    }

    const contentType = resp.headers?.get?.('content-type') || '';
    const contentLengthHeader = resp.headers?.get?.('content-length');
    const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : null;

    const reader = resp.body?.getReader?.();
    if (!reader) {
      // Environment without a streaming body — fall back to one read.
      const buffer = await resp.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (onProgress) {
        onProgress({
          completed: bytes.byteLength,
          total: totalBytes,
          percent: 100,
          totalBytes: bytes.byteLength,
          speedBytesPerSec: 0
        });
      }
      return { bytes, contentType };
    }

    const chunks = [];
    let received = 0;
    const startTime = Date.now();

    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          if (onProgress) {
            const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
            onProgress({
              completed: received,
              total: totalBytes,
              percent: totalBytes ? Math.round((received / totalBytes) * 100) : null,
              totalBytes: received,
              speedBytesPerSec: received / elapsedSec
            });
          }
        }
        if (done) break;
      }
    } catch (err) {
      if (!signal?.aborted) throw err;
    }

    if (signal?.aborted) {
      let partialBytes = null;
      if (chunks.length > 0) {
        partialBytes =
          typeof StegoBytes !== 'undefined' && StegoBytes.concatUint8Arrays
            ? StegoBytes.concatUint8Arrays(chunks)
            : concatChunks(chunks, received);
      }
      const abortErr = new Error('Download aborted by user.');
      abortErr.name = 'AbortError';
      /** @type {any} */ (abortErr).aborted = true;
      /** @type {any} */ (abortErr).partialBytes = partialBytes;
      /** @type {any} */ (abortErr).contentType = contentType;
      throw abortErr;
    }

    const bytes =
      typeof StegoBytes !== 'undefined' && StegoBytes.concatUint8Arrays
        ? StegoBytes.concatUint8Arrays(chunks)
        : concatChunks(chunks, received);

    return { bytes, contentType };
  }

  /**
   * Saves already-complete bytes as-is (no transmuxing) — the direct-file
   * counterpart to saveToFile's HLS/TS pipeline.
   */
  async saveDirectFile(bytes, filename, mimeType = 'application/octet-stream', options = {}) {
    return this._downloadBlob(bytes, filename, mimeType, options.saveAs);
  }

  async _downloadBlob(outputBytes, filename, mimeType, saveAsOption) {
    const blob = new Blob([outputBytes], { type: mimeType });
    const blobUrl = URL.createObjectURL(blob);
    const saveAs = saveAsOption !== undefined ? Boolean(saveAsOption) : false;

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

function concatChunks(chunks, totalLength) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

const StegoDownloader = { SegmentDownloader };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = StegoDownloader;
}
if (typeof globalThis !== 'undefined') {
  globalThis.StegoDownloader = StegoDownloader;
}
