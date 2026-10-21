#!/usr/bin/env node
// Update checks and source fetches for the Windows Shinawase Manager
// (ShinawaseLoader/manager). The manager runs on .NET Framework, which has no
// Ed25519 verifier, so everything trust-sensitive goes through update-net.mjs:
// the signed mirror manifest first, then GitHub (via ghproxy, then directly).
//
//   node manager-helper.mjs check [--official] [--mirrors a,b]
//   node manager-helper.mjs fetch --dest <dir> [--packages id,id] [--no-loader] [--cache <dir>] [--official] [--mirrors a,b]
//   node manager-helper.mjs fetch-workshop --dest <file.zip> [--cache <dir>] [--official] [--mirrors a,b]
//
// Prints one JSON object per line; the last line has "event": "result".
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from '../echomod-archive.mjs';
import { inspectWorkshopZip } from '../workshop-setup.mjs';
import {
  DEFAULT_UPDATE_MIRRORS,
  UPDATE_PACKAGES,
  UPDATE_REPO,
  WORKSHOP_ARCHIVE,
  createDeadline,
  createSourceHealth,
  fetchBuffer,
  fetchFirstValid,
  fetchSmallFromSources,
  isNetworkFailure,
  normalizeMirrorBases,
  parseMirrorManifest,
} from '../update-net.mjs';

export const githubSources = (official) => {
  const direct = { id: 'github', raw: `https://raw.githubusercontent.com/${UPDATE_REPO}/main`, archive: `https://codeload.github.com/${UPDATE_REPO}/zip/refs/heads/main` };
  if (official) return [direct];
  return [
    { id: 'ghproxy', raw: `https://ghproxy.net/https://raw.githubusercontent.com/${UPDATE_REPO}/main`, archive: `https://ghproxy.net/https://github.com/${UPDATE_REPO}/archive/refs/heads/main.zip` },
    direct,
  ];
};

// Writes the ShinawaseLoader/ subtree of a source archive (GitHub repo zip or
// the mirror's loader zip) under destRoot. Entries outside that subtree, with
// '..' segments, or resolving outside destRoot are skipped.
export const extractLoaderTree = (entries, destRoot) => {
  const root = resolve(destRoot);
  let written = 0;
  for (const entry of entries) {
    const normalized = `/${String(entry.path || '').replaceAll('\\', '/').replace(/^\/+/u, '')}`;
    const marker = '/ShinawaseLoader/';
    const at = normalized.indexOf(marker);
    if (at < 0) continue;
    const rel = normalized.slice(at + marker.length);
    if (!rel || rel.endsWith('/')) continue;
    const parts = rel.split('/');
    if (parts.some((part) => part === '..' || part === '.' || part === '')) continue;
    const target = resolve(root, ...parts);
    const back = relative(root, target);
    if (!back || back.startsWith('..') || resolve(root, back) !== target) continue;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
    written += 1;
  }
  return written;
};

// GitHub carries the Workshop edition as a release asset of the same version.
export const githubWorkshopSources = (official) => {
  const direct = { id: 'github', url: `https://github.com/${UPDATE_REPO}/releases/latest/download/${WORKSHOP_ARCHIVE}` };
  return official ? [direct] : [{ id: 'ghproxy', url: `https://ghproxy.net/${direct.url}` }, direct];
};

export const loaderVersionOf = (entries) => {
  const file = entries.find((entry) => String(entry.path || '').replaceAll('\\', '/').endsWith('/ShinawaseLoader/loader-version.json'));
  if (!file) return null;
  try { return String(JSON.parse(file.data.toString('utf8')).version || '') || null; } catch { return null; }
};

