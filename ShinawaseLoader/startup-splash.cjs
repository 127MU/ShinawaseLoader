'use strict';

// Startup card for the modded runtime.
//
// The asar bridge requires this file at the top of ECHO's main entry, before
// ECHO registers its own app-ready work. At app-ready it opens a small opaque
// window that plays startup-splash.html while ECHO boots. When ECHO asks to
// reveal its main window, the request is held until the intro has played; the
// card then empties out, the queued show/maximize calls replay so ECHO appears
// over it, and the card is removed underneath. Nothing here may delay or break
// ECHO for long: every wait is capped and every failure releases the window.

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SPLASH_PARTITION = 'shinawase-startup-splash';
// Matches the page background, so the native surface never shows another
// color before the first paint (no white or black flash).
const PAPER = '#f7f6f2';
const CARD = { width: 560, height: 320 };
// ECHO's tray (UltraLight) runtime, its restore relaunch and its CLI never show
// the full main window at startup, so they get no splash either.
const SKIP_ARGS = [
  '--no-mod-loader',
  '--no-startup-splash',
  '--echo-cli',
  '--cli',
  '--echo-ultra-light-gpu-runtime',
  '--echo-ultra-light-restored',
];
// Auxiliary windows share renderer/index.html or load auxiliary.html with one
// of these flags; only the plain main document is held.
const AUX_QUERY_KEYS = ['miniPlayer', 'desktopLyrics', 'desktopWall', 'desktopWallOverlay', 'pet', 'echo-cli'];
const REVEAL_METHODS = new Set(['show', 'showInactive', 'focus', 'maximize', 'restore', 'setFullScreen']);
const HELD_METHODS = [...REVEAL_METHODS, 'moveTop', 'hide', 'minimize'];
const DIALOG_METHODS = [
  'showMessageBox', 'showMessageBoxSync', 'showErrorBox', 'showOpenDialog', 'showOpenDialogSync',
  'showSaveDialog', 'showSaveDialogSync', 'showCertificateTrustDialog',
];
const DEFAULT_MAIN_SIZE = { width: 1680, height: 1050 };
// startup-splash.html plays its intro in this long (shorter with reduced motion).
const INTRO_MS = 2400;
const LIMITS = {
  introMs: INTRO_MS,
  // Give up on a card that never paints; ECHO is never held for it.
  showTimeoutMs: 4000,
  // Longest the intro may still hold ECHO after its own timeline should have ended.
  introSlackMs: 1600,
  outroMs: 1600,
  finishMs: 800,
  // How long the emptied card stays under ECHO's window before it is removed.
  handoffMs: 250,
  // A card still waiting after this long steps aside on its own.
  lifetimeMs: 90000,
};

const readJson = (file, fallback) => {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/u, '')); } catch { return fallback; }
};

const loadElectron = () => {
  try { return require('electron'); } catch {}
  try {
    const builtin = process.getBuiltinModule?.('electron');
    if (builtin) return builtin;
  } catch {}
  return null;
};

// Whether this launch should show the card at all.
const splashDecision = ({ argv = [], env = {}, config = {} } = {}) => {
  // The Loader page stores the switch under ui; a hand-edited top-level key works too.
  if (config && (config.ui?.startupSplash === false || config.startupSplash === false)) return { enabled: false, reason: 'config' };
  const flag = String(env.SHINAWASE_STARTUP_SPLASH ?? '').trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return { enabled: false, reason: 'env' };
  const skip = (argv || []).find((arg) => SKIP_ARGS.includes(arg));
  if (skip) return { enabled: false, reason: `argv:${skip}` };
  return { enabled: true, reason: null };
};

// ECHO's main window loads out/renderer/index.html without an auxiliary flag.
const isMainRendererUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  let url;
  try { url = new URL(value); } catch { return false; }
  if (!/(?:^|\/)renderer\/index\.html$/iu.test(decodeURIComponent(url.pathname))) return false;
  return !AUX_QUERY_KEYS.some((key) => url.searchParams.has(key));
};

