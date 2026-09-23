const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('popup.html includes 4 navigation tabs and corresponding panels', () => {
  const html = fs.readFileSync(path.join(rootDir, 'popup', 'popup.html'), 'utf8');
  assert.ok(html.includes('data-tab="videos"'), 'Must have videos tab');
  assert.ok(html.includes('data-tab="preview"'), 'Must have preview tab');
  assert.ok(html.includes('data-tab="downloads"'), 'Must have downloads tab');
  assert.ok(html.includes('data-tab="settings"'), 'Must have settings tab');
  assert.ok(html.includes('id="panelVideos"'), 'Must have panelVideos');
  assert.ok(html.includes('id="panelPreview"'), 'Must have panelPreview');
  assert.ok(html.includes('id="panelDownloads"'), 'Must have panelDownloads');
  assert.ok(html.includes('id="panelSettings"'), 'Must have panelSettings');
});

test('popup.js runs downloads in-place without opening separate download tabs', () => {
  const popupSource = fs.readFileSync(path.join(rootDir, 'popup', 'popup.js'), 'utf8');
  assert.ok(!popupSource.includes('mode=download'), 'Must not rely on mode=download');
  assert.ok(
    !popupSource.includes('chrome.tabs.create'),
    'Must not open extra tabs via chrome.tabs.create'
  );
  assert.ok(
    popupSource.includes("switchTab('downloads')"),
    'Must switch to in-place downloads tab'
  );
});

test('popup.js strictly scopes messages to currentTabId without cross-tab jumping', () => {
  const popupSource = fs.readFileSync(path.join(rootDir, 'popup', 'popup.js'), 'utf8');
  assert.ok(
    popupSource.includes('if (message.tabId && currentTabId && message.tabId !== currentTabId)'),
    'STREAM_DETECTED must strictly filter messages to currentTabId'
  );
});

test('Catcher captures content-length as size when available', () => {
  const catcherSource = fs.readFileSync(path.join(rootDir, 'background', 'catcher.js'), 'utf8');
  assert.ok(catcherSource.includes("getHeaderValue(responseHeaders, 'content-length')"));
  assert.ok(catcherSource.includes('formattedSize'));
});
