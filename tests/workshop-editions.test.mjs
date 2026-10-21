// The two editions maintained side by side: the external-injection install
// (ECHO.modded.exe) and the ECHO Workshop edition installed from
// shinawase-workshop.zip. Covers the setup driver's offline pieces, the
// bootstrap's dependency archive and uninstall opt-out, the update channel, and
// drift alarms between the C# Manager, the PowerShell installer and the
// Node scripts they call. Offline fixtures only: no ECHO, Steam or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../ShinawaseLoader/echomod-archive.mjs';
import { WORKSHOP_ARCHIVE, UPDATE_REPO } from '../ShinawaseLoader/update-net.mjs';
import { githubWorkshopSources } from '../ShinawaseLoader/manager/manager-helper.mjs';
import { NODE_MODULES_ARCHIVE, OPT_OUT_FILE, extractNodeModules, install, setEdition, status } from '../ShinawaseLoader/workshop-bootstrap.mjs';
import { WORKSHOP_ITEM_ID, WORKSHOP_ZIP_NAME, echoLaunchEnv, findItem, inspectWorkshopZip, itemReady } from '../ShinawaseLoader/workshop-setup.mjs';
import { ITEM_ID, NODE_MODULES_ARCHIVE as BUILD_NODE_MODULES, WORKSHOP_ZIP_NAME as BUILD_ZIP_NAME } from '../scripts/build-workshop-item.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => readFileSync(join(repo, rel), 'utf8');
const temp = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'shinawase-editions-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const entry = (path, value) => ({ path, data: Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)) });

test('one name for the Workshop package across builder, setup, update channel and Manager', () => {
  assert.equal(WORKSHOP_ZIP_NAME, 'shinawase-workshop.zip');
  assert.equal(BUILD_ZIP_NAME, WORKSHOP_ZIP_NAME);
  assert.equal(WORKSHOP_ARCHIVE, WORKSHOP_ZIP_NAME);
  assert.equal(ITEM_ID, WORKSHOP_ITEM_ID);
  assert.equal(BUILD_NODE_MODULES, NODE_MODULES_ARCHIVE);
  assert.match(read('ShinawaseLoader/manager/Engine.cs'), new RegExp(`FileName = "${WORKSHOP_ZIP_NAME.replace('.', '\\.')}"`));
  assert.ok(read('scripts/setup-modloader.ps1').includes(`workshop\\${WORKSHOP_ZIP_NAME}`));
  assert.ok(read('scripts/build-setup.ps1').includes(`workshop\\${WORKSHOP_ZIP_NAME}`));
  assert.ok(read('scripts/build-release.ps1').includes(`'${WORKSHOP_ZIP_NAME}'`));
});

test('the Manager writes the same uninstall opt-out the bootstrap honours', () => {
  const engine = read('ShinawaseLoader/manager/Engine.cs');
  assert.ok(engine.includes(`"${OPT_OUT_FILE}"`));
  assert.ok(engine.includes('"workshop.json"'));
  for (const variable of ['ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ASAR']) assert.ok(engine.includes(`"${variable}"`), variable);
});

test('every Workshop stage the setup driver emits has a Manager step and both string sets', () => {
  const engine = read('ShinawaseLoader/manager/Engine.cs');
  const strings = read('ShinawaseLoader/manager/Strings.cs');
  const setup = read('ShinawaseLoader/workshop-setup.mjs');
  const stages = [...new Set([...setup.matchAll(/stage: '([a-z]+)'/g)].map((match) => match[1]))].sort();
  assert.deepEqual(stages, ['approve', 'echo', 'import', 'loader', 'switch', 'zip']);
  for (const stage of stages) assert.ok(engine.includes(`case "${stage}":`), `Engine.cs ignores stage ${stage}`);
  for (const step of ['ws.echo', 'ws.import', 'ws.approve', 'ws.loader', 'ws.switch']) {
    assert.ok(strings.includes(`A("step.${step}"`), `missing step.${step}`);
  }
  const ps1 = read('scripts/setup-modloader.ps1');
  for (const key of ['wsEcho', 'wsImport', 'wsApprove', 'wsLoader', 'wsSwitch', 'wsDone']) {
    assert.equal(ps1.split(`    ${key} = '`).length - 1, 2, `${key} needs zh and en text`);
  }
});

test('the setup driver reads a Workshop zip without extracting it and refuses other items', (t) => {
  const dir = temp(t);
  const good = join(dir, 'good.zip');
  writeFileSync(good, createZip([
    entry('echo.workshop.json', { type: 'echo-workshop-item', id: WORKSHOP_ITEM_ID, version: '1.8.1-1', content: { kind: 'plugin-package', entry: 'community.echo' } }),
    entry('assets/loader/loader-version.json', { version: '1.8.1.1' }),
    entry('community.echo', '{}'),
  ]));
  assert.deepEqual(inspectWorkshopZip(good), { id: WORKSHOP_ITEM_ID, version: '1.8.1-1', loaderVersion: '1.8.1.1', files: 3 });
  const other = join(dir, 'other.zip');
  writeFileSync(other, createZip([entry('echo.workshop.json', { type: 'echo-workshop-item', id: 'someone.else', version: '1.0.0', content: { kind: 'plugin-package' } })]));
  assert.throws(() => inspectWorkshopZip(other), /workshop_zip_not_shinawase/u);
  const bare = join(dir, 'bare.zip');
  writeFileSync(bare, createZip([entry('readme.txt', 'x')]));
  assert.throws(() => inspectWorkshopZip(bare), /workshop_zip_manifest_missing/u);
});

