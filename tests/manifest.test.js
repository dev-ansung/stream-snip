const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const manifestPath = path.join(rootDir, 'manifest.json');

test('manifest.json exists and is valid JSON', () => {
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw), 'manifest.json must be valid JSON');
});

test('manifest follows Manifest V3 specifications', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3, 'Must be Manifest V3');
  assert.ok(manifest.name && typeof manifest.name === 'string', 'Must have a name');
  assert.ok(
    manifest.version && /^\d+(\.\d+)*$/.test(manifest.version),
    'Must have valid semver version'
  );
  assert.ok(
    manifest.description && typeof manifest.description === 'string',
    'Must have a description'
  );
});

test('manifest references existing background service worker', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(manifest.background, 'manifest must declare background');
  assert.ok(manifest.background.service_worker, 'manifest must declare service_worker');

  const swPath = path.join(rootDir, manifest.background.service_worker);
  assert.ok(
    fs.existsSync(swPath),
    `Service worker file ${manifest.background.service_worker} must exist`
  );
});

test('manifest references existing side panel and icons', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(manifest.side_panel, 'manifest must declare side_panel');
  assert.ok(manifest.side_panel.default_path, 'side_panel must declare default_path');

  const sidePanelPath = path.join(rootDir, manifest.side_panel.default_path);
  assert.ok(
    fs.existsSync(sidePanelPath),
    `Side panel file ${manifest.side_panel.default_path} must exist`
  );

  const iconSizes = ['16', '48', '128'];
  for (const size of iconSizes) {
    if (manifest.icons && manifest.icons[size]) {
      const iconPath = path.join(rootDir, manifest.icons[size]);
      assert.ok(fs.existsSync(iconPath), `Icon file ${manifest.icons[size]} must exist`);
    }
    if (manifest.action.default_icon && manifest.action.default_icon[size]) {
      const actionIconPath = path.join(rootDir, manifest.action.default_icon[size]);
      assert.ok(
        fs.existsSync(actionIconPath),
        `Action icon file ${manifest.action.default_icon[size]} must exist`
      );
    }
  }
});

test('manifest permissions contain expected MV3 permissions', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(Array.isArray(manifest.permissions), 'permissions must be an array');
  const expectedPerms = [
    'webRequest',
    'declarativeNetRequestWithHostAccess',
    'storage',
    'downloads',
    'activeTab',
    'webNavigation',
    'sidePanel'
  ];
  for (const perm of expectedPerms) {
    assert.ok(manifest.permissions.includes(perm), `Permissions must include ${perm}`);
  }

  assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
  assert.ok(
    manifest.host_permissions.includes('<all_urls>'),
    'host_permissions must include <all_urls>'
  );
});

test('popup.html contains extension reload button, log terminal, download manager, and script tags', () => {
  const popupHtmlPath = path.join(rootDir, 'popup', 'popup.html');
  assert.ok(fs.existsSync(popupHtmlPath));
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  assert.ok(html.includes('id="btnReloadExtension"'), 'Must have btnReloadExtension');
  assert.ok(html.includes('id="logTerminal"'), 'Must have logTerminal');
  assert.ok(html.includes('id="toastContainer"'), 'Must have toastContainer');
  assert.ok(html.includes('id="downloadManagerCard"'), 'Must have downloadManagerCard');
  assert.ok(html.includes('ui-feedback.js'), 'Must include ui-feedback.js');
  assert.ok(html.includes('player-controller.js'), 'Must include player-controller.js');
  assert.ok(html.includes('state-manager.js'), 'Must include state-manager.js');
});

test('manifest declares content_scripts pointing to existing content script', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(Array.isArray(manifest.content_scripts), 'Must declare content_scripts array');
  assert.ok(manifest.content_scripts.length > 0, 'Must have at least 1 content script entry');
  const cs = manifest.content_scripts[0];
  assert.ok(cs.js && cs.js.includes('content/content.js'));
  const csPath = path.join(rootDir, 'content', 'content.js');
  assert.ok(fs.existsSync(csPath), 'content/content.js file must exist');
});

