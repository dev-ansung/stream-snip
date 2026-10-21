const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('lib/videojs contains offline Video.js distribution and fonts', () => {
  assert.ok(
    fs.existsSync(path.join(rootDir, 'lib', 'videojs', 'video.min.js')),
    'video.min.js must exist in lib/videojs'
  );
  assert.ok(
    fs.existsSync(path.join(rootDir, 'lib', 'videojs', 'video-js.min.css')),
    'video-js.min.css must exist in lib/videojs'
  );
  assert.ok(
    fs.existsSync(path.join(rootDir, 'lib', 'videojs', 'font', 'VideoJS.woff')),
    'VideoJS.woff must exist in lib/videojs/font'
  );
});

test('player/player.html exists and includes Video.js, Hls.js, and Stego loader', () => {
  const htmlPath = path.join(rootDir, 'player', 'player.html');
  assert.ok(fs.existsSync(htmlPath), 'player/player.html must exist');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('video-js.min.css'), 'Must include video-js.min.css');
  assert.ok(html.includes('video.min.js'), 'Must include video.min.js');
  assert.ok(html.includes('hls.min.js'), 'Must include hls.min.js');
  assert.ok(html.includes('stego-loader.js'), 'Must include stego-loader.js');
  assert.ok(html.includes('id="videoPlayer"'), 'Must define videoPlayer element');
  assert.ok(html.includes('id="btnToggleFs"'), 'Must define btnToggleFs element');
});

test('player/player.js handles fullscreen toggle and keyboard navigation', () => {
  const jsPath = path.join(rootDir, 'player', 'player.js');
  assert.ok(fs.existsSync(jsPath), 'player/player.js must exist');
  const js = fs.readFileSync(jsPath, 'utf8');

  assert.ok(js.includes('videojs'), 'Must call videojs');
  assert.ok(js.includes('btnToggleFs'), 'Must bind btnToggleFs');
  assert.ok(js.includes('requestFullscreen'), 'Must handle requestFullscreen');
  assert.ok(js.includes('keydown'), 'Must register keydown handler');
});

test('stream-list wires opening player to chrome.tabs.create', () => {
  const streamListJs = fs.readFileSync(path.join(rootDir, 'popup', 'stream-list.js'), 'utf8');
  assert.ok(streamListJs.includes('.btn-open-player'), 'stream-list must have open-player button');
  assert.ok(
    streamListJs.includes('chrome.tabs.create'),
    'stream-list must call chrome.tabs.create on open'
  );
  assert.ok(
    streamListJs.includes('player/player.html'),
    'stream-list must target player/player.html'
  );
});

test('player/player.html includes clipper panel, quality selector, and download controls', () => {
  const htmlPath = path.join(rootDir, 'player', 'player.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  assert.ok(html.includes('id="clipperPanel"'), 'Must define clipperPanel');
  assert.ok(html.includes('id="clipStart"'), 'Must define clipStart input');
  assert.ok(html.includes('id="clipEnd"'), 'Must define clipEnd input');
  assert.ok(html.includes('id="btnSetStart"'), 'Must define btnSetStart');
  assert.ok(html.includes('id="btnSetEnd"'), 'Must define btnSetEnd');
  assert.ok(html.includes('id="qualitySelect"'), 'Must define qualitySelect');
  assert.ok(html.includes('id="formatSelect"'), 'Must define formatSelect');
  assert.ok(html.includes('id="clipFilename"'), 'Must define clipFilename input');
  assert.ok(html.includes('id="btnDownload"'), 'Must define btnDownload');
  assert.ok(html.includes('id="btnCancel"'), 'Must define btnCancel');
  assert.ok(html.includes('id="downloadProgress"'), 'Must define downloadProgress');
});

test('player/player.js implements hotkey clipping and offscreen download communication', () => {
  const jsPath = path.join(rootDir, 'player', 'player.js');
  const js = fs.readFileSync(jsPath, 'utf8');

  assert.ok(js.includes("case '[':"), 'Must handle [ hotkey for start marker');
  assert.ok(js.includes("case ']':"), 'Must handle ] hotkey for end marker');
  assert.ok(js.includes('START_DOWNLOAD'), 'Must dispatch START_DOWNLOAD');
  assert.ok(js.includes('CANCEL_DOWNLOAD'), 'Must dispatch CANCEL_DOWNLOAD');
  assert.ok(js.includes('DOWNLOAD_PROGRESS'), 'Must handle DOWNLOAD_PROGRESS');
  assert.ok(js.includes('DOWNLOAD_COMPLETE'), 'Must handle DOWNLOAD_COMPLETE');
});

test('scripts/build-zip.js includes player and offscreen directories in filesToInclude', () => {
  const buildScript = fs.readFileSync(path.join(rootDir, 'scripts', 'build-zip.js'), 'utf8');
  assert.ok(
    buildScript.includes("'player'"),
    'build-zip.js must include player directory in distribution zip'
  );
  assert.ok(
    buildScript.includes("'offscreen'"),
    'build-zip.js must include offscreen directory in distribution zip'
  );
});
