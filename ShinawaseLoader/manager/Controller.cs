// Window controller: navigation, overview, Mods, Steam, settings, the install
// sheet, dialogs and toasts. Everything long-running is awaited off the UI
// thread; every visual change goes through Anim so "Animations: off" is honored.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;
using IOPath = System.IO.Path;

namespace Shinawase.Manager
{
    public sealed class MainController
    {
        public readonly Window Window;
        private readonly Options options;
        private readonly Prefs prefs;
        private readonly NetState net;
        private readonly Installer installer;
        private string sourceDir;
        private LoaderVersionInfo sourceInfo;
        private List<EchoTarget> targets = new List<EchoTarget>();
        private EchoTarget current;
        private bool scanning = true;
        private RunStatus run = new RunStatus();
        private SteamInfo steam;
        private bool installing;
        private bool launching;
        private bool steamBusy;
        private bool statusBusy;
        private bool manualCheck;
        private bool announced;
        private string heroState;
        private FrameworkElement currentPage;
        private readonly Dictionary<RadioButton, FrameworkElement> navMap = new Dictionary<RadioButton, FrameworkElement>();
        private DispatcherTimer statusTimer;
        private DispatcherTimer progressTimer;
        private CancellationTokenSource installCts;
        private string sheetView;
        private string sheetMode;
        private string sheetPurpose;
        private List<PackageInfo> wizardPackages = new List<PackageInfo>();
        private List<PackageInfo> bundled = new List<PackageInfo>();
        private InstallPlan lastPlan;
        private InstallResult lastResult;
        private bool logVisible;
        private DateTime lastDragOver;
        private bool dropShown;
        private Task dialogChain = Task.FromResult(true);
        private bool syncingRadios;

        // named elements
        private Grid RootGrid, PageHost, SheetLayer, DialogLayer, DropLayer, HeroContent, SheetBody, ViewSelect, ViewProgress, ViewDone, ProgressTrack, NavPanel, SheetPanel, DialogPanel, DoneBadge;
        private StackPanel NavStack, ToastHost, HomeStack, ModsStack, SteamStack, SettingsStack, AboutStack, DoneSummary, LogoBars, SheetDots, ModsContent, HeroPathRow, HeroPrimaryBody, SetReprobeBody;
        private ScrollViewer ViewOptions;
        private Border NavIndicator, SheetBackdrop, DialogBackdrop, ProgressFill, ProgressSheen, LogPanel, DialogBadge, ModsEmpty, ModsNoLoader, TileSteamBadge, SteamBadge, OptLatestRow, TargetsEmpty, DoneSteamCard, DoneSummaryCard;
        private TranslateTransform NavIndicatorTT, SheetShift, SheenShift;
        private ScaleTransform SheetScale, DialogScale, ProgressScale, DoneScale, DropScale;
        private TextBlock HeroChip, HeroTitle, HeroSub, HeroPath, HeroPrimaryIcon, HeroPrimaryText, TileLoaderValue, TileLoaderSub, TileLoaderGlyph, TileSteamValue, TileSteamSub, TileSteamIcon, TileRunValue, TileRunSub, TileNetValue, TileNetSub,
            SideStatus, SideStatusSub, SteamTitle, SteamSub, SteamGlyph, SteamInfoRoot, SteamInfoApp, SteamInfoRunning, SteamAccountsEmpty, SheetTitle, SheetSub, ProgressPercent, ProgressDetail, DoneTitle, DoneSub,
            DialogTitle, DialogGlyph, OptLatestTitle, OptLatestDesc, AboutVersion, AboutManager, AboutInstalled, AboutRemote, SetVersionLine, SetVersionSub, DoneSteamApplyText, SteamApplyText;
        private Ellipse HeroDot, TileRunDot, SideDot, SideDotHalo, DoneHalo, DoneDisc;
        private Shape DoneCheck, DoneCross;
        private Button HeroPrimary, HeroSecondary, HeroChange, TileLoader, TileSteam, TileRun, TileNet, BtnMin, BtnClose, ThemeToggle, ModsImport, ModsFolder, ModsGoInstall, SteamCopy, SteamApply, SteamRestore,
            SetReprobe, SetCheckNow, SetOpenLogs, SetOpenLoader, SetDebug, SetSafe, SetUninstall, AboutGithub, AboutLogs, SheetClose, SheetAux, SheetBack, SheetNext, PkgInstallAll, TargetBrowse, TargetRescan, DialogPrimary, DialogSecondary, DoneSteamApply, DoneSteamLater;
        private ContentControl HeroPrimarySpin, TileLoaderSpin, SetReprobeSpin, SteamApplySpin, DialogBody, DoneSteamSpin;
        private ItemsControl ModsList, BundledList, SteamAccounts, NodeSources, MirrorList, TargetsList, PkgList, StepsList;
        private CheckBox SetAutoMirror, SetShinawase, SetAutoCheck, SetLoaderAuto, SetMotion, OptLatest, OptSteam, OptShortcut, OptDesktop, OptLaunch;
        private RadioButton NavHome, NavMods, NavSteam, NavSettings, NavAbout, LangZh, LangEn, SetLangZh, SetLangEn, ThemeSystem, ThemeLight, ThemeDark, OptEditionExternal, OptEditionWorkshop;
        private StackPanel OptExternalOnly, OptIntegrationExternal;
        private TextBlock OptEditionDesc;
        private string wizardEdition = "external";
        private string workshopZip;
        private TextBox SteamLine, LogBox;
        private Image AboutLogo;
        private Canvas HeroArt;
        private Ellipse HeroOrb1, HeroOrb2;
        private ScrollViewer PageHome, PageMods, PageSteam, PageSettings, PageAbout, StepsScroll, TargetsScroll;

        public MainController(Options options)
        {
            this.options = options;
            prefs = Prefs.Load();
            Anim.Enabled = prefs.Motion;
            L.Locale = L.Detect();
            ResolveSource();
            net = new NetState(prefs);
            installer = new Installer(net, prefs);
            Window = (Window)Ui.Load("MainWindow.xaml");
            BindElements();
            Window.Icon = IconArt.Render(64);
            AboutLogo.Source = IconArt.Render(144);
            var work = SystemParameters.WorkArea;
            if (Window.Height > work.Height - 16) Window.Height = Math.Max(560, work.Height - 16);
            if (Window.Width > work.Width - 16) Window.Width = Math.Max(900, work.Width - 16);
            WireEvents();
            InitSettingsControls();
            RootGrid.Opacity = 0;
            Window.SourceInitialized += (s, e) => Native.RoundCorners(Window);
            Window.Loaded += OnLoaded;
            Window.Closing += OnClosing;
            SystemEvents.UserPreferenceChanged += OnSystemPreference;
            installer.LogAppended += line => Window.Dispatcher.BeginInvoke(new Action(() =>
            {
                LogBox.AppendText(line + Environment.NewLine);
                if (logVisible) LogBox.ScrollToEnd();
            }));
        }

        // ---- setup ---------------------------------------------------------------
        private T Get<T>(string name) where T : class
        {
            var found = Window.FindName(name) as T;
            if (found == null) throw new InvalidOperationException("MainWindow.xaml is missing " + name);
            return found;
        }

        private void BindElements()
        {
            foreach (var field in typeof(MainController).GetFields(BindingFlags.Instance | BindingFlags.NonPublic))
            {
                if (!char.IsUpper(field.Name[0])) continue;
                if (!typeof(DependencyObject).IsAssignableFrom(field.FieldType)) continue;
                var element = Window.FindName(field.Name);
                if (element == null || !field.FieldType.IsInstanceOfType(element)) throw new InvalidOperationException("MainWindow.xaml is missing " + field.Name + " (" + field.FieldType.Name + ")");
                field.SetValue(this, element);
            }
        }

        private void ResolveSource()
        {
            var exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            var list = new List<string>();
            if (!string.IsNullOrEmpty(options.Source)) list.Add(options.Source);
            list.Add(exeDir);
            list.Add(IOPath.Combine(exeDir, "ShinawaseLoader"));
            var parent = IOPath.GetDirectoryName(exeDir);
            if (parent != null) list.Add(IOPath.Combine(parent, "ShinawaseLoader"));
            foreach (var dir in list)
            {
                if (File.Exists(IOPath.Combine(dir, "ShinawaseLoader.mjs")) && File.Exists(IOPath.Combine(dir, "loader-version.json")))
                {
                    sourceDir = Paths.Full(dir);
                    break;
                }
            }
            sourceInfo = sourceDir == null ? null : LoaderVersionInfo.Read(sourceDir);
            Log.Info("manager " + BuildInfo.Version + " source=" + (sourceDir ?? "none"));
        }

        private bool RunningFromInstall
        {
            get { return sourceDir != null && File.Exists(IOPath.Combine(IOPath.GetDirectoryName(sourceDir) ?? "", "ECHO.modded.exe")); }
        }

        private List<string> PackageDirs()
        {
            var dirs = new List<string>();
            if (sourceDir != null)
            {
                var root = IOPath.GetDirectoryName(sourceDir);
                if (root != null)
                {
                    dirs.Add(IOPath.Combine(root, "examples", "packages"));
                    dirs.Add(IOPath.Combine(root, "packages"));
                }
            }
            dirs.Add(IOPath.Combine(Paths.UserDataRoot, "staging", "packages"));
            dirs.Add(IOPath.Combine(Paths.UserDataRoot, "staging-packages", "packages"));
            return dirs;
        }

        private bool IsDark()
        {
            if (prefs.Theme == "dark") return true;
            if (prefs.Theme == "light") return false;
            return Theme.SystemDark();
        }

