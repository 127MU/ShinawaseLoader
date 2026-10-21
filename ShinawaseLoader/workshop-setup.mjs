#!/usr/bin/env node
// Setup side of the ECHO Workshop edition. The Shinawase Manager and the
// console installer run this on ECHO's own executable in Node mode
// (ELECTRON_RUN_AS_NODE=1, ELECTRON_NO_ASAR=1) to install, update and start
// the Workshop edition through ECHO itself:
//
//   1. start the stock ECHO with a loopback debugging port;
//   2. hand shinawase-workshop.zip to ECHO's own Workshop zip import (the same
//      path as dropping the file on ECHO's Workshop page), so ECHO verifies
//      the package and asks for the `system:full` approval in its own dialog.
//      This script never answers that dialog;
//   3. wait for the item's trusted module to install or update the Loader;
//   4. close that ECHO and reopen it in the isolated runtime that loads Mods.
//
//   workshop-setup.mjs inspect --zip <file>
//   workshop-setup.mjs install --echo <root> --zip <file> [--port <n>] [--approval-timeout <seconds>] [--no-switch]
//
// Output: one JSON object per line ({"event": "stage" | "log", ...}); the last
// line is {"event": "result", "ok": ...}.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './echomod-archive.mjs';
import { DARWIN_APP_NAMES, LINUX_EXE_NAMES } from './platform.mjs';
import { RendererClient } from './testing/client.mjs';
import { compareVersions, setEdition } from './workshop-bootstrap.mjs';

export const WORKSHOP_ITEM_ID = 'shinawase.loader';
export const WORKSHOP_ZIP_NAME = 'shinawase-workshop.zip';
const ECHO_APP_ID = '5105090';
const DROP_INPUT_ID = '__shinawaseWorkshopZip';
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
const readJson = (file, fallback = null) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/u, '')); } catch { return fallback; }
};

// Reads the item id and both versions from a Workshop zip without extracting it.
export const inspectWorkshopZip = (file) => {
  const entries = readZip(readFileSync(file), { maxEntries: 50000, maxBytes: 1024 * 1024 * 1024 });
  const pick = (path) => entries.find((entry) => entry.path.replaceAll('\\', '/').replace(/^\.\//u, '') === path);
  const manifestEntry = pick('echo.workshop.json');
  if (!manifestEntry) throw new Error('workshop_zip_manifest_missing');
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  if (manifest?.type !== 'echo-workshop-item' || manifest.id !== WORKSHOP_ITEM_ID || manifest.content?.kind !== 'plugin-package') throw new Error('workshop_zip_not_shinawase');
  const loader = pick('assets/loader/loader-version.json');
  const loaderVersion = loader ? String(JSON.parse(loader.data.toString('utf8')).version || '') : '';
  if (!loaderVersion) throw new Error('workshop_zip_loader_missing');
  return { id: manifest.id, version: String(manifest.version), loaderVersion, files: entries.length };
};

// Several copies can exist (a local import and a Steam subscription); prefer an
// enabled one, then the local import this setup manages.
export const findItem = (plugins, id = WORKSHOP_ITEM_ID) => {
  const matches = (Array.isArray(plugins) ? plugins : []).filter((plugin) => plugin?.pluginId === id);
  return matches.find((plugin) => plugin.enabled && plugin.sourceId === 'local')
    || matches.find((plugin) => plugin.enabled)
    || matches.find((plugin) => plugin.sourceId === 'local')
    || matches[0]
    || null;
};

export const itemReady = (item, version) => Boolean(item && item.enabled && !item.error && item.version === version);

export const stockExecutable = (echoRoot, platform = process.platform) => {
  if (platform === 'win32') return join(echoRoot, 'ECHO.exe');
  if (platform === 'darwin') {
    for (const name of DARWIN_APP_NAMES) {
      const binary = join(echoRoot, name, 'Contents', 'MacOS', 'ECHO');
      if (existsSync(binary)) return binary;
    }
    return join(echoRoot, DARWIN_APP_NAMES[0], 'Contents', 'MacOS', 'ECHO');
  }
  return LINUX_EXE_NAMES.map((name) => join(echoRoot, name)).find((file) => existsSync(file)) || join(echoRoot, LINUX_EXE_NAMES[0]);
};

// ECHO itself must start as the app, never in this script's Node mode.
export const echoLaunchEnv = (env = process.env) => {
  const next = { ...env, SteamAppId: ECHO_APP_ID, SteamGameId: ECHO_APP_ID };
  delete next.ELECTRON_RUN_AS_NODE;
  delete next.ELECTRON_NO_ASAR;
  return next;
};

const portFree = (port) => new Promise((resolvePromise) => {
  const server = createServer();
  server.once('error', () => resolvePromise(false));
  server.listen({ port, host: '127.0.0.1' }, () => server.close(() => resolvePromise(true)));
});
export const pickPort = async (preferred = 9339, span = 40) => {
  for (let port = preferred; port < preferred + span; port += 1) if (await portFree(port)) return port;
  throw new Error('no_free_debug_port');
};

const browserClose = async (port) => {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(3000) }).then((response) => response.json());
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => { socket.onopen = resolvePromise; socket.onerror = reject; });
  socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  await sleep(500);
  try { socket.close(); } catch {}
};

