import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createHarness } from '../ShinawaseLoader/testing/harness.mjs';

const packageDir = (name) => fileURLToPath(new URL(`../examples/${name}/echomod/`, import.meta.url));
// The SDK's mini DOM does not expose SVG creation or the browser Node constructor.
const browserDom = (h) => {
  h.document.createElementNS = (_namespace, tag) => h.document.createElement(tag);
  h.window.Node = h.document.createElement('span').constructor;
  return h;
};
const expectDisposed = (h) => {
  // Detached nodes and their local listeners are collected by browsers; the mini DOM retains them for inspection.
  for (const listener of h.realm.audit.listeners) {
    if (listener.target.nodeType === 1 && !listener.target.isConnected) h.realm.audit.listeners.delete(listener);
  }
  h.expectClean();
};
const input = (h, node, value) => {
  node.value = value;
  node.dispatchEvent(new h.window.Event('input', { bubbles: true }));
};

test('playlist keyword search, pagination, my-playlist filtering and URL import stay usable', async () => {
  const requests = [];
  const h = browserDom(createHarness({
    packageDir: packageDir('ECHO-Streaming'), config: { requireConsent: false, locale: 'en-US' },
    echo: { streaming: {
      getProviders: async () => [{ name: 'netease', displayName: 'NetEase', enabled: true }],
      listAccountPlaylists: async () => ({ playlists: [
        { provider: 'netease', providerPlaylistId: '1', title: 'Chill nights' },
        { provider: 'netease', providerPlaylistId: '2', title: '跑步音乐' },
      ] }),
      search: async (request) => {
        requests.push(request);
        return { playlists: [{ provider: 'netease', providerPlaylistId: String(request.page), title: `Result ${request.page}` }], hasMore: request.page === 1 };
      },
    } },
  }));
  h.context.settings.set({ activeTab: 'playlist' });
  await h.inject();
  h.openSidebarPage('main');
  await h.flushMicrotasks();
  const search = h.query('.streaming-search-box input');
  assert.equal(search.placeholder, 'Search online playlists');
  input(h, search, 'Ambient');
  h.query('.streaming-search-submit').click();
  await h.flushMicrotasks();
  assert.equal(requests[0].query, 'Ambient');
  assert.deepEqual([...requests[0].mediaTypes], ['playlist']);
  h.query('.streaming-load-more').click();
  await h.flushMicrotasks();
  assert.equal(requests[1].page, 2);
  assert.equal(h.query('.streaming-playlist-search-results').children.length, 2);
  h.queryAll('.streaming-fold-title').find((node) => node.textContent === 'Sync my playlists').click();
  await h.flushMicrotasks();
  const filter = h.query('.streaming-playlist-filter input');
  filter.focus();
  input(h, filter, '跑步');
  const rows = h.query('[data-account-playlist-filter-list]').children;
  assert.deepEqual(rows.map((row) => row.hidden), [true, false]);
  input(h, filter, 'missing');
  assert.equal(h.query('[data-account-playlist-filter-empty]').hidden, false);
  input(h, filter, '');
  assert.ok(rows.every((row) => !row.hidden));
  const url = h.query('.streaming-playlist-import input');
  const add = h.query('.streaming-playlist-import button');
  assert.equal(add.disabled, true);
  input(h, url, 'https://music.163.com/#/playlist?id=1');
  assert.equal(add.disabled, false);
  input(h, url, '');
  assert.equal(add.disabled, true);
  assert.ok(h.queryAll('button.tool-button').every((button) => button.classList.contains('echo-streaming-button')));
  h.dispose();
  expectDisposed(h);
});

