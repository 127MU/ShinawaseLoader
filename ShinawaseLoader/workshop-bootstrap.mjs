#!/usr/bin/env node
// Installs this Loader from an ECHO Workshop item into <ECHO_ROOT>/ShinawaseLoader
// and hands off to the isolated runtime. The Workshop item's trusted module
// (subscriber-approved `system:full`) starts it on ECHO's own executable in
// Node mode (ELECTRON_RUN_AS_NODE=1); the Workshop ships no node.exe, no
// launcher binary and no other file type ECHO's Workshop validation blocks.
//
//   workshop-bootstrap.mjs status  --echo <root> [--payload <dir>]
//   workshop-bootstrap.mjs install --echo <root> --payload <dir> [--packages <dir>] [--revision <id>] [--sync]
//
// install prints one JSON object per line: {"stage", "percent"} while working and
// {"done": true, ...} or {"error": "..."} last. It never overwrites a newer
// Loader (a self-update or a full install), the user's config, state, logs,
// backups or isolated runtime, and imports a bundled package only when it is
// missing or older than the bundled copy.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './echomod-archive.mjs';

const loaderDir = dirname(fileURLToPath(import.meta.url));
export const WORKSHOP_STATE_FILE = 'workshop.json';
// Written beside ECHO by an uninstall: an enabled Workshop item must not quietly
// reinstall the Loader on the next start. Only an explicit install clears it.
export const OPT_OUT_FILE = '.shinawase-uninstalled';
// Never copied over an existing install: user configuration, Loader state and
// everything the Loader or the installer writes at run time.
export const PRESERVED_ENTRIES = new Set(['loader.config.json', 'loader-state.json', 'native-host.json', WORKSHOP_STATE_FILE, 'Logs', 'backups', 'modded-runtime', 'node', 'node.exe']);
const MIN_ECHO_NODE_MAJOR = 22;

const readJson = (file, fallback = null) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/u, '')); } catch { return fallback; }
};
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

// Same ordering as compareVersions() in ShinawaseLoader.mjs: numeric parts,
// any count, so 1.8.1.1 > 1.8.1.
export const compareVersions = (left, right) => {
  const parts = (value) => String(value || '0').split(/[^\d]+/u).filter(Boolean).map((part) => Number(part) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) > (b[index] || 0) ? 1 : -1;
  }
  return 0;
};

export const loaderVersionAt = (loaderRoot) => {
  const version = readJson(join(loaderRoot, 'loader-version.json'), {})?.version;
  return typeof version === 'string' && version.trim() ? version.trim() : null;
};

// The trusted module runs in one of ECHO's utility processes, whose executable
// is the running ECHO. Inside the isolated runtime that is
// <root>/ShinawaseLoader/modded-runtime/ECHO(.exe); macOS nests it in a bundle.
export const locateEcho = (execPath, platform = process.platform) => {
  const normalized = String(execPath || '').replaceAll('\\', '/');
  const parts = normalized.split('/');
  const runtimeIndex = parts.findIndex((part, index) => part === 'modded-runtime' && parts[index - 1] === 'ShinawaseLoader');
  if (runtimeIndex > 1) {
    return { echoRoot: resolve(parts.slice(0, runtimeIndex - 1).join('/') || '/'), modded: true };
  }
  if (platform === 'darwin') {
    const appIndex = parts.findIndex((part) => part.endsWith('.app'));
    if (appIndex > 0) return { echoRoot: resolve(parts.slice(0, appIndex).join('/') || '/'), modded: false };
  }
  return { echoRoot: dirname(resolve(String(execPath || '.'))), modded: false };
};

// Electron's RunAsNode fuse is what lets the Loader run without a separate
// Node. Only trust it when this very process proves it: ECHO's executable,
// started with ELECTRON_RUN_AS_NODE, running a Node new enough for the Loader.
export const echoNodeUsable = (versions = process.versions, env = process.env) => Boolean(versions.electron)
  && env.ELECTRON_RUN_AS_NODE === '1'
  && Number(String(versions.node || '0').split('.')[0]) >= MIN_ECHO_NODE_MAJOR;

const hasOwnNode = (loaderRoot, config, platform) => {
  const runtimePath = typeof config.runtimePath === 'string' ? config.runtimePath.trim() : '';
  if (runtimePath && existsSync(runtimePath)) return true;
  return existsSync(join(loaderRoot, platform === 'win32' ? 'node.exe' : 'node'));
};

// Keys the Workshop install needs; everything else the user set stays.
export const mergeWorkshopConfig = (existing, defaults, { echoNode, ownNode }) => {
  const config = { ...(defaults || {}), ...(existing || {}) };
  config.autoStart = true;
  config.autoStartMode = 'app-asar-bridge';
  config.loadMode = config.loadMode || 'external-cdp';
  if (!ownNode && echoNode) config.nodeRuntime = 'echo';
  return config;
};

