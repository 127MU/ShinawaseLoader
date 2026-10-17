import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { normalizeMacInputPath, runMacSetup } from '../scripts/setup-modloader-macos.mjs';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'shinawase-menu-'));
  const target = join(root, 'ECHO with spaces');
  const contents = join(target, 'ECHO.app', 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(join(contents, 'Resources'), { recursive: true });
  const executable = join(contents, 'MacOS', 'ECHO');
  writeFileSync(executable, 'fixture');
  writeFileSync(join(contents, 'Resources', 'app.asar'), 'fixture');
  return { root, target, executable };
};

const session = (answers, options = {}) => {
  const output = [];
  const installs = [];
  const launches = [];
  return {
    output, installs, launches,
    run: () => runMacSetup({
      env: {},
      discover: () => [],
      ask: async () => answers.shift() ?? null,
      write: (line) => output.push(line),
      install: (settings) => {
        installs.push(settings);
        return { echoRoot: settings.echoRoot, launcher: join(settings.echoRoot, 'ECHO.modded.command'), syncStatus: 0 };
      },
      launch: (file) => { launches.push(file); return { status: 0 }; },
      ...options,
    }),
  };
};

test('menu opening, cancellation, and EOF do not install or launch', async () => {
  const { root, target, executable } = fixture();
  try {
    for (const answers of [['0'], ['4', '', '0'], ['4'], []]) {
      const check = session(answers, { discover: () => [executable] });
      assert.equal(await check.run(), 0);
      assert.equal(check.installs.length, 0);
      assert.equal(check.launches.length, 0);
      assert.equal(existsSync(join(target, 'ShinawaseLoader')), false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('manual quoted path and toggles feed the confirmed install without launching', async () => {
  const { root, target } = fixture();
  try {
    const check = session(['6', `"${join(target, 'ECHO.app')}"`, '2', '3', '4', 'y', '0']);
    assert.equal(await check.run(), 0);
    assert.equal(check.installs.length, 1);
    assert.equal(check.installs[0].echoRoot, target);
    assert.equal(check.installs[0].packages, false);
    assert.equal(check.installs[0].deps, false);
    assert.equal(check.launches.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('invalid selection recovers and Playtest is only selected explicitly', async () => {
  const { root, target, executable } = fixture();
  try {
    const playtest = executable.replace('ECHO with spaces', 'ECHO Playtest');
    mkdirSync(join(root, 'ECHO Playtest', 'ECHO.app', 'Contents', 'MacOS'), { recursive: true });
    mkdirSync(join(root, 'ECHO Playtest', 'ECHO.app', 'Contents', 'Resources'), { recursive: true });
    writeFileSync(playtest, 'fixture');
    writeFileSync(join(root, 'ECHO Playtest', 'ECHO.app', 'Contents', 'Resources', 'app.asar'), 'fixture');
    const check = session(['4', '6', '/missing/ECHO.app', '6', playtest, '4', 'yes', '0'], { discover: () => [playtest] });
    await check.run();
    assert.ok(check.output.some((line) => line.includes('尚未选择')));
    assert.ok(check.output.some((line) => line.includes('没有完整的 ECHO.app')));
    assert.equal(check.installs.length, 1);
    assert.equal(check.installs[0].echoRoot, join(root, 'ECHO Playtest'));
    assert.notEqual(check.installs[0].echoRoot, target);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('noninteractive install requires an explicit target; help never installs', async () => {
  for (const args of [[], ['--yes'], ['--launch'], ['--echo'], ['--unknown']]) {
    const check = session([], { args, interactive: false });
    await assert.rejects(check.run());
    assert.equal(check.installs.length, 0);
  }
  const check = session([], { args: ['--help'], interactive: false, discover: () => { throw new Error('must not scan'); } });
  assert.equal(await check.run(), 0);
  assert.equal(check.installs.length, 0);
});

test('explicit unattended install honors options and only launches on request', async () => {
  const { root, target } = fixture();
  try {
    const check = session([], { args: ['--yes', '--echo', target, '--no-packages', '--no-deps', '--launch', '--locale', 'en'], interactive: false });
    assert.equal(await check.run(), 0);
    assert.equal(check.installs[0].locale, 'en');
    assert.equal(check.installs[0].deps, false);
    assert.equal(check.launches.length, 1);
    const failed = session([], {
      args: ['--yes', '--echo', target, '--launch'],
      install: () => ({ syncStatus: 1, syncOutput: 'fixture failure' }),
    });
    await assert.rejects(failed.run(), /隔离运行时准备失败/);
    assert.equal(failed.launches.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('launch menu requires an installed launcher and never triggers install', async () => {
  const { root, target, executable } = fixture();
  try {
    const missing = session(['5', '0'], { discover: () => [executable] });
    await missing.run();
    assert.equal(missing.launches.length, 0);
    writeFileSync(join(target, 'ECHO.modded.command'), 'fixture');
    const installed = session(['5', '0'], { discover: () => [executable] });
    await installed.run();
    assert.deepEqual(installed.launches, [join(target, 'ECHO.modded.command')]);
    assert.equal(installed.installs.length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Terminal drag paths are decoded as text without executing shell expressions', () => {
  assert.equal(normalizeMacInputPath('/Applications/ECHO\\ Steam.app '), '/Applications/ECHO Steam.app');
  assert.equal(normalizeMacInputPath("'/Applications/ECHO Steam.app'"), '/Applications/ECHO Steam.app');
  assert.equal(normalizeMacInputPath('~/Games/ECHO.app', '/fixture'), '/fixture/Games/ECHO.app');
  assert.equal(normalizeMacInputPath('$(touch /tmp/example)'), '$(touch /tmp/example)');
});

test('macOS shell entry shows help and refuses piped implicit installation', { skip: process.platform !== 'darwin' }, () => {
  const help = spawnSync('/bin/bash', ['start-mac.command', '--help'], { encoding: 'utf8', env: { ...process.env, ECHO_NODE_PATH: process.execPath } });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /默认打开交互菜单/);
  const piped = spawnSync(process.execPath, ['scripts/setup-modloader-macos.mjs'], { input: '4\ny\n', encoding: 'utf8' });
  assert.equal(piped.status, 1);
  assert.match(piped.stderr, /请在终端打开菜单/);
});

test('a single Steam install is selected automatically, including on rescan', async () => {
  const { root, target, executable } = fixture();
  try {
    const check = session(['1', '4', 'y', '0'], { discover: () => [executable] });
    await check.run();
    assert.equal(check.installs.length, 1);
    assert.equal(check.installs[0].echoRoot, target);
    assert.ok(check.output.some((line) => line.includes('无需选择编号')));
    assert.ok(!check.output.some((line) => line.includes('发现多个')));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('multiple Steam installs require a choice and recover from an invalid number', async () => {
  const first = fixture();
  const second = fixture();
  try {
    const check = session(['4', '1', '99', '1', '2', '4', 'y', '0'], {
      discover: () => [first.executable, second.executable],
    });
    await check.run();
    assert.ok(check.output.some((line) => line.includes('列表编号无效')));
    assert.equal(check.installs.length, 1);
    assert.equal(check.installs[0].echoRoot, second.target);
  } finally {
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});
