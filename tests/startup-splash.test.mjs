// Startup splash: launch decision, window geometry, the asar bridge block, and
// the hold/replay contract with ECHO's main window, driven through a fake
// Electron. No ECHO, network, or display is needed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { injectSplashBridge, PATCH_REVISION } from '../ShinawaseLoader/echo-asar.mjs';
import { fingerprintStock, syncModdedRuntime } from '../ShinawaseLoader/runtime-sync.mjs';

const require = createRequire(import.meta.url);
const splashModule = require('../ShinawaseLoader/startup-splash.cjs');
const {
  installShinawaseStartupSplash, splashDecision, isMainRendererUrl, predictMainBounds, cardBounds, enabledPackageCount, CARD,
} = splashModule;

const MAIN_URL = 'file:///C:/Games/ECHO/ShinawaseLoader/modded-runtime/resources/app.asar/out/renderer/index.html';
const display = (id, x, y, width, height, taskbar = 40) => ({
  id,
  bounds: { x, y, width, height },
  workArea: { x, y, width, height: height - taskbar },
});
const PRIMARY = display(1, 0, 0, 1920, 1080);
const SECONDARY = display(2, 1920, 0, 2560, 1440);

test('splash is on by default and steps aside for opt-outs and windowless launches', () => {
  assert.deepEqual(splashDecision({ argv: ['ECHO.exe'], env: {}, config: {} }), { enabled: true, reason: null });
  assert.equal(splashDecision({ config: { ui: { startupSplash: false } } }).reason, 'config');
  assert.equal(splashDecision({ config: { startupSplash: false } }).reason, 'config');
  assert.equal(splashDecision({ env: { SHINAWASE_STARTUP_SPLASH: '0' } }).reason, 'env');
  for (const flag of ['--no-startup-splash', '--no-mod-loader', '--echo-cli', '--cli', '--echo-ultra-light-gpu-runtime', '--echo-ultra-light-restored']) {
    assert.equal(splashDecision({ argv: ['ECHO.exe', flag] }).enabled, false, flag);
  }
  assert.equal(splashDecision({ argv: ['ECHO.exe', '--remote-debugging-port=9229'] }).enabled, true);
});

test('only the plain main renderer document counts as ECHO main window', () => {
  assert.equal(isMainRendererUrl(MAIN_URL), true);
  assert.equal(isMainRendererUrl(`${MAIN_URL}?windowAcrylic=1`), true);
  for (const url of [
    `${MAIN_URL}?miniPlayer=1`, `${MAIN_URL}?pet=1`, `${MAIN_URL}?desktopWall=1`, `${MAIN_URL}?echo-cli=1`,
    MAIN_URL.replace('index.html', 'auxiliary.html'), MAIN_URL.replace('index.html', 'quick-search.html'),
    'data:text/html,<p>console</p>', '', 'about:blank', null,
  ]) {
    assert.equal(isMainRendererUrl(url), false, String(url));
  }
});

test('the predicted main window follows ECHO remembered placement', () => {
  const displays = [PRIMARY, SECONDARY];
  const maximized = predictMainBounds({ settings: { rememberedWindowSize: { x: 2000, y: 40, width: 1400, height: 900, maximized: true, displayId: 2 } }, displays, primary: PRIMARY });
  assert.equal(maximized.display, SECONDARY);
  assert.deepEqual(maximized.rect, SECONDARY.workArea);
  const normal = predictMainBounds({ settings: { rememberedWindowSize: { x: 540, y: 30, width: 1332, height: 764, maximized: false, displayId: 99 } }, displays, primary: PRIMARY });
  assert.equal(normal.display, PRIMARY);
  assert.deepEqual(normal.rect, { x: 540, y: 30, width: 1332, height: 764 });
  const clipped = predictMainBounds({ settings: { rememberedWindowSize: { x: 1800, y: 900, width: 1332, height: 764 } }, displays, primary: PRIMARY });
  assert.deepEqual(clipped.rect, { x: 588, y: 276, width: 1332, height: 764 });
  const fallback = predictMainBounds({ settings: { rememberWindowSizeEnabled: false, rememberedWindowSize: { x: 1, y: 1, width: 900, height: 700 } }, displays, primary: PRIMARY });
  assert.deepEqual(fallback.rect, { x: 120, y: 0, width: 1680, height: 1040 });
  assert.deepEqual(predictMainBounds({ settings: null, displays, primary: PRIMARY }).rect, fallback.rect);
});