export const NODE_MODULES_ARCHIVE = 'node_modules.zip';
const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.clap', '.dll', '.dylib', '.exe', '.jar', '.msi', '.node', '.ps1', '.scr', '.so', '.sys', '.vbs', '.vst3']);

// The Workshop item carries npm's output as one archive (see
// scripts/build-workshop-item.mjs). Files are written over an existing
// node_modules, never outside it, and executable types are skipped even though
// the build already left them out.
export const extractNodeModules = (archive, target) => {
  const root = resolve(target);
  let written = 0;
  for (const entry of readZip(readFileSync(archive), { maxEntries: 50000, maxBytes: 1024 * 1024 * 1024 })) {
    const rel = String(entry.path || '').replaceAll('\\', '/');
    if (!rel || rel.endsWith('/')) continue;
    const parts = rel.split('/');
    if (parts.some((part) => !part || part === '.' || part === '..') || /^[a-z]:/iu.test(rel)) continue;
    const dot = rel.lastIndexOf('.');
    if (dot > rel.lastIndexOf('/') && BLOCKED_EXTENSIONS.has(rel.slice(dot).toLowerCase())) continue;
    const file = resolve(root, ...parts);
    const back = relative(root, file);
    if (!back || back.startsWith('..') || resolve(root, back) !== file) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, entry.data);
    written += 1;
  }
  return written;
};

export const planInstall = ({ payloadVersion, installedVersion, installedRevision, revision, workshopOwned }) => {
  if (!installedVersion) return 'install';
  const order = compareVersions(payloadVersion, installedVersion);
  if (order > 0) return 'update';
  if (order < 0) return 'keep-newer';
  // Same version: only a Workshop-owned install follows a changed revision.
  if (workshopOwned && revision && installedRevision && revision !== installedRevision) return 'update';
  return 'current';
};

const packageManifest = (file) => {
  try {
    const bytes = readFileSync(file);
    const entries = readZip(bytes, { maxEntries: 4096, maxBytes: 256 * 1024 * 1024 });
    const pick = (name) => entries.find((entry) => entry.path.replaceAll('\\', '/').toLowerCase() === name);
    const entry = pick('echo.mod.json') || pick('echo.plugin.json') || pick('manifest.json');
    if (!entry) return null;
    const manifest = JSON.parse(entry.data.toString('utf8').replace(/^﻿/u, ''));
    const kind = entry.path.toLowerCase().endsWith('echo.plugin.json') ? 'plugin' : 'mod';
    return typeof manifest?.id === 'string' ? { id: manifest.id, version: String(manifest.version || '0'), kind } : null;
  } catch {
    return null;
  }
};

const installedPackageVersion = (echoRoot, { id, kind }) => {
  const dir = kind === 'plugin' ? join(echoRoot, 'Plugins', 'installed', id) : join(echoRoot, 'Mods', 'installed', id);
  const manifest = readJson(join(dir, kind === 'plugin' ? 'echo.plugin.json' : 'echo.mod.json'), null);
  return manifest ? String(manifest.version || '0') : null;
};

export const planPackages = (packagesRoot, echoRoot) => {
  if (!packagesRoot || !existsSync(packagesRoot)) return [];
  return readdirSync(packagesRoot)
    .filter((name) => /\.echomod$/iu.test(name))
    .sort()
    .map((name) => {
      const file = join(packagesRoot, name);
      const manifest = packageManifest(file);
      if (!manifest) return { file, action: 'invalid' };
      const installed = installedPackageVersion(echoRoot, manifest);
      const action = !installed ? 'install' : compareVersions(manifest.version, installed) > 0 ? 'update' : 'keep';
      return { file, id: manifest.id, version: manifest.version, installed, action };
    });
};

