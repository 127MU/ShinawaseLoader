// UI strings for the Shinawase Manager (zh / en). Keys prefixed with "s." are
// also published as window resources so XAML can bind them with
// {DynamicResource s.key} and switch language without a restart.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Windows;

namespace Shinawase.Manager
{
    public static class L
    {
        private static readonly Dictionary<string, string[]> Table = new Dictionary<string, string[]>(StringComparer.Ordinal);
        public static string Locale = "zh";

        private static void A(string key, string zh, string en) { Table[key] = new[] { zh, en }; }

        public static string T(string key)
        {
            string[] pair;
            if (!Table.TryGetValue(key, out pair)) return key;
            return Locale == "en" ? pair[1] : pair[0];
        }

        public static string F(string key, params object[] args)
        {
            try { return string.Format(CultureInfo.InvariantCulture, T(key), args); }
            catch { return T(key); }
        }

        public static void Publish(ResourceDictionary resources)
        {
            foreach (var key in Table.Keys)
            {
                resources[key.StartsWith("s.", StringComparison.Ordinal) ? key : "s." + key] = T(key);
            }
        }

        public static string Detect()
        {
            var saved = Selection.Read().Str("locale");
            if (saved == "zh" || saved == "en") return saved;
            return CultureInfo.CurrentUICulture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase) ? "zh" : "en";
        }

