/// <reference path="../.echo-sdk/echo-workshop-plugin.d.ts" />
const root = document.documentElement;
const $ = (id) => document.getElementById(id);

const copy = {
  zh: {
    subtitle: 'ECHO 外部 Mod 加载器 · 创意工坊版',
    installed: '已安装版本', bundled: '工坊内版本', folder: '安装位置',
    restartNow: '立即以 Mods 重启 ECHO', restartLater: '下次退出 ECHO 后以 Mods 打开', install: '重新安装 / 修复',
    autoSwitch: '每次启动原版 ECHO 时自动切换到 Mods 版',
    autoSwitchHint: '自动切换会在原版 ECHO 启动后立刻将其关闭并打开隔离运行时；一旦切换失败会自动暂停。想从 Steam 直接进入 Mods 版，可另外用安装器生成 ECHO.modded.exe 并设置启动选项。',
    autoSwitchPaused: '上次切换没有成功进入 Mods 版，自动切换已暂停；手动重启一次即可恢复。',
    confirmRestart: '再点一次确认：ECHO 会关闭并以 Mods 重新打开，播放会中断',
    laterScheduled: '已安排：退出 ECHO（托盘菜单 → 退出）后会自动以 Mods 打开，10 分钟内有效。',
    modded: '正在以 ShinawaseLoader 运行', moddedDetail: (v) => (v ? `Loader ${v} 已连接，Mods 会注入到当前窗口。` : 'Loader 尚未响应，稍等片刻；Mods 页面在侧栏 Shinawase 入口。'),
    ready: '已安装，当前是原版 ECHO', readyDetail: '以 Mods 重启后才会加载 Mods；原版 ECHO.exe 与 app.asar 不会被修改。',
    installing: '正在安装', notInstalled: '尚未安装', notInstalledDetail: '点击“重新安装 / 修复”把 Loader 安装到 ECHO 目录。',
    keepNewer: '已有更新的 Loader，保留现有安装。',
    failed: '安装失败', unsupported: '当前系统暂不支持',
    footer: '源代码与完整安装器：github.com/ChunchunOwO/ShinawaseLoader',
    stages: { start: '准备', plan: '检查版本', copy: '复制文件', config: '写入配置', packages: '导入内置 Mods', runtime: '生成隔离运行时' },
  },
  en: {
    subtitle: 'External Mod loader for ECHO · Workshop edition',
    installed: 'Installed', bundled: 'In this item', folder: 'Location',
    restartNow: 'Restart ECHO with Mods now', restartLater: 'Open with Mods after I quit ECHO', install: 'Reinstall / repair',
    autoSwitch: 'Switch to the Mods runtime whenever stock ECHO starts',
    autoSwitchHint: 'Automatic switching closes stock ECHO right after it starts and opens the isolated runtime; it pauses itself after a failed switch. To enter the Mods runtime straight from Steam, build ECHO.modded.exe with the installer and set it as the launch option.',
    autoSwitchPaused: 'The last switch did not reach the Mods runtime, so automatic switching is paused; one manual restart re-enables it.',
    confirmRestart: 'Click again to confirm: ECHO closes and reopens with Mods; playback stops',
    laterScheduled: 'Scheduled: quit ECHO (tray menu → Quit) and it reopens with Mods. Valid for 10 minutes.',
    modded: 'Running with ShinawaseLoader', moddedDetail: (v) => (v ? `Loader ${v} is connected and injects Mods into this window.` : 'The Loader has not answered yet; the Mods pages live under Shinawase in the sidebar.'),
    ready: 'Installed; this is stock ECHO', readyDetail: 'Mods load only after a restart into the isolated runtime. The stock ECHO executable and app.asar are never modified.',
    installing: 'Installing', notInstalled: 'Not installed', notInstalledDetail: 'Choose “Reinstall / repair” to install the Loader into the ECHO folder.',
    keepNewer: 'A newer Loader is already installed and is kept.',
    failed: 'Installation failed', unsupported: 'This platform is not supported yet',
    footer: 'Source and the full installer: github.com/ChunchunOwO/ShinawaseLoader',
    stages: { start: 'Preparing', plan: 'Checking versions', copy: 'Copying files', config: 'Writing config', packages: 'Importing bundled Mods', runtime: 'Building the isolated runtime' },
  },
};
let t = copy.en;
let state = null;
let pollTimer = 0;
let busy = false;
// The panel frame may not allow modal dialogs, so restarting asks for a second
// click within a few seconds instead of window.confirm().
let confirmUntil = 0;
let confirmTimer = 0;

