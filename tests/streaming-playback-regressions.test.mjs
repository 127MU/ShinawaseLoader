import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import vm from 'node:vm';

const shim = readFileSync(new URL('../ShinawaseLoader/playback-shim.cjs', import.meta.url), 'utf8');
// Slice anchors below contain "\n"; a CRLF checkout (Windows autocrlf) must still match.
const mod = readFileSync(new URL('../examples/ECHO-Streaming/echomod/mod.js', import.meta.url), 'utf8').replace(/\r\n/gu, '\n');
const between = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

test('first proxy playback and source resolution wait for the real listening port', async () => {
  let server;
  const context = vm.createContext({
    http: { createServer(fn) { server = http.createServer(fn); return server; } },
    randomBytes, URL, setInterval, clearInterval,
    extensionForSource: () => '.flac', buildStreamingProbe: () => ({}),
    preserveOutputSettings: raw => raw.output, stripStreamingChain: value => value,
  });
  vm.runInContext(
    between(shim, 'const installProxy =', 'const positiveNumber =')
    + between(shim, 'const asLocalRequest =', 'const steamStreamingBlocked =')
    + '\nglobalThis.convertLocal = asLocalRequest; globalThis.convertSource = asResolvedSource;',
    context,
  );
  try {
    const item = { provider: 'netease', providerTrackId: '1' };
    const source = { url: 'https://example.test/audio.flac' };
    const [local, resolved] = await Promise.all([
      context.convertLocal({ output: { mode: 'exclusive' } }, item, source),
      context.convertSource(item, source),
    ]);
    for (const path of [local.item.path, resolved.filePath]) {
      assert.equal(new URL(path).port, String(server.address().port));
      assert.equal(new URL(path).hostname, '127.0.0.1');
    }
    assert.equal(local.output.mode, 'exclusive');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
  }
});

test('status refresh cannot consume similar autoplay changes and repeated ticks stay deduplicated', async () => {
  let tick;
  const requested = [];
  const track = { id: '', stableKey: '', mediaType: 'streaming', provider: 'netease', providerTrackId: '' };
  const state = { currentStableKey: '', playbackState: 'paused', playbackTrackId: '' };
  const context = vm.createContext({
    state, packageDisposed: false, disposed: false,
    ncmUi: { similarAutoPlay: true, similarCount: 10, similarIds: [], similarPlayed: 0, lastSongId: null },
    neteaseConnected: () => true,
    findPlaybackQueue: () => ({ currentTrack: track }),
    playbackApi: () => ({ getStatus: async () => ({ currentTrackId: track.id, state: 'playing' }) }),
    syncNativePlaybackButtons() {}, syncPlaybackRows() {},
    playCurrentStableKey: () => state.playbackState === 'playing' && state.playbackTrackId === track.id ? track.stableKey : '',
    downloadApi: () => null, bindAccountStatuses() {},
    invokeMain: async (method, payload) => { if (method === 'neteaseSimilar') requested.push(payload.id); return {}; },
    window: { setTimeout, clearTimeout, setInterval(fn) { tick = fn; return 1; } },
  });
  vm.runInContext(
    'let playbackStatusPending = false; let playbackStatusTimeout = 0; let statusTimer;\n'
    + between(mod, 'const refreshPlaybackStatus =', 'const onPausedPlaybackClick =')
    + between(mod, 'const similarOnTrackChange =', '/*\n * SteamPlaylistsPage')
    + between(mod, 'const installListeners =', 'const stopAccountQrPolling =')
    + '\ninstallListeners();', context,
  );
  for (let id = 1; id <= 3; id += 1) {
    track.id = `streaming:netease:${id}`;
    track.stableKey = `netease:${id}`;
    track.providerTrackId = String(id);
    await vm.runInContext('refreshPlaybackStatus()', context);
    tick();
    tick();
  }
  assert.deepEqual(requested, ['1', '2', '3']);
});

test('a streaming replay never starts inside the last seconds of the track', async () => {
  // ECHO's repeat-one restart resumes from the last status position, which for
  // a streaming track lands ~1.4s before the end.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const previous = globalThis.__shinawasePlaybackShim;
  delete globalThis.__shinawasePlaybackShim;
  try {
    const handlers = new Map();
    const seen = [];
    const ipcMain = {
      _invokeHandlers: handlers,
      handle(channel, fn) { handlers.set(channel, fn); },
      removeHandler(channel) { handlers.delete(channel); },
    };
    handlers.set('playback:play-media-item', async (_event, raw) => { seen.push(raw.startSeconds); return { ok: true }; });
    handlers.set('playback:resolve-media-item', async () => ({}));
    const { installStreamingPlaybackShim } = require('../ShinawaseLoader/playback-shim.cjs');
    assert.equal(installStreamingPlaybackShim({ ipcMain }).play, true);
    const play = (item, startSeconds) => handlers.get('playback:play-media-item')({}, { item, startSeconds });
    const streaming = { mediaType: 'streaming', provider: 'netease', providerTrackId: '1', duration: 170.37 };
    await play(streaming, 169.003);
    await play(streaming, 90);
    await play(streaming, undefined);
    await play({ mediaType: 'local', path: 'D:/a.flac', duration: 170.37 }, 169.003);
    await play({ ...streaming, duration: 4 }, 2);
    assert.deepEqual(seen, [0, 90, undefined, 169.003, 2]);
  } finally {
    globalThis.__shinawasePlaybackShim = previous;
  }
});
