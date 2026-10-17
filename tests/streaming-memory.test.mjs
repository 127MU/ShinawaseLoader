import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { createHarness } from '../ShinawaseLoader/testing/harness.mjs';
import { fileURLToPath } from 'node:url';

test('playback changes reuse search rows and scrolling saves only after settling', async () => {
  let playing = false;
  let current = { id: 'streaming:netease:1', stableKey: 'netease:1', mediaType: 'streaming' };
  const h = createHarness({
    packageDir: fileURLToPath(new URL('../examples/ECHO-Streaming/echomod/', import.meta.url)),
    config: { requireConsent: false, similarAutoPlay: false },
    echo: {
      playback: { getStatus: async () => ({ currentTrackId: current.id, state: playing ? 'playing' : 'paused' }) },
      streaming: { getProviders: async () => [{ name: 'netease', enabled: true }] },
    },
  });
  h.document.createElementNS = (_ns, tag) => h.document.createElement(tag);
  h.window.Node = h.document.createElement('span').constructor;
  h.context.player.queue = () => ({ currentTrack: current });
  h.context.settings.set({ query: 'Song', result: { tracks: [{ ...current, provider: 'netease', providerTrackId: '1', title: 'Song', playable: true }] } });
  await h.inject();
  h.openSidebarPage('main');
  await h.flushMicrotasks();
  const row = h.query('.streaming-row');
  assert.ok(row);
  playing = true;
  await h.flushTimers({ maxMs: 750 });
  assert.equal(h.query('.streaming-row'), row);
  assert.equal(row.dataset.playing, 'true');
  assert.equal(row.querySelectorAll('.playing-dot').length, 1);
  assert.equal(row.querySelectorAll('[data-streaming-playing-label]').length, 1);
  playing = false;
  await h.flushTimers({ maxMs: 750 });
  assert.equal(h.query('.streaming-row'), row);
  assert.equal(row.dataset.playing, 'false');
  assert.equal(row.querySelector('.playing-dot'), null);
  assert.equal(row.querySelector('[data-streaming-playing-label]'), null);
  const list = h.query('.streaming-results');
  let saves = 0;
  const save = h.context.settings.set;
  h.context.settings.set = (patch) => { saves += 1; return save(patch); };
  for (let i = 1; i <= 30; i += 1) {
    list.scrollTop = i * 10;
    list.dispatchEvent(new h.window.Event('scroll'));
  }
  assert.equal(saves, 0);
  await h.flushTimers({ maxMs: 300 });
  assert.equal(saves, 1);
  assert.equal(h.context.settings.get().scrollTop, 300);
  list.scrollTop = 400;
  list.dispatchEvent(new h.window.Event('scroll'));
  h.dispose();
  assert.equal(h.context.settings.get().scrollTop, 400);
  assert.equal([...h.realm.audit.listeners].filter((entry) => entry.target === h.window && entry.type === 'pagehide').length, 0);
});

test('cover fetch cancels oversized streams before buffering the full body', async () => {
  const source = readFileSync(new URL('../examples/ECHO-Streaming/echomod/main.cjs', import.meta.url), 'utf8');
  const evaluate = (fetch) => vm.runInNewContext(
    source.slice(source.indexOf('const fetchImageOnce ='), source.indexOf('const fetchCoverImage =')) + '\nfetchImageOnce',
    { fetch, AbortController, Buffer, setTimeout, clearTimeout, maxCoverBytes: 64 },
  );
  let read = 0;
  let signal;
  const oversized = evaluate(async (_url, options) => {
    signal = options.signal;
    return {
      ok: true, headers: { get: () => null },
      body: (async function* () {
        for (let i = 0; i < 100; i += 1) { read += 1; yield new Uint8Array(32); }
      })(),
    };
  });
  assert.equal(await oversized('https://example.test/cover', {}), null);
  assert.equal(read, 3);
  assert.equal(signal.aborted, true);
  const valid = evaluate(async () => ({
    ok: true, headers: { get: () => null },
    body: (async function* () { yield Uint8Array.from([0xff, 0xd8]); yield Uint8Array.from([1, 2]); })(),
  }));
  const result = await valid('https://example.test/cover', {});
  assert.equal(result.mimeType, 'image/jpeg');
  assert.deepEqual([...result.data], [0xff, 0xd8, 1, 2]);
});

