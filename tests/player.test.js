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

test('popup.html and popup.js wire btnPopoutPlayer to chrome.tabs.create', () => {
  const popupHtml = fs.readFileSync(path.join(rootDir, 'popup', 'popup.html'), 'utf8');
  assert.ok(
    popupHtml.includes('id="btnPopoutPlayer"'),
    'popup.html must have btnPopoutPlayer button'
  );

  const popupJs = fs.readFileSync(path.join(rootDir, 'popup', 'popup.js'), 'utf8');
  assert.ok(popupJs.includes('btnPopoutPlayer'), 'popup.js must reference btnPopoutPlayer');
  assert.ok(
    popupJs.includes('chrome.tabs.create'),
    'popup.js must call chrome.tabs.create on popout'
  );
  assert.ok(popupJs.includes('player/player.html'), 'popup.js must target player/player.html');
});

test('scripts/build-zip.js includes player directory in filesToInclude', () => {
  const buildScript = fs.readFileSync(path.join(rootDir, 'scripts', 'build-zip.js'), 'utf8');
  assert.ok(
    buildScript.includes("'player'"),
    'build-zip.js must include player directory in distribution zip'
  );
});