const applyContext = (context) => {
  t = String(context.locale || '').toLowerCase().startsWith('zh') ? copy.zh : copy.en;
  root.lang = context.locale;
  root.dir = context.direction;
  root.dataset.colorScheme = context.colorScheme;
  root.style.colorScheme = context.colorScheme;
  for (const [name, value] of Object.entries(context.appearance || {})) root.style.setProperty(`--echo-host-${name}`, value);
  render();
};

const showError = (error) => {
  const node = $('error');
  const text = error ? (error instanceof Error ? error.message : String(error)) : '';
  node.textContent = text;
  node.hidden = !text;
};

const render = () => {
  $('subtitle').textContent = t.subtitle;
  $('label-installed').textContent = t.installed;
  $('label-bundled').textContent = t.bundled;
  $('label-folder').textContent = t.folder;
  $('restart-now').textContent = Date.now() < confirmUntil ? t.confirmRestart : t.restartNow;
  $('restart-later').textContent = t.restartLater;
  $('install').textContent = t.install;
  $('auto-switch-label').textContent = t.autoSwitch;
  $('footer').textContent = t.footer;
  if (!state) return;
  const job = state.job && !state.job.done ? state.job : null;
  const failedJob = state.job && state.job.done && !state.job.ok ? state.job : null;
  const supported = ['win32', 'linux', 'darwin'].includes(state.platform);
  let tone = 'idle';
  let title = t.notInstalled;
  let detail = t.notInstalledDetail;
  if (!supported) { title = t.unsupported; detail = state.platform; tone = 'warn'; }
  else if (job) { title = `${t.installing} · ${t.stages[job.stage] || job.stage}`; detail = ''; tone = 'busy'; }
  else if (state.modded) { title = t.modded; detail = t.moddedDetail(state.loader?.version); tone = 'ok'; }
  else if (failedJob) { title = t.failed; detail = failedJob.error || ''; tone = 'warn'; }
  else if (state.installedVersion && state.runtimeReady) { title = t.ready; detail = state.plan === 'keep-newer' ? `${t.readyDetail} ${t.keepNewer}` : t.readyDetail; tone = 'ok'; }
  $('state-dot').dataset.tone = tone;
  $('state-title').textContent = title;
  $('state-detail').textContent = detail;
  $('progress').hidden = !job;
  $('progress-bar').style.width = `${job ? job.percent || 0 : 0}%`;
  $('value-installed').textContent = state.installedVersion || '-';
  $('value-bundled').textContent = state.payloadVersion || '-';
  $('value-folder').textContent = state.loaderRoot || '-';
  const canRestart = supported && !state.modded && !job && Boolean(state.installedVersion) && state.runtimeReady;
  $('restart-now').hidden = state.modded;
  $('restart-later').hidden = state.modded;
  $('restart-now').disabled = busy || !canRestart;
  $('restart-later').disabled = busy || !canRestart || state.restartScheduled;
  $('install').disabled = busy || Boolean(job) || !supported;
  $('auto-switch').checked = state.autoSwitch === true;
  $('auto-switch').disabled = busy || !state.installedVersion;
  $('auto-switch-hint').textContent = state.autoSwitchPaused ? t.autoSwitchPaused : t.autoSwitchHint;
  echo.ui.setPanelPresentation({ title: 'ShinawaseLoader', badge: state.installedVersion || null, attention: failedJob ? 'warning' : 'none' }).catch(() => undefined);
};

const refresh = async () => {
  try {
    state = await echo.trusted.invoke('status');
    showError(null);
  } catch (error) {
    showError(error);
  }
  render();
  window.clearTimeout(pollTimer);
  // ECHO re-verifies the item's files on every trusted call, so poll quickly
  // only while an install runs.
  pollTimer = window.setTimeout(refresh, state?.job && !state.job.done ? 1500 : 30000);
};

const run = async (action) => {
  if (busy) return;
  busy = true;
  render();
  try {
    await action();
    showError(null);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    await refresh();
  }
};

$('install').onclick = () => run(() => echo.trusted.invoke('install'));
$('restart-now').onclick = () => {
  window.clearTimeout(confirmTimer);
  if (Date.now() >= confirmUntil) {
    confirmUntil = Date.now() + 5000;
    confirmTimer = window.setTimeout(() => { confirmUntil = 0; render(); }, 5000);
    render();
    return;
  }
  confirmUntil = 0;
  void run(() => echo.trusted.invoke('restart', { force: true }));
};
$('restart-later').onclick = () => run(async () => {
  await echo.trusted.invoke('restart', { force: false });
  await echo.ui.notify(t.laterScheduled);
});
$('auto-switch').onchange = (event) => run(() => echo.trusted.invoke('setAutoSwitch', { enabled: event.target.checked }));

echo.ui.getContext().then(applyContext).catch(() => render());
echo.ui.onContextChanged(applyContext);
void refresh();
