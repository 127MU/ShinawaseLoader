// The ECHO Workshop edition: the bootstrap that installs the Loader from a
// Workshop item, the Node host that relaunches into the isolated runtime, the
// main bridge running the Loader on ECHO's own Node, and the item builder.
// Offline fixtures only; no ECHO and no Workshop content are needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createZip } from '../ShinawaseLoader/echomod-archive.mjs';
import { mainBridgeSource } from '../ShinawaseLoader/echo-asar.mjs';
import { findIsolatedBinary, launchIsolated, splitHostArgs, waitForExit } from '../ShinawaseLoader/echo-modded-host.mjs';
import {
  autoSwitchAllowed, compareVersions, install, locateEcho, mergeWorkshopConfig, noteModdedStart, noteSwitch,
  planInstall, planPackages, setAutoSwitch, status,
} from '../ShinawaseLoader/workshop-bootstrap.mjs';
import { BLOCKED_EXTENSIONS, payloadIncluded, workshopPathProblem, workshopVersion } from '../scripts/build-workshop-item.mjs';

const tempDir = (t, prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const writeJson = (file, value) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('four-part Loader versions order after their three-part base', () => {
  assert.equal(compareVersions('1.8.1.1', '1.8.1'), 1);
  assert.equal(compareVersions('1.8.1', '1.8.1.0'), 0);
  assert.equal(compareVersions('1.8.2', '1.8.1.9'), 1);
  assert.equal(workshopVersion('1.8.1.1'), '1.8.1-1');
  assert.equal(workshopVersion('1.9.0'), '1.9.0');
});

test('the running ECHO is located from the utility process executable', () => {
  assert.deepEqual(locateEcho('D:\\Steam\\steamapps\\common\\ECHO\\ECHO.exe', 'win32').modded, false);
  const modded = locateEcho('D:\\Steam\\steamapps\\common\\ECHO\\ShinawaseLoader\\modded-runtime\\ECHO.exe', 'win32');
  assert.equal(modded.modded, true);
  assert.match(modded.echoRoot.replaceAll('\\', '/'), /\/steamapps\/common\/ECHO$/u);
  assert.equal(locateEcho('/games/ECHO/ShinawaseLoader/modded-runtime/ECHO', 'linux').modded, true);
  assert.match(locateEcho('/Applications/ECHO.app/Contents/Frameworks/ECHO Helper.app/Contents/MacOS/ECHO Helper', 'darwin').echoRoot.replaceAll('\\', '/'), /\/Applications$/u);
});

test('install plans never downgrade and follow Workshop revisions only for Workshop installs', () => {
  assert.equal(planInstall({ payloadVersion: '1.8.1.1', installedVersion: null }), 'install');
  assert.equal(planInstall({ payloadVersion: '1.8.1.1', installedVersion: '1.8.1' }), 'update');
  assert.equal(planInstall({ payloadVersion: '1.8.1.1', installedVersion: '1.8.2' }), 'keep-newer');
  assert.equal(planInstall({ payloadVersion: '1.8.1.1', installedVersion: '1.8.1.1', revision: 'b', installedRevision: 'a', workshopOwned: true }), 'update');
  assert.equal(planInstall({ payloadVersion: '1.8.1.1', installedVersion: '1.8.1.1', revision: 'b', installedRevision: 'a', workshopOwned: false }), 'current');
});

test('Workshop config keeps user settings and only falls back to ECHO\'s Node', () => {
  const merged = mergeWorkshopConfig({ port: 18000, locale: 'en', autoStart: false }, { port: 17862, safeMode: false }, { echoNode: true, ownNode: false });
  assert.equal(merged.port, 18000);
  assert.equal(merged.locale, 'en');
  assert.equal(merged.safeMode, false);
  assert.equal(merged.autoStart, true);
  assert.equal(merged.autoStartMode, 'app-asar-bridge');
  assert.equal(merged.nodeRuntime, 'echo');
  assert.equal(mergeWorkshopConfig({ runtimePath: 'C:/node/node.exe' }, {}, { echoNode: true, ownNode: true }).nodeRuntime, undefined);
});

const makePayload = (dir, version) => {
  writeJson(join(dir, 'loader-version.json'), { name: 'ShinawaseLoader', version });
  writeJson(join(dir, 'loader.config.json'), { autoStart: false, autoStartMode: 'manual', port: 17862 });
  // A stand-in CLI that records how the bootstrap called it.
  writeFileSync(join(dir, 'ShinawaseLoader.mjs'), [
    "import { appendFileSync } from 'node:fs';",
    "import { join, dirname } from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "appendFileSync(join(dirname(fileURLToPath(import.meta.url)), 'cli-calls.txt'), JSON.stringify({ args: process.argv.slice(2), runAsNode: process.env.ELECTRON_RUN_AS_NODE || null }) + '\\n');",
  ].join('\n'));
  mkdirSync(join(dir, 'Logs'), { recursive: true });
  writeFileSync(join(dir, 'Logs', 'payload.log'), 'must not be copied');
  writeFileSync(join(dir, 'feature.mjs'), `export const version = '${version}';\n`);
};

const makePackage = (file, id, version) => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, createZip([
    { path: 'echo.mod.json', data: Buffer.from(JSON.stringify({ id, name: id, version, entry: 'mod.js' })) },
    { path: 'mod.js', data: Buffer.from('return () => {};') },
  ]));
};

