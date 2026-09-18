# StegoClip - Standalone Chrome Extension for HLS Video Clipping

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/dev-ansung/stego-clip-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/dev-ansung/stego-clip-extension/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A lightweight standalone Google Chrome Extension (Manifest V3) that intercepts HLS (`.m3u8`) streaming playlists in real time, decodes steganographically wrapped video segments (PNG/image wrappers), provides an in-browser Side Panel video preview player, and allows clipping videos from a specified start time to end time directly within your browser.

## Key Features

- **Native Persistent Chrome Side Panel**: Docks neatly alongside the webpage so you can interact with the page's video player, seek, and browse without dismissing the clipper UI.
- **Dedicated Focused Download Mode**: Downloads proceed in a focused background workspace (`mode=download`), leaving the main panel responsive and free from UI blocking.
- **Native In-Browser Authentication**: All segment requests are made directly in your browser session with authenticated cookies and headers, completely eliminating 403 Forbidden errors from ephemeral CDN tokens.
- **Pure JavaScript Faststart MP4 Generation**: Converts fragmented MP4 streams into standard progressive `[ftyp][moov][mdat]` files with sample tables (`stts`, `stss`, `ctts`, `stsz`, `stsc`, `stco`) for seamless compatibility with QuickTime Player, macOS Finder preview, and iOS devices.
- **Side Panel Video Preview**: Built-in player powered by `hls.js` with a custom `StegoFragmentLoader` to preview and scrub both normal and steganographic streams.
- **One-Click Range Pickers**: Click "⏱️ Current" while watching the video preview to lock in your start and end clipping timestamps.
- **Automatic Steganography Stripping**: Transparently detects dummy 1x1 PNG headers and extracts raw MPEG-TS video payloads.
- **Concurrent Chunk Downloader**: Downloads only the overlapping segments concurrently and saves the assembled `.mp4` or `.ts` video to your Downloads folder.
- **Live Tab Seek Synchronization**: Automatically follows seek / scrub events on the webpage video player so you can navigate directly in your browser player while previewing in StegoClip. Includes a "🔗 Sync" toggle.
- **Active Tab Tracking**: Seamlessly switches context and streams when you click between different browser tabs with the sidebar open.
- **Resource Management & Safety**: Automatic Blob URL lifecycle management revokes object URLs via `chrome.downloads.onChanged` immediately upon download completion, preventing memory leaks on large downloads.

## Architecture

```
stego-clip-extension/
├── background/
│   └── service_worker.js     # Intercepts M3U8 requests, manages declarativeNetRequest rules
├── content/
│   └── content.js            # Observes HTML5 video elements and reports seek events to preview
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
│   ├── popup.css             # Side panel and download manager styling with toast notifications
│   ├── popup.html            # Side panel layout, media inspector, and download manager
│   ├── popup.js              # Presentation coordinator and user event wiring
│   ├── state-manager.js      # Debounced, tab-isolated storage synchronization
│   └── ui-feedback.js        # Non-blocking inline toast feedback
├── scripts/
│   └── build-zip.js          # Distribution zip builder for Chrome Web Store releases
└── tests/                    # Automated unit test suite (55 tests)
```

## Installation in Google Chrome

### From Source

1. Clone or download this repository:
   ```bash
   git clone https://github.com/dev-ansung/stego-clip-extension.git
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** in the top right corner.
4. Click **Load unpacked** in the top left corner.
5. Select the `stego-clip-extension` directory containing `manifest.json`.

### From Release Package

1. Download the latest `stego-clip-extension-v*.zip` from GitHub Releases.
2. Extract the archive into a folder.
3. In `chrome://extensions` with **Developer mode** enabled, click **Load unpacked** and choose the extracted folder.

## Usage

1. Open any webpage playing an HLS video stream (e.g., `fc2stream.tv`, `supjav.com`).
2. Click the **StegoClip** extension icon in your Chrome toolbar (or open the Side Panel).
3. The detected video stream will load into the preview player automatically.
4. Scrub the preview or the host webpage player to locate your desired start and end points.
5. Click **⏱️ Current** to lock in your start and end times (or type timestamps manually as `MM:SS` or `HH:MM:SS`).
6. Select your output container (`MP4` or `TS`) and click **⬇️ Download MP4 Clip**. The assembled video file will download to your browser's default Downloads folder.

## Building for Distribution

To build the standalone release ZIP for GitHub Releases or the Chrome Web Store:

```bash
pnpm run build
```

This runs the automated verification suite (linting, code formatting, and all unit tests) and bundles all necessary runtime files into `dist/stego-clip-extension-v<version>.zip`.

## Development & Verification

Install dependencies:

```bash
pnpm install
```

Run the unit test suite:

```bash
pnpm test
```

Run the full verification pipeline (ESLint, Prettier check, and unit tests):

```bash
pnpm run check
```

Automatically format code style:

```bash
pnpm run format
```

## Sister Project

Looking for a Python CLI tool for terminal-based and batch downloads with referer spoofing and segment concurrency? Check out:

- [stego-hls](https://github.com/dev-ansung/stego-hls) - Open source CLI to download and decrypt stego HLS streams with segmented downloading.

## Contributing

Contributions are welcome! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code style, testing, and pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