const finiteRect = (value) => value
  && [value.x, value.y, value.width, value.height].every((item) => Number.isFinite(Number(item)))
  && Number(value.width) > 0 && Number(value.height) > 0;

const contains = (area, x, y) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;

const fitInto = (rect, area) => {
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  return {
    x: Math.round(Math.min(Math.max(rect.x, area.x), area.x + area.width - width)),
    y: Math.round(Math.min(Math.max(rect.y, area.y), area.y + area.height - height)),
    width,
    height,
  };
};

// Where ECHO will put its main window, from the placement ECHO remembers in
// echo-settings.json. Mirrors ECHO's own fallback to a centered default size
// on the primary display. The card is centered on it so ECHO covers it.
const predictMainBounds = ({ settings, displays, primary }) => {
  const list = Array.isArray(displays) && displays.length ? displays : [primary];
  const saved = settings && settings.rememberWindowSizeEnabled !== false ? settings.rememberedWindowSize : null;
  if (saved && finiteRect(saved)) {
    const rect = { x: Number(saved.x), y: Number(saved.y), width: Number(saved.width), height: Number(saved.height) };
    const display = list.find((item) => item && item.id === saved.displayId)
      || list.find((item) => item && contains(item.workArea, rect.x, rect.y))
      || primary;
    return { display, rect: saved.maximized === true ? { ...display.workArea } : fitInto(rect, display.workArea) };
  }
  const area = primary.workArea;
  const width = Math.min(DEFAULT_MAIN_SIZE.width, area.width);
  const height = Math.min(DEFAULT_MAIN_SIZE.height, area.height);
  return {
    display: primary,
    rect: { x: Math.round(area.x + (area.width - width) / 2), y: Math.round(area.y + (area.height - height) / 2), width, height },
  };
};

// The card's own bounds: centered on the predicted window, kept on its display.
const cardBounds = (predicted) => {
  const centerX = predicted.rect.x + predicted.rect.width / 2;
  const centerY = predicted.rect.y + predicted.rect.height / 2;
  return fitInto({ x: centerX - CARD.width / 2, y: centerY - CARD.height / 2, ...CARD }, predicted.display.workArea);
};

const enabledPackageCount = (loaderRoot) => {
  const state = readJson(join(loaderRoot, 'loader-state.json'), null);
  const mods = state && typeof state.mods === 'object' && state.mods ? Object.values(state.mods) : [];
  return mods.filter((item) => item && item.enabled === true).length;
};

const later = (ms) => new Promise((resolve) => {
  const timer = setTimeout(resolve, Math.max(0, ms));
  timer.unref?.();
});
const capped = (promise, ms, fallback) => Promise.race([
  Promise.resolve(promise).catch(() => fallback),
  later(ms).then(() => fallback),
]);