test('quality metadata cache stays bounded and cannot refill after disposal', () => {
  const source = readFileSync(new URL('../examples/ECHO-Streaming/echomod/mod.js', import.meta.url), 'utf8');
  const context = vm.createContext({});
  vm.runInContext('let packageDisposed = false;\n' + source.slice(source.indexOf('const qualityProbeCache ='), source.indexOf('// Resolved probe entry')) + `
    for (let i = 0; i < 2000; i += 1) cacheQualityProbe(String(i), { qualities: ['high'] });
    globalThis.count = qualityProbeCache.size;
    globalThis.oldestRetained = qualityProbeCache.has('0');
    packageDisposed = true;
    qualityProbeCache.clear();
    cacheQualityProbe('late-response', {});
    globalThis.afterDispose = qualityProbeCache.size;
  `, context);
  assert.equal(context.count, 512);
  assert.equal(context.oldestRetained, false);
  assert.equal(context.afterDispose, 0);
});

test('streaming liked-page listeners are released across disable and reinjection', async () => {
  const h = createHarness({
    packageDir: fileURLToPath(new URL('../examples/ECHO-Streaming/echomod/', import.meta.url)),
    config: { requireConsent: false },
  });
  h.document.createElementNS = (_ns, tag) => h.document.createElement(tag);
  h.window.Node = h.document.createElement('span').constructor;
  h.document.body.innerHTML = '<section class="page-surface" data-route-id="playlists"><div class="liked-library-workspace"><div class="liked-collection-copy"><h1>我喜欢的歌曲</h1></div><div class="liked-collection-actions"></div></div></section>';
  const root = h.query('.liked-library-workspace');
  const listeners = () => [...h.realm.audit.listeners].filter((item) => item.target === root);
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await h.inject();
    assert.ok(listeners().length <= 1, 'no duplicate native-root handlers');
    assert.ok(h.query('[data-echo-streaming-liked-source="switch"]'));
    h.dispose();
    assert.equal(listeners().length, 0);
  }
});

const proxyFixture = () => {
  const source = readFileSync(new URL('../ShinawaseLoader/playback-shim.cjs', import.meta.url), 'utf8');
  let now = 0;
  let serial = 0;
  let handle;
  let prune;
  const requests = [];
  const server = new EventEmitter();
  server.listen = () => {};
  server.address = () => ({ port: 12345 });
  const http = {
    createServer(fn) { handle = fn; return server; },
    request(_url, _options, callback) {
      const req = new EventEmitter();
      req.end = () => {};
      req.destroy = () => { req.destroyed = true; req.emit('close'); };
      req.setTimeout = (_ms, fn) => { req.timeout = fn; };
      requests.push({ req, callback });
      return req;
    },
  };
  const context = vm.createContext({
    http, https: http, URL, Date: { now: () => now },
    setInterval: (fn) => { prune = fn; return { unref() {} }; }, clearInterval() {},
    randomBytes: () => ({ toString: () => String(++serial) }),
    extensionForSource: () => '.flac', staleStatus: () => false,
  });
  vm.runInContext(source.slice(source.indexOf('const installProxy ='), source.indexOf('const positiveNumber =')) + '\nglobalThis.proxy = installProxy();', context);
  const request = (url) => {
    const req = new EventEmitter();
    req.url = new URL(url).pathname;
    req.headers = {};
    const res = new EventEmitter();
    res.end = () => { res.writableEnded = true; };
    handle(req, res);
    return res;
  };
  return { proxy: context.proxy, request, requests, expire: () => { now += 13 * 60_000; prune(); } };
};

test('streaming proxy releases expired tokens and caps retained tracks', () => {
  const f = proxyFixture();
  const urls = Array.from({ length: 300 }, () => f.proxy.urlFor({ url: 'https://example.test/audio' }, { title: 'Track' }));
  assert.equal(f.request(urls[0]).statusCode, 404);
  assert.equal(f.request(urls.at(-1)).statusCode, undefined);
  f.expire();
  assert.equal(f.request(urls.at(-1)).statusCode, 404);
});

test('streaming proxy cancels upstream on consumer close and stalled requests', () => {
  const f = proxyFixture();
  const url = f.proxy.urlFor({ url: 'https://example.test/audio' });
  const res = f.request(url);
  const upstream = f.requests[0].req;
  res.destroyed = true;
  res.emit('close');
  assert.equal(upstream.destroyed, true);
  assert.equal(res.listenerCount('close'), 0);
  f.request(url);
  f.requests[1].req.timeout();
  assert.equal(f.requests[1].req.destroyed, true);
});