const cdpUp = async (port) => {
  try {
    const list = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) }).then((response) => response.json());
    return Array.isArray(list) && list.some((target) => target.type === 'page');
  } catch {
    return false;
  }
};

const loaderUp = async (port) => {
  try {
    const status = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(5000) }).then((response) => response.json());
    return status?.ok === true;
  } catch {
    return false;
  }
};

// The stock ECHO this script starts. A second ECHO only focuses the first one
// (single-instance lock), so an early exit means ECHO was already running.
const launchStock = async ({ echoRoot, port, emit, spawnChild = spawn }) => {
  const executable = stockExecutable(echoRoot);
  if (!existsSync(executable)) throw new Error(`echo_executable_missing:${executable}`);
  const child = spawnChild(executable, [`--remote-debugging-port=${port}`], { cwd: echoRoot, env: echoLaunchEnv(), detached: true, stdio: 'ignore' });
  let exited = null;
  child.once('exit', (code) => { exited = code ?? 0; });
  child.unref?.();
  emit({ event: 'stage', stage: 'echo', port });
  for (let tries = 0; tries < 120; tries += 1) {
    await sleep(750);
    if (await cdpUp(port)) return child.pid;
    if (exited !== null) throw new Error('echo_already_running');
  }
  throw new Error('echo_debug_port_timeout');
};

const evaluate = async (renderer, expression, fallback = null) => {
  try { return await renderer.evalValue(expression); } catch { return fallback; }
};
const plugins = async (renderer) => (await evaluate(renderer, '(async () => (await window.echo.workshop.getPlugins())?.plugins || [])()', [])) || [];
const trusted = (renderer, item, method, input = {}) => renderer.evalValue(`(async () => window.echo.workshop.invokeTrustedPlugin(${JSON.stringify({ sourceId: item.sourceId, itemId: item.itemId, method, input })}))()`);

// Drops the zip on ECHO's Workshop page the way a user would, so ECHO runs its
// own import, verification and approval prompt.
const dropZip = async (renderer, zipPath) => {
  // ECHO ignores the route event until its shell has mounted, so repeat it.
  let page = false;
  for (let tries = 0; tries < 45 && !page; tries += 1) {
    await renderer.evalValue(`(() => { window.dispatchEvent(new CustomEvent('app:navigate:route', { detail: 'workshop' })); return true; })()`);
    await sleep(2000);
    page = await evaluate(renderer, "Boolean(document.querySelector('main.workshop-page'))", false);
  }
  if (!page) throw new Error('workshop_page_unavailable');
  await renderer.evalValue(`(() => { document.getElementById('${DROP_INPUT_ID}')?.remove(); const input = document.createElement('input'); input.type = 'file'; input.id = '${DROP_INPUT_ID}'; input.style.display = 'none'; document.body.append(input); return true; })()`);
  const { root } = await renderer.call('DOM.getDocument', { depth: 0 });
  const { nodeId } = await renderer.call('DOM.querySelector', { nodeId: root.nodeId, selector: `#${DROP_INPUT_ID}` });
  await renderer.call('DOM.setFileInputFiles', { nodeId, files: [resolve(zipPath)] });
  return renderer.evalValue(`(() => {
    const input = document.getElementById('${DROP_INPUT_ID}');
    const file = input?.files?.[0];
    const page = document.querySelector('main.workshop-page');
    if (!file || !page) return 'unavailable';
    const data = new DataTransfer();
    data.items.add(file);
    page.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: data }));
    page.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
    setTimeout(() => input.remove(), 1000);
    return 'dropped';
  })()`, { awaitPromise: false });
};

