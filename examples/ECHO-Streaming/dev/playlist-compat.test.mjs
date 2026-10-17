// Synthetic host shapes only; no extracted ECHO source or user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { patchSteamPlaylistsPage } from '../../../ShinawaseLoader/echo-asar.mjs';
import { createMockRealm } from '../../../ShinawaseLoader/testing/mock-dom.mjs';

const mod = readFileSync(new URL('../echomod/mod.js', import.meta.url), 'utf8');
const fixture = (helper) => `convert=${helper}(row=>row.track?{...row.track,playlistItemId:row.id,unavailable:row.unavailable||row.track.unavailable}:{id:row.mediaId??row.id,path:"",title:row.titleSnapshot??"Unavailable track",artist:row.artistSnapshot??"Unknown artist",album:row.albumSnapshot??"",albumArtist:row.artistSnapshot??"",trackNo:null,discNo:null,year:null,genre:null,duration:row.durationSnapshot??0,codec:null,sampleRate:null,bitDepth:null,bitrate:null,coverId:row.coverId,coverThumb:row.coverThumb,fieldSources:{},playlistItemId:row.id,unavailable:!0},"itemToTrack")`;

test('playlist tracks survive renamed bundler helpers, while unavailable/local rows keep their behavior', () => {
  for (const helper of ['l', 't', '$wrap']) {
    const original = fixture(helper);
    const patched = patchSteamPlaylistsPage(original);
    assert.notEqual(patched, original);
    assert.equal(patchSteamPlaylistsPage(patched), patched);
    const convert = vm.runInNewContext(`const ${helper}=fn=>fn; let convert; ${patched}; convert`);
    const row = { id: 'item', mediaType: 'stream_track', mediaId: 'streaming:netease:123', sourceProvider: 'netease', sourceItemId: '123', titleSnapshot: 'Song', track: null };
    assert.equal(convert(row).unavailable, false);
    assert.equal(convert(row).providerTrackId, '123');
    assert.equal(convert({ ...row, unavailable: true }).unavailable, true);
    assert.equal(convert({ id: 'local', track: { title: 'Local', path: '/music/song.flac' } }).path, '/music/song.flac');
  }
});

const installSource = mod.slice(mod.indexOf('const installNativePlaylistImport = () => {'), mod.indexOf('playlistPageUnsubscribe = installNativePlaylistImport();'));
const realmWith = (markup) => {
  const realm = createMockRealm();
  realm.document.body.innerHTML = `<section class="page-surface" data-route-id="playlists">${markup}</section>`;
  realm.window.window = realm.window;
  // The SDK mock omits :scope. These fixtures have only direct action buttons.
  for (const actions of realm.document.querySelectorAll('.playlist-overview-actions, .playlist-detail-primary-actions')) {
    const query = actions.querySelector.bind(actions);
    actions.querySelector = selector => query(selector.replaceAll(':scope > ', ''));
  }
  vm.createContext(realm.window);
  return realm;
};

test('overview and detail actions mount once and clean up, with no legacy sidebar', async () => {
  for (const markup of [
    '<main class="playlist-collection-home"><header class="playlist-overview-header"><div class="playlist-overview-actions"><button class="tool-button"></button></div></header></main>',
    '<section class="playlist-detail"><header class="playlist-detail-header"><div class="playlist-actions playlist-detail-primary-actions"><button></button></div></header></section>',
  ]) {
    const realm = realmWith(markup);
    Object.assign(realm.window, { console: { info() {} }, pageRoot: null, state: { dailyPlaylists: [] }, neteaseConnected: () => false, copy: { addPlaylist: 'Import' } });
    const dispose = vm.runInContext(`let paintNativeDailyPanel; ${installSource}; installNativePlaylistImport()`, realm.window);
    const actions = realm.document.querySelector('.playlist-overview-actions, .playlist-detail-primary-actions');
    assert.equal(actions.querySelectorAll('[data-echo-streaming-import-button]').length, 1);
    await realm.clock.flush({ maxMs: 1600 });
    assert.equal(actions.querySelectorAll('[data-echo-streaming-import-button]').length, 1);
    dispose();
    assert.equal(realm.document.querySelector('[data-echo-streaming-import-button]'), null);
    assert.equal(realm.document.getElementById('echo-streaming-playlist-import-style'), null);
  }
});

test('import navigation reaches a playlist outside the visible wall', async () => {
  const realm = realmWith('<main class="playlist-collection-home"></main>');
  let navigated = null;
  realm.window.addEventListener('app:global-search:navigate-playlist', (event) => {
    navigated = event.detail.playlistId;
    realm.document.querySelector('main').innerHTML = '<div class="playlist-detail-copy"><h2>Imported</h2></div>';
  });
  Object.assign(realm.window, { libraryApi: () => ({}), sleep: async () => {}, revealNativePlaylists() {}, external: {} });
  const source = mod.slice(mod.indexOf('const findPlaylistsNav ='), mod.indexOf('const handleImportPlaylist ='));
  const open = vm.runInContext(`${source}; openImportedPlaylist`, realm.window);
  assert.equal(await open({ playlistId: 'imported-id', playlistName: 'Imported' }), true);
  assert.equal(navigated, 'imported-id');
});