export const status = ({ echoRoot, payloadRoot = null, execPath = process.execPath }) => {
  const root = resolve(echoRoot);
  const loaderRoot = join(root, 'ShinawaseLoader');
  const config = readJson(join(loaderRoot, 'loader.config.json'), {}) || {};
  const workshop = readJson(join(loaderRoot, WORKSHOP_STATE_FILE), null);
  const located = locateEcho(execPath);
  const runtimeExe = process.platform === 'win32' ? 'ECHO.exe' : 'ECHO';
  return {
    echoRoot: root,
    loaderRoot,
    modded: located.modded,
    platform: process.platform,
    payloadVersion: payloadRoot ? loaderVersionAt(payloadRoot) : null,
    installedVersion: loaderVersionAt(loaderRoot),
    workshopOwned: Boolean(workshop?.installedBy === 'workshop'),
    revision: workshop?.revision || null,
    installedAt: workshop?.installedAt || null,
    autoSwitch: workshop?.autoSwitch === true,
    lastSwitchAt: workshop?.lastSwitchAt || null,
    lastModdedStartAt: workshop?.lastModdedStartAt || null,
    edition: EDITIONS.includes(workshop?.edition) ? workshop.edition : null,
    optedOut: existsSync(join(root, OPT_OUT_FILE)),
    nodeRuntime: config.nodeRuntime || (config.runtimePath ? 'node' : null),
    autoStart: config.autoStart === true && config.autoStartMode === 'app-asar-bridge',
    runtimeReady: process.platform === 'darwin'
      ? existsSync(join(loaderRoot, 'modded-runtime'))
      : existsSync(join(loaderRoot, 'modded-runtime', runtimeExe)),
    launcher: existsSync(join(root, process.platform === 'win32' ? 'ECHO.modded.exe' : 'ECHO.modded.sh'))
      || existsSync(join(root, 'ECHO.modded.command')),
  };
};

const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);