        private void WireEvents()
        {
            navMap[NavHome] = PageHome;
            navMap[NavMods] = PageMods;
            navMap[NavSteam] = PageSteam;
            navMap[NavSettings] = PageSettings;
            navMap[NavAbout] = PageAbout;
            foreach (var pair in navMap)
            {
                var button = pair.Key;
                button.Checked += (s, e) => ShowPage(button);
            }
            foreach (var viewer in new[] { PageHome, PageMods, PageSteam, PageSettings, PageAbout, StepsScroll, TargetsScroll, ViewOptions }) SmoothScroll.Attach(viewer);

            BtnMin.Click += (s, e) => Window.WindowState = WindowState.Minimized;
            BtnClose.Click += (s, e) => Window.Close();
            ThemeToggle.Click += (s, e) => SetTheme(IsDark() ? "light" : "dark");
            LangZh.Checked += (s, e) => SetLocale("zh");
            LangEn.Checked += (s, e) => SetLocale("en");
            SetLangZh.Checked += (s, e) => SetLocale("zh");
            SetLangEn.Checked += (s, e) => SetLocale("en");
            ThemeSystem.Checked += (s, e) => { if (!syncingRadios) SetTheme("system"); };
            ThemeLight.Checked += (s, e) => { if (!syncingRadios) SetTheme("light"); };
            ThemeDark.Checked += (s, e) => { if (!syncingRadios) SetTheme("dark"); };

            HeroPrimary.Click += (s, e) => HeroPrimaryAction();
            HeroSecondary.Click += (s, e) => HeroSecondaryAction();
            HeroChange.Click += (s, e) => OpenSheet("pick", "install", "select");
            TileLoader.Click += async (s, e) => { manualCheck = true; await Probe(true); };
            TileSteam.Click += (s, e) => NavSteam.IsChecked = true;
            TileRun.Click += (s, e) => NavMods.IsChecked = true;
            TileNet.Click += (s, e) => NavSettings.IsChecked = true;

            ModsImport.Click += (s, e) => PickAndImport();
            ModsFolder.Click += (s, e) => { if (current != null) OpenFolder(IOPath.Combine(current.Root, "Mods")); };
            ModsGoInstall.Click += (s, e) => OpenInstall();
            ModsList.AddHandler(ButtonBase.ClickEvent, new RoutedEventHandler(OnModsClick));
            BundledList.AddHandler(ButtonBase.ClickEvent, new RoutedEventHandler(OnBundledClick));
            PkgInstallAll.Click += (s, e) => InstallAllPackages();

            SteamCopy.Click += (s, e) => { CopyText(SteamLine.Text); Toast(L.T("steam.copied"), "success"); };
            SteamApply.Click += async (s, e) => await ApplySteamAsync(false);
            SteamRestore.Click += async (s, e) => await ApplySteamAsync(true);

            SetAutoMirror.Click += (s, e) => { prefs.AutoMirror = SetAutoMirror.IsChecked == true; prefs.Save(); net.ApplySelection(); UpdateTiles(); };
            SetShinawase.Click += (s, e) => { prefs.UseShinawaseMirror = SetShinawase.IsChecked == true; prefs.Save(); UpdateTiles(); };
            SetAutoCheck.Click += (s, e) => { prefs.AutoCheck = SetAutoCheck.IsChecked == true; prefs.Save(); UpdateAll(); };
            SetLoaderAuto.Click += (s, e) => SetLoaderAutoUpdate(SetLoaderAuto.IsChecked == true);
            SetMotion.Click += (s, e) => { prefs.Motion = SetMotion.IsChecked == true; Anim.Enabled = prefs.Motion; prefs.Save(); AmbientMotion(); };
            SetReprobe.Click += async (s, e) => await Probe(false);
            SetCheckNow.Click += async (s, e) => { manualCheck = true; await Probe(true); };
            NodeSources.AddHandler(ButtonBase.ClickEvent, new RoutedEventHandler(OnSourceClick));
            SetOpenLogs.Click += (s, e) => OpenFolder(current != null && Directory.Exists(IOPath.Combine(current.LoaderRoot, "Logs")) ? IOPath.Combine(current.LoaderRoot, "Logs") : Paths.LogDir);
            SetOpenLoader.Click += (s, e) => { if (current != null) OpenFolder(current.Installed ? current.LoaderRoot : current.Root); };
            SetDebug.Click += (s, e) => RunLauncher("start-echo-debug.cmd");
            SetSafe.Click += (s, e) => RunLauncher("start-echo-safe.cmd");
            SetUninstall.Click += async (s, e) => await UninstallAsync();
            AboutGithub.Click += (s, e) => OpenUrl("https://github.com/" + Net.Repo);
            AboutLogs.Click += (s, e) => OpenFolder(Paths.LogDir);

            SheetClose.Click += (s, e) => CloseSheetRequested();
            SheetBack.Click += (s, e) => SheetBackAction();
            SheetNext.Click += (s, e) => SheetNextAction();
            OptEditionExternal.Checked += (s, e) => { if (!syncingRadios) ApplyEdition("external"); };
            OptEditionWorkshop.Checked += (s, e) => { if (!syncingRadios) ApplyEdition("workshop"); };
            SheetAux.Click += (s, e) => SheetAuxAction();
            TargetBrowse.Click += (s, e) => BrowseTarget();
            TargetRescan.Click += async (s, e) => { await Rescan(null); TargetsList.ItemsSource = null; TargetsList.ItemsSource = targets; UpdateSheetFooter(); };
            TargetsList.AddHandler(ToggleButton.CheckedEvent, new RoutedEventHandler((s, e) => UpdateSheetFooter()));
            DoneSteamApply.Click += async (s, e) => await DoneSteamApplyAction();
            DoneSteamLater.Click += (s, e) => Anim.Run(DoneSteamCard, UIElement.OpacityProperty, 0, 200, null, 0, () => DoneSteamCard.Visibility = Visibility.Collapsed);

            Window.PreviewKeyDown += OnKey;
            Window.DragEnter += OnDragOver;
            Window.DragOver += OnDragOver;
            Window.DragLeave += OnDragLeave;
            Window.Drop += OnDrop;
            HeroArt.SizeChanged += (s, e) => HeroArt.Clip = new RectangleGeometry(new Rect(e.NewSize), 20, 20);
            Window.Activated += (s, e) => { if (statusTimer != null) RefreshStatus(); };
        }

        private void InitSettingsControls()
        {
            SetAutoMirror.IsChecked = prefs.AutoMirror;
            SetShinawase.IsChecked = prefs.UseShinawaseMirror;
            SetAutoCheck.IsChecked = prefs.AutoCheck;
            SetMotion.IsChecked = prefs.Motion;
            NodeSources.ItemsSource = net.Node;
            MirrorList.ItemsSource = net.Shinawase;
            SyncRadios();
            net.PropertyChanged += (s, e) => Window.Dispatcher.BeginInvoke(new Action(UpdateTiles));
        }

        private void SyncRadios()
        {
            syncingRadios = true;
            try
            {
                (L.Locale == "en" ? LangEn : LangZh).IsChecked = true;
                (L.Locale == "en" ? SetLangEn : SetLangZh).IsChecked = true;
                (prefs.Theme == "dark" ? ThemeDark : prefs.Theme == "light" ? ThemeLight : ThemeSystem).IsChecked = true;
            }
            finally { syncingRadios = false; }
        }

        public void BringToFront()
        {
            if (Window.WindowState == WindowState.Minimized) Window.WindowState = WindowState.Normal;
            Window.Activate();
            Window.Topmost = true;
            Window.Topmost = false;
        }