const run = async () => {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith('-') ? args.shift() : 'check';
  const option = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
  };
  const hasFlag = (name) => args.includes(name);
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const official = hasFlag('--official');
  const mirrorBases = () => {
    if (official) return [];
    const fromArg = option('--mirrors');
    if (fromArg !== null) return normalizeMirrorBases(fromArg.split(','));
    const fromEnv = process.env.SHINAWASE_UPDATE_MIRRORS;
    if (fromEnv !== undefined) return normalizeMirrorBases(fromEnv.split(','));
    return normalizeMirrorBases(DEFAULT_UPDATE_MIRRORS);
  };
  const ctx = { headersMs: 15000, stallMs: 20000, minBps: 20 * 1024, deadline: createDeadline(20 * 60 * 1000), health: createSourceHealth() };
  const net = (extra = {}) => ({
    headersMs: ctx.headersMs,
    stallMs: ctx.stallMs,
    minBps: ctx.minBps,
    deadline: ctx.deadline,
    health: ctx.health,
    onAttempt: (candidate, code) => emit({ event: 'log', message: code ? `${candidate.id} failed: ${code}` : `${candidate.id} ok` }),
    ...extra,
  });

  const checkMirror = async () => {
    for (const base of mirrorBases()) {
      const id = `mirror:${base}`;
      try {
        const bytes = await fetchBuffer(`${base}/mirror-manifest.json`, { headersMs: 8000, stallMs: ctx.stallMs, deadline: ctx.deadline, maxBytes: 256 * 1024 });
        const signature = (await fetchBuffer(`${base}/mirror-manifest.sig`, { headersMs: 8000, stallMs: ctx.stallMs, deadline: ctx.deadline, maxBytes: 4096 })).toString('utf8');
        return { base, id, manifest: parseMirrorManifest(bytes, signature) };
      } catch (error) {
        const code = error?.code || (error instanceof Error ? error.message : String(error));
        emit({ event: 'log', message: `mirror ${base} unavailable: ${code}` });
        if (isNetworkFailure(error)) ctx.health.down(id);
      }
    }
    return null;
  };
  const githubJson = async (rel) => {
    const { data } = await fetchSmallFromSources(githubSources(official).map((source) => ({ id: source.id, url: `${source.raw}/${rel}` })), net());
    return JSON.parse(data.toString('utf8'));
  };
  const inspect = async () => {
    const mirror = await checkMirror();
    if (mirror) {
      return {
        mirror,
        via: 'mirror',
        remote: mirror.manifest.loader.version,
        workshop: mirror.manifest.workshop,
        packages: UPDATE_PACKAGES.map((item) => {
          const entry = mirror.manifest.packages.find((candidate) => candidate.id === item.id);
          return entry ? { id: item.id, version: entry.version, file: entry.file, sha256: entry.sha256, size: entry.size } : { id: item.id, version: null, file: item.file };
        }),
      };
    }
    const remote = String((await githubJson('ShinawaseLoader/loader-version.json'))?.version || '');
    const packages = [];
    for (const item of UPDATE_PACKAGES) {
      try {
        packages.push({ id: item.id, version: String((await githubJson(item.manifest))?.version || '') || null, file: item.file });
      } catch {
        packages.push({ id: item.id, version: null, file: item.file });
      }
    }
    return { mirror: null, via: 'github', remote, packages, workshop: null };
  };

  if (command === 'check') {
    const info = await inspect();
    emit({ event: 'result', ok: true, remote: info.remote, via: info.mirror ? info.mirror.base : info.via, packages: info.packages.map(({ id, version }) => ({ id, version })), workshop: info.workshop ? info.workshop.loaderVersion : null });
    return;
  }
  if (command === 'fetch-workshop') {
    const dest = option('--dest');
    if (!dest) throw new Error('--dest is required');
    emit({ event: 'stage', stage: 'check', label: 'manifest' });
    const info = await inspect();
    emit({ event: 'stage', stage: 'workshop', label: `ShinawaseLoader Workshop ${info.remote}` });
    const candidates = [];
    if (info.mirror && info.workshop) candidates.push({ id: info.mirror.id, url: `${info.mirror.base}/${info.workshop.archive}`, sha256: info.workshop.sha256, size: info.workshop.size });
    for (const github of githubWorkshopSources(official)) candidates.push(github);
    const cacheDir = option('--cache') || join(tmpdir(), 'shinawase-manager-cache');
    const target = resolve(dest);
    let inspected = null;
    const fetched = await fetchFirstValid(candidates, net({
      cacheDir,
      cacheName: 'workshop',
      maxBytes: 512 * 1024 * 1024,
      validate: (data) => {
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
        const found = inspectWorkshopZip(target);
        if (found.loaderVersion !== info.remote) throw new Error('update_archive_version_mismatch');
        inspected = found;
      },
    }));
    emit({ event: 'result', ok: true, path: target, version: inspected.version, loaderVersion: inspected.loaderVersion, via: fetched.source.id });
    return;
  }
  if (command !== 'fetch') throw new Error(`unknown command ${command}`);

  const dest = option('--dest');
  if (!dest) throw new Error('--dest is required');
  const cacheDir = option('--cache') || join(tmpdir(), 'shinawase-manager-cache');
  const wanted = String(option('--packages', '') || '').split(',').map((value) => value.trim()).filter(Boolean);
  emit({ event: 'stage', stage: 'check', label: 'manifest' });
  const info = await inspect();
  let loaderDir = null;
  let source = info.via;
  if (!hasFlag('--no-loader')) {
    emit({ event: 'stage', stage: 'loader', label: `ShinawaseLoader ${info.remote}` });
    const candidates = [];
    if (info.mirror) candidates.push({ id: info.mirror.id, url: `${info.mirror.base}/${info.mirror.manifest.loader.archive}`, sha256: info.mirror.manifest.loader.sha256, size: info.mirror.manifest.loader.size });
    for (const github of githubSources(official)) candidates.push({ id: github.id, url: github.archive });
    let entries = null;
    const fetched = await fetchFirstValid(candidates, net({
      cacheDir,
      cacheName: 'loader',
      maxBytes: 256 * 1024 * 1024,
      validate: (data) => {
        const files = readZip(data, { maxEntries: 20000, maxBytes: 256 * 1024 * 1024 });
        if (loaderVersionOf(files) !== info.remote) throw new Error('update_archive_version_mismatch');
        entries = files;
      },
    }));
    source = fetched.source.id;
    loaderDir = join(resolve(dest), 'ShinawaseLoader');
    const count = extractLoaderTree(entries, loaderDir);
    if (!count) throw new Error('archive_has_no_loader');
  }
  const packages = [];
  for (const id of wanted) {
    const item = info.packages.find((entry) => entry.id === id) || UPDATE_PACKAGES.find((entry) => entry.id === id);
    if (!item) continue;
    emit({ event: 'stage', stage: 'package', label: id });
    const candidates = [];
    if (info.mirror && item.sha256) candidates.push({ id: info.mirror.id, url: `${info.mirror.base}/${item.file}`, sha256: item.sha256, size: item.size });
    for (const github of githubSources(official)) candidates.push({ id: github.id, url: `${github.raw}/${item.file}` });
    const { data } = await fetchFirstValid(candidates, net({ cacheDir, cacheName: `pkg-${id}` }));
    const file = join(resolve(dest), 'packages', basename(item.file));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, data);
    packages.push({ id, version: item.version || null, path: file });
  }
  emit({ event: 'result', ok: true, version: info.remote, via: source, loaderDir, packages });
};

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  run().then(
    () => { process.exitCode = 0; },
    (error) => {
      process.stdout.write(`${JSON.stringify({ event: 'result', ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
      process.exitCode = 1;
    },
  );
}