const waitForApproval = async ({ renderer, info, emit, timeoutMs, dialogs }) => {
  const deadline = Date.now() + timeoutMs;
  let announced = false;
  let lastLog = 0;
  while (Date.now() < deadline) {
    if (dialogs.declined) throw new Error('approval_declined');
    if (Date.now() - lastLog > 10000 && !dialogs.open) {
      lastLog = Date.now();
      const item = findItem(await plugins(renderer));
      const notice = await evaluate(renderer, "(() => { const n = document.querySelector('main.workshop-page [role=status], main.workshop-page [role=alert], main.workshop-page [class*=notice]'); return n ? n.textContent.trim().slice(0, 200) : null; })()");
      emit({ event: 'log', message: `waiting: item=${item ? `${item.sourceId}/${item.version}/${item.enabled ? 'enabled' : 'disabled'}` : 'none'}${notice ? ` notice=${notice}` : ''}` });
    }
    // ECHO shows its confirmation once the import is verified; until then the
    // item may already be listed as disabled.
    if (dialogs.open && !announced) {
      announced = true;
      emit({ event: 'stage', stage: 'approve' });
    }
    if (!dialogs.open) {
      const item = findItem(await plugins(renderer));
      if (itemReady(item, info.version)) return item;
      if (item?.error) throw new Error(`workshop_item_error:${item.error}`);
      if (!announced && item && item.version === info.version && !item.enabled) {
        announced = true;
        emit({ event: 'stage', stage: 'approve' });
      }
    }
    await sleep(1000);
  }
  throw new Error('approval_timeout');
};

const waitForLoader = async ({ renderer, item, info, emit, timeoutMs = 15 * 60 * 1000 }) => {
  const deadline = Date.now() + timeoutMs;
  let kicked = false;
  while (Date.now() < deadline) {
    let state = null;
    try { state = await trusted(renderer, item, 'status'); } catch (error) { emit({ event: 'log', message: `status: ${error instanceof Error ? error.message : error}` }); }
    if (state) {
      const job = state.job;
      if (job && !job.done) emit({ event: 'stage', stage: 'loader', step: job.stage, percent: job.percent || 0 });
      else if (job && job.done && !job.ok) throw new Error(`loader_install_failed:${job.error || 'unknown'}`);
      else if (state.installedVersion && compareVersions(state.installedVersion, info.loaderVersion) >= 0 && state.runtimeReady) return state;
      else if (!kicked) {
        kicked = true;
        await trusted(renderer, item, 'install').catch(() => undefined);
      }
    }
    await sleep(1000);
  }
  throw new Error('loader_install_timeout');
};

