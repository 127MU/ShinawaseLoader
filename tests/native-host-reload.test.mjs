// Regression: every package install, uninstall, enable, or disable made the
// native host dispose and re-activate every main script, re-importing .mjs
// mains that Node can never unload. A changedOnly reload (what the Loader now
// sends) keeps packages whose manifest, config, and entry files are unchanged;
// a plain reload still restarts everything.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const nativeHost = fileURLToPath(new URL('../ShinawaseLoader/native-host.cjs', import.meta.url));

const counting = `const { appendFileSync } = require('node:fs');
const { join } = require('node:path');
module.exports = (host) => {
  appendFileSync(join(host.directory, 'events.txt'), 'activate\\n');
  return () => appendFileSync(join(host.directory, 'events.txt'), 'dispose\\n');
};`;
const countingEsm = `import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
export const activate = (host) => {
  appendFileSync(join(host.directory, 'events.txt'), 'activate\\n');
  return () => appendFileSync(join(host.directory, 'events.txt'), 'dispose\\n');
};`;

const workspace = (t) => {
  const base = mkdtempSync(join(tmpdir(), 'shinawase-native-reload-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const home = join(base, 'ShinawaseLoader');
  const game = join(base, 'game');
  mkdirSync(home, { recursive: true });
  const dirs = {};
  for (const [id, main, source] of [['test.cjs', 'main.cjs', counting], ['test.esm', 'main.mjs', countingEsm]]) {
    const directory = join(game, 'Mods', 'installed', id);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'echo.mod.json'), JSON.stringify({ id, name: id, version: '1.0.0', main }));
    writeFileSync(join(directory, main), source);
    writeFileSync(join(directory, 'config.json'), '{"n":1}');
    dirs[id] = directory;
  }
  writeFileSync(join(home, 'loader-state.json'), JSON.stringify({ mods: { 'test.cjs': { enabled: true, kind: 'mod' }, 'test.esm': { enabled: true, kind: 'mod' } } }));
  return { home, game, dirs };
};

const driver = (configFile) => `
const { writeFileSync } = require('node:fs');
const host = require(${JSON.stringify(nativeHost)});
(async () => {
  await host.startShinawaseNativeHost();
  const unchanged = await host.callNative({ method: 'reload', payload: { changedOnly: true } });
  writeFileSync(${JSON.stringify(configFile)}, '{"n":2}');
  const changed = await host.callNative({ method: 'reload', payload: { changedOnly: true } });
  const full = await host.callNative({ method: 'reload' });
  process.stdout.write(JSON.stringify({ unchanged, changed, full }));
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
`;

test('changedOnly reloads keep unchanged native packages running', (t) => {
  const { home, game, dirs } = workspace(t);
  const run = spawnSync(process.execPath, ['-e', driver(join(dirs['test.cjs'], 'config.json'))], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    env: { ...process.env, ECHO_MOD_HOME: home, ECHO_GAME_ROOT: game, ECHO_LOGS_HOME: join(home, 'Logs'), ECHO_NATIVE_PORT: '0' },
  });
  assert.equal(run.status, 0, run.stderr);
  const { unchanged, changed, full } = JSON.parse(run.stdout.trim().split('\n').pop());
  for (const status of [unchanged, changed, full]) assert.deepEqual([...status.packages].sort(), ['test.cjs', 'test.esm']);
  assert.deepEqual([...unchanged.kept].sort(), ['test.cjs', 'test.esm']);
  assert.deepEqual(changed.kept, ['test.esm'], 'only the package whose config changed restarts');
  assert.deepEqual(full.kept, [], 'a plain reload restarts every package');

  const events = (id) => readFileSync(join(dirs[id], 'events.txt'), 'utf8').trim().split('\n');
  // start, config change, full reload
  assert.deepEqual(events('test.cjs'), ['activate', 'dispose', 'activate', 'dispose', 'activate']);
  // start, full reload
  assert.deepEqual(events('test.esm'), ['activate', 'dispose', 'activate']);
});