test('the setup driver prefers an enabled copy and never starts ECHO in Node mode', () => {
  const plugins = [
    { pluginId: 'other', sourceId: 'local', enabled: true, version: '1.0.0' },
    { pluginId: WORKSHOP_ITEM_ID, sourceId: 'steam', enabled: false, version: '1.8.1-1' },
    { pluginId: WORKSHOP_ITEM_ID, sourceId: 'local', enabled: true, version: '1.8.1-1' },
  ];
  assert.equal(findItem(plugins).sourceId, 'local');
  assert.equal(findItem([plugins[1]]).sourceId, 'steam');
  assert.equal(findItem([]), null);
  assert.equal(itemReady(plugins[2], '1.8.1-1'), true);
  assert.equal(itemReady(plugins[2], '1.8.2'), false);
  assert.equal(itemReady({ ...plugins[2], error: 'x' }, '1.8.1-1'), false);
  const env = echoLaunchEnv({ ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1', PATH: 'p' });
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.ELECTRON_NO_ASAR, undefined);
  assert.equal(env.SteamAppId, '5105090');
  assert.equal(env.PATH, 'p');
});

test('the dependency archive unpacks inside node_modules only and skips blocked types', (t) => {
  const dir = temp(t);
  const archive = join(dir, NODE_MODULES_ARCHIVE);
  writeFileSync(archive, createZip([
    entry('pkg/index.js', 'module.exports = 1;'),
    entry('pkg/bin/tool.cmd', '@echo off'),
    entry('pkg/native.node', 'MZ'),
    entry('../escape.js', 'x'),
    entry('pkg/../../escape2.js', 'x'),
  ]));
  const target = join(dir, 'loader', 'node_modules');
  assert.equal(extractNodeModules(archive, target), 1);
  assert.equal(readFileSync(join(target, 'pkg', 'index.js'), 'utf8'), 'module.exports = 1;');
  assert.equal(existsSync(join(target, 'pkg', 'bin', 'tool.cmd')), false);
  assert.equal(existsSync(join(target, 'pkg', 'native.node')), false);
  assert.equal(existsSync(join(dir, 'loader', 'escape.js')), false);
  assert.equal(existsSync(join(dir, 'escape2.js')), false);
});

const makeEcho = (dir) => {
  const echoRoot = join(dir, 'ECHO');
  mkdirSync(join(echoRoot, 'resources'), { recursive: true });
  writeFileSync(join(echoRoot, 'resources', 'app.asar'), 'asar');
  const payload = join(dir, 'payload');
  mkdirSync(payload, { recursive: true });
  writeFileSync(join(payload, 'loader-version.json'), JSON.stringify({ version: '1.8.1.1' }));
  writeFileSync(join(payload, 'loader.config.json'), JSON.stringify({ port: 17862 }));
  writeFileSync(join(payload, 'ShinawaseLoader.mjs'), '');
  writeFileSync(join(payload, NODE_MODULES_ARCHIVE), createZip([entry('dep/index.js', 'ok')]));
  mkdirSync(join(echoRoot, 'ShinawaseLoader'), { recursive: true });
  // A Node of its own, so the fixture does not depend on ECHO's RunAsNode fuse.
  writeFileSync(join(echoRoot, 'ShinawaseLoader', 'loader.config.json'), JSON.stringify({ runtimePath: process.execPath }));
  return { echoRoot, payload };
};

test('an uninstall stops automatic Workshop reinstalls until an explicit install', async (t) => {
  const { echoRoot, payload } = makeEcho(temp(t));
  writeFileSync(join(echoRoot, OPT_OUT_FILE), 'uninstalled');
  const skipped = await install({ echoRoot, payloadRoot: payload, auto: true, log: () => {} });
  assert.equal(skipped.plan, 'opted-out');
  assert.equal(existsSync(join(echoRoot, 'ShinawaseLoader', 'ShinawaseLoader.mjs')), false);
  assert.equal(status({ echoRoot, execPath: join(echoRoot, 'ECHO.exe') }).optedOut, true);

  const installed = await install({ echoRoot, payloadRoot: payload, log: () => {} });
  assert.equal(installed.plan, 'install');
  assert.equal(existsSync(join(echoRoot, OPT_OUT_FILE)), false);
  assert.equal(readFileSync(join(echoRoot, 'ShinawaseLoader', 'node_modules', 'dep', 'index.js'), 'utf8'), 'ok');
  assert.equal(existsSync(join(echoRoot, 'ShinawaseLoader', NODE_MODULES_ARCHIVE)), false, 'the archive itself is not installed');

  assert.equal(setEdition(echoRoot, 'workshop'), 'workshop');
  assert.equal(status({ echoRoot, execPath: join(echoRoot, 'ECHO.exe') }).edition, 'workshop');
  assert.throws(() => setEdition(echoRoot, 'other'), /unknown edition/u);
  // A later Workshop update keeps the recorded edition.
  writeFileSync(join(payload, 'loader-version.json'), JSON.stringify({ version: '1.8.1.2' }));
  await install({ echoRoot, payloadRoot: payload, log: () => {} });
  assert.equal(status({ echoRoot, execPath: join(echoRoot, 'ECHO.exe') }).edition, 'workshop');
});

test('GitHub serves the Workshop edition as a release asset of the same repository', () => {
  const sources = githubWorkshopSources(false);
  assert.deepEqual(sources.map((source) => source.id), ['ghproxy', 'github']);
  assert.equal(sources[1].url, `https://github.com/${UPDATE_REPO}/releases/latest/download/${WORKSHOP_ARCHIVE}`);
  assert.deepEqual(githubWorkshopSources(true).map((source) => source.id), ['github']);
});
