const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const distDir = path.join(rootDir, 'dist');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

const zipName = `stego-clip-extension-v${pkg.version}.zip`;
const zipPath = path.join(distDir, zipName);

if (fs.existsSync(zipPath)) {
  fs.unlinkSync(zipPath);
}

const filesToInclude = [
  'manifest.json',
  'background',
  'content',
  'lib',
  'popup',
  'icons',
  'LICENSE',
  'README.md'
];

console.log(`Packaging StegoClip v${pkg.version} into ${zipName}...`);

const cmd = `zip -r -q "${zipPath}" ${filesToInclude.join(' ')} -x "*.DS_Store" "*__MACOSX*"`;
execSync(cmd, { cwd: rootDir, stdio: 'inherit' });

const stats = fs.statSync(zipPath);
const sizeKb = (stats.size / 1024).toFixed(1);
console.log(`Successfully built: dist/${zipName} (${sizeKb} KB)`);
