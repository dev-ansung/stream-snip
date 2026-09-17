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

test('manifest references existing popup and icons', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.ok(manifest.action, 'manifest must declare action');
  assert.ok(manifest.action.default_popup, 'action must declare default_popup');

  const popupPath = path.join(rootDir, manifest.action.default_popup);
  assert.ok(fs.existsSync(popupPath), `Popup file ${manifest.action.default_popup} must exist`);

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
  const expectedPerms = ['webRequest', 'storage', 'downloads', 'activeTab'];
  for (const perm of expectedPerms) {
    assert.ok(manifest.permissions.includes(perm), `Permissions must include ${perm}`);
  }

  assert.ok(Array.isArray(manifest.host_permissions), 'host_permissions must be an array');
  assert.ok(
    manifest.host_permissions.includes('<all_urls>'),
    'host_permissions must include <all_urls>'
  );
});
