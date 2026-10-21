/**
 * ShinawaseLoader Workshop bootstrap (trustedEntry, `system:full`).
 *
 * ECHO starts this module in its own utility process only after the
 * subscriber approves desktop-application-equivalent access. It installs the
 * Loader shipped under content/assets/loader into <ECHO_ROOT>/ShinawaseLoader
 * (never over a newer Loader, the user's config or Mods) and, on request,
 * reopens ECHO in the isolated runtime that loads Mods. The heavy work runs in
 * child processes on ECHO's own executable in Node mode so this process keeps
 * answering ECHO's heartbeats.
 *
 * Methods: status, install, restart { force }, setAutoSwitch { enabled }.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

let job = null;
let bootstrapModule = null;
let restartScheduled = false;

const payloadRoot = (context) => join(context.contentRoot, 'assets', 'loader');
const packagesRoot = (context) => join(context.contentRoot, 'assets', 'packages');
// The runner loads this module from a data: URL, so the Loader's own modules
// are imported by absolute file URL from the verified content root.
const bootstrap = async (context) => {
  bootstrapModule ??= await import(pathToFileURL(join(payloadRoot(context), 'workshop-bootstrap.mjs')).href);
  return bootstrapModule;
};
// ELECTRON_NO_ASAR: without it Electron's fs shows app.asar as a directory.
const nodeEnv = (extra = {}) => ({ ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1', ...extra });
const jobSnapshot = () => (job ? { ...job } : null);
const errorText = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

const readPort = (loaderRoot) => {
  try {
    const config = JSON.parse(readFileSync(join(loaderRoot, 'loader.config.json'), 'utf8').replace(/^﻿/u, ''));
    return Number(config.port) > 0 ? Number(config.port) : 17862;
  } catch {
    return 17862;
  }
};

const probeLoader = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/status`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return null;
    const value = await response.json();
    return { version: value?.loaderVersion || null, loadMode: value?.loadMode || null };
  } catch {
    return null;
  }
};

const describe = async (context) => {
  const mod = await bootstrap(context);
  const located = mod.locateEcho(process.execPath);
  const state = mod.status({ echoRoot: located.echoRoot, payloadRoot: payloadRoot(context) });
  const plan = mod.planInstall({
    payloadVersion: state.payloadVersion,
    installedVersion: state.installedVersion,
    installedRevision: state.revision,
    revision: context.revision,
    workshopOwned: state.workshopOwned,
  });
  return {
    ...state,
    plan,
    autoSwitchPaused: state.autoSwitch && !state.modded && !mod.autoSwitchAllowed(state),
    loader: state.modded ? await probeLoader(readPort(state.loaderRoot)) : null,
    job: jobSnapshot(),
    restartScheduled,
  };
};

const startInstall = async (context, { auto = false } = {}) => {
  if (job && !job.done) return jobSnapshot();
  const mod = await bootstrap(context);
  const located = mod.locateEcho(process.execPath);
  const current = { kind: 'install', startedAt: new Date().toISOString(), stage: 'start', percent: 0, done: false, ok: false, error: null, result: null };
  job = current;
  const args = [
    join(payloadRoot(context), 'workshop-bootstrap.mjs'), 'install',
    '--echo', located.echoRoot,
    '--payload', payloadRoot(context),
    '--packages', packagesRoot(context),
    '--revision', String(context.revision || ''),
  ];
  // The running isolated runtime locks its own files; its launcher re-syncs on
  // the next start anyway.
  if (!located.modded) args.push('--sync');
  // Automatic runs respect an uninstall done outside ECHO (OPT_OUT_FILE).
  if (auto) args.push('--auto');
  const child = spawn(process.execPath, args, { env: nodeEnv(), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffer = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    for (let index = buffer.indexOf('\n'); index >= 0; index = buffer.indexOf('\n')) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      if (message.error) current.error = String(message.error).slice(0, 300);
      else if (message.done) current.result = message;
      else {
        if (message.stage) current.stage = message.stage;
        if (Number.isFinite(message.percent)) current.percent = message.percent;
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-2000); });
  child.once('error', (error) => {
    current.done = true;
    current.error = errorText(error);
  });
  child.once('exit', (code) => {
    current.done = true;
    current.ok = code === 0 && !current.error && Boolean(current.result);
    if (current.ok) current.percent = 100;
    else if (!current.error) current.error = stderr.trim().split(/\r?\n/u).pop() || `exit ${code}`;
  });
  return jobSnapshot();
};

const waitForJob = async () => {
  while (job && !job.done) await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  return job;
};

// ECHO holds a single-instance lock, so the isolated runtime can only start
// after this ECHO exits. The detached launcher waits for that; `force` ends
// this ECHO right away (the subscriber confirmed it in the panel). `relaunch`
// also restarts an ECHO that already runs with Mods, after an update.
const restart = async (context, { force = false, relaunch = false } = {}) => {
  const mod = await bootstrap(context);
  const located = mod.locateEcho(process.execPath);
  if (located.modded && !relaunch) throw new Error('already_running_with_mods');
  await waitForJob();
  const state = mod.status({ echoRoot: located.echoRoot, payloadRoot: payloadRoot(context) });
  if (!state.installedVersion) throw new Error('loader_not_installed');
  if (!state.runtimeReady) throw new Error('isolated_runtime_missing');
  const mainPid = process.ppid;
  if (!restartScheduled) {
    mod.noteSwitch(located.echoRoot);
    const host = spawn(process.execPath, [join(state.loaderRoot, 'echo-modded-host.mjs'), '--wait-pid', String(mainPid)], {
      cwd: located.echoRoot,
      env: nodeEnv({ ECHO_GAME_ROOT: located.echoRoot, ECHO_MOD_HOME: state.loaderRoot }),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    host.unref();
    restartScheduled = true;
  }
  if (force) setTimeout(() => { try { process.kill(mainPid); } catch {} }, 800);
  return { scheduled: true, force: force === true };
};

export async function activate(context) {
  // Install or follow a Workshop update in the background on every start; the
  // bootstrap leaves a newer or foreign Loader untouched.
  const state = await describe(context).catch(() => null);
  if (!state) return;
  if (state.modded && state.installedVersion) {
    try { (await bootstrap(context)).noteModdedStart(state.echoRoot); } catch {}
  }
  if ((state.plan === 'install' || state.plan === 'update') && !state.optedOut) await startInstall(context, { auto: true }).catch(() => undefined);
  if ((await bootstrap(context)).autoSwitchAllowed(state)) {
    void waitForJob().then(() => restart(context, { force: true })).catch(() => undefined);
  }
}

export async function handle(request, context) {
  const input = request.input && typeof request.input === 'object' ? request.input : {};
  switch (request.method) {
    case 'status':
      return describe(context);
    case 'install':
      return startInstall(context);
    case 'restart':
      return restart(context, { force: input.force === true, relaunch: input.relaunch === true });
    case 'setAutoSwitch': {
      const mod = await bootstrap(context);
      return { autoSwitch: mod.setAutoSwitch(mod.locateEcho(process.execPath).echoRoot, input.enabled === true) };
    }
    default:
      throw new Error(`Unknown method: ${request.method}`);
  }
}