const runChild = (args, env, timeoutMs) => new Promise((resolvePromise) => {
  const child = spawn(process.execPath, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const collect = (chunk) => { output = (output + chunk).slice(-8000); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
  child.once('error', (error) => { clearTimeout(timer); resolvePromise({ code: -1, output: error.message }); });
  child.once('exit', (code) => { clearTimeout(timer); resolvePromise({ code, output }); });
});

export const install = async ({ echoRoot, payloadRoot, packagesRoot = null, revision = null, sync = false, auto = false, log = emit }) => {
  const root = resolve(echoRoot);
  const optOut = join(root, OPT_OUT_FILE);
  if (existsSync(optOut)) {
    if (auto) {
      log({ stage: 'plan', plan: 'opted-out', percent: 100 });
      return { plan: 'opted-out', payloadVersion: null, installedVersion: loaderVersionAt(join(root, 'ShinawaseLoader')), imported: [], runtime: 'skipped' };
    }
    rmSync(optOut, { force: true });
  }
  const payload = resolve(payloadRoot);
  const loaderRoot = join(root, 'ShinawaseLoader');
  const payloadVersion = loaderVersionAt(payload);
  if (!payloadVersion || !existsSync(join(payload, 'ShinawaseLoader.mjs'))) throw new Error('workshop_payload_invalid');
  if (!existsSync(join(root, 'resources', 'app.asar')) && process.platform !== 'darwin') throw new Error(`echo_root_invalid:${root}`);
  const previous = readJson(join(loaderRoot, WORKSHOP_STATE_FILE), null);
  const plan = planInstall({
    payloadVersion,
    installedVersion: loaderVersionAt(loaderRoot),
    installedRevision: previous?.revision || null,
    revision,
    workshopOwned: previous?.installedBy === 'workshop',
  });
  log({ stage: 'plan', plan, payloadVersion, percent: 5 });
  for (const dir of [loaderRoot, join(loaderRoot, 'Logs'), join(root, 'Mods'), join(root, 'Plugins')]) mkdirSync(dir, { recursive: true });

  const copied = plan === 'install' || plan === 'update';
  if (copied) {
    log({ stage: 'copy', percent: 15 });
    const configExists = existsSync(join(loaderRoot, 'loader.config.json'));
    await cp(payload, loaderRoot, {
      recursive: true,
      force: true,
      filter: (source) => {
        const rel = relative(payload, source);
        if (!rel) return true;
        const top = rel.split(sep)[0];
        if (top === 'loader.config.json') return !configExists;
        if (top === NODE_MODULES_ARCHIVE) return false;
        return !PRESERVED_ENTRIES.has(top);
      },
    });
    if (existsSync(join(payload, NODE_MODULES_ARCHIVE))) {
      log({ stage: 'copy', percent: 30 });
      extractNodeModules(join(payload, NODE_MODULES_ARCHIVE), join(loaderRoot, 'node_modules'));
    }
  }

  log({ stage: 'config', percent: 45 });
  const configPath = join(loaderRoot, 'loader.config.json');
  const existing = readJson(configPath, null);
  const ownNode = hasOwnNode(loaderRoot, existing || {}, process.platform);
  const echoNode = echoNodeUsable();
  if (!ownNode && !echoNode) throw new Error('loader_node_runtime_unavailable');
  writeJson(configPath, mergeWorkshopConfig(existing, readJson(join(payload, 'loader.config.json'), {}), { echoNode, ownNode }));

  const childEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    // runtime-sync and the Loader read app.asar as a plain file.
    ELECTRON_NO_ASAR: '1',
    ECHO_GAME_ROOT: root,
    ECHO_MOD_HOME: loaderRoot,
    ECHO_MODS_HOME: join(root, 'Mods'),
    ECHO_PLUGINS_HOME: join(root, 'Plugins'),
    ECHO_LOGS_HOME: join(loaderRoot, 'Logs'),
  };
  const cli = join(loaderRoot, 'ShinawaseLoader.mjs');
  await runChild([cli, 'init'], childEnv, 60000);

  const packages = planPackages(packagesRoot, root);
  const imported = [];
  for (const [index, item] of packages.entries()) {
    if (item.action !== 'install' && item.action !== 'update') continue;
    log({ stage: 'packages', id: item.id, percent: 50 + Math.round((index / Math.max(1, packages.length)) * 20) });
    // --enable only switches on a fresh install; an update keeps the user's choice.
    const result = await runChild([cli, 'import', item.file, ...(item.action === 'install' ? ['--enable'] : [])], childEnv, 120000);
    imported.push({ id: item.id, version: item.version, action: item.action, ok: result.code === 0 });
  }

  let runtime = 'skipped';
  if (sync) {
    log({ stage: 'runtime', percent: 75 });
    const result = await runChild([join(loaderRoot, 'runtime-sync.mjs'), '--echo', root, '--loader', loaderRoot, '--skip-update'], childEnv, 300000);
    runtime = result.code === 0 ? 'synced' : `failed:${result.output.trim().split(/\r?\n/u).slice(-3).join(' | ').slice(0, 400)}`;
  }

  const installedVersion = loaderVersionAt(loaderRoot);
  writeJson(join(loaderRoot, WORKSHOP_STATE_FILE), {
    installedBy: copied ? 'workshop' : (previous?.installedBy || 'other'),
    payloadVersion,
    revision: copied ? revision : (previous?.revision || null),
    installedAt: copied ? new Date().toISOString() : (previous?.installedAt || null),
    autoSwitch: previous?.autoSwitch === true,
    lastSwitchAt: previous?.lastSwitchAt || null,
    lastModdedStartAt: previous?.lastModdedStartAt || null,
    ...(previous?.edition ? { edition: previous.edition } : {}),
  });
  return { plan, payloadVersion, installedVersion, imported, runtime };
};

const updateWorkshopState = (echoRoot, patch) => {
  const file = join(resolve(echoRoot), 'ShinawaseLoader', WORKSHOP_STATE_FILE);
  const current = readJson(file, null);
  if (!current) throw new Error('loader_not_installed');
  const next = { ...current, ...patch };
  writeJson(file, next);
  return next;
};

export const setAutoSwitch = (echoRoot, enabled) => updateWorkshopState(echoRoot, { autoSwitch: enabled === true }).autoSwitch;
// Which edition the user runs: "workshop" (this item starts and updates the
// Loader) or "external" (ECHO.modded.exe and the Loader's own self-update).
// Setup records it; both editions share the same Loader folder.
export const EDITIONS = ['workshop', 'external'];
export const setEdition = (echoRoot, edition) => {
  if (!EDITIONS.includes(edition)) throw new Error(`unknown edition: ${edition}`);
  return updateWorkshopState(echoRoot, { edition }).edition;
};
export const noteSwitch = (echoRoot, now = new Date()) => updateWorkshopState(echoRoot, { lastSwitchAt: now.toISOString() });
export const noteModdedStart = (echoRoot, now = new Date()) => updateWorkshopState(echoRoot, { lastModdedStartAt: now.toISOString() });

// Automatic switching ends the stock ECHO on every start, so it stops as soon
// as one switch did not reach the isolated runtime; a manual restart re-arms it.
export const autoSwitchAllowed = (state) => {
  if (!state?.autoSwitch || state.modded || !state.installedVersion || !state.runtimeReady) return false;
  if (!state.lastSwitchAt) return true;
  return Boolean(state.lastModdedStartAt) && Date.parse(state.lastModdedStartAt) >= Date.parse(state.lastSwitchAt);
};

const option = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const [command, ...argv] = process.argv.slice(2);
  const echoRoot = option(argv, '--echo');
  const payloadRoot = option(argv, '--payload') || loaderDir;
  try {
    if (!echoRoot) throw new Error('missing --echo');
    if (command === 'status') {
      emit(status({ echoRoot, payloadRoot }));
    } else if (command === 'install') {
      const result = await install({
        echoRoot,
        payloadRoot,
        packagesRoot: option(argv, '--packages') || null,
        revision: option(argv, '--revision') || null,
        sync: argv.includes('--sync'),
        auto: argv.includes('--auto'),
      });
      emit({ done: true, percent: 100, ...result });
    } else {
      throw new Error(`unknown command: ${command || '(none)'}`);
    }
  } catch (error) {
    emit({ error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}

