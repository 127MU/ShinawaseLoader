// ShinawaseSetup.exe: the manager binary with the loader tree embedded as a
// payload. Run anywhere else it shows SetupWindow.xaml and installs itself per
// user (no administrator rights) to %LOCALAPPDATA%\Programs\Shinawase Manager,
// with a Start menu entry (so Windows search finds it) and an "Apps & features"
// entry whose uninstaller is the same exe
// started with --uninstall-app. The ECHO side is still installed from inside
// the manager, which opens with --first-run straight into the install sheet.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Shapes;
using Microsoft.Win32;
using Path = System.IO.Path;

namespace Shinawase.Manager
{
    public static class AppInstall
    {
        public const string Marker = "shinawase-app.json";
        public const string ExeName = "ShinawaseManager.exe";
        public const string RegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ShinawaseManager";
        public const string PayloadResource = "Shinawase.Manager.Payload.zip";

        public sealed class Choice
        {
            public string Dir;
            public bool StartMenu = true;
            public bool Desktop = true;
            public bool Register = true;
        }

        public static string DefaultDir
        {
            get
            {
                var local = Environment.GetEnvironmentVariable("LOCALAPPDATA");
                if (string.IsNullOrEmpty(local)) local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                return Path.Combine(local, "Programs", "Shinawase Manager");
            }
        }

