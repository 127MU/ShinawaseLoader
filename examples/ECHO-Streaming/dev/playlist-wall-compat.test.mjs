// Synthetic host shapes only; no extracted ECHO source or user data.
// ECHO 26.10.8+ playlists: a collection home with an artwork wall, detail
// pages without a playlist rail, and "new playlist" as a floating card.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createMockRealm } from '../../../ShinawaseLoader/testing/mock-dom.mjs';

const mod = readFileSync(new URL('../echomod/mod.js', import.meta.url), 'utf8');
const installSource = mod.slice(mod.indexOf('const installNativePlaylistImport = () => {'), mod.indexOf('playlistPageUnsubscribe = installNativePlaylistImport();'));

const realmWith = (markup) => {
  const realm = createMockRealm();
  realm.document.body.innerHTML = `<section class="page-surface" data-route-id="playlists">${markup}</section>`;
  realm.window.window = realm.window;
  // The SDK mock omits :scope and a few sibling/layout accessors; these
  // fixtures only use direct-child queries, so a descendant query is enough.
  const proto = Object.getPrototypeOf(realm.document.body);
  const query = proto.querySelector;
  const queryAll = proto.querySelectorAll;
  proto.querySelector = function (selector) { return query.call(this, String(selector).replaceAll(':scope > ', '')); };
  proto.querySelectorAll = function (selector) { return queryAll.call(this, String(selector).replaceAll(':scope > ', '')); };
  const siblings = (node) => node.parentElement?.children || [];
  Object.defineProperty(proto, 'nextElementSibling', { configurable: true, get() { const all = siblings(this); return all[all.indexOf(this) + 1] || null; } });
  Object.defineProperty(proto, 'lastElementChild', { configurable: true, get() { const all = this.children; return all[all.length - 1] || null; } });
  proto.getClientRects = function () { return []; };
  vm.createContext(realm.window);
  Object.assign(realm.window, {
    console: { info() {} },
    pageRoot: null,
    state: { dailyPlaylists: [] },
    neteaseConnected: () => false,
    copy: { addPlaylist: 'Import', playlistPlaceholderShort: 'Paste link', add: 'Add', adding: 'Adding', cancelImport: 'Cancel' },
  });
  return realm;
};
const install = (realm) => vm.runInContext(`let paintNativeDailyPanel; ${installSource}; installNativePlaylistImport()`, realm.window);

const home = '<div class="playlists-page playlists-page--collection playlists-page--home"><main class="playlist-collection-home">'
  + '<header class="playlist-overview-header"><div class="playlist-overview-actions"><button class="playlist-overview-create">New</button><button class="tool-button"></button></div></header>'
  + '<section class="playlist-library"></section></main></div>';

test('wall home: import opens a card in ECHO\'s create-card shape and yields to ECHO\'s own card', async () => {
  const realm = realmWith(home);
  const dispose = install(realm);
  const page = realm.document.querySelector('.playlists-page--home');
  const button = realm.document.querySelector('[data-echo-streaming-import-button]');
  assert.ok(button, 'import button mounts in the home header');

  button.click();
  const card = page.querySelector('[data-echo-streaming-import-popover]');
  assert.ok(card, 'opens a floating card on the collection page');
  assert.equal(card.parentElement, page);
  assert.ok(card.querySelector('.collection-playlist-create form[data-echo-streaming-playlist-import] input'), 'reuses ECHO\'s create form classes');
  assert.equal(card.querySelectorAll('.tool-button').length, 2);
  assert.equal(realm.document.querySelector('.playlist-collection-home > form'), null, 'no form under the header any more');

  button.click();
  assert.equal(page.querySelector('[data-echo-streaming-import-popover]'), null, 'a second click closes it');

  button.click();
  page.dataset.creating = 'true';
  await realm.clock.flush({ maxMs: 1600 });
  assert.equal(page.querySelector('[data-echo-streaming-import-popover]'), null, 'ECHO\'s own create card wins');

  dispose();
  assert.equal(realm.document.querySelector('[data-echo-streaming-import-button], [data-echo-streaming-import-popover]'), null);
});

test('wall detail pages get no import button; the legacy detail header still does', () => {
  const detail = (pageClass) => `<div class="playlists-page ${pageClass}"><section class="playlist-detail"><header class="playlist-detail-header">`
    + '<div class="playlist-actions playlist-detail-primary-actions"><button class="primary-action"></button></div></header></section></div>';
  const wall = realmWith(detail('playlists-page--collection playlists-page--wall-detail'));
  const disposeWall = install(wall);
  assert.equal(wall.document.querySelector('[data-echo-streaming-import-button]'), null);
  disposeWall();

  const legacy = realmWith(detail('playlists-page--collection'));
  const disposeLegacy = install(legacy);
  assert.equal(legacy.document.querySelectorAll('[data-echo-streaming-import-button]').length, 1);
  disposeLegacy();
});