test('install copies the payload around user data and imports only missing or older packages', async (t) => {
  const root = tempDir(t, 'shinawase-workshop-');
  const echoRoot = join(root, 'ECHO');
  const payload = join(root, 'item', 'assets', 'loader');
  const packages = join(root, 'item', 'assets', 'packages');
  mkdirSync(join(echoRoot, 'resources'), { recursive: true });
  writeFileSync(join(echoRoot, 'resources', 'app.asar'), 'asar');
  makePayload(payload, '1.8.1.1');
  makePackage(join(packages, 'fresh.echomod'), 'example.fresh', '1.0.0');
  makePackage(join(packages, 'older.echomod'), 'example.older', '1.0.0');
  makePackage(join(packages, 'newer.echomod'), 'example.newer', '2.0.0');
  writeJson(join(echoRoot, 'Mods', 'installed', 'example.older', 'echo.mod.json'), { id: 'example.older', version: '1.5.0' });
  writeJson(join(echoRoot, 'Mods', 'installed', 'example.newer', 'echo.mod.json'), { id: 'example.newer', version: '1.0.0' });
  // An earlier install with the user's own config and state.
  const loaderRoot = join(echoRoot, 'ShinawaseLoader');
  writeJson(join(loaderRoot, 'loader-version.json'), { version: '1.8.1' });
  writeJson(join(loaderRoot, 'loader.config.json'), { port: 18000, runtimePath: process.execPath, locale: 'en' });
  writeJson(join(loaderRoot, 'loader-state.json'), { mods: { keep: true } });

  assert.deepEqual(planPackages(packages, echoRoot).map((item) => [item.id, item.action]), [
    ['example.fresh', 'install'], ['example.newer', 'update'], ['example.older', 'keep'],
  ]);
  const stages = [];
  const result = await install({ echoRoot, payloadRoot: payload, packagesRoot: packages, revision: 'rev-1', log: (line) => stages.push(line.stage) });
  assert.equal(result.plan, 'update');
  assert.equal(result.installedVersion, '1.8.1.1');
  assert.deepEqual(result.imported.map((item) => [item.id, item.action, item.ok]), [['example.fresh', 'install', true], ['example.newer', 'update', true]]);
  assert.ok(stages.includes('copy') && stages.includes('packages'));
  assert.equal(readFileSync(join(loaderRoot, 'feature.mjs'), 'utf8'), "export const version = '1.8.1.1';\n");
  assert.equal(existsSync(join(loaderRoot, 'Logs', 'payload.log')), false, 'payload Logs are not copied');
  assert.deepEqual(readJson(join(loaderRoot, 'loader-state.json')), { mods: { keep: true } });
  const config = readJson(join(loaderRoot, 'loader.config.json'));
  assert.equal(config.port, 18000);
  assert.equal(config.runtimePath, process.execPath);
  assert.equal(config.autoStartMode, 'app-asar-bridge');
  assert.equal(config.nodeRuntime, undefined, 'an install with its own Node keeps it');
  const calls = readFileSync(join(loaderRoot, 'cli-calls.txt'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(calls[0].args, ['init']);
  assert.equal(calls[0].runAsNode, '1');
  assert.equal(calls.find((call) => call.args.some((arg) => arg.endsWith('fresh.echomod'))).args.at(-1), '--enable');
  assert.ok(!calls.find((call) => call.args.some((arg) => arg.endsWith('newer.echomod'))).args.includes('--enable'), 'updates keep the enable state');
  const workshop = readJson(join(loaderRoot, 'workshop.json'));
  assert.equal(workshop.installedBy, 'workshop');
  assert.equal(workshop.revision, 'rev-1');

  // A newer Loader (self-update or full installer) is left alone.
  writeJson(join(loaderRoot, 'loader-version.json'), { version: '1.9.0' });
  const again = await install({ echoRoot, payloadRoot: payload, packagesRoot: null, revision: 'rev-2', log: () => {} });
  assert.equal(again.plan, 'keep-newer');
  assert.equal(readJson(join(loaderRoot, 'loader-version.json')).version, '1.9.0');
  assert.equal(readJson(join(loaderRoot, 'workshop.json')).revision, 'rev-1');
});

test('install refuses to run without any usable Node runtime', async (t) => {
  const root = tempDir(t, 'shinawase-workshop-node-');
  const echoRoot = join(root, 'ECHO');
  const payload = join(root, 'payload');
  mkdirSync(join(echoRoot, 'resources'), { recursive: true });
  writeFileSync(join(echoRoot, 'resources', 'app.asar'), 'asar');
  makePayload(payload, '1.8.1.1');
  // Plain Node is not ECHO in RunAsNode mode, and the fresh install has no node.
  await assert.rejects(install({ echoRoot, payloadRoot: payload, log: () => {} }), /loader_node_runtime_unavailable/u);
});

test('automatic switching pauses after a switch that never reached the isolated runtime', (t) => {
  const root = tempDir(t, 'shinawase-workshop-switch-');
  const loaderRoot = join(root, 'ShinawaseLoader');
  writeJson(join(loaderRoot, 'loader-version.json'), { version: '1.8.1.1' });
  writeJson(join(loaderRoot, 'workshop.json'), { installedBy: 'workshop' });
  mkdirSync(join(loaderRoot, 'modded-runtime'), { recursive: true });
  writeFileSync(join(loaderRoot, 'modded-runtime', process.platform === 'win32' ? 'ECHO.exe' : 'ECHO'), '');
  const read = () => ({ ...status({ echoRoot: root, execPath: join(root, 'ECHO.exe') }), modded: false, runtimeReady: true });
  assert.equal(autoSwitchAllowed(read()), false, 'off by default');
  setAutoSwitch(root, true);
  assert.equal(autoSwitchAllowed(read()), true);
  noteSwitch(root, new Date('2026-10-18T10:00:00Z'));
  assert.equal(autoSwitchAllowed(read()), false, 'the switch has not arrived yet');
  noteModdedStart(root, new Date('2026-10-18T10:00:05Z'));
  assert.equal(autoSwitchAllowed(read()), true);
});

test('the Node host waits for the stock ECHO and never passes RunAsNode to the runtime it starts', async (t) => {
  assert.deepEqual(splitHostArgs(['--wait-pid', '42', '--foo', '--wait-pid=7']), { args: ['--foo'], waitPid: 7 });
  let polls = 0;
  assert.equal(await waitForExit(42, { pollMs: 1, alive: () => (polls += 1) < 3 }), true);
  assert.equal(await waitForExit(42, { pollMs: 1, timeoutMs: 5, alive: () => true }), false);
  assert.equal(await waitForExit(0), true);

  const root = tempDir(t, 'shinawase-host-');
  const loaderRoot = join(root, 'ShinawaseLoader');
  const runtimeExe = process.platform === 'win32' ? 'ECHO.exe' : 'ECHO';
  mkdirSync(join(loaderRoot, 'modded-runtime'), { recursive: true });
  writeFileSync(join(loaderRoot, 'modded-runtime', runtimeExe), '');
  if (process.platform !== 'darwin') assert.equal(findIsolatedBinary(join(loaderRoot, 'modded-runtime')), join(loaderRoot, 'modded-runtime', runtimeExe));
  if (process.platform === 'darwin') return;
  let launched = null;
  launchIsolated({
    echoRoot: root,
    loaderRoot,
    env: { ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ASAR: '1', ECHO_SKIP_SELF_UPDATE: '1', PATH: process.env.PATH || '' },
    spawnChild: (command, args, options) => { launched = { command, args, env: options.env }; return {}; },
  });
  assert.equal(launched.command, join(loaderRoot, 'modded-runtime', runtimeExe));
  assert.equal(launched.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(launched.env.ELECTRON_NO_ASAR, undefined);
  assert.equal(launched.env.ECHO_MOD_HOME, loaderRoot);
  assert.ok(launched.args.some((arg) => arg.startsWith('--remote-debugging-port=')));
});

const runBridge = ({ config, resourcesPath, env = {} }) => {
  const spawned = [];
  const files = new Map([['ShinawaseLoader.mjs', true]]);
  // POSIX-style paths keep the assertions identical on every host OS.
  const path = {
    join: (...parts) => parts.join('/').replace(/\/+/gu, '/'),
    dirname: (value) => value.replace(/\/[^/]*$/u, '') || '/',
    basename: (value) => value.replace(/^.*\//u, ''),
  };
  const fs = {
    existsSync: (file) => [...files.keys()].some((name) => file.endsWith(name)),
    readFileSync: () => JSON.stringify(config),
    mkdirSync: () => {}, statSync: () => ({ size: 0 }), openSync: () => 3, closeSync: () => {}, appendFileSync: () => {},
  };
  const childProcess = { spawn: (command, args, options) => { spawned.push({ command, args, options }); return { once() {}, pid: 1 }; } };
  const builtins = { 'node:fs': fs, 'node:path': path, 'node:url': { pathToFileURL: (value) => ({ href: `file://${value}` }) }, 'node:child_process': childProcess };
  const app = {
    commandLine: { appendSwitch() {} },
    whenReady: () => ({ then: (fn) => { fn(); return { catch() {} }; } }),
    once() {},
  };
  const context = {
    app,
    console,
    setTimeout,
    globalThis: {},
    process: { platform: 'win32', resourcesPath, execPath: '/E/ShinawaseLoader/modded-runtime/ECHO.exe', env, argv: [], getBuiltinModule: (name) => builtins[name] },
  };
  context.globalThis = context;
  vm.runInNewContext(mainBridgeSource, context);
  return spawned;
};

test('main bridge runs the Loader on ECHO\'s own Node when the install asks for it', () => {
  const [echoNode] = runBridge({
    config: { autoStart: true, autoStartMode: 'app-asar-bridge', nodeRuntime: 'echo' },
    resourcesPath: '/E/ShinawaseLoader/modded-runtime/resources',
  });
  assert.equal(echoNode.command, '/E/ShinawaseLoader/modded-runtime/ECHO.exe');
  assert.equal(echoNode.options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(echoNode.options.env.ELECTRON_NO_ASAR, '1');
  assert.equal(echoNode.args[0], '/E/ShinawaseLoader/ShinawaseLoader.mjs', 'install root resolved from modded-runtime without ECHO_MOD_ROOT');
  assert.equal(echoNode.options.cwd, '/E');

  const [plainNode] = runBridge({
    config: { autoStart: true, autoStartMode: 'app-asar-bridge' },
    resourcesPath: '/E/resources',
    env: { ECHO_MOD_ROOT: '/E' },
  });
  assert.equal(plainNode.options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.notEqual(plainNode.command, '/E/ShinawaseLoader/modded-runtime/ECHO.exe');
});

test('the Workshop payload leaves out every file type ECHO\'s Workshop rejects', () => {
  for (const extension of ['.exe', '.dll', '.node', '.ps1', '.cmd', '.bat', '.vbs']) assert.ok(BLOCKED_EXTENSIONS.has(extension));
  assert.equal(payloadIncluded('ShinawaseLoader/ShinawaseLoader.mjs'), true);
  assert.equal(payloadIncluded('ShinawaseLoader/echo-native-host.node'), false);
  assert.equal(payloadIncluded('ShinawaseLoader/manager/Engine.cs'), false);
  assert.equal(payloadIncluded('ShinawaseLoader/streaming-bridge.cjs'), true);
  assert.equal(payloadIncluded('ShinawaseLoader/streaming-bridge.cjs', { streaming: false }), false);
  assert.equal(workshopPathProblem('assets/loader/node_modules/x/index.js'), null);
  assert.equal(workshopPathProblem('assets/loader/aux.js'), 'reserved');
  assert.equal(workshopPathProblem('assets/loader/a./b.js'), 'trailing');
  assert.equal(workshopPathProblem(`assets/${'x'.repeat(240)}`), 'length');
});
