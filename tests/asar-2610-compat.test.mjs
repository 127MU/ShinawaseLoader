// Regressions from aligning the asar patches with echo-steam 26.10.16-26.10.18.
// Synthetic bundle shapes only; no extracted ECHO source.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { applyAuxiliaryWindowCrashFix, applyRepeatOneIdentityFix, patchLyricsPage, patchPlayback, patchPreload, patchSteamPlaylistsPage } from '../ShinawaseLoader/echo-asar.mjs';

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

test('streaming lyrics target survives a queue republish of the same track', () => {
  // 26.10.18 LyricsPage shape. The Core queue republishes its page every few
  // seconds while playing, so the current track arrives as a new object.
  const page = [
    'const isStreaming=e=>e?.mediaType==="streaming"&&typeof e.providerTrackId=="string";',
    'const memo=[];let slot=0;',
    'const a={useMemo(fn,deps){const prev=memo[slot];let value;if(prev&&prev.deps.length===deps.length&&prev.deps.every((d,i)=>Object.is(d,deps[i])))value=prev.value;else{value=fn();memo[slot]={deps,value};}slot+=1;return value;}};',
    'globalThis.render=(N)=>{slot=0;const he=a.useMemo(()=>isStreaming(N)&&!N.isLiveStream?{provider:N.provider,providerTrackId:N.providerTrackId}:null,[N]);return he;};',
  ].join('\n');
  const patched = patchLyricsPage(page);
  assert.notEqual(patched, page);
  assert.equal(patchLyricsPage(patched), patched, 'idempotent');
  const track = () => ({ id: 'streaming:netease:1', mediaType: 'streaming', provider: 'netease', providerTrackId: '1', fieldSources: { title: 'netease' } });
  const stock = {};
  vm.runInNewContext(page, stock);
  assert.notEqual(stock.render(track()), stock.render(track()), 'stock memo churns on object identity');
  const context = {};
  vm.runInNewContext(patched, context);
  const first = context.render(track());
  assert.equal(context.render(track()), first, 'same provider track keeps the same target');
  assert.deepEqual({ ...context.render({ ...track(), providerTrackId: '2' }) }, { provider: 'netease', providerTrackId: '2' });
  assert.equal(context.render({ ...track(), isLiveStream: true }), null);
  assert.equal(context.render(null), null);
});

test('a repeat-one loop of a streaming track keeps the current track identity', () => {
  // 26.10.20 AudioSession.handleQueueAdvance, trimmed to the identity fields.
  // The daemon restarts the open HTTP source and reports no track id.
  const session = [
    'globalThis.AudioSession = class AudioSession {',
    '  emit(name, value) { this.events.push(value.nextTrackId); }',
    '  getStatus() { return {}; }',
    '  handleQueueAdvance(params) {',
    '    this.emit("track-advance", { status: this.getStatus(), nextTrackId: typeof params.nextTrackId === "string" ? params.nextTrackId : null, gapless: params.gaplessAdvance === true });',
    '    if (typeof params.nextFilePath === "string") {',
    '      this.currentFilePath = params.nextFilePath;',
    '      this.currentTrackId = typeof params.nextTrackId === "string" ? params.nextTrackId : null;',
    '      const metadata = params.nextMetadata && typeof params.nextMetadata === "object" && !Array.isArray(params.nextMetadata) ? params.nextMetadata : null;',
    '      this.currentTrackMetadata = metadata ? { title: metadata.title ?? null, artist: metadata.artist ?? null } : null;',
    '    }',
    '    this.currentQueueItemId = typeof params.nextItemId === "string" ? params.nextItemId : null;',
    '  }',
    '};',
  ].join('\n');
  const patched = applyRepeatOneIdentityFix(session);
  assert.notEqual(patched, session);
  assert.equal(applyRepeatOneIdentityFix(patched), patched, 'idempotent');
  assert.equal(applyRepeatOneIdentityFix('const unrelated = 1;'), 'const unrelated = 1;', 'other builds are left alone');
  const make = (source, repeatMode) => {
    const context = {};
    vm.runInNewContext(source, context);
    const audio = new context.AudioSession();
    Object.assign(audio, {
      events: [],
      queueSnapshot: { repeatMode, items: [] },
      currentTrackId: 'streaming:netease:1',
      currentQueueItemId: 'q1',
      currentFilePath: 'http://cdn.example/1.flac',
      currentTrackMetadata: { title: 'Song', artist: 'Artist' },
    });
    return audio;
  };
  const loop = { queueAdvance: true, nextFilePath: 'http://cdn.example/1.flac' };
  const stock = make(session, 'one');
  stock.handleQueueAdvance(loop);
  assert.equal(stock.currentTrackId, null, 'stock ECHO forgets the song');

  const fixed = make(patched, 'one');
  fixed.handleQueueAdvance(loop);
  assert.equal(fixed.currentTrackId, 'streaming:netease:1');
  assert.equal(fixed.currentQueueItemId, 'q1');
  assert.deepEqual({ ...fixed.currentTrackMetadata }, { title: 'Song', artist: 'Artist' });
  assert.deepEqual([...fixed.events], ['streaming:netease:1'], 'Core hears the same track again');

  const next = make(patched, 'off');
  next.handleQueueAdvance({ queueAdvance: true, nextFilePath: 'D:/b.flac', nextTrackId: 'local:2', nextItemId: 'q2', nextMetadata: { title: 'B' } });
  assert.equal(next.currentTrackId, 'local:2', 'a real advance is untouched');
  assert.equal(next.currentQueueItemId, 'q2');
  const unknown = make(patched, 'off');
  unknown.handleQueueAdvance({ queueAdvance: true, nextFilePath: 'D:/c.flac', nextItemId: 'q3' });
  assert.equal(unknown.currentTrackId, null, 'without repeat-one an unknown item stays unknown');
});