const installShinawaseStartupSplash = (options = {}) => {
  if (globalThis.__shinawaseStartupSplash) return globalThis.__shinawaseStartupSplash;
  const loaderRoot = options.loaderRoot || __dirname;
  const electron = options.electron || loadElectron();
  const config = readJson(join(loaderRoot, 'loader.config.json'), {});
  const decision = splashDecision({ argv: options.argv || process.argv, env: options.env || process.env, config });
  const limits = { ...LIMITS, ...(options.limits || {}) };
  const status = { enabled: decision.enabled, reason: decision.reason, phase: 'idle', events: [] };
  globalThis.__shinawaseStartupSplash = status;
  // Milliseconds since ECHO's process started, so a log line reads as a startup timeline.
  const uptime = () => Math.round(process.uptime() * 1000);
  const note = (event) => {
    if (status.events.length < 32) status.events.push(`+${uptime()}ms ${event}`);
  };
  // One overwritten line per launch: timings only, no paths or user data.
  const writeLog = () => {
    try {
      const logs = options.logsRoot || process.env.ECHO_LOGS_HOME || join(loaderRoot, 'Logs');
      mkdirSync(logs, { recursive: true });
      const { phase, heldMs, events } = status;
      writeFileSync(join(logs, 'startup-splash.log'), `${JSON.stringify({ at: new Date().toISOString(), phase, heldMs: heldMs ?? null, events })}\n`);
    } catch {}
  };
  const page = join(loaderRoot, 'startup-splash.html');
  const { app, BrowserWindow, dialog } = electron || {};
  if (!status.enabled) return status;
  if (!app || !BrowserWindow || typeof app.whenReady !== 'function') {
    Object.assign(status, { enabled: false, reason: 'electron-unavailable' });
    return status;
  }
  if (!existsSync(page)) {
    Object.assign(status, { enabled: false, reason: 'page-missing' });
    return status;
  }

  let splash = null;
  let creatingSplash = false;
  let shown = false;
  let shownAt = 0;
  let stage = 'boot';
  let quitting = false;
  let done = false;
  let releasing = false;
  let pendingDestroy = false;
  let held = null;
  let revealing = null;
  let resolveShown;
  const shownSignal = new Promise((resolve) => { resolveShown = resolve; });
  const timers = new Set();
  const wrapped = new Map();
  const cleanups = [];
  const dialogGuards = new Map();

  const timer = (ms, fn) => {
    const handle = setTimeout(() => { timers.delete(handle); fn(); }, ms);
    handle.unref?.();
    timers.add(handle);
    return handle;
  };
  const alive = () => Boolean(splash && !splash.isDestroyed());
  const runJs = (code, ms, fallback = null) => {
    if (!alive()) return Promise.resolve(fallback);
    let contents;
    try { contents = splash.webContents; } catch { return Promise.resolve(fallback); }
    if (!contents || contents.isDestroyed()) return Promise.resolve(fallback);
    return capped(contents.executeJavaScript(code, false), ms, fallback);
  };
  const call = (method, ...args) => `window.shinawaseSplash && window.shinawaseSplash.${method}(${args.map((item) => JSON.stringify(item)).join(',')})`;

  // A hidden card must outlive the moment ECHO has no other window, or ECHO's
  // window-all-closed handler quits the app. It is destroyed as soon as ECHO
  // creates a window of its own.
  const destroyWhenAnotherWindowExists = () => setImmediate(destroySplash);
  const destroySplash = () => {
    if (!alive()) {
      if (pendingDestroy) app.removeListener('browser-window-created', destroyWhenAnotherWindowExists);
      pendingDestroy = false;
      return;
    }
    const others = BrowserWindow.getAllWindows().some((item) => item !== splash && !item.isDestroyed());
    if (others || quitting) {
      if (pendingDestroy) app.removeListener('browser-window-created', destroyWhenAnotherWindowExists);
      pendingDestroy = false;
      try { splash.destroy(); } catch {}
      return;
    }
    try { splash.hide(); } catch {}
    if (!pendingDestroy) {
      pendingDestroy = true;
      app.on('browser-window-created', destroyWhenAnotherWindowExists);
    }
  };

  const unwrapWindows = () => {
    for (const [win, names] of wrapped) {
      if (win.isDestroyed()) continue;
      for (const name of names) {
        try { delete win[name]; } catch {}
      }
    }
    wrapped.clear();
  };

  const restoreDialogs = () => {
    for (const [name, original] of dialogGuards) {
      try { if (dialog[name] !== original) dialog[name] = original; } catch {}
    }
    dialogGuards.clear();
  };

  // Puts ECHO's window back in charge: replays the queued calls in order.
  const release = (reason) => {
    if (releasing) return;
    releasing = true;
    note(`release ${reason}`);
    const queue = held ? held.queue.splice(0) : [];
    const win = held ? held.win : null;
    unwrapWindows();
    restoreDialogs();
    if (!win || win.isDestroyed()) return;
    for (const [name, args] of queue) {
      try { win[name](...args); } catch (error) { note(`replay ${name} failed ${error && error.message}`); }
    }
    // Windows may refuse activation to a process that is not in the foreground;
    // raise ECHO anyway so the emptied card is always underneath it.
    if (queue.some(([name]) => REVEAL_METHODS.has(name))) {
      try { if (win.isVisible() && !win.isMinimized()) win.moveTop(); } catch {}
    }
  };

  const finishSplash = (reason) => {
    if (done) return;
    done = true;
    status.phase = 'done';
    note(`done ${reason}`);
    release(reason);
    for (const handle of timers) clearTimeout(handle);
    timers.clear();
    for (const cleanup of cleanups.splice(0)) {
      try { cleanup(); } catch {}
    }
    destroySplash();
    writeLog();
  };

  // Steps aside at once: a dialog, a crash, a timeout or a quit.
  const abort = (reason) => {
    if (done) return;
    note(`abort ${reason}`);
    if (alive()) {
      try { splash.hide(); } catch {}
    }
    finishSplash(reason);
  };

  const setStage = (key) => {
    if (done || stage === key || stage === 'ready') return;
    stage = key;
    if (shown) void runJs(call('stage', key), 1000);
  };

  const runReveal = async () => {
    status.phase = 'revealing';
    const requestedAt = Date.now();
    note('reveal requested');
    // A card that is not on screen yet gets a short grace period, never more.
    if (!shown) await capped(shownSignal, Math.max(0, limits.showTimeoutMs - (Date.now() - (status.createdAt || requestedAt))), false);
    if (!shown || !alive()) return finishSplash('reveal-without-splash');
    // The intro always plays out first.
    const introLeft = Math.max(0, limits.introMs - (Date.now() - shownAt));
    await runJs(call('whenIntroDone'), introLeft + limits.introSlackMs);
    if (done) return undefined;
    // The card finishes its line and empties out, then ECHO appears over it.
    await runJs(call('outro'), limits.outroMs);
    if (done) return undefined;
    status.heldMs = Date.now() - requestedAt;
    release('reveal');
    await runJs(call('finish'), limits.finishMs);
    await later(limits.handoffMs);
    finishSplash('revealed');
    return undefined;
  };

  const requestReveal = () => {
    if (revealing || done) return;
    setStage('ready');
    // Collect the rest of ECHO's synchronous reveal (maximize, then show).
    revealing = Promise.resolve().then(runReveal).catch((error) => {
      note(`reveal failed ${error && error.message}`);
      finishSplash('reveal-error');
    });
  };

  const safeUrl = (win) => {
    try { return win.webContents.getURL(); } catch { return ''; }
  };

  const wrapWindow = (win) => {
    if (wrapped.has(win)) return;
    const names = [];
    for (const name of HELD_METHODS) {
      const original = win[name];
      if (typeof original !== 'function') continue;
      win[name] = function shinawaseSplashHeld(...args) {
        if (!done && !releasing) {
          if (held && held.win === win) {
            held.queue.push([name, args]);
            return undefined;
          }
          const reveals = REVEAL_METHODS.has(name) && !(name === 'setFullScreen' && args[0] !== true);
          if (!held && reveals && isMainRendererUrl(safeUrl(win))) {
            held = { win, queue: [[name, args]] };
            note(`hold ${name}`);
            requestReveal();
            return undefined;
          }
        }
        return original.apply(win, args);
      };
      names.push(name);
    }
    wrapped.set(win, names);
    win.once?.('closed', () => {
      wrapped.delete(win);
      if (held && held.win === win) finishSplash('main-closed');
    });
  };

  const onWindowCreated = (_event, win) => {
    if (!win || creatingSplash || win === splash || done) return;
    wrapWindow(win);
    const contents = win.webContents;
    if (!contents || typeof contents.on !== 'function') return;
    const onNavigate = (_navEvent, url) => {
      if (isMainRendererUrl(url)) setStage('echo');
    };
    const onDomReady = () => {
      if (isMainRendererUrl(safeUrl(win))) setStage('ui');
    };
    contents.on('did-navigate', onNavigate);
    contents.on('dom-ready', onDomReady);
    cleanups.push(() => {
      if (contents.isDestroyed()) return;
      contents.removeListener('did-navigate', onNavigate);
      contents.removeListener('dom-ready', onDomReady);
    });
  };

  const guardDialogs = () => {
    if (!dialog) return;
    for (const name of DIALOG_METHODS) {
      const original = dialog[name];
      if (typeof original !== 'function') continue;
      const guard = function shinawaseSplashDialogGuard(...args) {
        abort(`dialog:${name}`);
        return original.apply(this, args);
      };
      try {
        dialog[name] = guard;
        dialogGuards.set(name, original);
      } catch {}
    }
  };

  const showSplash = () => {
    if (shown || done || !alive()) return;
    shown = true;
    shownAt = Date.now();
    status.phase = 'showing';
    note('shown');
    try { splash.showInactive(); } catch { try { splash.show(); } catch {} }
    try { splash.moveTop(); } catch {}
    void runJs(`${call('start')}; ${call('stage', stage)}`, 1500);
    resolveShown(true);
  };

  const createSplash = () => {
    if (quitting || done) return;
    const { screen } = electron;
    let settings = null;
    try { settings = readJson(join(app.getPath('userData'), 'echo-settings.json'), null); } catch {}
    const bounds = cardBounds(predictMainBounds({ settings, displays: screen.getAllDisplays(), primary: screen.getPrimaryDisplay() }));
    const loaderVersion = readJson(join(loaderRoot, 'loader-version.json'), {})?.version || '';
    const localeHint = String(config.locale || app.getLocale?.() || '').toLowerCase();
    const query = {
      locale: localeHint.startsWith('zh') ? 'zh' : 'en',
      version: String(loaderVersion),
      mods: String(enabledPackageCount(loaderRoot)),
    };
    creatingSplash = true;
    try {
      // Opaque on purpose: no transparent or click-through layer, which on
      // some Windows setups composites as a white flash.
      splash = new BrowserWindow({
        ...bounds,
        show: false,
        frame: false,
        transparent: false,
        backgroundColor: PAPER,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        skipTaskbar: true,
        roundedCorners: false,
        title: 'Shinawase',
        ...(process.platform === 'linux' ? { type: 'splash' } : {}),
        webPreferences: {
          partition: SPLASH_PARTITION,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          devTools: false,
          spellcheck: false,
          backgroundThrottling: false,
          webgl: false,
        },
      });
    } finally {
      creatingSplash = false;
    }
    status.createdAt = Date.now();
    note('created');
    try { splash.setMenuBarVisibility?.(false); } catch {}
    const contents = splash.webContents;
    contents.setWindowOpenHandler?.(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('render-process-gone', () => abort('render-process-gone'));
    contents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
      if (isMainFrame !== false) abort('load-failed');
    });
    splash.once('ready-to-show', showSplash);
    splash.on('closed', () => {
      splash = null;
      if (!done) finishSplash('closed');
    });
    timer(limits.showTimeoutMs, () => {
      if (!shown) abort('show-timeout');
    });
    timer(limits.lifetimeMs, () => {
      if (!revealing) {
        void runJs(call('dismiss'), 600).then(() => abort('lifetime'));
      }
    });
    splash.loadFile(page, { query }).catch(() => abort('load-failed'));
  };

  app.on('browser-window-created', onWindowCreated);
  cleanups.push(() => app.removeListener('browser-window-created', onWindowCreated));
  app.on('before-quit', () => {
    quitting = true;
    if (done) { destroySplash(); return; }
    abort('quit');
  });
  app.on('will-quit', () => {
    quitting = true;
    destroySplash();
  });
  guardDialogs();
  status.phase = 'waiting';
  app.whenReady().then(() => {
    if (quitting || done) return;
    try {
      createSplash();
    } catch (error) {
      note(`create failed ${error && error.message}`);
      abort('create-failed');
    }
  }).catch(() => abort('ready-failed'));
  return status;
};

module.exports = {
  installShinawaseStartupSplash,
  splashDecision,
  isMainRendererUrl,
  predictMainBounds,
  cardBounds,
  enabledPackageCount,
  CARD,
  LIMITS,
};
