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

test('popup.html contains refresh streams button, download manager, and script tags', () => {
  const popupHtmlPath = path.join(rootDir, 'popup', 'popup.html');
  assert.ok(fs.existsSync(popupHtmlPath));
  const html = fs.readFileSync(popupHtmlPath, 'utf8');
  assert.ok(html.includes('id="btnRefreshStreams"'), 'Must have btnRefreshStreams');
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
