/**
 * Custom Hls.js Fragment Loader with automatic Steganography Stripping.
 *
 * Intercepts downloaded fragment buffers and strips dummy PNG headers before
 * handing the MPEG-TS stream data over to Hls.js's internal demuxer.
 */

class StegoFragmentLoader extends Hls.DefaultConfig.loader {
  constructor(config) {
    super(config);
  }

  load(context, config, callbacks) {
    const originalSuccess = callbacks.onSuccess;

    callbacks.onSuccess = (response, stats, ctx, networkDetails) => {
      if (response && response.data instanceof ArrayBuffer) {
        const decoded = StegoDecoder.stripStego(new Uint8Array(response.data));
        // Create an ArrayBuffer copy of the sliced Uint8Array for Hls.js
        response.data = decoded.buffer.slice(
          decoded.byteOffset,
          decoded.byteOffset + decoded.byteLength
        );
      }
      originalSuccess(response, stats, ctx, networkDetails);
    };

    super.load(context, config, callbacks);
  }
}

if (typeof globalThis !== 'undefined') {
  /** @type {any} */ (globalThis).StegoFragmentLoader = StegoFragmentLoader;
}
