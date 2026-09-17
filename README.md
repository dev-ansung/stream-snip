# StegoClip - Standalone Chrome Extension for HLS Video Clipping

A lightweight standalone Google Chrome Extension (Manifest V3) that intercepts HLS (`.m3u8`) streaming playlists in real time, decodes steganographically wrapped video segments (PNG/image wrappers), provides an in-popup video preview player, and allows clipping videos from a specified start time to end time.

## Key Features

- **Native In-Browser Authentication**: All segment requests are made directly in your browser session with authenticated cookies and headers, completely eliminating 403 Forbidden errors from ephemeral CDN tokens.
- **In-Popup Video Preview**: Built-in player powered by `hls.js` with a custom `StegoFragmentLoader` to preview and scrub both normal and steganographic streams.
- **One-Click Range Pickers**: Click "⏱️ Current" while watching the video preview to lock in your start and end clipping timestamps.
- **Automatic Steganography Stripping**: Transparently detects dummy 1x1 PNG headers and extracts raw MPEG-TS video payloads.
- **Concurrent Chunk Downloader**: Downloads only the overlapping segments concurrently and saves the assembled `.ts` video to your Downloads folder.

## Installation in Google Chrome

1. Open Google Chrome and go to `chrome://extensions`.
2. Turn on **Developer mode** in the top right corner.
3. Click **Load unpacked** in the top left corner.
4. Select the directory:
   ```
   /Users/an/Development/Antigravity/stego-clip-extension
   ```

## Usage

1. Open any webpage playing an HLS video stream (e.g. `fc2stream.tv`, `supjav.com`).
2. Click the **StegoClip** extension icon in your Chrome toolbar.
3. The video will load in the preview player.
4. Use the player to find your scene, click **⏱️ Current** to set the start and end times (or type `MM:SS`).
5. Click **⬇️ Download Clip**. The video file will download to your Downloads folder.

## Automated Testing

```bash
pnpm test
```
