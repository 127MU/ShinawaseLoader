// Regressions from aligning the asar patches with echo-steam 26.10.16-26.10.18.
// Synthetic bundle shapes only; no extracted ECHO source.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { applyAuxiliaryWindowCrashFix, patchPreload, patchSteamPlaylistsPage } from '../ShinawaseLoader/echo-asar.mjs';

test('preload bridge invokes the bridge channels even when ECHO\'s IpcChannels lost them', () => {
  // 26.10.8+ Steam preloads ship an IpcChannels table without the streaming,
  // account, downloads and qobuz keys.
  const preload = [
    '"use strict";',
    'const calls = []; const IpcChannels = { PodcastsList: "podcasts:list" };',
    'const ipcRenderer = { invoke: (channel, ...args) => { calls.push(channel); return Promise.resolve(args); }, on() {}, off() {} };',
    'function expose() {',
    '  const echoApi = {',
    '    podcasts: { list: () => ipcRenderer.invoke(IpcChannels.PodcastsList) }',
    '  };',
    '  return echoApi;',
    '}',
    'globalThis.result = { api: expose(), calls };',
  ].join('\n');
  const patched = patchPreload(preload);
  assert.equal(patchPreload(patched), patched, 'idempotent');
  const context = {};
  vm.runInNewContext(patched, context);
  const { api, calls } = context.result;
  api.streaming.search({ query: 'x' });
  api.streaming.importPlaylistFromUrl('https://example.invalid/playlist');
  api.accounts.getStatuses();
  api.downloads.getJobs();
  api.qobuz.getStatus();
  assert.deepEqual([...calls], ['streaming:search', 'streaming:importPlaylistFromUrl', 'account:get-statuses', 'downloads:get-jobs', 'qobuz:auth:get-status']);
  assert.ok(!calls.includes(undefined));
});

test('preload channel table matches the streaming-preload helper', () => {
  const asar = readFileSync(new URL('../ShinawaseLoader/echo-asar.mjs', import.meta.url), 'utf8');
  const helper = readFileSync(new URL('../ShinawaseLoader/streaming-preload.cjs', import.meta.url), 'utf8');
  const table = (text, start) => {
    const body = text.slice(text.indexOf(start), text.indexOf('});', text.indexOf(start)));
    return Object.fromEntries([...body.matchAll(/(\w+): '([^']+)'/g)].map((match) => [match[1], match[2]]));
  };
  const fromAsar = table(asar, 'const BRIDGE_IPC_CHANNELS = Object.freeze({');
  const fromHelper = table(helper, 'const channels = {');
  assert.equal(Object.keys(fromAsar).length, 53);
  assert.deepEqual(fromAsar, fromHelper);
});

// 26.10.x shapes: the bundler renames the parameter to window2 and the mini
// player helper gained a menu guard and a topmost level.
const mainFixture = [
  'let miniPlayerMenuOpen = false;',
  'const miniPlayerWindowsTopmostLevel = "pop-up-menu";',
  'const applyOverlayAlwaysOnTop = (window2) => { window2.raised.push("overlay"); };',
  'const applyMiniPlayerAlwaysOnTop = (window2) => {',
  '  if (window2.isDestroyed() || miniPlayerMenuOpen) {',
  '    return;',
  '  }',
  '  if (process.platform === "win32") {',
  '    window2.setAlwaysOnTop(true, miniPlayerWindowsTopmostLevel);',
  '    return;',
  '  }',
  '  applyOverlayAlwaysOnTop(window2);',
  '};',
  'const applyDesktopLyricsAlwaysOnTop = (window2) => {',
  '  window2.setAlwaysOnTop(true, miniPlayerWindowsTopmostLevel);',
  '};',
  'const applyPetAlwaysOnTop = (window2, platform = process.platform) => {',
  '  if (platform === "win32") {',
  '    window2.setAlwaysOnTop(true);',
  '    return;',
  '  }',
  '  applyOverlayAlwaysOnTop(window2, platform);',
  '};',
  'helpers = { applyMiniPlayerAlwaysOnTop, applyDesktopLyricsAlwaysOnTop, applyPetAlwaysOnTop };',
].join('\n');

test('topmost helpers in the 26.10 shape are deferred for a window\'s first 600ms', () => {
  const patched = applyAuxiliaryWindowCrashFix(mainFixture);
  assert.equal((patched.match(/shinawase-defer-topmost/g) || []).length, 3);
  assert.equal(applyAuxiliaryWindowCrashFix(patched), patched, 'idempotent');
  let now = 1000;
  const timers = [];
  const context = { process: { platform: 'win32' }, Date: { now: () => now }, setTimeout: (fn, ms) => timers.push({ fn, ms }), WeakMap, Math };
  vm.runInNewContext(patched, context);
  const window = { raised: [], destroyed: false, isDestroyed() { return this.destroyed; }, setAlwaysOnTop(...args) { this.raised.push(args); } };
  context.helpers.applyMiniPlayerAlwaysOnTop(window);
  assert.deepEqual(window.raised, [], 'the first raise waits');
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 600);
  now += 700;
  timers.shift().fn();
  assert.deepEqual(window.raised, [[true, 'pop-up-menu']]);
  context.helpers.applyMiniPlayerAlwaysOnTop(window);
  assert.equal(window.raised.length, 2, 'later raises run at once');
  const closed = { ...window, raised: [], destroyed: false };
  context.helpers.applyPetAlwaysOnTop(closed);
  closed.destroyed = true;
  timers.shift().fn();
  assert.deepEqual(closed.raised, [], 'a window closed meanwhile is not raised');
});

test('liked page add-to-playlist targets include imported streaming playlists', () => {
  const liked = 'qt=224,el=r(t=>t.sourceProvider==="local"&&t.kind!=="system"&&t.kind!=="smart","canAddTrackToPlaylist"),we=1';
  const patched = patchSteamPlaylistsPage(liked);
  assert.equal(patched, 'qt=224,el=r(t=>t.kind!=="system"&&t.kind!=="smart","canAddTrackToPlaylist"),we=1');
  assert.equal(patchSteamPlaylistsPage(patched), patched);
});
