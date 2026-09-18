# StegoClip - Standalone Chrome Extension for HLS Video Clipping

A lightweight standalone Google Chrome Extension (Manifest V3) that intercepts HLS (`.m3u8`) streaming playlists in real time, decodes steganographically wrapped video segments (PNG/image wrappers), provides an in-popup video preview player, and allows clipping videos from a specified start time to end time.

## Key Features

- **Native In-Browser Authentication**: All segment requests are made directly in your browser session with authenticated cookies and headers, completely eliminating 403 Forbidden errors from ephemeral CDN tokens.
- **Pure JavaScript Faststart MP4 Generation**: Converts fragmented MP4 streams into standard progressive `[ftyp][moov][mdat]` files with sample tables (`stts`, `stss`, `ctts`, `stsz`, `stsc`, `stco`) for seamless compatibility with QuickTime Player, macOS Finder preview, and iOS devices.
- **Dedicated Full-Page Studio Mode**: Expand from the extension popup into a full-page workspace (`popup.html?mode=full`) to manage long streams and inspect media properties without accidental popup closures.
- **In-Popup Video Preview**: Built-in player powered by `hls.js` with a custom `StegoFragmentLoader` to preview and scrub both normal and steganographic streams.
- **One-Click Range Pickers**: Click "⏱️ Current" while watching the video preview to lock in your start and end clipping timestamps.
- **Automatic Steganography Stripping**: Transparently detects dummy 1x1 PNG headers and extracts raw MPEG-TS video payloads.
- **Concurrent Chunk Downloader**: Downloads only the overlapping segments concurrently and saves the assembled `.mp4` or `.ts` video to your Downloads folder.
- **Resource Management & Safety**: Automatic Blob URL lifecycle management revokes object URLs via `chrome.downloads.onChanged` immediately upon download completion, preventing memory leaks on large downloads.

## Architecture

```
stego-clip-extension/
├── background/
│   └── service_worker.js     # Intercepts M3U8 requests, manages declarativeNetRequest rules
├── lib/
│   ├── constants.js          # Shared message types, storage keys, and safety bounds
│   ├── downloader.js         # Concurrent segment fetcher and stego stripper
│   ├── parser.js             # M3U8 playlist and timeline range parser
│   ├── stego-loader.js       # Hls.js fragment loader adapter
│   ├── stego.js              # Binary inspection and PNG header stripper
│   ├── time.js               # Timestamp parsing, formatting, and filename generation
│   └── transmuxer.js         # TS-to-MP4 transmuxer and pure JS fMP4 unfragmenter
├── popup/
│   ├── player-controller.js  # Hls.js lifecycle, metadata extraction, and preview control
│   ├── popup.css             # Popup and full-page Studio styling with toast notifications
│   ├── popup.html            # Studio layout, media inspector, and download panel
│   ├── popup.js              # Presentation coordinator and user event wiring
│   ├── state-manager.js      # Debounced, tab-isolated storage synchronization
│   └── ui-feedback.js        # Non-blocking inline toast feedback
└── tests/                    # Node test runner suite (39 automated unit tests)
```

## Installation in Google Chrome

1. Open Google Chrome and navigate to `chrome://extensions`.
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
5. Choose output format (`MP4` or `TS`) and click **⬇️ Download MP4 Clip**. The video file will download to your Downloads folder.
6. For long videos or large clip batches, click **⛶ Open Full Page** to open the full-screen Studio tab.

## Development & Verification

Run the test suite:

```bash
pnpm test
```

Run the complete verification pipeline (ESLint, Prettier code style check, and tests):

```bash
pnpm run check
```
