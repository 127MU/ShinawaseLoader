#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const spec = JSON.parse(readFileSync(join(root, 'scripts', 'mod-market.json'), 'utf8'));
const outRoot = resolve(process.argv[2] || join(root, 'dist', 'mod-market'));
const iconMime = new Map([
  ['.svg', 'image/svg+xml'], ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'], ['.gif', 'image/gif'],
]);
const formatBytes = (bytes) => (
  bytes < 1024 ? `${bytes} B`
    : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
      : `${(bytes / (1024 * 1024)).toFixed(2)} MB`
);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(join(outRoot, 'packages'), { recursive: true });
mkdirSync(join(outRoot, 'icons'), { recursive: true });
mkdirSync(join(outRoot, 'docs'), { recursive: true });

const mods = [];
for (const entry of spec.mods) {
  const packagePath = resolve(root, entry.package);
  const sourceDir = resolve(root, entry.source);
  const manifest = readJson(join(sourceDir, 'echo.mod.json'));
  if (manifest.id !== entry.id) throw new Error(`id mismatch for ${entry.id}: manifest has ${manifest.id}`);
  const bytes = readFileSync(packagePath);
  const version = String(manifest.version || '1.0.0');
  const fileName = `${manifest.id}-${version}.echomod`;
  const iconName = String(manifest.icon || 'icon.svg');
  const iconPath = join(sourceDir, iconName);
  const iconExt = extname(iconName).toLowerCase() || '.svg';
  const iconFile = `${manifest.id}${iconExt}`;
  copyFileSync(packagePath, join(outRoot, 'packages', fileName));
  copyFileSync(iconPath, join(outRoot, 'icons', iconFile));
  const iconBytes = readFileSync(iconPath);
  const mime = iconMime.get(iconExt) || 'application/octet-stream';
  const readmeCandidates = [join(sourceDir, 'README.md'), join(sourceDir, '..', 'README.md')];
  const readmePath = readmeCandidates.find((file) => existsSync(file));
  let hasReadme = false;
  if (readmePath) {
    const readme = readFileSync(readmePath, 'utf8').slice(0, 80000);
    writeFileSync(join(outRoot, 'docs', `${manifest.id}.md`), readme.endsWith('\n') ? readme : readme + '\n');
    hasReadme = true;
  }
  mods.push({
    id: manifest.id,
    name: manifest.name || manifest.id,
    nameZh: entry.nameZh || manifest.name || manifest.id,
    version,
    description: entry.descriptionEn || manifest.description || '',
    descriptionZh: entry.descriptionZh || manifest.description || '',
    author: entry.author || 'Shinawase',
    channel: entry.channel === 'official' ? 'official' : 'community',
    featured: entry.featured === true,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
    minEchoVersion: manifest.minEchoVersion || null,
    homepage: entry.homepage || 'https://github.com/ChunchunOwO/ShinawaseLoader',
    file: `packages/${fileName}`,
    icon: `icons/${iconFile}`,
    iconDataUrl: `data:${mime};base64,${iconBytes.toString('base64')}`,
    sha256: sha256(bytes),
    size: bytes.length,
    downloads: 0,
    views: 0,
    installs: 0,
    intro: entry.descriptionEn || manifest.description || '',
    introZh: entry.descriptionZh || manifest.description || '',
    hasReadme,
    uploadedAt: new Date().toISOString(),
  });
  console.log(`  ${manifest.id}  v${version}  ${formatBytes(bytes.length)}  ${sha256(bytes).slice(0, 12)}`);
}

const catalog = {
  version: 1,
  name: spec.name || 'Shinawase Mod Market',
  updatedAt: new Date().toISOString(),
  mods,
};
writeFileSync(join(outRoot, 'index.json'), JSON.stringify(catalog, null, 2) + '\n');
writeFileSync(join(outRoot, 'seed.json'), JSON.stringify(catalog, null, 2) + '\n');
const webRoot = join(root, 'scripts', 'mod-market-web');
for (const name of ['index.html', 'market.css', 'market.js', 'echo-hub-fx.js', 'echo-hub-fx.css', 'echo-hub-fx-dark.css', 'echo-pearl.mp3']) {
  const src = join(webRoot, name);
  if (existsSync(src)) copyFileSync(src, join(outRoot, name));
}
copyFileSync(join(root, 'scripts', 'mod-market-server.py'), join(outRoot, 'mod-market-server.py'));

console.log(`\nWrote ${mods.length} mods → ${outRoot}`);