        static L()
        {
            // ---- shell ------------------------------------------------------
            A("s.app.sub", "ModLoader 管理器", "ModLoader Manager");
            A("s.nav.home", "概览", "Overview");
            A("s.nav.mods", "模组", "Mods");
            A("s.nav.steam", "Steam 启动项", "Steam launch");
            A("s.nav.settings", "设置", "Settings");
            A("s.nav.about", "关于", "About");
            A("s.side.theme", "切换主题", "Toggle theme");
            A("s.min", "最小化", "Minimize");
            A("s.close", "关闭", "Close");

            // ---- overview ---------------------------------------------------
            A("s.home.title", "概览", "Overview");
            A("s.home.sub", "安装、更新并启动带 Mods 的 ECHO", "Install, update and launch ECHO with Mods");
            A("s.tile.loader", "Loader", "Loader");
            A("s.tile.steam", "Steam 启动项", "Steam launch option");
            A("s.tile.run", "运行状态", "Status");
            A("s.tile.net", "下载源", "Download source");
            A("s.home.change", "更换", "Change");
            A("s.home.openFolder", "打开目录", "Open folder");
            A("hero.scan.title", "正在查找 ECHO…", "Looking for ECHO…");
            A("hero.scan.sub", "正在扫描 Steam 库", "Scanning Steam libraries");
            A("hero.noEcho.title", "没有找到 ECHO", "ECHO was not found");
            A("hero.noEcho.sub", "请确认已在 Steam 安装 ECHO，或手动选择 ECHO.exe。", "Make sure ECHO is installed in Steam, or pick ECHO.exe yourself.");
            A("hero.install.title", "为 ECHO 安装 ShinawaseLoader", "Install ShinawaseLoader for ECHO");
            A("hero.install.sub", "一键完成 Loader、隔离运行时、ECHO.modded.exe、可选包与 Steam 启动项。Steam 原版文件不会被修改。", "One click sets up the Loader, isolated runtime, ECHO.modded.exe, optional packages and the Steam launch option. Steam's original files stay untouched.");
            A("hero.update.title", "发现新版本 {0}", "Version {0} is available");
            A("hero.update.sub", "当前 {0}。更新会保留你的 Mods、设置与 Steam 启动项。", "You have {0}. Updating keeps your Mods, settings and Steam launch option.");
            A("hero.ready.title", "一切就绪", "All set");
            A("hero.ready.sub", "在这里或 Steam 的「开始游戏」启动带 Mods 的 ECHO。", "Launch ECHO with Mods here or with Steam's Play button.");
            A("hero.running.title", "ECHO 正在运行", "ECHO is running");
            A("hero.running.sub", "Mods 已加载。可以在「模组」页即时启用或停用。", "Mods are loaded. Toggle them live on the Mods page.");
            A("hero.broken.title", "安装不完整", "Installation is incomplete");
            A("hero.broken.sub", "缺少 ECHO.modded.exe 或隔离运行时，修复安装即可恢复。", "ECHO.modded.exe or the isolated runtime is missing. Repair to restore it.");
            A("chip.notInstalled", "未安装", "Not installed");
            A("chip.installed", "已安装 {0}", "Installed {0}");
            A("chip.update", "可更新", "Update available");
            A("chip.running", "运行中", "Running");
            A("chip.broken", "需要修复", "Needs repair");
            A("chip.none", "未选择", "Not selected");
            A("btn.install", "一键安装", "Install");
            A("btn.update", "立即更新", "Update now");
            A("btn.launch", "启动 ECHO", "Launch ECHO");
            A("btn.launching", "正在启动…", "Starting…");
            A("btn.choose", "选择 ECHO", "Choose ECHO");
            A("btn.repair", "修复安装", "Repair");
            A("btn.check", "检查更新", "Check for updates");
            A("btn.rescan", "重新扫描", "Scan again");
            A("btn.openMods", "管理模组", "Manage Mods");
            A("tile.loader.none", "未安装", "Not installed");
            A("tile.loader.latest", "已是最新", "Up to date");
            A("tile.loader.remote", "最新 {0}", "Latest {0}");
            A("tile.loader.checking", "正在检查更新…", "Checking for updates…");
            A("tile.loader.offline", "无法检查更新", "Couldn't check for updates");
            A("tile.steam.on", "已配置", "Configured");
            A("tile.steam.off", "未配置", "Not set");
            A("tile.steam.partial", "部分配置", "Partly set");
            A("tile.steam.na", "不可用", "Unavailable");
            A("tile.steam.accounts", "{0} 个账户", "{0} account(s)");
            A("tile.steam.fix", "点此一键设置", "Click to set it up");
            A("tile.steam.noSteam", "未检测到 Steam", "Steam not found");
            A("tile.steam.noApp", "此 ECHO 不在 Steam 库中", "Not a Steam library install");
            A("tile.run.off", "未运行", "Not running");
            A("tile.run.on", "运行中", "Running");
            A("tile.run.starting", "启动中…", "Starting…");
            A("tile.run.mods", "Mods 已加载", "Mods loaded");
            A("tile.run.stock", "原版运行中，未加载 Mods", "Stock ECHO, no Mods");
            A("tile.run.wait", "等待注入通道", "Waiting for injection");
            A("tile.run.idle", "可从这里或 Steam 启动", "Launch here or from Steam");
            A("tile.net.auto", "自动 · {0}", "Auto · {0}");
            A("tile.net.testing", "测速中…", "Testing…");
            A("tile.net.offline", "网络不可用", "Offline");
            A("tile.net.ms", "{0} ms", "{0} ms");

            // ---- mods ---------------------------------------------------------
            A("s.mods.title", "模组", "Mods");
            A("s.mods.sub", "启用、导入或移除 Mods 与 Plugins", "Enable, import or remove Mods and Plugins");
            A("s.mods.import", "导入", "Import");
            A("s.mods.folder", "打开文件夹", "Open folder");
            A("s.mods.installed", "已安装", "Installed");
            A("s.mods.recommended", "推荐", "Recommended");
            A("s.mods.empty", "还没有安装任何模组", "No Mods installed yet");
            A("s.mods.emptyHint", "把 .echomod 文件拖进窗口，或点击「导入」。", "Drop a .echomod file here, or click Import.");
            A("s.mods.noLoader", "安装 Loader 后即可管理模组", "Install the Loader to manage Mods");
            A("s.mods.noLoaderHint", "安装只需一分钟左右。", "It only takes about a minute.");
            A("s.mods.goInstall", "去安装", "Install");
            A("s.mods.drop", "松开以导入", "Drop to import");
            A("s.mods.dropHint", "支持 .echomod / .echo / .zip", "Accepts .echomod / .echo / .zip");
            A("s.mods.liveHint", "ECHO 运行时，启用会立即注入；停用的 Mod 在下次启动后完全卸下。", "While ECHO runs, enabling injects right away; disabled Mods are fully gone after the next start.");
            A("mods.enabled", "已启用 {0}", "Enabled {0}");
            A("mods.disabled", "已停用 {0}", "Disabled {0}");
            A("mods.imported", "已导入 {0}", "Imported {0}");
            A("mods.removed", "已移除 {0}", "Removed {0}");
            A("mods.failed", "操作失败：{0}", "Failed: {0}");
            A("mods.removeTitle", "移除 {0}？", "Remove {0}?");
            A("mods.removeBody", "模组文件会从游戏目录的 Mods / Plugins 中删除。", "The package files are deleted from the game's Mods / Plugins folder.");
            A("mods.remove", "移除", "Remove");
            A("mods.install", "安装", "Install");
            A("mods.installedTag", "已安装", "Installed");
            A("mods.updateTo", "更新到 {0}", "Update to {0}");
            A("mods.importFilter", "ECHO 包 (*.echomod;*.echo;*.zip)|*.echomod;*.echo;*.zip", "ECHO packages (*.echomod;*.echo;*.zip)|*.echomod;*.echo;*.zip");
            A("pkg.streaming.desc", "流媒体与账号桥接", "Streaming and account bridge");
            A("pkg.mv.desc", "歌词页 MV 播放", "Music videos on the lyrics page");
            A("pkg.lyrics.desc", "手动歌词匹配与来源筛选", "Manual lyrics matching and source filters");

            // ---- steam --------------------------------------------------------
            A("s.steam.title", "Steam 启动项", "Steam launch option");
            A("s.steam.sub", "让 Steam 的「开始游戏」直接打开带 Mods 的 ECHO", "Make Steam's Play button open ECHO with Mods");
            A("s.steam.line", "启动项", "Launch option");
            A("s.steam.copy", "复制", "Copy");
            A("s.steam.apply", "一键写入", "Apply");
            A("s.steam.restore", "恢复原设置", "Restore");
            A("s.steam.accounts", "Steam 账户", "Steam accounts");
            A("s.steam.info", "检测信息", "Details");
            A("s.steam.root", "Steam 目录", "Steam folder");
            A("s.steam.appid", "AppID", "AppID");
            A("s.steam.state", "Steam 状态", "Steam");
            A("s.steam.manual", "手动设置", "Set it manually");
            A("s.steam.step1", "Steam → 库 → 右键 ECHO → 属性 → 通用 → 启动选项", "Steam → Library → right-click ECHO → Properties → General → Launch options");
            A("s.steam.step2", "粘贴上面的启动项后关闭窗口即可。", "Paste the line above and close the window.");
            A("s.steam.note", "Steam 运行时会先关闭 Steam（它退出时会覆盖配置），写入后自动重新打开。写入前会备份配置文件。", "If Steam is running it is closed first (it overwrites the config on exit) and reopened afterwards. The config file is backed up before writing.");
            A("steam.status.on", "已为 {0} 个账户配置", "Configured for {0} account(s)");
            A("steam.status.onSub", "在 Steam 点「开始游戏」即会启动带 Mods 的 ECHO。", "Pressing Play in Steam now starts ECHO with Mods.");
            A("steam.status.off", "尚未配置", "Not configured yet");
            A("steam.status.offSub", "点「一键写入」，或按下方步骤手动设置。", "Click Apply, or follow the manual steps below.");
            A("steam.status.partial", "部分账户未配置", "Some accounts are not set");
            A("steam.status.noSteam", "未找到 Steam", "Steam was not found");
            A("steam.status.noSteamSub", "仍可双击游戏目录下的 ECHO.modded.exe 启动。", "You can still double-click ECHO.modded.exe in the game folder.");
            A("steam.status.noApp", "此 ECHO 不在 Steam 库中", "This ECHO is not in a Steam library");
            A("steam.status.noAppSub", "Steam 启动项只适用于通过 Steam 安装的 ECHO。", "Launch options only apply to ECHO installed through Steam.");
            A("steam.status.noLoader", "请先安装 Loader", "Install the Loader first");
            A("steam.status.noLoaderSub", "启动项指向的 ECHO.modded.exe 由安装生成。", "The launch option points at ECHO.modded.exe, which the install creates.");
            A("steam.acc.set", "已设置", "Set");
            A("steam.acc.unset", "未设置", "Not set");
            A("steam.acc.other", "其他启动项", "Other options");
            A("steam.acc.otherRoot", "指向其他目录", "Points elsewhere");
            A("steam.acc.recent", "最近登录", "Last signed in");
            A("steam.running", "运行中", "Running");
            A("steam.notRunning", "未运行", "Not running");
            A("steam.closeTitle", "需要暂时关闭 Steam", "Steam needs to close briefly");
            A("steam.closeBody", "Steam 退出时会用内存中的设置覆盖配置文件，所以写入前必须先关闭它。写入后会自动重新打开 Steam。", "Steam overwrites its config file when it exits, so it must be closed before writing. It is reopened automatically afterwards.");
            A("steam.closeConfirm", "关闭 Steam 并写入", "Close Steam and apply");
            A("steam.closing", "正在关闭 Steam…", "Closing Steam…");
            A("steam.closeFailed", "Steam 没有在 {0} 秒内退出，请手动退出后重试。", "Steam did not exit within {0} seconds. Quit it yourself and try again.");
            A("steam.applied", "启动项已写入 {0} 个账户", "Launch option saved for {0} account(s)");
            A("steam.restored", "已恢复原来的启动项", "Original launch options restored");
            A("steam.copied", "启动项已复制", "Launch option copied");
            A("steam.failed", "写入失败：{0}", "Could not write: {0}");
            A("steam.noAccounts", "没有找到 Steam 账户配置", "No Steam account config was found");
            A("steam.reopen", "正在重新打开 Steam…", "Reopening Steam…");

            // ---- settings -----------------------------------------------------
            A("s.set.title", "设置", "Settings");
            A("s.set.sub", "下载源、更新与外观", "Downloads, updates and appearance");
            A("s.set.net", "下载与网络", "Downloads & network");
            A("s.set.auto", "自动选择最快的下载源", "Pick the fastest source automatically");
            A("s.set.autoDesc", "打开时测速；下载按速度依次尝试，失败自动切换到下一个。", "Sources are timed on start; downloads try them fastest-first and fall back automatically.");
            A("s.set.sources", "Node 下载源", "Node sources");
            A("s.set.sourcesDesc", "关闭自动后可手动指定。npm 依赖与 GitHub 更新跟随此选择（官方源 = 全部直连）。", "Pick one when Auto is off. npm and GitHub updates follow this choice (Official = direct everywhere).");
            A("s.set.reprobe", "重新测速", "Test again");
            A("s.set.shinawase", "优先使用 Shinawase 镜像", "Prefer the Shinawase mirror");
            A("s.set.shinawaseDesc", "Node 校验 SHA-256，Loader 更新校验 Ed25519 签名，镜像无法篡改内容。", "Node is checked against its SHA-256 and Loader updates against an Ed25519 signature, so a mirror cannot alter them.");
            A("s.set.updates", "更新", "Updates");
            A("s.set.autoCheck", "打开管理器时检查更新", "Check for updates on open");
            A("s.set.autoCheckDesc", "只检查版本号，不会自动下载。", "Only compares versions; nothing is downloaded on its own.");
            A("s.set.loaderAuto", "启动 ECHO 时自动更新 Loader", "Update the Loader when ECHO starts");
            A("s.set.loaderAutoDesc", "由 ECHO.modded.exe 在启动前执行，最多占用 45 秒。", "Run by ECHO.modded.exe before start; capped at 45 seconds.");
            A("s.set.checkNow", "立即检查", "Check now");
            A("s.set.look", "外观", "Appearance");
            A("s.set.theme", "主题", "Theme");
            A("s.set.themeSystem", "跟随系统", "System");
            A("s.set.themeLight", "浅色", "Light");
            A("s.set.themeDark", "深色", "Dark");
            A("s.set.lang", "语言", "Language");
            A("s.set.motion", "界面动效", "Animations");
            A("s.set.motionDesc", "关闭后页面切换与弹窗不再使用过渡动画。", "Turn off transitions for pages and dialogs.");
            A("s.set.tools", "工具", "Tools");
            A("s.set.logs", "日志", "Logs");
            A("s.set.logsDesc", "管理器与 Loader 的日志文件夹", "Manager and Loader log folders");
            A("s.set.loaderDir", "Loader 目录", "Loader folder");
            A("s.set.loaderDirDesc", "游戏目录下的 ShinawaseLoader", "ShinawaseLoader inside the game folder");
            A("s.set.open", "打开", "Open");
            A("s.set.debug", "调试模式启动", "Launch in debug mode");
            A("s.set.debugDesc", "带详细日志启动 ECHO（start-echo-debug.cmd）", "Start ECHO with verbose logs (start-echo-debug.cmd)");
            A("s.set.safe", "安全模式启动", "Launch in safe mode");
            A("s.set.safeDesc", "不加载任何 Mod，用于排查问题（start-echo-safe.cmd）", "Start without any Mod to troubleshoot (start-echo-safe.cmd)");
            A("s.set.launch", "启动", "Launch");
            A("s.set.danger", "危险操作", "Danger zone");
            A("s.set.uninstall", "卸载 ShinawaseLoader", "Uninstall ShinawaseLoader");
            A("s.set.uninstallDesc", "删除 Loader、隔离运行时与 ECHO.modded.exe，保留 Mods / Plugins。", "Removes the Loader, isolated runtime and ECHO.modded.exe; keeps Mods / Plugins.");
            A("s.set.uninstallBtn", "卸载", "Uninstall");
            A("src.shinawase", "Shinawase 镜像", "Shinawase mirror");
            A("src.huawei", "华为云", "Huawei Cloud");
            A("src.aliyun", "阿里云", "Alibaba Cloud");
            A("src.npmmirror", "npmmirror", "npmmirror");
            A("src.official", "Node.js 官方（直连）", "Node.js official (direct)");
            A("src.github", "GitHub 直连", "GitHub direct");
            A("src.ghproxy", "GitHub 加速 (ghproxy)", "GitHub via ghproxy");
            A("src.down", "不可用", "Unreachable");
            A("src.testing", "测速中", "Testing");
            A("src.fastest", "最快", "Fastest");

            // ---- about --------------------------------------------------------
            A("s.about.title", "关于", "About");
            A("s.about.summary", "ECHO Steam 的社区外部 ModLoader。使用独立启动器与隔离运行时，不修改 Steam 原版的 ECHO.exe 与 app.asar。", "A community external ModLoader for ECHO Steam. It uses an independent launcher and an isolated runtime and never modifies Steam's ECHO.exe or app.asar.");
            A("s.about.manager", "管理器版本", "Manager version");
            A("s.about.installed", "已安装 Loader", "Installed Loader");
            A("s.about.remote", "最新版本", "Latest version");
            A("s.about.disclaimer", "免责声明", "Disclaimer");
            A("s.about.github", "GitHub 仓库", "GitHub repository");
            A("s.about.logs", "打开日志", "Open logs");

            // ---- consent ------------------------------------------------------
            A("consent.title", "免责声明与使用约定", "Disclaimer and terms of use");
            A("s.consent.boundary", "ShinawaseLoader 是独立社区工具，不代表 ECHO 官方。", "ShinawaseLoader is an independent community tool and does not represent ECHO.");
            A("s.consent.rules", "仅可依法且获授权使用；禁止违法、商业盈利、侵权、未经授权访问、侵犯隐私及传播恶意内容。", "Use only lawfully and with permission. Unlawful, commercial, infringing, unauthorized, privacy-violating or malicious use is prohibited.");
            A("s.consent.packages", "第三方包由各自作者提供，请确认来源、权限和使用条件。", "Third-party packages come from their authors; check their source, permissions and terms.");
            A("consent.repeat", "每次打开管理器均需同意；不同意将直接退出。", "You agree each time the manager opens. Declining closes it.");
            A("consent.agree", "同意并继续", "Agree and continue");
            A("consent.decline", "不同意并退出", "Disagree and exit");

            // ---- install wizard -----------------------------------------------
            A("wiz.selectTitle", "选择 ECHO", "Choose ECHO");
            A("wiz.selectSub", "已自动扫描 Steam 库与常见位置", "Steam libraries and common folders were scanned");
            A("wiz.browse", "浏览…", "Browse…");
            A("wiz.none", "没有找到 ECHO。请点击「浏览」选择 ECHO.exe。", "No ECHO found. Click Browse to pick ECHO.exe.");
            A("wiz.browseFilter", "ECHO (ECHO*.exe)|ECHO*.exe", "ECHO (ECHO*.exe)|ECHO*.exe");
            A("wiz.notEcho", "这不是 ECHO 的程序文件", "That is not an ECHO executable");
            A("wiz.optionsTitle", "安装选项", "Options");
            A("wiz.optionsSub", "之后都可以在管理器里更改", "You can change all of this later");
            A("wiz.packages", "可选包", "Optional packages");
            A("wiz.installAll", "一键全部安装", "Install all");
            A("wiz.integration", "集成", "Integration");
            A("wiz.optSteam", "自动设置 Steam 启动项", "Set the Steam launch option");
            A("wiz.optSteamDesc", "Steam 的「开始游戏」将启动带 Mods 的 ECHO", "Steam's Play button starts ECHO with Mods");
            A("wiz.optShortcut", "开始菜单快捷方式", "Start menu shortcut");
            A("wiz.optShortcutDesc", "开始菜单 → Shinawase Manager", "Start menu → Shinawase Manager");
            A("wiz.optDesktop", "桌面快捷方式", "Desktop shortcut");
            A("wiz.optDesktopDesc", "桌面 → ECHO (Mods)", "Desktop → ECHO (Mods)");
            A("wiz.optLaunch", "完成后启动 ECHO", "Launch ECHO when done");
            A("wiz.optLaunchDesc", "安装结束后直接打开带 Mods 的 ECHO", "Open ECHO with Mods right after installing");
            A("wiz.optLatest", "安装最新版本 {0}", "Install the latest version {0}");
            A("wiz.optLatestDesc", "从下载源获取并校验；关闭则安装本地的 {0}", "Fetched and verified from the download source; off installs the local {0}");
            A("wiz.next", "下一步", "Next");
            A("wiz.back", "上一步", "Back");
            A("wiz.install", "开始安装", "Install");
            A("wiz.cancel", "取消", "Cancel");
            A("wiz.close", "关闭", "Close");
            A("wiz.done", "完成", "Done");
            A("wiz.retry", "重试", "Retry");
            A("wiz.copyLog", "复制日志", "Copy log");
            A("wiz.showLog", "详细日志", "Details");
            A("wiz.installing", "正在安装", "Installing");
            A("wiz.updating", "正在更新", "Updating");
            A("wiz.repairing", "正在修复", "Repairing");
            A("wiz.progressSub", "请勿关闭窗口，通常需要 1 ~ 3 分钟", "Keep this window open; it usually takes 1 to 3 minutes");
            A("wiz.doneInstall", "安装完成", "Installed");
            A("wiz.doneUpdate", "更新完成", "Updated");
            A("wiz.doneRepair", "修复完成", "Repaired");
            A("wiz.doneSub", "ShinawaseLoader {0} 已就绪。", "ShinawaseLoader {0} is ready.");
            A("wiz.failed", "没能完成", "Something went wrong");
            A("wiz.failedAt", "在「{0}」这一步失败：{1}", "Failed at \"{0}\": {1}");
            A("wiz.adminRetry", "以管理员身份重试", "Retry as administrator");
            A("wiz.launchNow", "启动 ECHO", "Launch ECHO");
            A("wiz.cancelConfirm", "安装正在进行。现在取消可能留下不完整的文件，之后可以修复安装。", "Installing is in progress. Cancelling may leave partial files; you can repair later.");
            A("wiz.cancelling", "正在取消…", "Cancelling…");
            A("wiz.sumLoader", "Loader {0}", "Loader {0}");
            A("wiz.sumRuntime", "隔离运行时 · ECHO {0}", "Isolated runtime · ECHO {0}");
            A("wiz.sumHost", "ECHO.modded.exe", "ECHO.modded.exe");
            A("wiz.sumPackages", "已安装 {0} 个包", "{0} package(s) installed");
            A("wiz.sumSteamOn", "Steam 启动项已写入", "Steam launch option saved");
            A("wiz.sumSteamPending", "Steam 启动项待写入", "Steam launch option pending");
            A("wiz.sumSteamSkip", "未设置 Steam 启动项", "Steam launch option not set");
            A("wiz.sumWarn", "{0}", "{0}");
            A("wiz.steamPendingBody", "Steam 正在运行。写入启动项需要短暂关闭 Steam，完成后自动重新打开。", "Steam is running. Writing the launch option needs Steam closed briefly; it reopens afterwards.");
            A("wiz.steamPendingBtn", "关闭 Steam 并写入", "Close Steam and apply");
            A("wiz.steamLater", "稍后", "Later");

            A("step.prepare", "准备", "Prepare");
            A("step.node", "Node 运行时", "Node runtime");
            A("step.fetch", "获取最新版本", "Fetch the latest version");
            A("step.copy", "复制 Loader", "Copy the Loader");
            A("step.config", "初始化", "Initialize");
            A("step.deps", "流媒体依赖", "Streaming dependencies");
            A("step.runtime", "隔离运行时", "Isolated runtime");
            A("step.host", "ECHO.modded.exe", "ECHO.modded.exe");
            A("step.launchers", "启动器与快捷方式", "Launchers & shortcuts");
            A("step.packages", "可选包", "Optional packages");
            A("step.steam", "Steam 启动项", "Steam launch option");

            A("d.node.system", "使用系统 Node {0}", "Using system Node {0}");
            A("d.node.cached", "使用已缓存的 Node {0}", "Using cached Node {0}");
            A("d.node.download", "{0} / {1} · {2}/s · {3}", "{0} / {1} · {2}/s · {3}");
            A("d.node.connecting", "连接 {0}…", "Connecting to {0}…");
            A("d.node.verify", "校验 SHA-256…", "Verifying SHA-256…");
            A("d.node.extract", "解压…", "Extracting…");
            A("d.node.next", "{0} 失败，换下一个源…", "{0} failed, trying the next source…");
            A("d.fetch.check", "查询最新版本…", "Looking up the latest version…");
            A("d.fetch.get", "下载并校验 {0}…", "Downloading and verifying {0}…");
            A("d.fetch.skip", "本地已是最新", "Local copy is current");
            A("d.copy.files", "已复制 {0} 个文件", "Copied {0} files");
            A("d.copy.same", "从已安装目录运行，跳过复制", "Running from the installed folder; nothing to copy");
            A("d.deps.cached", "依赖未变化，跳过", "Dependencies unchanged; skipped");
            A("d.deps.via", "通过 {0} 安装…（{1}s）", "Installing via {0}… ({1}s)");
            A("d.deps.warn", "npm 安装失败，网易云音源将降级：{0}", "npm install failed; the NetEase source stays degraded: {0}");
            A("d.runtime.copy", "复制 ECHO.exe 与 app.asar 并打补丁…（{0}s）", "Copying ECHO.exe and app.asar and patching… ({0}s)");
            A("d.runtime.done", "ECHO {0} · {1}", "ECHO {0} · {1}");
            A("d.host.compile", "编译独立启动器…", "Compiling the independent launcher…");
            A("d.packages.item", "导入 {0}…", "Importing {0}…");
            A("d.packages.none", "未选择可选包", "No optional packages selected");
            A("d.packages.fetch", "下载 {0}…", "Downloading {0}…");
            A("d.steam.skip", "已跳过", "Skipped");
            A("d.steam.waiting", "等待确认关闭 Steam", "Waiting to close Steam");

            // ---- setup (ShinawaseSetup.exe) -------------------------------------
            A("setup.sub", "ECHO ModLoader 管理器 · v{0}", "ECHO ModLoader Manager · v{0}");
            A("setup.desc", "内置歌词匹配白盒、流媒体与 MV，可一键全部安装。", "Includes Lyrics Match Whitebox, Streaming and MV. Install all from the manager.");
            A("setup.change", "更改目录", "Change folder");
            A("setup.dirNotEmpty", "请选择空文件夹或已有的 Shinawase Manager 安装目录。", "Choose an empty folder or an existing Shinawase Manager installation.");
            A("setup.optDesktop", "创建桌面快捷方式", "Desktop shortcut");
            A("setup.optDesktopDesc", "桌面 → Shinawase Manager", "Desktop → Shinawase Manager");
            A("setup.optLaunch", "完成后打开管理器", "Open the manager when done");
            A("setup.optLaunchDesc", "直接进入 ECHO 的一键安装", "Goes straight to the one-click ECHO install");
            A("setup.install", "一键安装", "Install");
            A("setup.update", "更新到 v{0}", "Update to v{0}");
            A("setup.reinstall", "重新安装", "Reinstall");
            A("setup.open", "打开", "Open");
            A("setup.cancel", "取消", "Cancel");
            A("setup.done", "完成", "Done");
            A("setup.retry", "重试", "Retry");
            A("setup.path", "安装位置：{0}", "Location: {0}");
            A("setup.noAdmin", "仅为当前用户安装，无需管理员权限", "For the current user only; no administrator rights needed");
            A("setup.installed", "已安装 v{0}", "v{0} is installed");
            A("setup.shortcutDesc", "ECHO ModLoader 管理器", "ECHO ModLoader Manager");
            A("setup.step.close", "关闭正在运行的管理器…", "Closing the running manager…");
            A("setup.step.copy", "复制程序…", "Copying the app…");
            A("setup.step.extract", "解压 Loader 文件…", "Unpacking the Loader…");
            A("setup.step.shortcuts", "更新快捷方式…", "Updating shortcuts…");
            A("setup.step.register", "注册到「应用和功能」…", "Registering in Apps & features…");
            A("setup.step.remove", "删除程序文件…", "Removing program files…");
            A("setup.doneTitle", "安装完成", "Installed");
            A("setup.doneSub", "正在打开 Shinawase Manager…", "Opening Shinawase Manager…");
            A("setup.doneSubStay", "可从开始菜单或搜索「Shinawase」打开。", "Open it from the Start menu or by searching \"Shinawase\".");
            A("setup.failed", "安装失败：{0}", "Setup failed: {0}");
            A("setup.unTitle", "卸载 Shinawase Manager", "Uninstall Shinawase Manager");
            A("setup.unDesc", "卸载管理器与快捷方式。ECHO 内的 Loader 请先在管理器「设置」中卸载。", "Removes the manager and shortcuts. Uninstall ECHO's Loader from the manager's Settings first if needed.");
            A("setup.unBtn", "卸载", "Uninstall");
            A("setup.unDone", "已卸载", "Uninstalled");
            A("setup.unDoneSub", "Shinawase Manager 已移除。", "Shinawase Manager was removed.");

            // ---- generic ------------------------------------------------------
            A("ok", "好", "OK");
            A("cancel", "取消", "Cancel");
            A("continue", "继续", "Continue");
            A("toast.upToDate", "已是最新版本 {0}", "You're up to date ({0})");
            A("toast.updateFound", "发现新版本 {0}", "Version {0} is available");
            A("toast.checkFailed", "检查更新失败，请稍后再试", "Couldn't check for updates; try again later");
            A("toast.launchOk", "ECHO 已启动，Mods 已加载", "ECHO started with Mods");
            A("toast.launchFail", "ECHO 已启动，但调试端口 {0} 在 {1} 秒内没有响应，Mod 不会注入。请完全退出 ECHO 后再试。", "ECHO started but debug port {0} did not answer within {1} seconds, so no Mod is injected. Quit ECHO completely and try again.");
            A("toast.launchError", "无法启动：{0}", "Couldn't launch: {0}");
            A("toast.alreadyRunning", "带 Mods 的 ECHO 已在运行", "ECHO with Mods is already running");
            A("toast.saved", "已保存", "Saved");
            A("toast.logCopied", "日志已复制", "Log copied");
            A("toast.uninstalled", "已卸载 ShinawaseLoader，Mods 与 Plugins 已保留", "ShinawaseLoader removed; Mods and Plugins were kept");
            A("toast.managerUpdated", "管理器已更新，重新打开后生效", "The manager was updated; reopen it to use the new version");
            A("echoRunning.title", "ECHO 正在运行", "ECHO is running");
            A("echoRunning.body", "需要先关闭这个目录里正在运行的 ECHO（{0} 个进程）才能继续，未保存的内容可能丢失。", "ECHO from this folder must be closed first ({0} process(es)). Unsaved work may be lost.");
            A("echoRunning.confirm", "关闭 ECHO 并继续", "Close ECHO and continue");
            A("uninstall.title", "卸载 ShinawaseLoader？", "Uninstall ShinawaseLoader?");
            A("uninstall.body", "将删除 Loader、隔离运行时、ECHO.modded.exe 与快捷方式。Mods 与 Plugins 文件夹会保留，Steam 原版不受影响。", "This removes the Loader, isolated runtime, ECHO.modded.exe and shortcuts. Mods and Plugins folders are kept and Steam's ECHO is untouched.");
            A("uninstall.steam", "同时恢复 Steam 启动项", "Also restore the Steam launch option");
            A("uninstall.confirm", "卸载", "Uninstall");
            A("uninstall.failed", "卸载失败：{0}", "Uninstall failed: {0}");
            A("admin.title", "没有写入权限", "No write permission");
            A("admin.body", "无法写入 {0}。以管理员身份重新打开管理器后再试一次。", "Cannot write to {0}. Reopen the manager as administrator and try again.");
            A("admin.confirm", "以管理员身份打开", "Reopen as administrator");
            A("rank.steam", "Steam 正式版", "Steam release");
            A("rank.playtest", "Playtest", "Playtest");
            A("rank.other", "其他位置", "Other location");
            A("target.version", "ECHO {0}", "ECHO {0}");
            A("target.loader", "Loader {0}", "Loader {0}");
            A("target.noLoader", "未安装 Loader", "No Loader");
            A("time.s", "{0}s", "{0}s");
        }
    }
}