test('streaming paused/missing status covers both native player surfaces, recovers and cleans up', async () => {
  let current = { id: 'streaming:netease:1', mediaType: 'streaming' };
  let status = null;
  let playCalls = 0;
  const h = browserDom(createHarness({ packageDir: packageDir('ECHO-Streaming'), echo: { playback: {
    getStatus: async () => { if (status === 'error') throw new Error('status unavailable'); return status; },
    play: async () => { playCalls += 1; status = { currentTrackId: current.id, state: 'playing' }; },
  } } }));
  h.context.player.queue = () => ({ currentTrack: current });
  h.document.body.innerHTML = '<div class="player-bar"><button class="play-button" title="Pause" aria-label="Pause"><svg></svg></button></div><div class="lyrics-page"><button class="lyrics-primary-control" title="Pause" aria-label="Pause"><svg></svg></button></div>';
  await h.inject();
  await h.flushMicrotasks();
  const buttons = h.queryAll('.player-bar button, .lyrics-page button');
  assert.ok(buttons.every((button) => button.hasAttribute('data-echo-streaming-paused')));
  assert.ok(buttons.every((button) => button.getAttribute('aria-label') === '播放'));
  buttons[1].click();
  await h.flushMicrotasks();
  assert.equal(playCalls, 1);
  assert.ok(buttons.every((button) => !button.hasAttribute('data-echo-streaming-paused')));
  status = { currentTrackId: current.id, state: 'paused' };
  await h.flushTimers({ maxMs: 750 });
  assert.ok(buttons.every((button) => button.hasAttribute('data-echo-streaming-paused')));
  status = { currentTrackId: 'old-track', state: 'playing' };
  await h.flushTimers({ maxMs: 750 });
  assert.ok(buttons.every((button) => button.hasAttribute('data-echo-streaming-paused')));
  status = 'error';
  await h.flushTimers({ maxMs: 750 });
  assert.ok(buttons.every((button) => button.hasAttribute('data-echo-streaming-paused')));
  current = { id: 'local:1', mediaType: 'local' };
  await h.flushTimers({ maxMs: 750 });
  assert.ok(buttons.every((button) => !button.hasAttribute('data-echo-streaming-paused')));
  current = { id: 'streaming:netease:1', mediaType: 'streaming' };
  status = null;
  await h.flushTimers({ maxMs: 750 });
  h.dispose();
  assert.ok(buttons.every((button) => button.getAttribute('aria-label') === 'Pause'));
  assert.equal(h.queryAll('.echo-streaming-paused-icon').length, 0);
  h.expectClean();
});

test('whitebox controls survive continuous lyrics mutations and search every lyrics source explicitly', async () => {
  const cleared = [];
  const searched = [];
  // ECHO Steam keeps only "local" enabled (online sources are Workshop-provided), so a search without a provider
  // id never reaches NetEase / LRCLIB / QQ Music: the panel must name each one.
  const searchCandidatesForSnapshot = async (request, query, provider) => {
    searched.push({ provider, query, trackId: request.trackId });
    return provider === 'lrclib' ? [{ id: 'c1', provider: 'lrclib', title: 'Song', artist: 'Artist', hasSynced: true }] : [];
  };
  const h = browserDom(createHarness({ packageDir: packageDir('ECHO-LyricsMatchWhitebox'), config: { disableAutoOpenOnBoot: false }, echo: { lyrics: { clearCache: async (id) => cleared.push(id), searchCandidatesForSnapshot } } }));
  h.context.player.queue = () => ({ currentTrack: { id: 'streaming:netease:1', mediaType: 'streaming', title: 'Song', artist: 'Artist' } });
  h.document.body.innerHTML = '<div class="app-titlebar-actions"></div><section class="lyrics-settings-drawer-root" data-open="true"><div class="lyrics-current-track-section"><div class="lyrics-section-collapse-content"><div class="lyrics-current-track-actions"></div></div></div></section>';
  let opened = 0;
  const navigate = h.context.extend.navigate;
  h.context.extend.navigate = (route) => { assert.equal(route, 'lyrics'); opened += 1; navigate(route); };
  await h.inject();
  assert.ok(h.query('[data-echo-lmwb-host]'));
  const button = h.query('[data-echo-lmwb-rematch]');
  assert.ok(button);
  let automatic = 0;
  const searches = [];
  // Fake host listeners belong to the fixture, not the package cleanup audit.
  const manual = (event) => searches.push(event.detail.query);
  const auto = () => { automatic += 1; };
  h.window.addEventListener('lyrics:search-requested', manual);
  h.window.addEventListener('lyrics:rematch-requested', auto);
  button.click();
  await h.flushTimers({ maxMs: 100 });
  await h.flushMicrotasks();
  assert.equal(opened, 1, 'opening matching from another route opens the native lyrics page first');
  assert.deepEqual(cleared, [], 'clearing the cache would trigger a host reload and dismiss candidates');
  assert.deepEqual(searches, [], 'the host search only covers local lyrics on current ECHO builds');
  assert.equal(automatic, 0);
  assert.equal(h.queryAll('[data-echo-lmwb-match-panel]').length, 1, 'no exact match: the whitebox panel opens');
  const panelSearch = searched.filter((entry) => entry.query === 'song');
  for (const provider of ['netease', 'lrclib', 'qqmusic']) {
    assert.ok(panelSearch.some((entry) => entry.provider === provider), `${provider} is searched by name`);
  }
  assert.ok(h.query('.echo-lmwb-cand'), 'network candidates are listed');
  // A second open request while one is pending or open never stacks overlays.
  h.query('[data-echo-lmwb-match-icon]').click();
  h.query('[data-echo-lmwb-match-icon]').click();
  await h.flushMicrotasks();
  assert.equal(h.queryAll('[data-echo-lmwb-match-panel]').length, 1);
  assert.equal(h.query('.lyrics-settings-drawer-root').getAttribute('data-open'), 'true');
  button.remove();
  for (let i = 0; i < 10; i += 1) {
    const lyricsUpdate = h.document.createElement('span');
    h.realm.audit.exempt(lyricsUpdate);
    h.query('.lyrics-section-collapse-content').append(lyricsUpdate);
    await h.flushTimers({ maxMs: 10 });
  }
  assert.equal(h.queryAll('[data-echo-lmwb-rematch]').length, 1);
  h.window.removeEventListener('lyrics:search-requested', manual);
  h.window.removeEventListener('lyrics:rematch-requested', auto);
  h.dispose();
  await h.flushMicrotasks();
  expectDisposed(h);
});

