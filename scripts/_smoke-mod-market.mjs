#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const live = process.argv.includes('--live');
const url = 'https://echo.shiinasuki.com/mod-market/index.json';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

const catalog = live
  ? await (await fetch(url, { headers: { 'user-agent': 'ShinawaseLoader-smoke' } })).json()
  : JSON.parse(readFileSync(join(root, 'dist', 'mod-market', 'index.json'), 'utf8'));

if (catalog.version !== 1 || !Array.isArray(catalog.mods) || !catalog.mods.length) {
  throw new Error('invalid catalog');
}
for (const item of catalog.mods) {
  if (!/^[a-z0-9][a-z0-9._-]{1,63}$/iu.test(item.id)) throw new Error('bad id ' + item.id);
  if (!item.file || !item.sha256 || !item.size || !item.version) throw new Error('incomplete ' + item.id);
  if (!/^[a-f0-9]{64}$/u.test(item.sha256)) throw new Error('bad sha ' + item.id);
  if (typeof item.iconDataUrl === 'string' && !item.iconDataUrl.startsWith('data:')) throw new Error('bad icon ' + item.id);
}
if (live) {
  const sample = catalog.mods.find((item) => item.id === 'echo.mv') || catalog.mods[0];
  const fileUrl = new URL(sample.file, url);
  const bytes = Buffer.from(await (await fetch(fileUrl)).arrayBuffer());
  if (sha(bytes) !== sample.sha256) throw new Error('checksum mismatch ' + sample.id);
}
console.log(`ok  ${catalog.mods.length} mods  ${live ? 'live' : 'local'}  ${catalog.updatedAt || ''}`);