        // ---- lifecycle -----------------------------------------------------------
        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            Anim.Run(RootGrid, UIElement.OpacityProperty, 1, 380, Anim.Cubic);
            var navIndex = 0;
            foreach (UIElement item in NavStack.Children) Anim.Enter(item, -10, 0, 120 + 45 * navIndex++, 460);
            currentPage = PageHome;
            StaggerPage(PageHome, 140);
            Window.Dispatcher.BeginInvoke(new Action(() => MoveNavIndicator(NavHome, false)), DispatcherPriority.Loaded);
            UpdateAll();
            AmbientMotion();
            var consent = ShowConsentAsync();
            if (options.Get("--snapshot") != null)
            {
                await Task.Delay(1200);
                Snap("01-consent");
                DialogPrimary.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
            }
            var agreed = await consent;
            if (!agreed)
            {
                Window.Close();
                return;
            }
            if (RunningFromInstall || AppInstall.RunningAsApp) RefreshInstalledManager();
            statusTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(2.5) };
            statusTimer.Tick += (s, a) => RefreshStatus();
            statusTimer.Start();
            var scan = Rescan(options.Echo);
            var probe = Probe(false);
            await scan;
            if (!string.IsNullOrEmpty(options.Page)) NavigateTo(options.Page);
            // Opened by ShinawaseSetup.exe: go straight to the one-click install.
            if (options.Has("--first-run") && current != null && !current.Installed && sourceDir != null) OpenInstall();
            await probe;
            if (options.Get("--snapshot") != null) await SnapshotTour();
        }

        // ---- review mode ---------------------------------------------------------
        // --snapshot <dir> walks the UI (pages, sheet, themes, languages) and writes
        // PNGs for visual review; --snapshot-install also runs the install sheet.
        private void Snap(string name)
        {
            Snapshot.Save(RootGrid, options.Get("--snapshot"), name);
        }

        private async Task SnapshotTour()
        {
            await Task.Delay(1500);
            Snap("02-home");
            if (options.Has("--snapshot-update"))
            {
                if (heroState == "update")
                {
                    HeroPrimaryAction();
                    for (var i = 0; i < 80 && (installing || sheetView == "progress"); i++)
                    {
                        await Task.Delay(2000);
                        if (installing) Snap("u-progress-" + i.ToString("00", CultureInfo.InvariantCulture));
                    }
                    await Task.Delay(1800);
                    Snap("u-done");
                    HideSheet();
                    await Task.Delay(1200);
                    Snap("u-home-after");
                }
                Window.Close();
                return;
            }
            foreach (var pair in new[] { Tuple.Create(NavMods, "03-mods"), Tuple.Create(NavSteam, "04-steam"), Tuple.Create(NavSettings, "05-settings"), Tuple.Create(NavAbout, "06-about") })
            {
                pair.Item1.IsChecked = true;
                await Task.Delay(1500);
                Snap(pair.Item2);
            }
            NavSettings.IsChecked = true;
            await Task.Delay(900);
            PageSettings.ScrollToEnd();
            await Task.Delay(500);
            Snap("05b-settings-end");
            NavHome.IsChecked = true;
            await Task.Delay(900);
            OpenSheet("install", current != null && current.Installed ? "repair" : "install", "select");
            await Task.Delay(1100);
            Snap("07-sheet-select");
            SheetNextAction();
            await Task.Delay(1100);
            Snap("08-sheet-options");
            if (options.Has("--snapshot-install"))
            {
                SheetNextAction();
                for (var i = 0; i < 60 && (installing || sheetView == "progress"); i++)
                {
                    await Task.Delay(2500);
                    if (installing) Snap("09-progress-" + i.ToString("00", CultureInfo.InvariantCulture));
                }
                await Task.Delay(1800);
                Snap("10-done");
            }
            HideSheet();
            await Task.Delay(800);
            Toast(L.T("toast.saved"), "success");
            var dialog = ShowDialog("", "warning", L.T("echoRunning.title"), L.F("echoRunning.body", 1), L.T("echoRunning.confirm"), L.T("cancel"), false);
            await Task.Delay(1000);
            Snap("11-dialog-toast");
            DialogSecondary.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
            await dialog;
            SetTheme(IsDark() ? "light" : "dark");
            await Task.Delay(1000);
            Snap("12-home-theme2");
            NavMods.IsChecked = true;
            await Task.Delay(1400);
            Snap("13-mods-theme2");
            NavSettings.IsChecked = true;
            await Task.Delay(1400);
            Snap("14-settings-theme2");
            SetLocale(L.Locale == "zh" ? "en" : "zh");
            NavHome.IsChecked = true;
            await Task.Delay(1400);
            Snap("15-home-lang2");
            NavSteam.IsChecked = true;
            await Task.Delay(1400);
            Snap("16-steam-lang2");
            Window.Close();
        }

        // The loader's own self-update replaces ShinawaseLoader/manager/*.cs but
        // not this binary; rebuild it in the background when the sources moved on.
        private async void RefreshInstalledManager()
        {
            try
            {
                var self = Assembly.GetEntryAssembly().Location;
                var selfDir = IOPath.GetDirectoryName(self);
                if (!Paths.Same(selfDir, sourceDir) && !(AppInstall.RunningAsApp && Paths.Same(selfDir, IOPath.GetDirectoryName(sourceDir)))) return;
                var updated = await Task.Run(() => ManagerBuild.Deploy(IOPath.Combine(sourceDir, "manager"), self));
                if (updated) Toast(L.T("toast.managerUpdated"), "accent");
            }
            catch (Exception error) { Log.Warn("manager refresh: " + error.Message); }
        }

        private async void OnClosing(object sender, CancelEventArgs e)
        {
            if (!installing) { SystemEvents.UserPreferenceChanged -= OnSystemPreference; return; }
            e.Cancel = true;
            if (await ConfirmCancelInstall())
            {
                if (installCts != null) installCts.Cancel();
            }
        }

        private void OnSystemPreference(object sender, UserPreferenceChangedEventArgs e)
        {
            if (prefs.Theme != "system") return;
            Window.Dispatcher.BeginInvoke(new Action(() => ApplyTheme(true)));
        }

        private void OnKey(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
            {
                if (DialogLayer.Visibility == Visibility.Visible) { DialogSecondary.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent)); e.Handled = true; }
                else if (SheetLayer.Visibility == Visibility.Visible) { CloseSheetRequested(); e.Handled = true; }
            }
            else if (e.Key == Key.Enter && DialogLayer.Visibility == Visibility.Visible)
            {
                DialogPrimary.RaiseEvent(new RoutedEventArgs(ButtonBase.ClickEvent));
                e.Handled = true;
            }
        }

        // ---- navigation & page motion ------------------------------------------
        private void NavigateTo(string page)
        {
            switch ((page ?? "").ToLowerInvariant())
            {
                case "mods": NavMods.IsChecked = true; break;
                case "steam": NavSteam.IsChecked = true; break;
                case "settings": NavSettings.IsChecked = true; break;
                case "about": NavAbout.IsChecked = true; break;
                default: NavHome.IsChecked = true; break;
            }
        }

        private void ShowPage(RadioButton button)
        {
            FrameworkElement next;
            if (!navMap.TryGetValue(button, out next) || next == currentPage) return;
            MoveNavIndicator(button, true);
            var previous = currentPage;
            currentPage = next;
            if (previous != null)
            {
                previous.IsHitTestVisible = false;
                Anim.Run(previous, UIElement.OpacityProperty, 0, 130, Anim.Cubic, 0, () =>
                {
                    if (currentPage != previous) previous.Visibility = Visibility.Collapsed;
                });
            }
            next.Visibility = Visibility.Visible;
            next.IsHitTestVisible = true;
            Anim.Set(next, UIElement.OpacityProperty, 1);
            var viewer = next as ScrollViewer;
            if (viewer != null) viewer.ScrollToVerticalOffset(0);
            StaggerPage(next, 70);
            if (next == PageMods) RefreshMods();
            if (next == PageSteam) RefreshSteam();
        }

        private void StaggerPage(FrameworkElement page, int delay)
        {
            var viewer = page as ScrollViewer;
            var stack = viewer == null ? null : viewer.Content as Panel;
            if (stack == null) return;
            var index = 0;
            foreach (UIElement child in stack.Children)
            {
                if (child.Visibility != Visibility.Visible) continue;
                Anim.Enter(child, 0, 16, delay + Math.Min(index, 7) * 38, 520);
                index++;
            }
        }

        private void MoveNavIndicator(RadioButton button, bool animate)
        {
            if (!button.IsLoaded) return;
            var y = button.TranslatePoint(new Point(0, 0), NavPanel).Y;
            if (!animate) Anim.Set(NavIndicatorTT, TranslateTransform.YProperty, y);
            else Anim.Run(NavIndicatorTT, TranslateTransform.YProperty, y, 420, Anim.Spring);
        }

        // Crossfades from a snapshot of the old look to the new one.
        private void Crossfade(Action change)
        {
            if (!Anim.Enabled || !Window.IsLoaded || RootGrid.ActualWidth < 1)
            {
                change();
                return;
            }
            var dpi = VisualTreeHelper.GetDpi(RootGrid);
            var width = (int)Math.Ceiling(RootGrid.ActualWidth * dpi.DpiScaleX);
            var height = (int)Math.Ceiling(RootGrid.ActualHeight * dpi.DpiScaleY);
            var bitmap = new RenderTargetBitmap(width, height, dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32);
            bitmap.Render(RootGrid);
            var snapshot = new Image { Source = bitmap, Stretch = Stretch.Fill, IsHitTestVisible = false };
            Grid.SetColumnSpan(snapshot, 2);
            RootGrid.Children.Add(snapshot);
            change();
            Anim.Run(snapshot, UIElement.OpacityProperty, 0, 340, Anim.InOut, 30, () => RootGrid.Children.Remove(snapshot));
        }

        private void AmbientMotion()
        {
            foreach (var pair in new[] { Tuple.Create(HeroOrb1, 9.0, 26.0), Tuple.Create(HeroOrb2, 7.0, -20.0) })
            {
                var shift = Anim.Shift(pair.Item1);
                if (!Anim.Enabled)
                {
                    Anim.Set(shift, TranslateTransform.XProperty, 0);
                    Anim.Set(shift, TranslateTransform.YProperty, 0);
                    continue;
                }
                var dx = new DoubleAnimation(0, pair.Item3, TimeSpan.FromSeconds(pair.Item2)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = Anim.InOut };
                var dy = new DoubleAnimation(0, pair.Item3 * 0.6, TimeSpan.FromSeconds(pair.Item2 * 1.3)) { AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = Anim.InOut };
                shift.BeginAnimation(TranslateTransform.XProperty, dx);
                shift.BeginAnimation(TranslateTransform.YProperty, dy);
            }
        }

        private void LogoBusy(bool on)
        {
            var index = 0;
            foreach (FrameworkElement bar in LogoBars.Children)
            {
                var scale = bar.RenderTransform as ScaleTransform;
                if (scale == null) continue;
                if (!on || !Anim.Enabled)
                {
                    Anim.Run(scale, ScaleTransform.ScaleYProperty, 1, 260, Anim.Cubic);
                    index++;
                    continue;
                }
                var bounce = new DoubleAnimation(1, 0.35 + 0.1 * (index % 2), TimeSpan.FromMilliseconds(380 + 90 * index))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = Anim.InOut,
                    BeginTime = TimeSpan.FromMilliseconds(70 * index),
                };
                scale.BeginAnimation(ScaleTransform.ScaleYProperty, bounce);
                index++;
            }
        }

        private void SwapText(TextBlock block, string text)
        {
            if (block.Text == text) return;
            if (!Anim.Enabled || !block.IsLoaded) { block.Text = text; return; }
            Anim.Run(block, UIElement.OpacityProperty, 0, 110, Anim.Cubic, 0, () =>
            {
                block.Text = text;
                Anim.Run(block, UIElement.OpacityProperty, 1, 220, Anim.Cubic);
            });
        }

        // ---- theme & language ----------------------------------------------------
        private void SetTheme(string theme)
        {
            prefs.Theme = theme;
            prefs.Save();
            SyncRadios();
            ApplyTheme(true);
        }

        private void ApplyTheme(bool animate)
        {
            Action change = () => Theme.Apply(Application.Current.Resources, IsDark());
            if (animate) Crossfade(change); else change();
        }

        private void SetLocale(string locale)
        {
            if (syncingRadios || L.Locale == locale) { SyncRadios(); return; }
            Crossfade(() =>
            {
                L.Locale = locale;
                L.Publish(Application.Current.Resources);
                Selection.Update(new Dictionary<string, object> { { "locale", locale } });
                if (current != null && current.Installed)
                {
                    var path = IOPath.Combine(current.LoaderRoot, "loader.config.json");
                    var config = Json.TryReadObject(path);
                    if (config != null) { config["locale"] = locale; try { Json.WriteObject(path, config); } catch { } }
                }
                foreach (var target in targets) target.Relabel();
                foreach (var step in installer.Steps) step.Relabel();
                foreach (var package in wizardPackages.Concat(bundled)) package.Relabel();
                if (steam != null) foreach (var account in steam.Accounts) account.Relabel();
                net.Relabel();
                SyncRadios();
                heroState = null;
                UpdateAll();
                UpdateSteamView();
                if (SheetLayer.Visibility == Visibility.Visible) UpdateSheetHeader();
            });
        }

        // ---- data refresh ------------------------------------------------------------
        private async Task Rescan(string hint)
        {
            scanning = true;
            UpdateHero();
            List<EchoTarget> found;
            try { found = await Task.Run(() => Discovery.Scan(hint)); }
            catch (Exception error) { Log.Warn("scan: " + error.Message); found = new List<EchoTarget>(); }
            if (RunningFromInstall)
            {
                var root = IOPath.GetDirectoryName(sourceDir);
                if (!found.Any(t => Paths.Same(t.Root, root)))
                {
                    var extra = await Task.Run(() => Discovery.Scan(root));
                    found.AddRange(extra.Where(t => !found.Any(f => Paths.Same(f.ExePath, t.ExePath))));
                }
            }
            targets = found;
            scanning = false;
            EchoTarget pick = null;
            if (!string.IsNullOrEmpty(hint)) pick = found.FirstOrDefault(t => Paths.Same(t.ExePath, hint) || Paths.Same(t.Root, hint));
            if (pick == null && current != null) pick = found.FirstOrDefault(t => Paths.Same(t.ExePath, current.ExePath));
            if (pick == null && RunningFromInstall) pick = found.FirstOrDefault(t => Paths.Same(t.Root, IOPath.GetDirectoryName(sourceDir)));
            if (pick == null) pick = Discovery.Preferred(found);
            SetCurrent(pick);
        }

        private void SetCurrent(EchoTarget target)
        {
            current = target;
            foreach (var t in targets) t.IsSelected = t == target;
            run = new RunStatus();
            UpdateAll();
            RefreshStatus();
            RefreshSteam();
            if (currentPage == PageMods) RefreshMods();
        }

        private async void RefreshStatus()
        {
            if (statusBusy || current == null) return;
            statusBusy = true;
            try
            {
                var target = current;
                var status = await Lifecycle.StatusAsync(target);
                if (target != current) return;
                var changed = status.ModdedRunning != run.ModdedRunning || status.StockRunning != run.StockRunning || status.Cdp != run.Cdp;
                run = status;
                if (changed)
                {
                    UpdateHero();
                    UpdateRunTile();
                    UpdateSidebar();
                }
            }
            catch (Exception error) { Log.Warn("status: " + error.Message); }
            finally { statusBusy = false; }
        }

        private async Task Probe(bool announce)
        {
            SetReprobeSpin.Visibility = Visibility.Visible;
            SetReprobeBody.Opacity = 0;
            UpdateTiles();
            try
            {
                if (sourceInfo != null) await net.ProbeAllAsync(sourceInfo.NodeVersion);
            }
            catch (Exception error) { Log.Warn("probe: " + error.Message); }
            SetReprobeSpin.Visibility = Visibility.Collapsed;
            SetReprobeBody.Opacity = 1;
            UpdateAll();
            if (announce || (prefs.AutoCheck && !announced && current != null && current.Installed))
            {
                announced = true;
                var latest = RemoteVersion;
                if (UpdateAvailable) Toast(L.F("toast.updateFound", LatestVersion), "accent");
                else if (announce)
                {
                    if (latest == null) Toast(L.T("toast.checkFailed"), "warning");
                    else Toast(L.F("toast.upToDate", current != null && current.Installed ? current.LoaderVersion : latest), "success");
                }
            }
        }

        private string RemoteVersion { get { return (prefs.AutoCheck || manualCheck) ? net.RemoteVersion : null; } }

        private string LatestVersion
        {
            get
            {
                var local = sourceInfo == null ? null : sourceInfo.Version;
                var remote = RemoteVersion;
                if (remote == null) return local;
                if (local == null) return remote;
                return Versions.Compare(remote, local) >= 0 ? remote : local;
            }
        }

        private bool RemoteNewerThanSource
        {
            get { return RemoteVersion != null && (sourceInfo == null || Versions.Compare(RemoteVersion, sourceInfo.Version) > 0); }
        }

        private bool UpdateAvailable
        {
            get { return current != null && current.Installed && LatestVersion != null && Versions.Compare(LatestVersion, current.LoaderVersion) > 0; }
        }

        private void UpdateAll()
        {
            UpdateHero();
            UpdateTiles();
            UpdateSidebar();
            UpdateSettingsView();
            UpdateAboutView();
        }

        // ---- overview ------------------------------------------------------------------
        private string ComputeHeroState()
        {
            if (current == null) return scanning ? "scan" : "noEcho";
            if (!current.Installed) return "install";
            if (!current.Healthy) return "broken";
            if (run.ModdedRunning) return "running";
            if (UpdateAvailable) return "update";
            return "ready";
        }

        private void UpdateHero()
        {
            var state = ComputeHeroState();
            var changed = state != heroState;
            heroState = state;
            Action apply = () => ApplyHero(state);
            if (!changed || !Anim.Enabled || !HeroContent.IsLoaded) { apply(); return; }
            var shift = Anim.Shift(HeroContent);
            Anim.Run(HeroContent, UIElement.OpacityProperty, 0, 120, Anim.Cubic, 0, () =>
            {
                apply();
                Anim.Set(shift, TranslateTransform.YProperty, 10);
                Anim.Run(HeroContent, UIElement.OpacityProperty, 1, 260, Anim.Cubic);
                Anim.Run(shift, TranslateTransform.YProperty, 0, 420, Anim.Out);
            });
        }

        private void ApplyHero(string state)
        {
            string chip, title, sub, glyph, primary, secondary = null, dot;
            var primaryEnabled = true;
            switch (state)
            {
                case "scan":
                    chip = "…"; dot = "B.Text3"; title = L.T("hero.scan.title"); sub = L.T("hero.scan.sub"); glyph = ""; primary = L.T("btn.choose"); primaryEnabled = false; break;
                case "noEcho":
                    chip = L.T("chip.none"); dot = "B.Warning"; title = L.T("hero.noEcho.title"); sub = L.T("hero.noEcho.sub"); glyph = ""; primary = L.T("btn.choose"); secondary = L.T("btn.rescan"); break;
                case "install":
                    chip = L.T("chip.notInstalled"); dot = "B.Warning"; title = L.T("hero.install.title"); sub = L.T("hero.install.sub"); glyph = ""; primary = L.T("btn.install"); break;
                case "broken":
                    chip = L.T("chip.broken"); dot = "B.Danger"; title = L.T("hero.broken.title"); sub = L.T("hero.broken.sub"); glyph = ""; primary = L.T("btn.repair"); break;
                case "running":
                    chip = L.T("chip.running"); dot = "B.Success"; title = L.T("hero.running.title"); sub = L.T("hero.running.sub"); glyph = ""; primary = L.T("btn.openMods"); break;
                case "update":
                    chip = L.T("chip.update"); dot = "B.Accent"; title = L.F("hero.update.title", LatestVersion); sub = L.F("hero.update.sub", current.LoaderVersion); glyph = ""; primary = L.T("btn.update"); secondary = L.T("btn.launch"); break;
                default:
                    chip = L.F("chip.installed", "v" + current.LoaderVersion); dot = "B.Success"; title = L.T("hero.ready.title"); sub = L.T("hero.ready.sub"); glyph = ""; primary = L.T("btn.launch"); secondary = L.T("btn.repair"); break;
            }
            HeroChip.Text = chip;
            HeroDot.SetResourceReference(Shape.FillProperty, dot);
            HeroTitle.Text = title;
            HeroSub.Text = sub;
            HeroPrimaryIcon.Text = glyph;
            HeroPrimaryText.Text = launching ? L.T("btn.launching") : primary;
            HeroPrimary.IsEnabled = primaryEnabled && !launching && !installing;
            HeroPrimarySpin.Visibility = launching || state == "scan" ? Visibility.Visible : Visibility.Collapsed;
            HeroPrimaryBody.Opacity = launching || state == "scan" ? 0 : 1;
            HeroSecondary.Content = secondary;
            HeroSecondary.Visibility = secondary == null ? Visibility.Hidden : Visibility.Visible;
            HeroPathRow.Visibility = current == null ? Visibility.Collapsed : Visibility.Visible;
            HeroPath.Text = current == null ? "" : current.Root;
            HeroPath.ToolTip = current == null ? null : current.ExePath;
        }

        private void HeroPrimaryAction()
        {
            switch (heroState)
            {
                case "noEcho": OpenSheet("pick", "install", "select"); break;
                case "install": OpenInstall(); break;
                case "broken": OpenSheet("install", "repair", "options"); break;
                case "running": NavMods.IsChecked = true; break;
                case "update": StartUpdate(); break;
                case "ready": Launch(); break;
            }
        }

        private async void HeroSecondaryAction()
        {
            switch (heroState)
            {
                case "noEcho": await Rescan(null); break;
                case "update": Launch(); break;
                case "ready": OpenSheet("install", "repair", "options"); break;
            }
        }

        private void UpdateTiles()
        {
            // loader
            TileLoaderSpin.Visibility = net.Probing ? Visibility.Visible : Visibility.Collapsed;
            TileLoaderGlyph.Visibility = net.Probing ? Visibility.Collapsed : Visibility.Visible;
            if (current == null || !current.Installed) TileLoaderValue.Text = L.T("tile.loader.none");
            else TileLoaderValue.Text = "v" + current.LoaderVersion;
            string loaderSub;
            if (net.Probing) loaderSub = L.T("tile.loader.checking");
            else if (UpdateAvailable || (current != null && !current.Installed && LatestVersion != null)) loaderSub = L.F("tile.loader.remote", LatestVersion);
            else if (current != null && current.Installed && (RemoteVersion != null || LatestVersion != null)) loaderSub = L.T("tile.loader.latest");
            else loaderSub = net.RemoteChecked && RemoteVersion == null && prefs.AutoCheck ? L.T("tile.loader.offline") : " ";
            TileLoaderSub.Text = loaderSub;
            TileLoaderSub.SetResourceReference(TextBlock.ForegroundProperty, UpdateAvailable ? "B.Accent" : "B.Text2");
            // network
            TileNetValue.Text = net.Summary;
            TileNetSub.Text = net.SummarySub;
            UpdateRunTile();
            UpdateSteamTile();
        }

        private void UpdateRunTile()
        {
            string value, sub, dot;
            if (run.ModdedRunning && run.Cdp) { value = L.T("tile.run.on"); sub = L.T("tile.run.mods"); dot = "B.Success"; }
            else if (run.ModdedRunning) { value = L.T("tile.run.starting"); sub = L.T("tile.run.wait"); dot = "B.Warning"; }
            else if (run.StockRunning) { value = L.T("tile.run.on"); sub = L.T("tile.run.stock"); dot = "B.Warning"; }
            else { value = L.T("tile.run.off"); sub = current != null && current.Healthy ? L.T("tile.run.idle") : " "; dot = "B.Text3"; }
            TileRunValue.Text = value;
            TileRunSub.Text = sub;
            TileRunDot.SetResourceReference(Shape.FillProperty, dot);
        }

        private void UpdateSteamTile()
        {
            string value, sub, tone;
            if (steam == null) { value = "—"; sub = " "; tone = "accent"; }
            else if (!steam.Found) { value = L.T("tile.steam.na"); sub = L.T("tile.steam.noSteam"); tone = "muted"; }
            else if (string.IsNullOrEmpty(steam.AppId)) { value = L.T("tile.steam.na"); sub = L.T("tile.steam.noApp"); tone = "muted"; }
            else
            {
                var relevant = steam.Relevant;
                var set = relevant.Count(a => a.State == "set");
                if (relevant.Count > 0 && set == relevant.Count) { value = L.T("tile.steam.on"); sub = L.F("tile.steam.accounts", set); tone = "success"; }
                else if (set > 0) { value = L.T("tile.steam.partial"); sub = L.T("tile.steam.fix"); tone = "warning"; }
                else { value = L.T("tile.steam.off"); sub = current != null && current.Installed ? L.T("tile.steam.fix") : L.T("steam.status.noLoader"); tone = "warning"; }
            }
            TileSteamValue.Text = value;
            TileSteamSub.Text = sub;
            var bg = tone == "success" ? "B.SuccessSoft" : tone == "warning" ? "B.WarningSoft" : tone == "muted" ? "B.Surface2" : "B.AccentSoft";
            var fg = tone == "success" ? "B.Success" : tone == "warning" ? "B.Warning" : tone == "muted" ? "B.Text3" : "B.Accent";
            TileSteamBadge.SetResourceReference(Border.BackgroundProperty, bg);
            TileSteamIcon.SetResourceReference(TextBlock.ForegroundProperty, fg);
        }

        private void UpdateSidebar()
        {
            string text, sub, dot;
            var pulse = false;
            if (current == null) { text = L.T("chip.none"); sub = ""; dot = "B.Text3"; }
            else if (run.ModdedRunning && run.Cdp) { text = L.T("tile.run.on"); sub = L.T("tile.run.mods"); dot = "B.Success"; pulse = true; }
            else if (run.ModdedRunning || run.StockRunning) { text = run.ModdedRunning ? L.T("tile.run.starting") : L.T("tile.run.on"); sub = run.ModdedRunning ? L.T("tile.run.wait") : L.T("tile.run.stock"); dot = "B.Warning"; }
            else if (!current.Installed) { text = L.T("chip.notInstalled"); sub = current.EchoVersion == null ? "" : "ECHO " + current.EchoVersion; dot = "B.Warning"; }
            else { text = L.T("tile.run.off"); sub = "Loader v" + current.LoaderVersion + (current.EchoVersion == null ? "" : " · ECHO " + current.EchoVersion); dot = "B.Text3"; }
            SideStatus.Text = text;
            SideStatusSub.Text = sub;
            SideDot.SetResourceReference(Shape.FillProperty, dot);
            SideDotHalo.SetResourceReference(Shape.FillProperty, dot);
            var scale = (ScaleTransform)SideDotHalo.RenderTransform;
            if (pulse && Anim.Enabled)
            {
                var grow = new DoubleAnimation(0.6, 1.9, TimeSpan.FromSeconds(1.6)) { RepeatBehavior = RepeatBehavior.Forever, EasingFunction = Anim.Cubic };
                var fade = new DoubleAnimation(0.55, 0, TimeSpan.FromSeconds(1.6)) { RepeatBehavior = RepeatBehavior.Forever, EasingFunction = Anim.Cubic };
                scale.BeginAnimation(ScaleTransform.ScaleXProperty, grow);
                scale.BeginAnimation(ScaleTransform.ScaleYProperty, grow);
                SideDotHalo.BeginAnimation(UIElement.OpacityProperty, fade);
            }
            else
            {
                scale.BeginAnimation(ScaleTransform.ScaleXProperty, null);
                scale.BeginAnimation(ScaleTransform.ScaleYProperty, null);
                SideDotHalo.BeginAnimation(UIElement.OpacityProperty, null);
                SideDotHalo.Opacity = 0;
            }
        }

        // ---- launch ----------------------------------------------------------------------
        private async void Launch()
        {
            if (launching || current == null || !current.Healthy) return;
            var target = current;
            var status = await Lifecycle.StatusAsync(target);
            if (status.StockRunning && !await ConfirmCloseEcho(target)) return;
            launching = true;
            LogoBusy(true);
            UpdateHero();
            LaunchOutcome outcome;
            try { outcome = await Lifecycle.LaunchAsync(target, CancellationToken.None); }
            catch (Exception error) { outcome = new LaunchOutcome { Error = error.Message }; }
            launching = false;
            LogoBusy(false);
            if (outcome.Error != null) Toast(L.F("toast.launchError", outcome.Error), "danger");
            else if (outcome.AlreadyRunning) Toast(L.T("toast.alreadyRunning"), "info");
            else if (outcome.CdpReady) Toast(L.T("toast.launchOk"), "success");
            else Toast(L.F("toast.launchFail", outcome.Port, 120), "warning");
            UpdateHero();
            RefreshStatus();
        }

        private async Task<bool> ConfirmCloseEcho(EchoTarget target)
        {
            var processes = Lifecycle.EchoProcesses(target);
            var count = processes.Count;
            foreach (var p in processes) p.Dispose();
            if (count == 0) return true;
            var ok = await ShowDialog("", "warning", L.T("echoRunning.title"), L.F("echoRunning.body", count), L.T("echoRunning.confirm"), L.T("cancel"), false);
            if (!ok) return false;
            var closed = await Lifecycle.CloseEchoAsync(target);
            await Task.Delay(400);
            return closed;
        }

        private void RunLauncher(string name)
        {
            if (current == null || !current.Installed) return;
            try { Lifecycle.RunLauncher(current, name); }
            catch (Exception error) { Toast(L.F("toast.launchError", error.Message), "danger"); }
        }

        // ---- install sheet -------------------------------------------------------------------
        private void OpenInstall()
        {
            if (current == null || targets.Count > 1) OpenSheet("install", "install", "select");
            else OpenSheet("install", "install", "options");
        }

        private void OpenSheet(string purpose, string mode, string view)
        {
            if (sourceDir == null && purpose == "install")
            {
                Toast("ShinawaseLoader source folder not found next to the manager.", "danger");
                return;
            }
            sheetPurpose = purpose;
            sheetMode = mode;
            lastResult = null;
            TargetsList.ItemsSource = null;
            TargetsList.ItemsSource = targets;
            TargetsEmpty.Visibility = targets.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (current != null) foreach (var t in targets) t.IsSelected = Paths.Same(t.ExePath, current.ExePath);
            PrepareOptions();
            ShowSheet();
            SetView(view, 0);
        }

        private void InstallAllPackages()
        {
            if (installing || sheetView != "options") return;
            foreach (var package in wizardPackages) package.IsSelected = true;
            SheetNextAction();
        }

        private void PrepareOptions()
        {
            var target = SelectedTarget() ?? current;
            wizardPackages = Packages.Bundled();
            Packages.Resolve(wizardPackages, PackageDirs(), target);
            foreach (var package in wizardPackages)
            {
                package.IsSelected = sheetMode == "install" && target != null && !target.Installed ? true : package.IsInstalled;
            }
            PkgList.ItemsSource = wizardPackages;
            var remoteNewer = RemoteNewerThanSource;
            OptLatestRow.Visibility = remoteNewer ? Visibility.Visible : Visibility.Collapsed;
            OptLatest.IsChecked = remoteNewer;
            if (remoteNewer)
            {
                OptLatestTitle.Text = L.F("wiz.optLatest", RemoteVersion);
                OptLatestDesc.Text = L.F("wiz.optLatestDesc", sourceInfo == null ? "?" : sourceInfo.Version);
            }
            OptSteam.IsChecked = true;
            OptShortcut.IsChecked = true;
            OptDesktop.IsChecked = File.Exists(Shortcuts.DesktopPath());
            OptLaunch.IsChecked = sheetMode == "install";
            // An existing install keeps its edition; new installs start external.
            workshopZip = WorkshopPackage.Find(sourceDir);
            var edition = target != null && target.Installed && target.IsWorkshop ? "workshop" : "external";
            syncingRadios = true;
            OptEditionExternal.IsChecked = edition == "external";
            OptEditionWorkshop.IsChecked = edition == "workshop";
            syncingRadios = false;
            ApplyEdition(edition);
        }

        private void ApplyEdition(string edition)
        {
            wizardEdition = edition;
            var workshop = edition == "workshop";
            OptExternalOnly.Visibility = workshop ? Visibility.Collapsed : Visibility.Visible;
            OptIntegrationExternal.Visibility = workshop ? Visibility.Collapsed : Visibility.Visible;
            OptEditionDesc.Text = workshop
                ? (workshopZip == null ? L.T("wiz.editionWorkshopDesc") + " " + L.T("wiz.editionWorkshopDownload") : L.T("wiz.editionWorkshopDesc"))
                : L.T("wiz.editionExternalDesc");
        }

        private EchoTarget SelectedTarget()
        {
            return targets.FirstOrDefault(t => t.IsSelected);
        }

        private void ShowSheet()
        {
            SheetLayer.Visibility = Visibility.Visible;
            Anim.Run(SheetBackdrop, UIElement.OpacityProperty, 1, 240, Anim.Cubic);
            Anim.Run(SheetPanel, UIElement.OpacityProperty, 1, 260, Anim.Cubic, 40);
            Anim.Run(SheetScale, ScaleTransform.ScaleXProperty, 1, 460, Anim.Out, 40, null, 0.955);
            Anim.Run(SheetScale, ScaleTransform.ScaleYProperty, 1, 460, Anim.Out, 40, null, 0.955);
            Anim.Run(SheetShift, TranslateTransform.YProperty, 0, 460, Anim.Out, 40, null, 22);
        }

        private void HideSheet()
        {
            Anim.Run(SheetBackdrop, UIElement.OpacityProperty, 0, 220, Anim.Cubic);
            Anim.Run(SheetScale, ScaleTransform.ScaleXProperty, 0.97, 200, Anim.In);
            Anim.Run(SheetScale, ScaleTransform.ScaleYProperty, 0.97, 200, Anim.In);
            Anim.Run(SheetShift, TranslateTransform.YProperty, 12, 200, Anim.In);
            Anim.Run(SheetPanel, UIElement.OpacityProperty, 0, 180, Anim.Cubic, 0, () => SheetLayer.Visibility = Visibility.Collapsed);
        }

        private async void CloseSheetRequested()
        {
            if (installing)
            {
                if (await ConfirmCancelInstall() && installCts != null) installCts.Cancel();
                return;
            }
            HideSheet();
        }

        private Task<bool> ConfirmCancelInstall()
        {
            return ShowDialog("", "warning", L.T("wiz.cancel"), L.T("wiz.cancelConfirm"), L.T("wiz.cancel"), L.T("continue"), true);
        }

        private FrameworkElement ViewElement(string view)
        {
            switch (view)
            {
                case "select": return ViewSelect;
                case "options": return ViewOptions;
                case "progress": return ViewProgress;
                default: return ViewDone;
            }
        }

        private static int ViewIndex(string view)
        {
            switch (view)
            {
                case "select": return 0;
                case "options": return 1;
                case "progress": return 2;
                default: return 3;
            }
        }

        private void SetView(string view, int direction)
        {
            var previous = sheetView == null ? null : ViewElement(sheetView);
            var next = ViewElement(view);
            sheetView = view;
            if (previous != null && previous != next)
            {
                var outShift = Anim.Shift(previous);
                previous.IsHitTestVisible = false;
                Anim.Run(outShift, TranslateTransform.XProperty, -28 * direction, 220, Anim.In);
                Anim.Run(previous, UIElement.OpacityProperty, 0, 180, Anim.Cubic, 0, () =>
                {
                    if (sheetView == null || ViewElement(sheetView) != previous) previous.Visibility = Visibility.Collapsed;
                });
            }
            foreach (var other in new FrameworkElement[] { ViewSelect, ViewOptions, ViewProgress, ViewDone })
            {
                if (other != next && other != previous) other.Visibility = Visibility.Collapsed;
            }
            next.Visibility = Visibility.Visible;
            next.IsHitTestVisible = true;
            if (direction == 0) { Anim.Set(next, UIElement.OpacityProperty, 1); Anim.Set(Anim.Shift(next), TranslateTransform.XProperty, 0); }
            else Anim.Enter(next, 32 * direction, 0, 70, 420);
            UpdateSheetHeader();
            UpdateSheetFooter();
            var index = ViewIndex(view);
            var dots = SheetDots.Children.OfType<Border>().ToList();
            for (var i = 0; i < dots.Count; i++)
            {
                Anim.Run(dots[i], FrameworkElement.WidthProperty, i == index ? 22 : 6, 360, Anim.Out);
                dots[i].SetResourceReference(Border.BackgroundProperty, i <= index ? "B.Accent" : "B.BorderStrong");
                dots[i].Opacity = i < index ? 0.45 : 1;
            }
            SheetDots.Visibility = sheetPurpose == "pick" ? Visibility.Collapsed : Visibility.Visible;
        }

        private void UpdateSheetHeader()
        {
            string title, sub;
            switch (sheetView)
            {
                case "select": title = L.T("wiz.selectTitle"); sub = L.T("wiz.selectSub"); break;
                case "options": title = L.T("wiz.optionsTitle"); sub = L.T("wiz.optionsSub"); break;
                case "progress":
                    title = sheetMode == "update" ? L.T("wiz.updating") : sheetMode == "repair" ? L.T("wiz.repairing") : L.T("wiz.installing");
                    sub = L.T("wiz.progressSub");
                    break;
                default:
                    if (lastResult != null && lastResult.Ok) { title = sheetMode == "update" ? L.T("wiz.doneUpdate") : sheetMode == "repair" ? L.T("wiz.doneRepair") : L.T("wiz.doneInstall"); sub = L.F("wiz.doneSub", lastResult.LoaderVersion ?? "?"); }
                    else { title = L.T("wiz.failed"); sub = lastResult != null && lastResult.Cancelled ? L.T("wiz.cancelling") : " "; }
                    break;
            }
            SheetTitle.Text = title;
            SheetSub.Text = sub;
        }

        private void UpdateSheetFooter()
        {
            SheetAux.Visibility = Visibility.Collapsed;
            SheetBack.Visibility = Visibility.Visible;
            SheetNext.Visibility = Visibility.Visible;
            SheetNext.IsEnabled = true;
            SheetClose.IsEnabled = true;
            switch (sheetView)
            {
                case "select":
                    SheetBack.Content = L.T("wiz.cancel");
                    SheetNext.Content = sheetPurpose == "pick" ? L.T("ok") : L.T("wiz.next");
                    SheetNext.IsEnabled = SelectedTarget() != null;
                    break;
                case "options":
                    SheetBack.Content = targets.Count > 1 || current == null ? L.T("wiz.back") : L.T("wiz.cancel");
                    SheetNext.Content = sheetMode == "update" ? L.T("btn.update") : sheetMode == "repair" ? L.T("btn.repair") : L.T("wiz.install");
                    break;
                case "progress":
                    SheetAux.Visibility = Visibility.Visible;
                    SheetAux.Content = L.T("wiz.showLog");
                    SheetBack.Content = L.T("wiz.cancel");
                    SheetNext.Visibility = Visibility.Collapsed;
                    break;
                default:
                    SheetAux.Visibility = Visibility.Visible;
                    SheetAux.Content = L.T("wiz.copyLog");
                    if (lastResult != null && lastResult.Ok)
                    {
                        SheetBack.Content = L.T("wiz.launchNow");
                        SheetBack.Visibility = current != null && current.Healthy && !run.ModdedRunning ? Visibility.Visible : Visibility.Collapsed;
                        SheetNext.Content = L.T("wiz.done");
                    }
                    else
                    {
                        SheetBack.Content = L.T("wiz.close");
                        SheetNext.Content = lastResult != null && lastResult.AccessDenied ? L.T("wiz.adminRetry") : L.T("wiz.retry");
                    }
                    break;
            }
        }

        private void SheetBackAction()
        {
            switch (sheetView)
            {
                case "select": HideSheet(); break;
                case "options":
                    if (targets.Count > 1 || current == null) SetView("select", -1);
                    else HideSheet();
                    break;
                case "progress": CloseSheetRequested(); break;
                default:
                    HideSheet();
                    if (lastResult != null && lastResult.Ok) Launch();
                    break;
            }
        }

        private void SheetNextAction()
        {
            switch (sheetView)
            {
                case "select":
                    var picked = SelectedTarget();
                    if (picked == null) return;
                    if (sheetPurpose == "pick")
                    {
                        Selection.Update(new Dictionary<string, object> { { "echoExe", picked.ExePath } });
                        SetCurrent(picked);
                        HideSheet();
                        return;
                    }
                    PrepareOptions();
                    SetView("options", 1);
                    break;
                case "options": StartInstall(); break;
                case "progress": break;
                default:
                    if (lastResult != null && lastResult.Ok) { HideSheet(); return; }
                    if (lastResult != null && lastResult.AccessDenied) { RelaunchAsAdmin(); return; }
                    StartInstall();
                    break;
            }
        }

        private void SheetAuxAction()
        {
            if (sheetView == "progress")
            {
                logVisible = !logVisible;
                if (logVisible)
                {
                    LogPanel.Visibility = Visibility.Visible;
                    Anim.Run(LogPanel, UIElement.OpacityProperty, 1, 220, Anim.Cubic);
                    Anim.Run(StepsScroll, UIElement.OpacityProperty, 0, 160, Anim.Cubic);
                    LogBox.ScrollToEnd();
                }
                else
                {
                    Anim.Run(StepsScroll, UIElement.OpacityProperty, 1, 220, Anim.Cubic);
                    Anim.Run(LogPanel, UIElement.OpacityProperty, 0, 160, Anim.Cubic, 0, () => { if (!logVisible) LogPanel.Visibility = Visibility.Collapsed; });
                }
                return;
            }
            CopyText(installer.LogText);
            Toast(L.T("toast.logCopied"), "success");
        }

        private void BrowseTarget()
        {
            var dialog = new OpenFileDialog { Filter = L.T("wiz.browseFilter"), CheckFileExists = true, Title = L.T("wiz.selectTitle") };
            if (current != null) dialog.InitialDirectory = current.Root;
            if (dialog.ShowDialog(Window) != true) return;
            if (!Discovery.IsEchoExe(dialog.FileName)) { Toast(L.T("wiz.notEcho"), "warning"); return; }
            var target = targets.FirstOrDefault(t => Paths.Same(t.ExePath, dialog.FileName));
            if (target == null)
            {
                target = EchoTarget.FromExe(dialog.FileName);
                targets.Insert(0, target);
            }
            foreach (var t in targets) t.IsSelected = t == target;
            TargetsList.ItemsSource = null;
            TargetsList.ItemsSource = targets;
            TargetsEmpty.Visibility = Visibility.Collapsed;
            UpdateSheetFooter();
        }

        private bool launchAfterInstall;

        private void StartUpdate()
        {
            if (current == null) return;
            sheetPurpose = "install";
            sheetMode = "update";
            foreach (var t in targets) t.IsSelected = t == current;
            PrepareOptions();
            OptLaunch.IsChecked = false;
            ShowSheet();
            sheetView = null;
            StartInstall();
        }

        private async void StartInstall()
        {
            var target = SelectedTarget() ?? current;
            if (target == null || installing) return;
            if (!await ConfirmCloseEcho(target))
            {
                if (sheetView == null) HideSheet();
                return;
            }
            var plan = new InstallPlan
            {
                Target = target,
                SourceDir = sourceDir,
                UseRemote = OptLatestRow.Visibility == Visibility.Visible && OptLatest.IsChecked == true,
                RemoteVersion = RemoteVersion,
                Packages = wizardPackages,
                StartMenu = OptShortcut.IsChecked == true,
                Desktop = OptDesktop.IsChecked == true,
                SetSteam = OptSteam.IsChecked == true,
                Mode = sheetMode ?? "install",
                PackageDirs = PackageDirs(),
                Edition = wizardEdition,
                WorkshopZip = workshopZip,
                Launch = OptLaunch.IsChecked == true,
            };
            if (plan.Edition == "workshop")
            {
                // No bundled zip: the newest one comes from the mirror or GitHub.
                plan.UseRemote = plan.UseRemote || workshopZip == null;
                plan.SetSteam = false;
            }
            // The Workshop run switches ECHO to the Mods runtime itself.
            launchAfterInstall = OptLaunch.IsChecked == true && plan.Edition != "workshop";
            lastPlan = plan;
            lastResult = null;
            installer.Prepare(plan);
            StepsList.ItemsSource = installer.Steps;
            LogBox.Text = "";
            logVisible = false;
            LogPanel.Visibility = Visibility.Collapsed;
            Anim.Set(LogPanel, UIElement.OpacityProperty, 0);
            Anim.Set(StepsScroll, UIElement.OpacityProperty, 1);
            Anim.Set(ProgressScale, ScaleTransform.ScaleXProperty, 0);
            ProgressPercent.Text = "0%";
            ProgressDetail.Text = " ";
            installing = true;
            SetView("progress", sheetView == null ? 0 : 1);
            LogoBusy(true);
            UpdateHero();
            StartProgressLoop();
            installCts = new CancellationTokenSource();
            InstallResult result;
            try { result = await installer.RunAsync(plan, installCts.Token); }
            catch (Exception error) { result = new InstallResult { Error = error.Message, FailedStep = "prepare" }; }
            installing = false;
            LogoBusy(false);
            lastResult = result;
            target.Refresh();
            if (result.Ok)
            {
                Anim.Run(ProgressScale, ScaleTransform.ScaleXProperty, 1, 380, Anim.Out);
                await Task.Delay(Anim.Enabled ? 520 : 0);
            }
            StopProgressLoop();
            if (result.Ok && !Paths.Same(target.ExePath, current == null ? null : current.ExePath)) current = target;
            if (result.Ok && AppInstall.RunningAsApp && installer.FetchedSource != null)
            {
                // Keep the app's bundled loader (its install source) as new as ECHO's.
                var fetched = installer.FetchedSource;
                var fetchedPackages = installer.FetchedPackages;
                try
                {
                    if (await Task.Run(() => AppInstall.RefreshPayload(AppInstall.SelfDir, fetched, fetchedPackages)))
                    {
                        ResolveSource();
                        RefreshInstalledManager();
                    }
                }
                catch (Exception error) { Log.Warn("app payload refresh: " + error.Message); }
            }
            ShowDone(result);
            UpdateAll();
            RefreshSteam();
            RefreshMods();
            RefreshStatus();
            if (result.ManagerUpdated && Paths.Same(Assembly.GetEntryAssembly().Location, IOPath.Combine(target.LoaderRoot, "ShinawaseManager.exe"))) Toast(L.T("toast.managerUpdated"), "accent");
            if (result.Ok && launchAfterInstall && !result.SteamPending)
            {
                launchAfterInstall = false;
                await Task.Delay(Anim.Enabled ? 700 : 0);
                AddSummaryRow("", L.T("btn.launching"), "B.Accent");
                Launch();
            }
        }

        private void StartProgressLoop()
        {
            if (Anim.Enabled)
            {
                var sweep = new DoubleAnimation(-140, Math.Max(400, ProgressTrack.ActualWidth), TimeSpan.FromSeconds(1.6)) { RepeatBehavior = RepeatBehavior.Forever, EasingFunction = Anim.InOut };
                SheenShift.BeginAnimation(TranslateTransform.XProperty, sweep);
                ProgressSheen.Visibility = Visibility.Visible;
            }
            double shown = -1;
            progressTimer = new DispatcherTimer(DispatcherPriority.Render) { Interval = TimeSpan.FromMilliseconds(60) };
            progressTimer.Tick += (s, e) =>
            {
                var target = installer.Overall;
                if (Math.Abs(target - shown) > 0.0005)
                {
                    shown = target;
                    Anim.Run(ProgressScale, ScaleTransform.ScaleXProperty, target, 500, Anim.Cubic);
                }
                ProgressPercent.Text = ((int)Math.Round(ProgressScale.ScaleX * 100)).ToString(CultureInfo.InvariantCulture) + "%";
                var active = installer.Steps.FirstOrDefault(step => step.State == StepState.Active);
                ProgressDetail.Text = active == null ? " " : (string.IsNullOrEmpty(active.Detail) ? active.Title : active.Detail);
            };
            progressTimer.Start();
        }

        private void StopProgressLoop()
        {
            if (progressTimer != null) progressTimer.Stop();
            SheenShift.BeginAnimation(TranslateTransform.XProperty, null);
            ProgressSheen.Visibility = Visibility.Collapsed;
            ProgressPercent.Text = ((int)Math.Round(installer.Overall * 100)).ToString(CultureInfo.InvariantCulture) + "%";
        }

        private void ShowDone(InstallResult result)
        {
            DoneSummary.Children.Clear();
            DoneSteamCard.Visibility = result.Ok && result.SteamPending ? Visibility.Visible : Visibility.Collapsed;
            DoneSteamCard.Opacity = 1;
            DoneSteamSpin.Visibility = Visibility.Collapsed;
            DoneSteamApplyText.Opacity = 1;
            DoneSteamApply.IsEnabled = true;
            if (result.Ok)
            {
                DoneDisc.SetResourceReference(Shape.FillProperty, "B.Success");
                DoneHalo.SetResourceReference(Shape.FillProperty, "B.SuccessSoft");
                DoneCheck.Visibility = Visibility.Visible;
                DoneCross.Visibility = Visibility.Collapsed;
                DoneTitle.Text = sheetMode == "update" ? L.T("wiz.doneUpdate") : sheetMode == "repair" ? L.T("wiz.doneRepair") : L.T("wiz.doneInstall");
                DoneSub.Text = L.F("wiz.doneSub", result.LoaderVersion ?? "?");
                AddSummaryRow("", L.F("wiz.sumLoader", result.LoaderVersion ?? "?"), "B.Success");
                if (lastPlan != null && lastPlan.Edition == "workshop")
                {
                    AddSummaryRow("", result.WorkshopImported ? L.T("wiz.sumWorkshopImported") : L.T("wiz.sumWorkshopCurrent"), "B.Success");
                    AddSummaryRow("", result.Switched ? L.T("wiz.sumWorkshopSwitched") : L.T("wiz.sumWorkshopClosed"), result.Switched ? "B.Success" : "B.Text3");
                }
                else
                {
                    AddSummaryRow("", L.F("wiz.sumRuntime", result.EchoVersion ?? "?"), "B.Success");
                    AddSummaryRow("", L.T("wiz.sumHost"), "B.Success");
                    if (lastPlan != null && lastPlan.Packages.Any(p => p.IsSelected)) AddSummaryRow("", L.F("wiz.sumPackages", result.PackagesInstalled), "B.Success");
                    if (lastPlan != null && lastPlan.SetSteam)
                    {
                        if (result.SteamApplied) AddSummaryRow("", L.T("wiz.sumSteamOn"), "B.Success");
                        else if (result.SteamPending) AddSummaryRow("", L.T("wiz.sumSteamPending"), "B.Warning");
                        else AddSummaryRow("", L.T("wiz.sumSteamSkip"), "B.Text3");
                    }
                }
                foreach (var warning in result.Warnings) AddSummaryRow("", warning, "B.Warning");
            }
            else
            {
                DoneDisc.SetResourceReference(Shape.FillProperty, "B.Danger");
                DoneHalo.SetResourceReference(Shape.FillProperty, "B.DangerSoft");
                DoneCheck.Visibility = Visibility.Collapsed;
                DoneCross.Visibility = Visibility.Visible;
                DoneTitle.Text = result.Cancelled ? L.T("wiz.cancel") : L.T("wiz.failed");
                var stepTitle = result.FailedStep == null ? "?" : L.T("step." + result.FailedStep);
                DoneSub.Text = result.Cancelled ? L.T("wiz.cancelConfirm") : L.F("wiz.failedAt", stepTitle, result.AccessDenied ? L.F("admin.body", result.DeniedPath) : result.Error);
                foreach (var warning in result.Warnings) AddSummaryRow("", warning, "B.Warning");
            }
            DoneSummaryCard.Visibility = DoneSummary.Children.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            SetView("done", 1);
            // badge pop + check stroke
            Anim.Run(DoneScale, ScaleTransform.ScaleXProperty, 1, 560, Anim.Pop, 120, null, 0.4);
            Anim.Run(DoneScale, ScaleTransform.ScaleYProperty, 1, 560, Anim.Pop, 120, null, 0.4);
            Anim.Run(DoneHalo, UIElement.OpacityProperty, 1, 600, Anim.Cubic, 160, null, 0);
            Anim.Run(DoneCheck, Shape.StrokeDashOffsetProperty, 0, 520, Anim.Cubic, 360, null, 10);
            var rowIndex = 0;
            foreach (UIElement row in DoneSummary.Children) Anim.Enter(row, 0, 8, 420 + 60 * rowIndex++, 420);
        }

        private void AddSummaryRow(string glyph, string text, string brush)
        {
            var row = new Grid { Margin = new Thickness(0, 5, 0, 5) };
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition());
            var icon = new TextBlock { Text = glyph, FontFamily = (FontFamily)Window.FindResource("IconFont"), FontSize = 12, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 3, 0, 0) };
            icon.SetResourceReference(TextBlock.ForegroundProperty, brush);
            var label = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(12, 0, 0, 0), FontSize = 13 };
            label.SetResourceReference(TextBlock.ForegroundProperty, "B.Text");
            Grid.SetColumn(label, 1);
            row.Children.Add(icon);
            row.Children.Add(label);
            DoneSummary.Children.Add(row);
            DoneSummaryCard.Visibility = Visibility.Visible;
            if (sheetView == "done" && !installing) Anim.Enter(row, 0, 8, 0, 380);
        }

        private async Task DoneSteamApplyAction()
        {
            DoneSteamApply.IsEnabled = false;
            DoneSteamSpin.Visibility = Visibility.Visible;
            DoneSteamApplyText.Opacity = 0;
            var ok = await ApplySteamAsync(false, true);
            DoneSteamSpin.Visibility = Visibility.Collapsed;
            DoneSteamApplyText.Opacity = 1;
            DoneSteamApply.IsEnabled = true;
            if (ok)
            {
                Anim.Run(DoneSteamCard, UIElement.OpacityProperty, 0, 220, Anim.Cubic, 0, () => DoneSteamCard.Visibility = Visibility.Collapsed);
                AddSummaryRow("", L.T("wiz.sumSteamOn"), "B.Success");
                if (launchAfterInstall) { launchAfterInstall = false; Launch(); }
            }
        }

        private void RelaunchAsAdmin()
        {
            var self = Assembly.GetEntryAssembly().Location;
            var args = "--wait-mutex";
            if (sourceDir != null) args += " --source " + Proc.Quote(sourceDir);
            var target = SelectedTarget() ?? current;
            if (target != null) args += " --echo " + Proc.Quote(target.ExePath);
            try
            {
                Process.Start(new ProcessStartInfo(self, args) { UseShellExecute = true, Verb = "runas" });
                Window.Close();
            }
            catch (Win32Exception) { }
        }

        // ---- mods ------------------------------------------------------------------------------
        private async void RefreshMods()
        {
            var target = current;
            var installed = target != null && target.Installed;
            ModsNoLoader.Visibility = installed ? Visibility.Collapsed : Visibility.Visible;
            ModsContent.Visibility = installed ? Visibility.Visible : Visibility.Collapsed;
            ModsImport.IsEnabled = installed;
            ModsFolder.IsEnabled = target != null;
            if (!installed) { ModsList.ItemsSource = null; return; }
            List<ModVm> mods;
            try { mods = await Task.Run(() => LoaderOps.ReadMods(target)); }
            catch (Exception error) { Log.Warn("mods: " + error.Message); mods = new List<ModVm>(); }
            if (target != current) return;
            ModsList.ItemsSource = mods;
            ModsEmpty.Visibility = mods.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            bundled = Packages.Bundled();
            await Task.Run(() => Packages.Resolve(bundled, PackageDirs(), target));
            BundledList.ItemsSource = bundled;
        }

        private static T Ancestor<T>(DependencyObject start) where T : DependencyObject
        {
            for (var node = start; node != null; node = VisualTreeHelper.GetParent(node))
            {
                var hit = node as T;
                if (hit != null) return hit;
            }
            return null;
        }

        private async void OnModsClick(object sender, RoutedEventArgs e)
        {
            var source = e.OriginalSource as FrameworkElement;
            if (source == null) return;
            var vm = source.DataContext as ModVm;
            if (vm == null || current == null) return;
            var tag = source.Tag as string;
            if (tag == "toggle")
            {
                var box = source as CheckBox;
                var enable = box != null && box.IsChecked == true;
                vm.Busy = true;
                var result = await LoaderOps.RunAsync(current, null, CancellationToken.None, enable ? "enable" : "disable", vm.Id);
                vm.Busy = false;
                if (result.ExitCode == 0)
                {
                    vm.SetEnabled(enable);
                    Toast(L.F(enable ? "mods.enabled" : "mods.disabled", vm.Name), enable ? "success" : "info");
                }
                else
                {
                    vm.Reset();
                    Toast(L.F("mods.failed", result.Tail(2)), "danger");
                }
            }
            else if (tag == "remove")
            {
                if (!await ShowDialog("", "danger", L.F("mods.removeTitle", vm.Name), L.T("mods.removeBody"), L.T("mods.remove"), L.T("cancel"), true)) return;
                vm.Busy = true;
                var result = await LoaderOps.RunAsync(current, null, CancellationToken.None, "uninstall", vm.Id);
                if (result.ExitCode == 0) Toast(L.F("mods.removed", vm.Name), "info");
                else Toast(L.F("mods.failed", result.Tail(2)), "danger");
                RefreshMods();
            }
        }

        private async void OnBundledClick(object sender, RoutedEventArgs e)
        {
            var source = e.OriginalSource as FrameworkElement;
            var vm = source == null ? null : source.DataContext as PackageInfo;
            if (vm == null || current == null || !current.Installed || (source.Tag as string) != "install") return;
            vm.Busy = true;
            try
            {
                if (vm.LocalPath == null)
                {
                    var helper = IOPath.Combine(current.LoaderRoot, "manager", "manager-helper.mjs");
                    if (!File.Exists(helper) && sourceDir != null) helper = IOPath.Combine(sourceDir, "manager", "manager-helper.mjs");
                    var dest = IOPath.Combine(Paths.UserDataRoot, "staging-packages");
                    Fs.TryDelete(dest);
                    Directory.CreateDirectory(dest);
                    var args = new List<string> { helper, "fetch", "--no-loader", "--dest", dest, "--cache", IOPath.Combine(Paths.UserDataRoot, "update-cache"), "--packages", vm.Id };
                    args.AddRange(net.HelperMirrorArgs());
                    var fetched = await Proc.RunAsync(current.NodePath, args, dest, current.NodeEnv, 10 * 60 * 1000, null, CancellationToken.None);
                    if (fetched.ExitCode != 0) throw new InvalidOperationException(fetched.Tail(3));
                    Packages.Resolve(new List<PackageInfo> { vm }, PackageDirs(), current);
                    if (vm.LocalPath == null) throw new FileNotFoundException(vm.FileName);
                }
                await ImportFile(vm.LocalPath, vm.Name);
            }
            catch (Exception error) { Toast(L.F("mods.failed", error.Message), "danger"); }
            finally { vm.Busy = false; }
        }

        private void PickAndImport()
        {
            if (current == null || !current.Installed) return;
            var dialog = new OpenFileDialog { Filter = L.T("mods.importFilter"), Multiselect = true, CheckFileExists = true };
            if (dialog.ShowDialog(Window) != true) return;
            ImportFiles(dialog.FileNames);
        }

        private async void ImportFiles(IEnumerable<string> files)
        {
            foreach (var file in files) await ImportFile(file, null);
        }

        private async Task ImportFile(string file, string name)
        {
            if (current == null || !current.Installed) return;
            if (name == null)
            {
                var manifest = Packages.ReadManifest(file);
                name = manifest != null ? (manifest.Str("name") ?? manifest.Str("id")) : IOPath.GetFileNameWithoutExtension(file);
            }
            var result = await LoaderOps.RunAsync(current, null, CancellationToken.None, "import", file, "--enable");
            if (result.ExitCode == 0) Toast(L.F("mods.imported", name), "success");
            else Toast(L.F("mods.failed", result.Tail(2)), "danger");
            RefreshMods();
        }

        private static readonly string[] DropExtensions = { ".echomod", ".echo", ".zip" };

        private void OnDragOver(object sender, DragEventArgs e)
        {
            var files = e.Data.GetDataPresent(DataFormats.FileDrop) ? e.Data.GetData(DataFormats.FileDrop) as string[] : null;
            var ok = files != null && current != null && current.Installed && !installing && files.Any(f => DropExtensions.Contains(IOPath.GetExtension(f).ToLowerInvariant()));
            e.Effects = ok ? DragDropEffects.Copy : DragDropEffects.None;
            e.Handled = true;
            if (!ok) return;
            lastDragOver = DateTime.UtcNow;
            if (dropShown) return;
            dropShown = true;
            DropLayer.Visibility = Visibility.Visible;
            Anim.Run(DropLayer, UIElement.OpacityProperty, 1, 180, Anim.Cubic);
            Anim.Run(DropScale, ScaleTransform.ScaleXProperty, 1, 420, Anim.Pop, 0, null, 0.6);
            Anim.Run(DropScale, ScaleTransform.ScaleYProperty, 1, 420, Anim.Pop, 0, null, 0.6);
        }

        private async void OnDragLeave(object sender, DragEventArgs e)
        {
            var stamp = DateTime.UtcNow;
            await Task.Delay(90);
            if (lastDragOver > stamp) return;
            HideDrop();
        }

        private void HideDrop()
        {
            if (!dropShown) return;
            dropShown = false;
            Anim.Run(DropLayer, UIElement.OpacityProperty, 0, 160, Anim.Cubic, 0, () => { if (!dropShown) DropLayer.Visibility = Visibility.Collapsed; });
        }

        private void OnDrop(object sender, DragEventArgs e)
        {
            HideDrop();
            var files = e.Data.GetData(DataFormats.FileDrop) as string[];
            if (files == null || current == null || !current.Installed) return;
            var accepted = files.Where(f => DropExtensions.Contains(IOPath.GetExtension(f).ToLowerInvariant())).ToList();
            if (accepted.Count == 0) return;
            NavMods.IsChecked = true;
            ImportFiles(accepted);
        }

        // ---- steam -----------------------------------------------------------------------------
        private async void RefreshSteam()
        {
            var target = current;
            SteamInfo info;
            try { info = await Task.Run(() => Steam.Inspect(target == null ? null : target.Root)); }
            catch (Exception error) { Log.Warn("steam: " + error.Message); info = new SteamInfo(); }
            if (target != current) return;
            steam = info;
            UpdateSteamView();
            UpdateSteamTile();
        }

        private void UpdateSteamView()
        {
            var info = steam;
            SteamLine.Text = current == null ? "" : Steam.LaunchOptionsFor(current.Root);
            string title, sub, glyph, tone;
            var canApply = false;
            if (info == null) { title = "—"; sub = " "; glyph = ""; tone = "muted"; }
            else if (!info.Found) { title = L.T("steam.status.noSteam"); sub = L.T("steam.status.noSteamSub"); glyph = ""; tone = "muted"; }
            else if (current == null || string.IsNullOrEmpty(info.AppId)) { title = L.T("steam.status.noApp"); sub = L.T("steam.status.noAppSub"); glyph = ""; tone = "muted"; }
            else if (!current.Installed) { title = L.T("steam.status.noLoader"); sub = L.T("steam.status.noLoaderSub"); glyph = ""; tone = "warning"; }
            else
            {
                var relevant = info.Relevant;
                var set = relevant.Count(a => a.State == "set");
                canApply = true;
                if (relevant.Count > 0 && set == relevant.Count) { title = L.F("steam.status.on", set); sub = L.T("steam.status.onSub"); glyph = ""; tone = "success"; }
                else if (set > 0) { title = L.T("steam.status.partial"); sub = L.T("steam.status.offSub"); glyph = ""; tone = "warning"; }
                else { title = L.T("steam.status.off"); sub = L.T("steam.status.offSub"); glyph = ""; tone = "warning"; }
            }
            SteamTitle.Text = title;
            SteamSub.Text = sub;
            SteamGlyph.Text = glyph;
            SteamBadge.SetResourceReference(Border.BackgroundProperty, tone == "success" ? "B.SuccessSoft" : tone == "warning" ? "B.WarningSoft" : "B.Surface2");
            SteamGlyph.SetResourceReference(TextBlock.ForegroundProperty, tone == "success" ? "B.Success" : tone == "warning" ? "B.Warning" : "B.Text3");
            SteamApply.IsEnabled = canApply && !steamBusy;
            SteamRestore.IsEnabled = canApply && !steamBusy && info.Relevant.Any(a => a.State == "set" || prefs.SteamBackups.Obj(info.AppId) != null && prefs.SteamBackups.Obj(info.AppId).ContainsKey(a.AccountId));
            SteamAccounts.ItemsSource = info == null || string.IsNullOrEmpty(info.AppId) ? null : info.Relevant;
            SteamAccountsEmpty.Visibility = info != null && info.Found && info.Accounts.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            SteamInfoRoot.Text = info == null || info.Root == null ? "—" : info.Root;
            SteamInfoApp.Text = info == null || info.AppId == null ? "—" : info.AppId + (info.AppName == null ? "" : "  ·  " + info.AppName);
            SteamInfoRunning.Text = info == null || !info.Found ? "—" : (Steam.IsRunning(info) ? L.T("steam.running") : L.T("steam.notRunning"));
        }

        private async Task<bool> ApplySteamAsync(bool restore, bool quiet = false)
        {
            if (current == null || steamBusy) return false;
            steamBusy = true;
            SteamApplySpin.Visibility = Visibility.Visible;
            SteamApplyText.Opacity = 0;
            SteamApply.IsEnabled = false;
            SteamRestore.IsEnabled = false;
            var reopen = false;
            SteamInfo info = null;
            try
            {
                var target = current;
                info = await Task.Run(() => Steam.Inspect(target.Root));
                if (!info.Found || string.IsNullOrEmpty(info.AppId)) { Toast(L.T(!info.Found ? "steam.status.noSteam" : "steam.status.noApp"), "warning"); return false; }
                if (info.Accounts.Count == 0) { Toast(L.T("steam.noAccounts"), "warning"); return false; }
                if (Steam.IsRunning(info))
                {
                    if (!await ShowDialog("", "warning", L.T("steam.closeTitle"), L.T("steam.closeBody"), L.T("steam.closeConfirm"), L.T("cancel"), false)) return false;
                    Toast(L.T("steam.closing"), "info");
                    var closed = await Steam.ShutdownAsync(info, 45, CancellationToken.None);
                    if (!closed) { Toast(L.F("steam.closeFailed", 45), "danger"); return false; }
                    reopen = true;
                }
                var relevant = info.Relevant;
                var count = await Task.Run(() => restore ? Steam.Restore(info, relevant, target.Root, prefs) : Steam.Apply(info, relevant, target.Root, prefs));
                if (!quiet || restore) Toast(restore ? L.T("steam.restored") : L.F("steam.applied", count), "success");
                return true;
            }
            catch (Exception error)
            {
                Log.Warn("steam apply: " + error);
                Toast(L.F("steam.failed", error.Message), "danger");
                return false;
            }
            finally
            {
                if (reopen && info != null)
                {
                    Toast(L.T("steam.reopen"), "info");
                    Steam.Start(info);
                }
                steamBusy = false;
                SteamApplySpin.Visibility = Visibility.Collapsed;
                SteamApplyText.Opacity = 1;
                RefreshSteam();
            }
        }

        // ---- settings ---------------------------------------------------------------------------
        private void OnSourceClick(object sender, RoutedEventArgs e)
        {
            var source = e.OriginalSource as FrameworkElement;
            var vm = source == null ? null : source.DataContext as SourceInfo;
            if (vm == null || prefs.AutoMirror) return;
            Selection.Update(new Dictionary<string, object> { { "nodeMirror", vm.Id } });
            net.ApplySelection();
            UpdateTiles();
            Toast(L.T("toast.saved") + " · " + vm.Label, "success");
        }

        private void SetLoaderAutoUpdate(bool enabled)
        {
            if (current == null || !current.Installed) return;
            var path = IOPath.Combine(current.LoaderRoot, "loader.config.json");
            var config = Json.TryReadObject(path) ?? new JObject();
            config["autoUpdate"] = enabled;
            try { Json.WriteObject(path, config); Toast(L.T("toast.saved"), "success"); }
            catch (Exception error) { Toast(error.Message, "danger"); }
        }

        private void UpdateSettingsView()
        {
            var installed = current != null && current.Installed;
            SetLoaderAuto.IsEnabled = installed;
            SetLoaderAuto.IsChecked = installed && current.Config.Bool("autoUpdate") != false;
            SetOpenLoader.IsEnabled = current != null;
            SetDebug.IsEnabled = installed;
            SetSafe.IsEnabled = installed;
            SetUninstall.IsEnabled = installed && !installing;
            var local = installed ? "v" + current.LoaderVersion : L.T("tile.loader.none");
            SetVersionLine.Text = "Loader " + local;
            if (net.Probing) SetVersionSub.Text = L.T("tile.loader.checking");
            else if (UpdateAvailable) SetVersionSub.Text = L.F("tile.loader.remote", LatestVersion);
            else if (RemoteVersion != null) SetVersionSub.Text = L.T("tile.loader.latest") + "  ·  " + (net.RemoteVia ?? "");
            else SetVersionSub.Text = " ";
        }

        private void UpdateAboutView()
        {
            AboutVersion.Text = "Shinawase Manager " + BuildInfo.Version;
            AboutManager.Text = "v" + BuildInfo.Version;
            AboutInstalled.Text = current != null && current.Installed ? "v" + current.LoaderVersion : "—";
            AboutRemote.Text = LatestVersion != null ? "v" + LatestVersion : "—";
        }

        private async Task UninstallAsync()
        {
            if (current == null || !current.Installed) return;
            var target = current;
            var body = new StackPanel();
            var text = new TextBlock { Text = L.T("uninstall.body"), TextWrapping = TextWrapping.Wrap, FontSize = 13.5 };
            text.SetResourceReference(TextBlock.ForegroundProperty, "B.Text2");
            body.Children.Add(text);
            var row = new Grid { Margin = new Thickness(0, 16, 0, 0) };
            row.ColumnDefinitions.Add(new ColumnDefinition());
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.Children.Add(new TextBlock { Text = L.T("uninstall.steam"), VerticalAlignment = VerticalAlignment.Center, FontWeight = FontWeights.SemiBold });
            var restore = new CheckBox { Style = (Style)Window.FindResource("Switch"), IsChecked = true };
            Grid.SetColumn(restore, 1);
            row.Children.Add(restore);
            body.Children.Add(row);
            if (!await ShowDialog("", "danger", L.T("uninstall.title"), body, L.T("uninstall.confirm"), L.T("cancel"), true)) return;
            if (!await ConfirmCloseEcho(target)) return;
            if (restore.IsChecked == true && steam != null && steam.Found && steam.AppId != null && steam.Relevant.Any(a => a.State == "set"))
            {
                await ApplySteamAsync(true);
            }
            LogoBusy(true);
            try
            {
                await Task.Run(() => Lifecycle.Uninstall(target));
                Toast(L.T("toast.uninstalled"), "success");
            }
            catch (Exception error)
            {
                Log.Error("uninstall: " + error);
                Toast(L.F("uninstall.failed", error.Message), "danger");
            }
            LogoBusy(false);
            target.Refresh();
            UpdateAll();
            RefreshMods();
            RefreshSteam();
        }

        // ---- dialogs & toasts --------------------------------------------------------------
        private Task<bool> ShowConsentAsync()
        {
            var body = new StackPanel();
            foreach (var key in new[] { "s.consent.boundary", "s.consent.rules", "s.consent.packages" })
            {
                var row = new Grid { Margin = new Thickness(0, 0, 0, 10) };
                row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
                row.ColumnDefinitions.Add(new ColumnDefinition());
                var bullet = new Ellipse { Width = 6, Height = 6, VerticalAlignment = VerticalAlignment.Top, Margin = new Thickness(0, 7, 0, 0) };
                bullet.SetResourceReference(Shape.FillProperty, "B.Accent");
                var text = new TextBlock { TextWrapping = TextWrapping.Wrap, Margin = new Thickness(12, 0, 0, 0), FontSize = 13.5 };
                text.SetResourceReference(TextBlock.TextProperty, key);
                text.SetResourceReference(TextBlock.ForegroundProperty, "B.Text");
                Grid.SetColumn(text, 1);
                row.Children.Add(bullet);
                row.Children.Add(text);
                body.Children.Add(row);
            }
            var repeat = new TextBlock { Text = L.T("consent.repeat"), TextWrapping = TextWrapping.Wrap, FontSize = 12, Margin = new Thickness(0, 4, 0, 0) };
            repeat.SetResourceReference(TextBlock.ForegroundProperty, "B.Text3");
            body.Children.Add(repeat);
            return ShowDialog("", "accent", L.T("consent.title"), body, L.T("consent.agree"), L.T("consent.decline"), false);
        }

        public Task<bool> ShowDialog(string glyph, string tone, string title, object body, string primary, string secondary, bool dangerous)
        {
            var previous = dialogChain;
            var tcs = new TaskCompletionSource<bool>();
            dialogChain = tcs.Task;
            previous.ContinueWith(_ => Window.Dispatcher.BeginInvoke(new Action(() => OpenDialog(glyph, tone, title, body, primary, secondary, dangerous, tcs))));
            return tcs.Task;
        }

        private void OpenDialog(string glyph, string tone, string title, object body, string primary, string secondary, bool dangerous, TaskCompletionSource<bool> tcs)
        {
            DialogGlyph.Text = glyph;
            var soft = tone == "danger" ? "B.DangerSoft" : tone == "warning" ? "B.WarningSoft" : tone == "success" ? "B.SuccessSoft" : "B.AccentSoft";
            var strong = tone == "danger" ? "B.Danger" : tone == "warning" ? "B.Warning" : tone == "success" ? "B.Success" : "B.Accent";
            DialogBadge.SetResourceReference(Border.BackgroundProperty, soft);
            DialogGlyph.SetResourceReference(TextBlock.ForegroundProperty, strong);
            DialogTitle.Text = title;
            if (body is string)
            {
                var text = new TextBlock { Text = (string)body, TextWrapping = TextWrapping.Wrap, FontSize = 13.5 };
                text.SetResourceReference(TextBlock.ForegroundProperty, "B.Text2");
                DialogBody.Content = text;
            }
            else DialogBody.Content = body;
            DialogPrimary.Content = primary;
            DialogPrimary.Style = (Style)Window.FindResource(dangerous ? "DangerSolid" : "Primary");
            DialogSecondary.Content = secondary;
            DialogSecondary.Visibility = secondary == null ? Visibility.Collapsed : Visibility.Visible;
            RoutedEventHandler onPrimary = null, onSecondary = null;
            Action<bool> close = value =>
            {
                DialogPrimary.Click -= onPrimary;
                DialogSecondary.Click -= onSecondary;
                Anim.Run(DialogBackdrop, UIElement.OpacityProperty, 0, 200, Anim.Cubic);
                Anim.Run(DialogScale, ScaleTransform.ScaleXProperty, 0.96, 180, Anim.In);
                Anim.Run(DialogScale, ScaleTransform.ScaleYProperty, 0.96, 180, Anim.In);
                Anim.Run(DialogPanel, UIElement.OpacityProperty, 0, 170, Anim.Cubic, 0, () =>
                {
                    DialogLayer.Visibility = Visibility.Collapsed;
                    tcs.TrySetResult(value);
                });
            };
            onPrimary = (s, e) => close(true);
            onSecondary = (s, e) => close(false);
            DialogPrimary.Click += onPrimary;
            DialogSecondary.Click += onSecondary;
            DialogLayer.Visibility = Visibility.Visible;
            Anim.Run(DialogBackdrop, UIElement.OpacityProperty, 1, 220, Anim.Cubic);
            Anim.Run(DialogPanel, UIElement.OpacityProperty, 1, 240, Anim.Cubic, 30);
            Anim.Run(DialogScale, ScaleTransform.ScaleXProperty, 1, 440, Anim.Spring, 30, null, 0.94);
            Anim.Run(DialogScale, ScaleTransform.ScaleYProperty, 1, 440, Anim.Spring, 30, null, 0.94);
            DialogPrimary.Focus();
        }

        public void Toast(string text, string tone)
        {
            if (string.IsNullOrWhiteSpace(text)) return;
            var accent = tone == "success" ? "B.Success" : tone == "danger" ? "B.Danger" : tone == "warning" ? "B.Warning" : tone == "accent" ? "B.Accent" : "B.Text3";
            var glyph = tone == "success" ? "" : tone == "danger" ? "" : tone == "warning" ? "" : tone == "accent" ? "" : "";
            var card = new Border { CornerRadius = new CornerRadius(12), Padding = new Thickness(14, 11, 16, 11), Margin = new Thickness(0, 10, 0, 0), MaxWidth = 440, HorizontalAlignment = HorizontalAlignment.Right, Cursor = Cursors.Hand };
            card.SetResourceReference(Border.BackgroundProperty, "B.ToastBg");
            card.Effect = new DropShadowEffect { BlurRadius = 24, ShadowDepth = 6, Direction = 270, Opacity = 0.28, Color = Colors.Black };
            var row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            row.ColumnDefinitions.Add(new ColumnDefinition());
            var badge = new Border { Width = 22, Height = 22, CornerRadius = new CornerRadius(11), VerticalAlignment = VerticalAlignment.Top };
            badge.SetResourceReference(Border.BackgroundProperty, accent);
            badge.Child = new TextBlock { Text = glyph, FontFamily = (FontFamily)Window.FindResource("IconFont"), FontSize = 11, Foreground = Brushes.White, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
            var label = new TextBlock { Text = text, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(11, 2, 0, 0), FontSize = 13 };
            label.SetResourceReference(TextBlock.ForegroundProperty, "B.ToastText");
            Grid.SetColumn(label, 1);
            row.Children.Add(badge);
            row.Children.Add(label);
            card.Child = row;
            while (ToastHost.Children.Count >= 4) ToastHost.Children.RemoveAt(0);
            ToastHost.Children.Add(card);
            Anim.Enter(card, 48, 0, 0, 460);
            var lifetime = TimeSpan.FromMilliseconds(Math.Min(9000, 3200 + text.Length * 45));
            var timer = new DispatcherTimer { Interval = lifetime };
            Action dismiss = () =>
            {
                timer.Stop();
                if (!ToastHost.Children.Contains(card)) return;
                var shift = Anim.Shift(card);
                Anim.Run(shift, TranslateTransform.XProperty, 40, 220, Anim.In);
                Anim.Run(card, UIElement.OpacityProperty, 0, 200, Anim.Cubic, 0, () => ToastHost.Children.Remove(card));
            };
            timer.Tick += (s, e) => dismiss();
            card.MouseLeftButtonUp += (s, e) => dismiss();
            card.MouseEnter += (s, e) => timer.Stop();
            card.MouseLeave += (s, e) => timer.Start();
            timer.Start();
        }

        // ---- shell helpers -------------------------------------------------------------------
        private void OpenFolder(string path)
        {
            try
            {
                if (!Directory.Exists(path)) Directory.CreateDirectory(path);
                Process.Start(new ProcessStartInfo("explorer.exe", Proc.Quote(path)) { UseShellExecute = true });
            }
            catch (Exception error) { Toast(error.Message, "danger"); }
        }

        private void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception error) { Toast(error.Message, "danger"); }
        }

        private void CopyText(string text)
        {
            for (var attempt = 0; attempt < 5; attempt++)
            {
                try { Clipboard.SetText(text ?? ""); return; }
                catch { Thread.Sleep(60); }
            }
        }
    }
}