        public static string SelfPath { get { return Assembly.GetEntryAssembly().Location; } }
        public static string SelfDir { get { return Path.GetDirectoryName(SelfPath); } }
        public static bool HasPayload { get { return Assembly.GetExecutingAssembly().GetManifestResourceInfo(PayloadResource) != null; } }
        public static bool IsAppDir(string dir) { return !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, Marker)); }
        public static bool RunningAsApp { get { return IsAppDir(SelfDir); } }

        // Setup mode: explicitly asked for, or a payload-carrying exe that does
        // not sit next to a loader tree (a downloaded ShinawaseSetup.exe).
        public static bool ShouldRunSetup(Options options)
        {
            if (options.Has("--setup")) return true;
            return HasPayload && !File.Exists(Path.Combine(SelfDir, "ShinawaseLoader", "ShinawaseLoader.mjs"));
        }

        public static string InstalledDir()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(RegistryKey))
                {
                    var location = key == null ? null : Convert.ToString(key.GetValue("InstallLocation"));
                    if (IsAppDir(location)) return Paths.Full(location);
                }
            }
            catch { }
            return IsAppDir(DefaultDir) ? DefaultDir : null;
        }

        public static string InstalledVersion(string dir)
        {
            var marker = dir == null ? null : Json.TryReadObject(Path.Combine(dir, Marker));
            return marker == null ? null : marker.Str("version");
        }

        public static string PayloadVersion()
        {
            try
            {
                using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
                using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
                {
                    var entry = zip.Entries.FirstOrDefault(e => e.FullName.Replace('\\', '/').Equals("ShinawaseLoader/loader-version.json", StringComparison.OrdinalIgnoreCase));
                    if (entry != null)
                    {
                        using (var reader = new StreamReader(entry.Open())) return Json.ParseObject(reader.ReadToEnd()).Str("version");
                    }
                }
            }
            catch { }
            return BuildInfo.Version;
        }

        public static List<Process> RunningManagers(string dir)
        {
            var list = Proc.FindByImage(new[] { Path.Combine(dir, ExeName) }, "ShinawaseManager");
            var own = Process.GetCurrentProcess().Id;
            foreach (var p in list.Where(p => p.Id == own).ToList()) { list.Remove(p); p.Dispose(); }
            return list;
        }

        public static async Task CloseManagers(string dir)
        {
            var running = RunningManagers(dir);
            foreach (var process in running)
            {
                try { process.CloseMainWindow(); } catch { }
            }
            for (var i = 0; i < 10 && running.Any(p => { try { return !p.HasExited; } catch { return false; } }); i++) await Task.Delay(300);
            foreach (var process in running)
            {
                try { if (!process.HasExited) process.Kill(); } catch { }
                process.Dispose();
            }
        }

        private static void ExtractPayload(string dir)
        {
            var root = Paths.Full(dir) + "\\";
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(PayloadResource))
            using (var zip = new ZipArchive(stream, ZipArchiveMode.Read))
            {
                foreach (var entry in zip.Entries)
                {
                    var relative = entry.FullName.Replace('/', '\\').TrimStart('\\');
                    if (relative.Length == 0 || relative.EndsWith("\\", StringComparison.Ordinal)) continue;
                    if (relative.Split('\\').Any(part => part == ".." || part == "." || part.Length == 0)) continue;
                    var target = Paths.Full(Path.Combine(dir, relative));
                    if (!target.StartsWith(root, StringComparison.OrdinalIgnoreCase)) continue;
                    Fs.EnsureParent(target);
                    entry.ExtractToFile(target, true);
                }
            }
        }

        public static void Install(Choice choice, Action<double, string> progress)
        {
            var dir = Paths.Full(choice.Dir);
            if (Directory.Exists(dir) && Directory.EnumerateFileSystemEntries(dir).Any() && !IsAppDir(dir))
                throw new InvalidOperationException(L.T("setup.dirNotEmpty"));
            var exe = Path.Combine(dir, ExeName);
            Directory.CreateDirectory(dir);
            progress(0.15, L.T("setup.step.copy"));
            if (!Paths.Same(SelfPath, exe)) ManagerBuild.ReplaceExe(SelfPath, exe);
            progress(0.35, L.T("setup.step.extract"));
            // Old payload files go first so a removed file cannot linger.
            Fs.TryDelete(Path.Combine(dir, "ShinawaseLoader"));
            Fs.TryDelete(Path.Combine(dir, "examples"));
            Fs.TryDelete(Path.Combine(dir, "workshop"));
            ExtractPayload(dir);
            if (!File.Exists(Path.Combine(dir, "ShinawaseLoader", "ShinawaseLoader.mjs"))) throw new InvalidDataException("payload has no loader tree");
            var version = LoaderVersionInfo.Read(Path.Combine(dir, "ShinawaseLoader"));
            var text = version == null ? BuildInfo.Version : version.Version;
            Json.WriteObject(Path.Combine(dir, Marker), new JObject { { "version", text }, { "installedAt", DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture) } });
            progress(0.75, L.T("setup.step.shortcuts"));
            if (choice.StartMenu) Shortcuts.Create(Shortcuts.StartMenuPath(), exe, "", dir, exe + ",0", L.T("setup.shortcutDesc"));
            if (choice.Desktop) Shortcuts.Create(Shortcuts.DesktopManagerPath(), exe, "", dir, exe + ",0", L.T("setup.shortcutDesc"));
            else if (Shortcuts.PointsInto(Shortcuts.DesktopManagerPath(), dir)) Fs.TryDelete(Shortcuts.DesktopManagerPath());
            if (choice.Register)
            {
                progress(0.9, L.T("setup.step.register"));
                Register(dir, text);
            }
            progress(1, L.T("setup.doneTitle"));
            Log.Info("app installed to " + dir + " v" + text);
        }

        private static long SizeKb(string dir)
        {
            try { return new DirectoryInfo(dir).GetFiles("*", SearchOption.AllDirectories).Sum(f => f.Length) / 1024; }
            catch { return 0; }
        }

        public static void Register(string dir, string version)
        {
            var exe = Path.Combine(dir, ExeName);
            using (var key = Registry.CurrentUser.CreateSubKey(RegistryKey))
            {
                key.SetValue("DisplayName", "Shinawase Manager");
                key.SetValue("DisplayVersion", version);
                key.SetValue("Publisher", "ShinawaseLoader");
                key.SetValue("DisplayIcon", exe + ",0");
                key.SetValue("InstallLocation", dir);
                key.SetValue("UninstallString", "\"" + exe + "\" --uninstall-app");
                key.SetValue("URLInfoAbout", "https://github.com/" + Net.Repo);
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd", CultureInfo.InvariantCulture));
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                key.SetValue("EstimatedSize", (int)Math.Min(int.MaxValue, SizeKb(dir)), RegistryValueKind.DWord);
            }
        }

        // Removes the manager app only; the loader inside ECHO is left alone.
        public static void Uninstall(string dir, Action<double, string> progress)
        {
            dir = Paths.Full(dir);
            if (!IsAppDir(dir)) throw new InvalidOperationException("not a Shinawase Manager folder: " + dir);
            progress(0.2, L.T("setup.step.shortcuts"));
            foreach (var link in new[] { Shortcuts.StartMenuPath(), Shortcuts.DesktopManagerPath() })
            {
                if (Shortcuts.PointsInto(link, dir)) Fs.TryDelete(link);
            }
            try
            {
                string registered = null;
                using (var key = Registry.CurrentUser.OpenSubKey(RegistryKey))
                {
                    if (key != null) registered = Convert.ToString(key.GetValue("InstallLocation"));
                }
                if (registered != null && Paths.Same(registered, dir)) Registry.CurrentUser.DeleteSubKeyTree(RegistryKey, false);
            }
            catch (Exception error) { Log.Warn("unregister: " + error.Message); }
            progress(0.5, L.T("setup.step.remove"));
            if (Paths.IsUnder(SelfPath, dir))
            {
                foreach (var entry in new DirectoryInfo(dir).GetFileSystemInfos())
                {
                    if (Paths.Same(entry.FullName, SelfPath)) continue;
                    Fs.TryDelete(entry.FullName);
                }
                // The running uninstaller cannot delete itself: a detached cmd
                // removes the folder once this process has exited.
                var script = "/c ping 127.0.0.1 -n 3 >nul & rmdir /s /q " + Proc.Quote(dir);
                Process.Start(new ProcessStartInfo("cmd.exe", script) { CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = Path.GetTempPath() });
            }
            else Fs.DeleteTree(dir);
            progress(1, L.T("setup.unDone"));
            Log.Info("app uninstalled from " + dir);
        }

        // Keeps the app's own loader tree (the install source) in step after the
        // manager installed a newer remote version into ECHO.
        public static bool RefreshPayload(string appDir, string stagedLoader, string stagedPackages)
        {
            if (!IsAppDir(appDir) || string.IsNullOrEmpty(stagedLoader) || !File.Exists(Path.Combine(stagedLoader, "ShinawaseLoader.mjs"))) return false;
            var current = Path.Combine(appDir, "ShinawaseLoader");
            var next = current + ".next";
            Fs.TryDelete(next);
            Fs.CopyTree(stagedLoader, next, null, null);
            var old = current + ".old";
            Fs.TryDelete(old);
            if (Directory.Exists(current)) Directory.Move(current, old);
            Directory.Move(next, current);
            Fs.TryDelete(old);
            if (!string.IsNullOrEmpty(stagedPackages) && Directory.Exists(stagedPackages))
            {
                var packages = Path.Combine(appDir, "examples", "packages");
                Directory.CreateDirectory(packages);
                foreach (var file in Directory.GetFiles(stagedPackages, "*.echomod")) Fs.CopyFile(file, Path.Combine(packages, Path.GetFileName(file)));
            }
            var version = LoaderVersionInfo.Read(current);
            var marker = Json.TryReadObject(Path.Combine(appDir, Marker)) ?? new JObject();
            if (version != null) marker["version"] = version.Version;
            Json.WriteObject(Path.Combine(appDir, Marker), marker);
            try { if (version != null) Register(appDir, version.Version); } catch { }
            return true;
        }
    }

    public sealed class SetupController
    {
        public readonly Window Window;
        private readonly Options options;
        private bool uninstall;
        private readonly string payloadVersion;
        private string installedDir;
        private string targetDir;
        private string state = "ready"; // ready | working | done | failed
        private Grid SetupRoot;
        private StackPanel OptionsPanel, ProgressPanel;
        private TextBlock SetupTitle, SetupSub, SetupDesc, SetupPath, SetupStatus, BtnPrimaryText, SetupPercent;
        private Button BtnPrimary, BtnSecondary, BtnMin, BtnClose, BtnChange, BtnUninstall;
        private CheckBox OptLaunch;
        private ContentControl BtnPrimarySpin;
        private ScaleTransform SetupProgressScale;

        public SetupController(Options options)
        {
            this.options = options;
            uninstall = options.Has("--uninstall-app");
            payloadVersion = HasPayloadVersion();
            installedDir = AppInstall.InstalledDir();
            if (uninstall && installedDir == null && AppInstall.RunningAsApp) installedDir = AppInstall.SelfDir;
            targetDir = options.Get("--app-dir") ?? installedDir ?? AppInstall.DefaultDir;
            if (AppInstall.IsAppDir(targetDir)) installedDir = targetDir;
            Window = (Window)Ui.Load("SetupWindow.xaml");
            foreach (var field in typeof(SetupController).GetFields(BindingFlags.Instance | BindingFlags.NonPublic))
            {
                if (!char.IsUpper(field.Name[0]) || !typeof(DependencyObject).IsAssignableFrom(field.FieldType)) continue;
                var element = Window.FindName(field.Name);
                if (element == null || !field.FieldType.IsInstanceOfType(element)) throw new InvalidOperationException("SetupWindow.xaml is missing " + field.Name);
                field.SetValue(this, element);
            }
            Window.SourceInitialized += (s, e) => Native.RoundCorners(Window);
            BtnMin.Click += (s, e) => Window.WindowState = WindowState.Minimized;
            BtnClose.Click += (s, e) => { if (state != "working") Window.Close(); };
            BtnPrimary.Click += async (s, e) => await Primary();
            BtnSecondary.Click += (s, e) => Secondary();
            BtnChange.Click += (s, e) => ChangeDirectory();
            BtnUninstall.Click += (s, e) =>
            {
                if (state == "working" || !AppInstall.IsAppDir(TargetDir)) return;
                uninstall = true;
                state = "ready";
                ApplyTexts();
                Anim.Enter(SetupDesc, 0, 6, 0, 220);
            };
            Window.Closing += (s, e) => { if (state == "working") e.Cancel = true; };
            OptLaunch.IsChecked = true;
            ApplyTexts();
            SetupRoot.Opacity = 0;
            Window.Loaded += (s, e) => Enter();
            if (options.Get("--snapshot") != null) Window.Loaded += async (s, e) => await SnapshotTour();
        }

        // --snapshot <dir>: ready -> install -> done screenshots for review.
        private async Task SnapshotTour()
        {
            var dir = options.Get("--snapshot");
            await Task.Delay(1400);
            Snapshot.Save(SetupRoot, dir, uninstall ? "un-ready" : "setup-ready");
            OptLaunch.IsChecked = false;
            var run = Primary();
            await Task.Delay(260);
            Snapshot.Save(SetupRoot, dir, uninstall ? "un-progress" : "setup-progress");
            await run;
            await Task.Delay(900);
            Snapshot.Save(SetupRoot, dir, uninstall ? "un-done" : "setup-done");
            Window.Close();
        }

        private static string HasPayloadVersion()
        {
            return AppInstall.HasPayload ? AppInstall.PayloadVersion() : BuildInfo.Version;
        }

        public void BringToFront()
        {
            if (Window.WindowState == WindowState.Minimized) Window.WindowState = WindowState.Normal;
            Window.Activate();
        }

        private string TargetDir { get { return targetDir; } }

        private void ChangeDirectory()
        {
            if (state == "working" || uninstall) return;
            using (var dialog = new System.Windows.Forms.FolderBrowserDialog())
            {
                dialog.Description = L.T("setup.change");
                dialog.SelectedPath = TargetDir;
                if (dialog.ShowDialog() != System.Windows.Forms.DialogResult.OK) return;
                targetDir = Paths.Full(dialog.SelectedPath);
                ApplyTexts();
            }
        }

        private void ApplyTexts()
        {
            var installedVersion = AppInstall.InstalledVersion(TargetDir);
            SetupTitle.Text = uninstall ? L.T("setup.unTitle") : "Shinawase Manager";
            SetupSub.Text = L.F("setup.sub", uninstall ? (installedVersion ?? BuildInfo.Version) : payloadVersion);
            SetupDesc.Text = uninstall ? L.T("setup.unDesc") : L.T("setup.desc");
            SetupPath.Text = L.F("setup.path", TargetDir);
            SetupPath.ToolTip = TargetDir;
            OptionsPanel.Visibility = Visibility.Visible;
            Anim.Set(OptionsPanel, UIElement.OpacityProperty, 1);
            ProgressPanel.Visibility = Visibility.Collapsed;
            BtnChange.Visibility = uninstall ? Visibility.Collapsed : Visibility.Visible;
            OptLaunch.Visibility = uninstall ? Visibility.Collapsed : Visibility.Visible;
            BtnUninstall.Visibility = !uninstall && AppInstall.IsAppDir(TargetDir) ? Visibility.Visible : Visibility.Collapsed;
            SetupStatus.Text = "";
            if (uninstall)
            {
                BtnPrimaryText.Text = L.T("setup.unBtn");
                BtnPrimary.Style = (Style)Window.FindResource("DangerSolid");
                BtnSecondary.Content = L.T("setup.cancel");
                return;
            }
            BtnPrimary.Style = (Style)Window.FindResource("PrimaryLarge");
            if (!AppInstall.IsAppDir(TargetDir)) { BtnPrimaryText.Text = L.T("setup.install"); BtnSecondary.Content = L.T("setup.cancel"); }
            else
            {
                var newer = installedVersion == null || Versions.Compare(payloadVersion, installedVersion) > 0;
                BtnPrimaryText.Text = newer ? L.F("setup.update", payloadVersion) : L.T("setup.reinstall");
                BtnSecondary.Content = L.T("setup.open");
                SetupStatus.Text = L.F("setup.installed", installedVersion ?? "?");
            }
        }

        private void Enter()
        {
            Anim.Run(SetupRoot, UIElement.OpacityProperty, 1, 360, Anim.Cubic);
            Anim.Enter(SetupTitle, 0, 8, 0, 360);
        }

        private void Secondary()
        {
            if (state == "working") return;
            if (uninstall && !options.Has("--uninstall-app") && state != "done")
            {
                uninstall = false;
                ApplyTexts();
                return;
            }
            if (!uninstall && AppInstall.IsAppDir(TargetDir) && state != "done")
            {
                Launch(false);
                return;
            }
            Window.Close();
        }

        private void Launch(bool firstRun)
        {
            var exe = Path.Combine(TargetDir, AppInstall.ExeName);
            try { Process.Start(new ProcessStartInfo(exe, firstRun ? "--first-run" : "") { UseShellExecute = false, WorkingDirectory = TargetDir }); }
            catch (Exception error) { SetupStatus.Text = error.Message; return; }
            Window.Close();
        }

        private void SetWorking(bool on)
        {
            BtnPrimary.IsEnabled = !on;
            BtnSecondary.IsEnabled = !on;
            BtnChange.IsEnabled = !on;
            BtnUninstall.IsEnabled = !on;
            BtnPrimarySpin.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
            BtnPrimaryText.Opacity = on ? 0 : 1;
        }

        private void Report(double value, string text)
        {
            Window.Dispatcher.BeginInvoke(new Action(() =>
            {
                Anim.Run(SetupProgressScale, ScaleTransform.ScaleXProperty, value, 420, Anim.Cubic);
                SetupStatus.Text = text;
                SetupPercent.Text = ((int)Math.Round(value * 100)).ToString(CultureInfo.InvariantCulture) + "%";
            }));
        }

        private async Task Primary()
        {
            if (state == "working") return;
            if (state == "done")
            {
                if (uninstall) Window.Close();
                else Launch(true);
                return;
            }
            state = "working";
            SetWorking(true);
            Anim.Run(OptionsPanel, UIElement.OpacityProperty, 0, 160, Anim.Cubic);
            await Task.Delay(Anim.Enabled ? 160 : 0);
            OptionsPanel.Visibility = Visibility.Collapsed;
            ProgressPanel.Visibility = Visibility.Visible;
            Anim.Set(SetupProgressScale, ScaleTransform.ScaleXProperty, 0);
            Anim.Enter(ProgressPanel, 0, 6, 0, 220);
            SetupStatus.SetResourceReference(TextBlock.ForegroundProperty, "B.Text2");
            Exception failure = null;
            var dir = TargetDir;
            try
            {
                Report(0.05, L.T("setup.step.close"));
                await AppInstall.CloseManagers(dir);
                if (uninstall) await Task.Run(() => AppInstall.Uninstall(dir, Report));
                else
                {
                    var choice = new AppInstall.Choice { Dir = dir, Desktop = false, StartMenu = !options.Has("--no-start-menu"), Register = !options.Has("--no-register") };
                    await Task.Run(() => AppInstall.Install(choice, Report));
                    installedDir = dir;
                }
            }
            catch (Exception error)
            {
                failure = error;
                Log.Error("setup: " + error);
            }
            await Task.Delay(Anim.Enabled ? 450 : 0);
            SetWorking(false);
            if (failure != null)
            {
                state = "failed";
                SetupStatus.Text = L.F("setup.failed", failure.Message);
                SetupStatus.SetResourceReference(TextBlock.ForegroundProperty, "B.Danger");
                BtnPrimaryText.Text = L.T("setup.retry");
                return;
            }
            state = "done";
            SetupTitle.Text = uninstall ? L.T("setup.unDone") : L.T("setup.doneTitle");
            Anim.Enter(SetupTitle, 0, 6, 0, 260);
            BtnUninstall.Visibility = Visibility.Collapsed;
            SetupStatus.SetResourceReference(TextBlock.ForegroundProperty, "B.Success");
            if (uninstall)
            {
                SetupStatus.Text = L.T("setup.unDoneSub");
                BtnPrimaryText.Text = L.T("setup.done");
                BtnPrimary.Style = (Style)Window.FindResource("PrimaryLarge");
                BtnSecondary.Visibility = Visibility.Collapsed;
                await Task.Delay(1600);
                Window.Close();
                return;
            }
            BtnPrimaryText.Text = L.T("setup.open");
            BtnSecondary.Content = L.T("setup.done");
            if (OptLaunch.IsChecked == true)
            {
                SetupStatus.Text = L.T("setup.doneSub");
                await Task.Delay(Anim.Enabled ? 1100 : 300);
                Launch(true);
            }
            else SetupStatus.Text = L.T("setup.doneSubStay");
        }
    }
}