test('the card is centered on the predicted window and stays on its display', () => {
  assert.deepEqual(CARD, { width: 560, height: 320 });
  const centered = cardBounds({ display: PRIMARY, rect: { x: 120, y: 0, width: 1680, height: 1040 } });
  assert.deepEqual(centered, { x: 680, y: 360, width: 560, height: 320 });
  const secondary = cardBounds({ display: SECONDARY, rect: SECONDARY.workArea });
  assert.deepEqual(secondary, { x: 2920, y: 540, width: 560, height: 320 });
  // A window hanging off the corner of its display still gets a fully visible card.
  const edge = cardBounds({ display: PRIMARY, rect: { x: 1700, y: 900, width: 300, height: 200 } });
  assert.deepEqual(edge, { x: 1360, y: 720, width: 560, height: 320 });
});

test('enabled package count reads loader-state.json and tolerates a missing file', () => {
  const root = mkdtempSync(join(tmpdir(), 'shinawase-splash-state-'));
  try {
    assert.equal(enabledPackageCount(root), 0);
    writeFileSync(join(root, 'loader-state.json'), JSON.stringify({ version: 2, mods: { a: { enabled: true }, b: { enabled: false }, c: { enabled: true, kind: 'plugin' } } }));
    assert.equal(enabledPackageCount(root), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the page plays the intro length the controller budgets for and exposes its API', () => {
  const html = readFileSync(new URL('../ShinawaseLoader/startup-splash.html', import.meta.url), 'utf8');
  const cjs = readFileSync(new URL('../ShinawaseLoader/startup-splash.cjs', import.meta.url), 'utf8');
  const introPage = Number(/const INTRO_END = reduced \? \d+ : (\d+);/u.exec(html)?.[1]);
  const introMain = Number(/const INTRO_MS = (\d+);/u.exec(cjs)?.[1]);
  assert.ok(introPage > 0 && introPage === introMain, `page ${introPage} vs controller ${introMain}`);
  for (const method of ['start', 'stage', 'whenIntroDone', 'outro', 'finish', 'dismiss']) {
    assert.match(html, new RegExp(`\\n {4}(?:async )?${method}\\(`, 'u'), method);
  }
  assert.match(html, /Content-Security-Policy" content="default-src 'none';/u, 'page stays offline');
  assert.doesNotMatch(html, /\bsrc=["']https?:/u);
});

test('the asar block is injected once and loads startup-splash.cjs from the Loader folder', () => {
  const main = 'import { app } from "electron";\nconsole.log("echo main");\n';
  const once = injectSplashBridge(main);
  assert.ok(once.startsWith('/* shinawase-loader-startup-splash-v1 */'));
  assert.ok(once.endsWith(main));
  assert.equal(injectSplashBridge(once), once);
  assert.ok(PATCH_REVISION >= 2);

  const root = mkdtempSync(join(tmpdir(), 'shinawase-splash-bridge-'));
  try {
    const loaderRoot = join(root, 'ShinawaseLoader');
    mkdirSync(loaderRoot);
    writeFileSync(join(loaderRoot, 'startup-splash.cjs'), 'exports.installShinawaseStartupSplash = (options) => { globalThis.__splashProbe = options; };');
    const block = once.slice(0, once.length - main.length);
    const context = {
      app: {},
      console,
      process: {
        env: { ECHO_MOD_ROOT: root, ECHO_MOD_HOME: loaderRoot },
        platform: process.platform,
        resourcesPath: join(root, 'resources'),
        getBuiltinModule: (name) => require(name),
      },
    };
    // The stub is loaded through Node's module system, so it reports on this realm's global.
    delete globalThis.__splashProbe;
    vm.runInNewContext(block, context);
    assert.equal(globalThis.__splashProbe?.loaderRoot, loaderRoot);
    // Outside ECHO's main entry (no app binding) the block does nothing.
    delete globalThis.__splashProbe;
    vm.runInNewContext(block, { ...context, app: undefined });
    assert.equal(globalThis.__splashProbe, undefined);
  } finally {
    delete globalThis.__splashProbe;
    rmSync(root, { recursive: true, force: true });
  }
});

test('runtimes patched before the splash block are rebuilt once, then stay current', { skip: process.platform === 'darwin' && 'macOS runtimes are app bundles' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'shinawase-splash-revision-'));
  try {
    const exeName = process.platform === 'win32' ? 'ECHO.exe' : 'ECHO';
    mkdirSync(join(root, 'resources'));
    writeFileSync(join(root, exeName), 'stock exe');
    writeFileSync(join(root, 'resources', 'app.asar'), 'not a real archive');
    const loaderRoot = join(root, 'ShinawaseLoader');
    const runtime = join(loaderRoot, 'modded-runtime');
    mkdirSync(join(runtime, 'resources'), { recursive: true });
    mkdirSync(join(loaderRoot, 'backups'), { recursive: true });
    writeFileSync(join(runtime, exeName), 'runtime exe');
    writeFileSync(join(runtime, 'resources', 'app.asar'), 'runtime archive');
    const fingerprint = join(loaderRoot, 'backups', 'runtime-sync.json');
    const stock = fingerprintStock(root);
    // Written by a Loader that predates patch revisions.
    writeFileSync(fingerprint, JSON.stringify({ ...stock, patchStatus: 'patched' }));
    const outdated = syncModdedRuntime({ echoRoot: root, loaderRoot });
    assert.equal(outdated.reason, 'patch-outdated');
    assert.equal(JSON.parse(readFileSync(fingerprint, 'utf8')).patchRevision, PATCH_REVISION);
    writeFileSync(fingerprint, JSON.stringify({ ...stock, patchStatus: 'patched', patchRevision: PATCH_REVISION }));
    assert.equal(syncModdedRuntime({ echoRoot: root, loaderRoot }).status, 'current');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------- fake Electron

const flush = async (rounds = 6) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const createEnvironment = ({ config = {}, displays = [PRIMARY] } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'shinawase-splash-'));
  const loaderRoot = join(root, 'ShinawaseLoader');
  const userData = join(root, 'userData');
  mkdirSync(loaderRoot);
  mkdirSync(userData);
  writeFileSync(join(loaderRoot, 'startup-splash.html'), '<!doctype html>');
  writeFileSync(join(loaderRoot, 'loader.config.json'), JSON.stringify({ locale: 'zh', ...config }));
  writeFileSync(join(loaderRoot, 'loader-version.json'), JSON.stringify({ version: '9.9.9' }));
  writeFileSync(join(loaderRoot, 'loader-state.json'), JSON.stringify({ mods: { a: { enabled: true } } }));

  const app = new EventEmitter();
  let markReady;
  const ready = new Promise((resolve) => { markReady = resolve; });
  Object.assign(app, {
    whenReady: () => ready,
    getPath: () => userData,
    getLocale: () => 'zh-CN',
    isHardwareAccelerationEnabled: () => true,
  });
  const page = { started: 0, stages: [], outro: [], finished: 0, dismissed: 0, introDone: null, releaseIntro: null };
  page.introDone = new Promise((resolve) => { page.releaseIntro = resolve; });
  const windows = [];

  class FakeContents extends EventEmitter {
    constructor(owner) {
      super();
      this.owner = owner;
      this.url = '';
      this.destroyed = false;
    }

    getURL() { return this.url; }

    isDestroyed() { return this.destroyed; }

    setWindowOpenHandler() {}

    executeJavaScript(code) {
      const calls = [...code.matchAll(/shinawaseSplash\.(\w+)\(([^)]*)\)/gu)];
      let result = Promise.resolve(true);
      for (const [, method, args] of calls) {
        if (method === 'start') page.started += 1;
        else if (method === 'stage') page.stages.push(JSON.parse(args));
        else if (method === 'whenIntroDone') result = page.introDone;
        else if (method === 'outro') page.outro.push(args ? JSON.parse(args) : null);
        else if (method === 'finish') page.finished += 1;
        else if (method === 'dismiss') page.dismissed += 1;
      }
      return result;
    }
  }

  class FakeWindow extends EventEmitter {
    static getAllWindows() { return windows.filter((item) => !item.destroyed); }

    constructor(options = {}) {
      super();
      this.options = options;
      this.calls = [];
      this.destroyed = false;
      this.visible = false;
      this.webContents = new FakeContents(this);
      windows.push(this);
      app.emit('browser-window-created', { preventDefault() {} }, this);
    }

    isDestroyed() { return this.destroyed; }

    isVisible() { return this.visible; }

    isMinimized() { return false; }

    getBounds() { return { x: this.options.x ?? 120, y: this.options.y ?? 0, width: this.options.width ?? 1680, height: this.options.height ?? 1040 }; }

    loadFile(file, options) { this.loaded = { file, options }; return Promise.resolve(); }

    setIgnoreMouseEvents(value) { this.calls.push(['setIgnoreMouseEvents', value]); }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.calls.push('destroy');
      this.emit('closed');
    }
  }
  for (const name of ['show', 'showInactive', 'hide', 'focus', 'maximize', 'minimize', 'restore', 'moveTop', 'setFullScreen']) {
    FakeWindow.prototype[name] = function record(...args) {
      this.calls.push(args.length ? [name, ...args] : name);
      if (name === 'show' || name === 'showInactive' || name === 'maximize') this.visible = true;
      if (name === 'hide') this.visible = false;
    };
  }

  const dialogCalls = [];
  const dialog = {
    showMessageBox: (...args) => { dialogCalls.push(args); return Promise.resolve({ response: 0 }); },
  };
  const originalShowMessageBox = dialog.showMessageBox;
  const screen = {
    getPrimaryDisplay: () => displays[0],
    getAllDisplays: () => displays,
    getDisplayMatching: (rect) => displays.find((item) => rect.x >= item.bounds.x && rect.x < item.bounds.x + item.bounds.width) || displays[0],
  };
  const electron = { app, BrowserWindow: FakeWindow, dialog, screen };
  const install = (options = {}) => {
    delete globalThis.__shinawaseStartupSplash;
    return installShinawaseStartupSplash({ loaderRoot, electron, argv: ['ECHO.exe'], env: {}, ...options, limits: { handoffMs: 0, ...(options.limits || {}) } });
  };
  const splash = () => windows.find((item) => item.options.title === 'Shinawase');
  const createMain = (url = MAIN_URL, options = {}) => {
    const win = new FakeWindow({ title: 'ECHO', ...options });
    win.webContents.url = url;
    return win;
  };
  const cleanup = () => {
    delete globalThis.__shinawaseStartupSplash;
    rmSync(root, { recursive: true, force: true });
  };
  return { app, markReady, page, windows, dialog, dialogCalls, originalShowMessageBox, install, splash, createMain, cleanup, FakeWindow };
};

test('ECHO main window waits for the intro, then the queued maximize/show replay in order', async () => {
  const env = createEnvironment();
  try {
    const status = env.install();
    assert.equal(status.enabled, true);
    env.markReady();
    await flush();
    const splash = env.splash();
    assert.ok(splash, 'card window created at app-ready');
    assert.equal(splash.options.transparent, false, 'no transparent layer that could flash');
    assert.match(splash.options.backgroundColor, /^#f7f6f2$/iu, 'native background matches the paper');
    assert.equal(splash.options.focusable, false);
    assert.deepEqual({ x: splash.options.x, y: splash.options.y, width: splash.options.width, height: splash.options.height }, { x: 680, y: 360, width: 560, height: 320 });
    assert.ok(!splash.calls.some((call) => Array.isArray(call) && call[0] === 'setIgnoreMouseEvents'), 'card is not a click-through layer');
    assert.equal(splash.loaded.options.query.locale, 'zh');
    assert.equal(splash.loaded.options.query.version, '9.9.9');
    assert.equal(splash.loaded.options.query.mods, '1');

    splash.emit('ready-to-show');
    await flush();
    assert.ok(splash.calls.includes('showInactive'));
    assert.equal(env.page.started, 1);

    const main = env.createMain();
    main.webContents.emit('did-navigate', {}, MAIN_URL);
    await flush();
    assert.ok(env.page.stages.includes('echo'));

    main.maximize();
    main.show();
    await flush();
    assert.deepEqual(main.calls, [], 'ECHO must not appear before the intro has played');
    assert.equal(env.page.outro.length, 0);

    env.page.releaseIntro(true);
    await flush(12);
    assert.equal(env.page.outro.length, 1, 'card empties out before ECHO appears');
    assert.deepEqual(main.calls, ['maximize', 'show', 'moveTop'], 'replayed in order, then raised over the card');
    assert.equal(splash.calls.filter((call) => call === 'moveTop').length, 1, 'the card is never raised over ECHO');
    assert.equal(env.page.finished, 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(splash.destroyed, true, 'card removed underneath ECHO');
    assert.equal(status.phase, 'done');
    assert.equal(Object.hasOwn(main, 'show'), false, 'wrappers removed after release');
    main.focus();
    assert.deepEqual(main.calls, ['maximize', 'show', 'moveTop', 'focus']);
  } finally {
    env.cleanup();
  }
});

test('auxiliary windows are never held', async () => {
  const env = createEnvironment();
  try {
    env.install();
    env.markReady();
    await flush();
    env.splash().emit('ready-to-show');
    const mini = env.createMain(MAIN_URL.replace('index.html', 'auxiliary.html') + '?miniPlayer=1');
    mini.showInactive();
    assert.deepEqual(mini.calls, ['showInactive']);
    const lyrics = env.createMain(`${MAIN_URL}?desktopLyrics=1`);
    lyrics.show();
    assert.deepEqual(lyrics.calls, ['show']);
  } finally {
    env.cleanup();
  }
});

test('a startup dialog hides the splash at once and releases the held window', async () => {
  const env = createEnvironment();
  try {
    env.install();
    env.markReady();
    await flush();
    const splash = env.splash();
    splash.emit('ready-to-show');
    const main = env.createMain();
    main.show();
    await flush();
    assert.deepEqual(main.calls, []);
    await env.dialog.showMessageBox({ message: 'library recovery' });
    assert.equal(env.dialogCalls.length, 1, 'the original dialog still runs');
    assert.deepEqual(main.calls, ['show', 'moveTop']);
    assert.ok(splash.calls.includes('hide') || splash.destroyed);
    assert.equal(env.dialog.showMessageBox, env.originalShowMessageBox, 'dialog guard removed');
  } finally {
    env.cleanup();
  }
});

test('a splash that never paints gives up, and is only destroyed once ECHO has a window', async () => {
  const env = createEnvironment();
  try {
    const status = env.install({ limits: { showTimeoutMs: 20 } });
    env.markReady();
    await flush();
    const splash = env.splash();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(status.phase, 'done');
    assert.equal(splash.destroyed, false, 'destroying the only window would trip ECHO window-all-closed');
    assert.ok(splash.calls.includes('hide'));
    const main = env.createMain();
    await flush();
    assert.equal(splash.destroyed, true);
    main.show();
    assert.deepEqual(main.calls, ['show']);
  } finally {
    env.cleanup();
  }
});

test('the reveal is bounded even when the page never reports its intro', async () => {
  const env = createEnvironment();
  try {
    const status = env.install({ limits: { introMs: 10, introSlackMs: 30, outroMs: 30, finishMs: 30 } });
    env.markReady();
    await flush();
    const splash = env.splash();
    splash.emit('ready-to-show');
    const main = env.createMain();
    main.show();
    await new Promise((resolve) => setTimeout(resolve, 200));
    await flush();
    assert.deepEqual(main.calls, ['show', 'moveTop']);
    assert.equal(status.phase, 'done');
  } finally {
    env.cleanup();
  }
});

test('disabled splash and early quit leave ECHO untouched', async () => {
  const disabled = createEnvironment({ config: { ui: { startupSplash: false } } });
  try {
    const status = disabled.install();
    assert.equal(status.enabled, false);
    disabled.markReady();
    await flush();
    assert.equal(disabled.splash(), undefined);
    const main = disabled.createMain();
    main.show();
    assert.deepEqual(main.calls, ['show']);
  } finally {
    disabled.cleanup();
  }
  const quitting = createEnvironment();
  try {
    quitting.install();
    quitting.app.emit('before-quit');
    quitting.markReady();
    await flush();
    assert.equal(quitting.splash(), undefined, 'a second instance that quits never paints a splash');
  } finally {
    quitting.cleanup();
  }
});