test('the native daemon queue never receives an unresolved streaming: path', async () => {
  // Same entry line as 26.10.20 prepareDaemonQueue; the rest is a stub that
  // reports what the daemon would be handed.
  const module = [
    'const isRemoteQueueTrack = (id) => /^remote:/u.test(id);',
    'const isHttp = (path) => /^https?:\\/\\//u.test(path);',
    'const prepareDaemonQueue = async (snapshot, resolveRemote, isCurrent, currentSource) => {',
    '  const needsPreparation = snapshot.items.some((item) => isRemoteQueueTrack(item.trackId) || isHttp(item.filePath));',
    '  return snapshot;',
    '};',
    'globalThis.prepare = prepareDaemonQueue;',
  ].join('\n');
  const patched = applyRepeatOneIdentityFix(module);
  assert.notEqual(patched, module);
  assert.equal(applyRepeatOneIdentityFix(patched), patched, 'idempotent');
  const context = {};
  vm.runInNewContext(patched, context);
  const run = (snapshot, source) => context.prepare(snapshot, null, () => true, source);
  const streaming = (n) => ({ itemId: `q${n}`, trackId: `streaming:netease:${n}`, filePath: `streaming:netease:${n}` });
  const local = (n) => ({ itemId: `q${n}`, trackId: `local:${n}`, filePath: `D:/music/${n}.flac` });
  const current = { kind: 'http', uri: 'https://cdn.example/1.flac' };
  const plain = (value) => JSON.parse(JSON.stringify(value));

  const one = await run({ currentItemId: 'q1', repeatMode: 'one', items: [local(0), streaming(1), streaming(2)] }, current);
  assert.deepEqual(plain(one.items), [{ ...streaming(1), source: current }], 'repeat-one loops the open stream with its own identity');
  assert.equal(one.repeatMode, 'one');

  const off = await run({ currentItemId: 'q0', repeatMode: 'off', items: [local(0), streaming(1), local(2)] }, undefined);
  assert.deepEqual(plain(off.items), [local(0)], 'stops before the next streaming item');
  assert.equal(off.repeatMode, 'off');

  const all = await run({ currentItemId: 'q1', repeatMode: 'all', items: [local(0), streaming(1)] }, current);
  assert.deepEqual(plain(all.items), [{ ...streaming(1), source: current }, local(0)], 'repeat-all keeps a whole cycle');
  assert.equal(all.repeatMode, 'all');

  const cut = await run({ currentItemId: 'q1', repeatMode: 'all', items: [streaming(1), streaming(2)] }, current);
  assert.equal(cut.repeatMode, 'off', 'a cut cycle cannot repeat');

  const unopened = await run({ currentItemId: 'q1', repeatMode: 'one', items: [streaming(1)] }, undefined);
  assert.deepEqual(plain(unopened.items), [], 'nothing playable is handed over without the open source');

  const localOnly = { currentItemId: 'q0', repeatMode: 'one', items: [local(0)] };
  assert.equal(await run(localOnly, undefined), localOnly, 'local queues are untouched');
});