export const installWorkshop = async ({ echoRoot, zip, port = null, approvalTimeoutMs = 10 * 60 * 1000, switchToMods = true, emit = () => {} }) => {
  const root = resolve(echoRoot);
  const info = inspectWorkshopZip(zip);
  emit({ event: 'stage', stage: 'zip', version: info.version, loaderVersion: info.loaderVersion });
  const debugPort = port || await pickPort();
  const echoPid = await launchStock({ echoRoot: root, port: debugPort, emit });
  let renderer = null;
  for (let tries = 0; tries < 40 && !renderer; tries += 1) {
    // ECHO re-verifies the item's files on each call into its trusted module,
    // which can take longer than an ordinary evaluation.
    try { renderer = await RendererClient.connect({ debugPort, timeoutMs: 90000 }); } catch { await sleep(750); }
  }
  if (!renderer) throw new Error('echo_main_window_missing');
  try {
    await renderer.waitForTrue('Boolean(window.echo?.workshop?.getPlugins && window.echo.workshop.invokeTrustedPlugin)', { timeoutMs: 60000, label: 'workshop api' });
    const dialogs = { open: false, declined: false };
    await renderer.call('Page.enable');
    renderer.on('Page.javascriptDialogOpening', () => { dialogs.open = true; });
    renderer.on('Page.javascriptDialogClosed', (params) => { dialogs.open = false; if (params?.result === false) dialogs.declined = true; });

    // ECHO lists Workshop items only after its startup reconcile; give an
    // existing install a moment to appear before importing again.
    let item = null;
    for (let tries = 0; tries < 20 && !item; tries += 1) {
      item = findItem(await plugins(renderer));
      if (!item) await sleep(1000);
    }
    const already = itemReady(item, info.version);
    emit({ event: 'stage', stage: 'import', already });
    if (!already) {
      const dropped = await dropZip(renderer, zip);
      if (dropped !== 'dropped') throw new Error('workshop_page_unavailable');
      item = await waitForApproval({ renderer, info, emit, timeoutMs: approvalTimeoutMs, dialogs });
    }
    emit({ event: 'stage', stage: 'loader', percent: 0 });
    const state = await waitForLoader({ renderer, item, info, emit });
    setEdition(root, 'workshop');
    let switched = false;
    if (switchToMods) {
      emit({ event: 'stage', stage: 'switch' });
      // The trusted module schedules the launcher to wait for this ECHO's exit.
      await trusted(renderer, item, 'restart', { force: false, relaunch: true });
      renderer.close();
      renderer = null;
      await browserClose(debugPort).catch(() => undefined);
      // Either signal proves the isolated runtime is up: its debugging port, or
      // the Loader API that its main process starts.
      const config = readJson(join(root, 'ShinawaseLoader', 'loader.config.json'), {}) || {};
      const moddedPort = Number(config.debugPort) || 9229;
      const apiPort = Number(config.port) || 17862;
      for (let tries = 0; tries < 160 && !switched; tries += 1) {
        await sleep(750);
        switched = await cdpUp(moddedPort) || await loaderUp(apiPort);
      }
      if (!switched) throw new Error('mods_runtime_start_timeout');
    } else {
      // Do not leave the stock ECHO running with the debugging port this
      // script opened; the user starts the Mods runtime later.
      emit({ event: 'stage', stage: 'switch', close: true });
      renderer.close();
      renderer = null;
      await browserClose(debugPort).catch(() => undefined);
    }
    return { ok: true, version: info.version, loaderVersion: state.installedVersion, item: { sourceId: item.sourceId, itemId: item.itemId }, imported: !already, switched, echoPid };
  } finally {
    renderer?.close();
  }
};

const option = (argv, name) => {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
};

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
  const [command, ...argv] = process.argv.slice(2);
  const run = async () => {
    const zip = option(argv, '--zip') || join(dirname(dirname(fileURLToPath(import.meta.url))), WORKSHOP_ZIP_NAME);
    if (command === 'inspect') return { ok: true, ...inspectWorkshopZip(zip) };
    if (command !== 'install') throw new Error(`unknown command: ${command || '(none)'}`);
    const echoRoot = option(argv, '--echo');
    if (!echoRoot) throw new Error('missing --echo');
    return installWorkshop({
      echoRoot,
      zip,
      port: Number(option(argv, '--port')) || null,
      approvalTimeoutMs: (Number(option(argv, '--approval-timeout')) || 600) * 1000,
      switchToMods: !argv.includes('--no-switch'),
      emit,
    });
  };
  run().then(
    (result) => { emit({ event: 'result', ...result }); },
    (error) => { emit({ event: 'result', ok: false, error: error instanceof Error ? error.message : String(error) }); process.exitCode = 1; },
  );
}