test('whitebox shows an explicit empty source filter and preserves native filtering when candidates arrive', async () => {
  const h = browserDom(createHarness({ packageDir: packageDir('ECHO-LyricsMatchWhitebox'), config: { injectToggle: false, injectRematch: false, disableAutoOpenOnBoot: false, locale: 'en-US' } }));
  h.document.body.innerHTML = '<section class="lyrics-match-panel"><div class="lyrics-match-panel__bar">Searching...</div></section>';
  await h.inject();
  const panel = h.query('.lyrics-match-panel');
  assert.equal(h.query('.echo-lmwb-empty-filter button').disabled, true);
  assert.equal(h.query('.echo-lmwb-empty-filter button').textContent, 'All sources0');
  assert.match(h.query('.echo-lmwb-empty-filter [role="status"]').textContent, /candidates arrive/);
  const filters = h.document.createElement('div');
  filters.className = 'lyrics-source-filters';
  filters.innerHTML = '<button data-active="true">All sources<small>2</small></button><button data-active="false">LRCLIB<small>2</small></button>';
  const nativeButton = filters.children[1];
  let selected = 0;
  const select = () => { selected += 1; nativeButton.setAttribute('data-active', 'true'); };
  nativeButton.addEventListener('click', select);
  panel.append(filters);
  await h.flushTimers({ maxMs: 100 });
  assert.equal(h.query('.echo-lmwb-empty-filter'), null);
  assert.equal(filters.children[1], nativeButton, 'the host owns the source buttons and handlers');
  nativeButton.click();
  assert.equal(selected, 1);
  filters.remove();
  await h.flushTimers({ maxMs: 100 });
  assert.equal(h.queryAll('.echo-lmwb-empty-filter').length, 1);
  nativeButton.removeEventListener('click', select);
  h.dispose();
  assert.equal(h.query('.echo-lmwb-empty-filter'), null);
  expectDisposed(h);
});

test('whitebox asks the host to search candidates once after streaming lyrics give up', async () => {
  const h = browserDom(createHarness({
    packageDir: packageDir('ECHO-LyricsMatchWhitebox'),
    config: { injectToggle: false, injectRematch: false, disableAutoOpenOnBoot: false, locale: 'en-US' },
  }));
  h.context.player.queue = () => ({ currentTrack: { id: 'streaming:netease:1', title: 'Song', artist: 'Artist' } });
  h.document.body.innerHTML = '<section class="lyrics-match-panel"><p class="lyrics-match-status">No lyrics found</p></section>';
  const searches = [];
  const onSearch = (event) => searches.push(event.detail.query);
  h.window.addEventListener('lyrics:search-requested', onSearch);
  await h.inject();
  await h.flushTimers({ maxMs: 100 });
  // Title only by default (normalizeIncludeArtist): LRCLIB returns nothing for "title artist".
  assert.deepEqual(searches, ['song']);
  h.query('.lyrics-match-status').textContent = 'No lyrics found';
  await h.flushTimers({ maxMs: 100 });
  assert.deepEqual(searches, ['song']);
  h.window.removeEventListener('lyrics:search-requested', onSearch);
  h.dispose();
  expectDisposed(h);
});