test('catching is wired into its own module (background/catcher.js), separate from the service worker', () => {
  const swSource = fs.readFileSync(path.join(rootDir, 'background', 'service_worker.js'), 'utf8');
  const catcherPath = path.join(rootDir, 'background', 'catcher.js');
  assert.ok(fs.existsSync(catcherPath), 'background/catcher.js must exist');
  const catcherSource = fs.readFileSync(catcherPath, 'utf8');

  assert.ok(swSource.includes('background/catcher.js'), 'service worker must import catcher.js');
  assert.ok(
    swSource.includes('chrome.runtime.onConnect'),
    'Must listen for side panel connections'
  );
  assert.ok(
    swSource.includes('Catcher.registerSidePanelPort'),
    'Must hand the side panel connection to Catcher to arm/disarm'
  );
  assert.ok(catcherSource.includes('function armCapture'), 'Catcher must own arm/disarm');
  assert.ok(catcherSource.includes('function disarmCapture'), 'Catcher must own arm/disarm');
});

test('manual stream URL entry is routed through Catcher', () => {
  const swSource = fs.readFileSync(path.join(rootDir, 'background', 'service_worker.js'), 'utf8');
  const catcherSource = fs.readFileSync(path.join(rootDir, 'background', 'catcher.js'), 'utf8');
  assert.ok(
    swSource.includes("request.type === 'ADD_MANUAL_STREAM'"),
    'Service worker must route ADD_MANUAL_STREAM messages'
  );
  assert.ok(
    swSource.includes('Catcher.registerManualStream'),
    'Must delegate manual entry to Catcher rather than duplicating the logic'
  );
  assert.ok(
    catcherSource.includes('async function registerManualStream'),
    'Catcher must implement manual stream registration'
  );
});

test("Catcher preserves a tab's streams across navigation", () => {
  const catcherSource = fs.readFileSync(path.join(rootDir, 'background', 'catcher.js'), 'utf8');
  assert.ok(
    catcherSource.includes('async function _pruneIfNavigatedAway'),
    'Preserves pruneIfNavigatedAway interface without destructive auto-wiping'
  );
  assert.ok(
    catcherSource.includes('Streams are preserved across navigations'),
    'Documents stream preservation across navigations'
  );
});

test("Catcher does not borrow another tab's streams once the caller names an exact tab", () => {
  const catcherSource = fs.readFileSync(path.join(rootDir, 'background', 'catcher.js'), 'utf8');
  assert.ok(
    catcherSource.includes('knowsExactTab'),
    'Falling back to lastActiveMediaTabId or "any tab with streams" must be gated on ' +
      'not knowing which tab to target — otherwise a tab with zero streams so far ' +
      '(the normal state right after opening the panel) incorrectly shows a ' +
      "different, possibly stale tab's leftover data instead of an empty list"
  );
});

test('popup.html offers a manual stream URL fallback', () => {
  const html = fs.readFileSync(path.join(rootDir, 'popup', 'popup.html'), 'utf8');
  assert.ok(html.includes('id="manualStreamUrl"'), 'Must have a manual stream URL input');
  assert.ok(html.includes('id="btnAddManualStream"'), 'Must have an add-stream button');
});

test('Catcher sniffs via Content-Type, not just URL pattern', () => {
  const catcherSource = fs.readFileSync(path.join(rootDir, 'background', 'catcher.js'), 'utf8');
  assert.ok(
    catcherSource.includes('chrome.webRequest.onResponseStarted'),
    'Must inspect the response stage where Content-Type is available'
  );
  assert.ok(
    catcherSource.includes('StreamSniffer.classifyMediaRequest'),
    'Must delegate the detection decision to the decoupled lib/stream-sniffer.js'
  );
  assert.ok(
    catcherSource.includes('async function registerStream'),
    'Sniffed and manually-added streams must share one registration path'
  );
});

test('popup.js supports direct (non-HLS) media files, not just HLS clipping', () => {
  const popupSource = fs.readFileSync(path.join(rootDir, 'popup', 'popup.js'), 'utf8');
  assert.ok(
    popupSource.includes('class NotHlsError'),
    'Must distinguish "not HLS" from a generic fetch failure so it can fall back'
  );
  assert.ok(
    popupSource.includes('async function loadDirectStream'),
    'Must have a distinct load path for direct media (no manifest/segments)'
  );
  assert.ok(
    popupSource.includes('async function executeDirectDownload'),
    'Must download direct files whole, without HLS segment/transmux logic'
  );
  assert.ok(
    popupSource.includes("stream.kind === 'direct'"),
    'Background-classified kind must steer which load/download path is used'
  );
});

test('popup.html loads lib/stream-sniffer.js so popup.js can classify manual URLs', () => {
  const html = fs.readFileSync(path.join(rootDir, 'popup', 'popup.html'), 'utf8');
  assert.ok(html.includes('stream-sniffer.js'), 'popup.html must include the sniffer script');
});