test('the island constructor stays non-topmost when its topmost becomes switchable', () => {
  // ECHOSteam after 26.10.20: `alwaysOnTop: isMiniPlayerForcedTopmost(),`.
  const ctor = '    skipTaskbar: true,\n    show: false,\n    // Ordinary topmost from the first frame (same floating level the runtime\n    // applyMiniPlayerAlwaysOnTop uses); some Linux window managers only honor\n    // the above-state reliably when it is set before the window is mapped.\n    alwaysOnTop: isMiniPlayerForcedTopmost(),\n    ...linuxOverlayBrowserWindowOptions(),\n    webPreferences: {';
  const patched = applyAuxiliaryWindowCrashFix(`const window = new BrowserWindow({\n${ctor}\n    }\n  });`);
  assert.ok(patched.includes('    alwaysOnTop: false,\n    ...linuxOverlayBrowserWindowOptions(),'));
  assert.ok(!patched.includes('isMiniPlayerForcedTopmost()'), 'the deferred helper applies the setting instead');
});

test('streaming playback patch covers ECHO before and after Workshop playback sources (26.10.21)', async () => {
  // Trimmed media-request validator and resolver in both shapes; only the
  // anchored lines are ECHO's, the rest is stub scaffolding.
  const build = (workshop) => [
    'const isWorkshopSourceReference = (value) => value.startsWith("echo-workshop-source:");',
    'const resolveWorkshopPlaybackSource = async (value) => `https://workshop.example/${value}`;',
    'const decodeM3u8ProviderTrackId = (value) => value;',
    'const createProbeHintForMediaItem = () => ({});',
    'globalThis.validate = (provider2, providerTrackId) => {',
    '  if (true) {',
    '    const radioUrl = provider2 === "m3u8" ? decodeM3u8ProviderTrackId(providerTrackId).trim() : "";',
    workshop
      ? '    if (provider2 !== "m3u8" || !isWorkshopSourceReference(radioUrl) && !/^https?:\\/\\/\\S+$/iu.test(radioUrl)) {'
      : '    if (provider2 !== "m3u8" || !/^https?:\\/\\/\\S+$/iu.test(radioUrl)) {',
    '      throw new Error("Music streaming playback is not available in the Steam distribution.");',
    '    }',
    '    return { provider: provider2 };',
    '  }',
    '};',
    'globalThis.resolve = async (item, durationSeconds) => {',
    '  let filePath;',
    '  let probe = createProbeHintForMediaItem(',
    '    item);',
    '  if (item.mediaType === "remote") {',
    '    filePath = "remote";',
    '  } else if (item.mediaType === "streaming") {',
    ...(workshop
      ? ['    const source = decodeM3u8ProviderTrackId(item.providerTrackId).trim();',
        '    filePath = isWorkshopSourceReference(source) ? await resolveWorkshopPlaybackSource(source) : source;']
      : ['    filePath = decodeM3u8ProviderTrackId(item.providerTrackId).trim();']),
    '  } else {',
    '    filePath = item.path;',
    '  }',
    '  return { filePath, mimeType: null, probe, durationSeconds };',
    '};',
  ].join('\n');
  for (const workshop of [false, true]) {
    const stock = build(workshop);
    const patched = patchPlayback(stock);
    assert.notEqual(patched, stock);
    assert.equal(patchPlayback(patched), patched, 'idempotent');
    const context = { __shinawaseResolveStreamingPlayback: async ({ provider, providerTrackId }) => ({ url: `https://cdn.example/${provider}/${providerTrackId}.flac`, headers: { A: '1' }, sampleRate: 48000, codec: 'flac', mimeType: 'audio/flac' }) };
    vm.runInNewContext(patched, context);
    assert.deepEqual({ ...context.validate('netease', '1') }, { provider: 'netease' }, 'non-m3u8 providers pass validation');
    assert.throws(() => context.validate('m3u8', 'not a url'), /must be valid/u);
    const netease = await context.resolve({ mediaType: 'streaming', provider: 'netease', providerTrackId: '1' }, 200);
    assert.equal(netease.filePath, 'https://cdn.example/netease/1.flac');
    assert.equal(netease.mimeType, 'audio/flac');
    assert.equal(netease.probe.fileSampleRate, 48000);
    const radio = await context.resolve({ mediaType: 'streaming', provider: 'm3u8', providerTrackId: 'https://radio.example/live.m3u8' }, null);
    assert.equal(radio.filePath, 'https://radio.example/live.m3u8');
    if (workshop) {
      assert.deepEqual({ ...context.validate('m3u8', 'echo-workshop-source:abc') }, { provider: 'm3u8' });
      const fromWorkshop = await context.resolve({ mediaType: 'streaming', provider: 'm3u8', providerTrackId: 'echo-workshop-source:abc' }, null);
      assert.equal(fromWorkshop.filePath, 'https://workshop.example/echo-workshop-source:abc', 'Workshop sources keep resolving');
    }
  }
});
