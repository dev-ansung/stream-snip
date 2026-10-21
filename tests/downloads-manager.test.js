const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');

test('popup.html includes 3 navigation tabs and corresponding panels (Videos, Downloads, Settings)', () => {
  const html = fs.readFileSync(path.join(rootDir, 'popup', 'popup.html'), 'utf8');
  assert.ok(html.includes('data-tab="videos"'), 'Must have videos tab');
  assert.ok(!html.includes('data-tab="preview"'), 'Must drop preview tab');
  assert.ok(html.includes('data-tab="downloads"'), 'Must have downloads tab');
  assert.ok(html.includes('data-tab="settings"'), 'Must have settings tab');
  assert.ok(html.includes('id="panelVideos"'), 'Must have panelVideos');
  assert.ok(!html.includes('id="panelPreview"'), 'Must drop panelPreview');
  assert.ok(html.includes('id="panelDownloads"'), 'Must have panelDownloads');
  assert.ok(html.includes('id="panelSettings"'), 'Must have panelSettings');
});

test('popup.js runs downloads in-place without opening separate download tabs', () => {
  const popupSource = fs.readFileSync(path.join(rootDir, 'popup', 'popup.js'), 'utf8');
  assert.ok(!popupSource.includes('mode=download'), 'Must not rely on mode=download');
  assert.ok(!popupSource.includes('mode=download'), 'Must not open extra tabs for downloads');
  assert.ok(
    popupSource.includes('switchTab(tabName)') || popupSource.includes("switchTab('downloads')"),
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

test('downloads-manager.js wires dedicated folder button to chrome.downloads.show', () => {
  const dlSource = fs.readFileSync(path.join(rootDir, 'popup', 'downloads-manager.js'), 'utf8');
  assert.ok(
    dlSource.includes('chrome.downloads.show(item.downloadId)'),
    'Must call chrome.downloads.show with downloadId on folder button click'
  );
  assert.ok(
    dlSource.includes('.cc-btn-finder'),
    'Must have dedicated cc-btn-finder class for folder action'
  );
});

test('downloads-manager.js creates CatCatch-style card structure with tracks, domain, and status indicators', () => {
  const dlSource = fs.readFileSync(path.join(rootDir, 'popup', 'downloads-manager.js'), 'utf8');
  assert.ok(dlSource.includes('catcatch-card'), 'Must use catcatch-card element');
  assert.ok(dlSource.includes('status-active'), 'Must support status-active class');
  assert.ok(dlSource.includes('status-complete'), 'Must support status-complete class');
  assert.ok(dlSource.includes('status-deleted'), 'Must support status-deleted class');
  assert.ok(dlSource.includes('badge-deleted'), 'Must support badge-deleted tag');
  assert.ok(dlSource.includes('cc-track-icon'), 'Must support audio/video track indicators');
  assert.ok(dlSource.includes('cc-btn-reload'), 'Must support redownload/re-clip reload button');
});

test('downloads-manager.js seamlessly transitions active task to completed history in-place', () => {
  const dlSource = fs.readFileSync(path.join(rootDir, 'popup', 'downloads-manager.js'), 'utf8');
  assert.ok(
    dlSource.includes('function transitionTaskToComplete(taskId, historyItem)'),
    'Must have transitionTaskToComplete function'
  );
  assert.ok(
    dlSource.includes("card.classList.remove('status-active')"),
    'Must transition status-active to status-complete in-place'
  );
  assert.ok(
    dlSource.includes("card.classList.add('status-complete')"),
    'Must add status-complete on the same card DOM element'
  );
});

test('downloads-manager.js checks file existence on disk via chrome.downloads.search for DELETED status', () => {
  const dlSource = fs.readFileSync(path.join(rootDir, 'popup', 'downloads-manager.js'), 'utf8');
  assert.ok(
    dlSource.includes('chrome.downloads.search({ id: item.downloadId })'),
    'Must query chrome.downloads.search to verify file existence'
  );
  assert.ok(
    dlSource.includes('item.exists = false'),
    'Must mark item.exists = false when file is removed'
  );
});

test('canceling a download job finalizes and saves partial downloaded chunks as MP4 in background', () => {
  const offscreenSource = fs.readFileSync(path.join(rootDir, 'offscreen', 'offscreen.js'), 'utf8');
  assert.ok(
    offscreenSource.includes('partialBytes && partialBytes.byteLength > 0'),
    'Must detect partial downloaded bytes on abort in offscreen'
  );
  assert.ok(
    offscreenSource.includes('downloader.saveToFile') &&
      offscreenSource.includes("filename.replace(/\\.(ts|mp3|mp4)$/i, '') + '.mp4'"),
    'Must save partial HLS download as MP4 in offscreen'
  );
  const dlSource = fs.readFileSync(path.join(rootDir, 'popup', 'downloads-manager.js'), 'utf8');
  assert.ok(
    dlSource.includes('transitionTaskToComplete(taskId,'),
    'Must transition partial download to completed in-place'
  );
});
