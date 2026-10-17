// Focused offline host-integration checks; fixtures contain no ECHO code/data.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { createMockRealm } from '../../../ShinawaseLoader/testing/mock-dom.mjs';

const source = readFileSync(new URL('../echomod/mod.js', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const setup = (markup) => {
  const realm = createMockRealm();
  realm.document.body.innerHTML = markup;
  realm.window.window = realm.window;
  const make = (tag, className = '') => Object.assign(realm.document.createElement(tag), { className });
  Object.assign(realm.window, {
    make, makeIcon: () => make('span'), copy: { play: 'Play' },
    actionButton: (label, icon, handler, options = {}) => {
      const button = make('button', options.className);
      button.textContent = label;
      button.disabled = options.disabled === true;
      button.addEventListener('click', handler);
      return button;
    },
  });
  vm.createContext(realm.window);
  return realm;
};

test('current transport button and legacy button both recover and restore labels', () => {
  const realm = setup('<button class="player-primary-control" data-workshop-icon="transport-pause" title="Pause" aria-label="Pause"><span></span></button><button class="play-button" title="Pause"></button>');
  const sync = vm.runInContext(`${between('const pausedButtons =', 'let playbackStatusPending =')}; syncNativePlaybackButtons`, realm.window);
  sync(true);
  assert.equal(realm.document.querySelectorAll('[data-echo-streaming-paused]').length, 2);
  sync(false);
  const button = realm.document.querySelector('.player-primary-control');
  assert.equal(button.getAttribute('aria-label'), 'Pause');
  assert.equal(button.getAttribute('title'), 'Pause');
  assert.equal(realm.document.querySelector('[data-echo-streaming-paused]'), null);
});

test('daily playlist navigation picks its own page among multiple mods', () => {
  const realm = setup('<button class="nav-item" data-echo-external-sidebar="other:main">Other</button><button class="nav-item" data-echo-external-sidebar="echo.community-streaming:accounts">Streaming accounts</button><button class="nav-item" data-echo-external-sidebar="echo.community-streaming:main">Music</button>');
  realm.window.manifest = { id: 'echo.community-streaming' };
  const find = vm.runInContext(`${between('const findStreamingNav =', 'const openStreamingDailyPlaylist =')}; findStreamingNav`, realm.window);
  assert.equal(find().getAttribute('data-echo-external-sidebar'), 'echo.community-streaming:main');
});

test('independent liked route supports streaming playback with an empty local library and restores local UI', async () => {
  const realm = setup('<section class="page-surface" data-route-id="liked"><main class="liked-library-workspace"><header class="liked-workspace-header"><div class="liked-collection-copy"><h1>お気に入りの曲</h1><p>0</p></div><div class="liked-collection-actions"><button class="liked-primary-action" disabled>Local play</button></div></header><section class="playlist-empty-state">Local empty</section></main></section>');
  const played = [];
  Object.assign(realm.window, {
    packageDisposed: false, chinese: false, defaultCover: '', formatDuration: () => '1:00',
    state: { accountStatuses: [{ provider: 'netease', connected: true }], providers: [] },
    invokeMain: async (method) => method === 'neteaseAccountPlaylists'
      ? { playlists: [{ title: '我喜欢的音乐', providerPlaylistId: 'likes' }] }
      : { tracks: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }, { id: 'blocked', playable: false }] },
    toLibraryTrack: track => track, sourceFor: provider => ({ provider }),
    playViaQueue: async (track, options) => { played.push({ track, options }); },
  });
  const dispose = vm.runInContext(`${between('const installLikedSourceSwitch =', 'const likedSourceUnsubscribe =')}; installLikedSourceSwitch()`, realm.window);
  realm.document.querySelector('button[data-provider="netease"]').click();
  await setImmediate();
  const root = realm.document.querySelector('.liked-library-workspace');
  assert.equal(root.getAttribute('data-echo-streaming-liked-provider'), 'netease');
  const controls = root.querySelectorAll('.echo-streaming-liked-play-actions button');
  assert.equal(controls.length, 2);
  assert.equal(controls[0].disabled, false);
  controls[0].click();
  controls[1].click();
  await setImmediate();
  assert.equal(played.length, 2);
  for (const call of played) {
    assert.equal(call.options.replaceQueueWith.length, 2);
    assert.equal(call.track.provider, 'netease');
  }
  assert.equal(root.querySelectorAll('.echo-streaming-liked-row')[2].disabled, true);
  realm.document.querySelector('button[data-provider="local"]').click();
  await setImmediate();
  assert.equal(root.getAttribute('data-echo-streaming-liked-provider'), null);
  assert.equal(root.querySelector('.echo-streaming-liked-list'), null);
  assert.equal(root.querySelector('.liked-collection-copy p').textContent, '0');
  dispose();
  assert.equal(realm.document.querySelector('[data-echo-streaming-liked-source]'), null);
});

test('artist extension ignores cached hidden routes and inactive album tabs', () => {
  const realm = setup('<section class="page-surface" hidden><div class="artist-detail-page"><section class="artist-albums-view"></section></div></section><section class="page-surface"><div class="artist-detail-page"><section class="artist-albums-view" hidden></section></div></section>');
  const { page, albums } = vm.runInContext(`${between('  const liveArtistPage =', '  const cleanArtistName =')}; ({page: liveArtistPage, albums: liveAlbumsView})`, realm.window);
  assert.equal(page().closest('.page-surface').hidden, false);
  assert.equal(albums(), null);
  page().querySelector('.artist-albums-view').removeAttribute('hidden');
  assert.ok(albums());
});
