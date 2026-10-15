// Shinawase Manager: entry point, theme, animation helpers and the window
// controller. The window markup lives in MainWindow.xaml (embedded resource,
// loaded with XamlReader); this file only wires behavior to named elements.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;
using IOPath = System.IO.Path;

[assembly: AssemblyTitle("Shinawase Manager")]
[assembly: AssemblyProduct("Shinawase Manager")]
[assembly: AssemblyDescription("Shinawase Manager")]
[assembly: AssemblyCompany("ShinawaseLoader")]
[assembly: AssemblyVersion(Shinawase.Manager.BuildInfo.Version)]
[assembly: AssemblyFileVersion(Shinawase.Manager.BuildInfo.Version)]

namespace Shinawase.Manager
{
    public sealed class Options
    {
        public string Source;
        public string Echo;
        public string Headless;
        public string WriteIcon;
        public string Xaml;
        public string Page;
        public bool WaitMutex;
        public readonly Dictionary<string, string> Values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public readonly HashSet<string> Flags = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        public string Get(string name) { string value; return Values.TryGetValue(name, out value) ? value : null; }
        public bool Has(string name) { return Flags.Contains(name) || Values.ContainsKey(name); }

        public static Options Parse(string[] args)
        {
            var o = new Options();
            for (var i = 0; i < args.Length; i++)
            {
                var arg = args[i];
                if (!arg.StartsWith("--", StringComparison.Ordinal)) continue;
                var takesValue = i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal);
                if (arg == "--headless" && takesValue) { o.Headless = args[++i]; continue; }
                if (takesValue && arg != "--wait-mutex") { o.Values[arg] = args[++i]; continue; }
                o.Flags.Add(arg);
            }
            o.Source = o.Get("--source");
            o.Echo = o.Get("--echo");
            o.WriteIcon = o.Get("--write-icon");
            o.Xaml = o.Get("--xaml");
            o.Page = o.Get("--page");
            o.WaitMutex = o.Flags.Contains("--wait-mutex");
            return o;
        }
    }

    public static class Program
    {
        [STAThread]
        public static int Main(string[] args)
        {
            var options = Options.Parse(args);
            if (options.WriteIcon != null) { IconArt.WriteIco(options.WriteIcon); return 0; }
            if (options.Headless != null) return Headless.Run(options);

            var setup = options.Has("--uninstall-app") || AppInstall.ShouldRunSetup(options);
            var name = setup ? @"Local\ShinawaseSetup" : @"Local\ShinawaseManager";
            bool created;
            var mutex = new Mutex(true, name, out created);
            if (!created && options.WaitMutex)
            {
                try { created = mutex.WaitOne(15000); } catch (AbandonedMutexException) { created = true; }
            }
            if (!created)
            {
                try { EventWaitHandle.OpenExisting(name + ".Activate").Set(); } catch { }
                return 0;
            }
            var activate = new EventWaitHandle(false, EventResetMode.AutoReset, name + ".Activate");
            var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            MainController controller = null;
            app.DispatcherUnhandledException += (s, e) =>
            {
                Log.Error("unhandled: " + e.Exception);
                e.Handled = true;
                if (controller != null) controller.Toast(e.Exception.Message, "danger");
            };
            Window window;
            Action bringToFront;
            try
            {
                Ui.Prepare(app, options);
                if (setup)
                {
                    var installer = new SetupController(options);
                    window = installer.Window;
                    bringToFront = installer.BringToFront;
                }
                else
                {
                    controller = new MainController(options);
                    window = controller.Window;
                    bringToFront = controller.BringToFront;
                }
            }
            catch (Exception error)
            {
                Log.Error("startup: " + error);
                MessageBox.Show(error.Message, "Shinawase Manager", MessageBoxButton.OK, MessageBoxImage.Error);
                return 1;
            }
            var listener = new Thread(() =>
            {
                while (activate.WaitOne()) app.Dispatcher.BeginInvoke(bringToFront);
            }) { IsBackground = true };
            listener.Start();
            var code = app.Run(window);
            GC.KeepAlive(mutex);
            return code;
        }
    }

    // Loads the embedded XAML (or, with --xaml <dir|file>, the files on disk for
    // UI work without recompiling) and prepares the shared application resources:
    // Styles.xaml, theme brushes and localized strings must exist before any
    // window is parsed so StaticResource lookups resolve.
    public static class Ui
    {
        public static string XamlDir;

        public static object Load(string name)
        {
            if (!string.IsNullOrEmpty(XamlDir))
            {
                var path = IOPath.Combine(XamlDir, name);
                if (File.Exists(path))
                {
                    using (var stream = File.OpenRead(path)) return XamlReader.Load(stream);
                }
            }
            using (var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Shinawase.Manager." + name))
            {
                if (stream == null) throw new FileNotFoundException("embedded " + name + " is missing");
                return XamlReader.Load(stream);
            }
        }

        public static void Prepare(Application app, Options options)
        {
            if (!string.IsNullOrEmpty(options.Xaml)) XamlDir = Directory.Exists(options.Xaml) ? options.Xaml : IOPath.GetDirectoryName(options.Xaml);
            var prefs = Prefs.Load();
            Anim.Enabled = prefs.Motion;
            L.Locale = L.Detect();
            app.Resources.MergedDictionaries.Add((ResourceDictionary)Load("Styles.xaml"));
            Theme.Apply(app.Resources, Theme.IsDark(prefs));
            L.Publish(app.Resources);
        }
    }

    // ---- icon -----------------------------------------------------------------
    public static class IconArt
    {
        public static BitmapSource Render(int size)
        {
            var visual = new DrawingVisual();
            using (var dc = visual.RenderOpen())
            {
                double s = size;
                var gradient = new LinearGradientBrush(Color.FromRgb(0x8A, 0x6C, 0xF7), Color.FromRgb(0x4B, 0x55, 0xE8), new Point(0, 0), new Point(1, 1));
                var radius = s * 0.24;
                dc.DrawRoundedRectangle(gradient, null, new Rect(0, 0, s, s), radius, radius);
                var shine = new LinearGradientBrush(Color.FromArgb(0x30, 0xFF, 0xFF, 0xFF), Color.FromArgb(0x00, 0xFF, 0xFF, 0xFF), new Point(0, 0), new Point(0, 1));
                dc.DrawRoundedRectangle(shine, null, new Rect(0, 0, s, s * 0.55), radius, radius);
                var heights = new[] { 0.29, 0.53, 0.39, 0.21 };
                var bar = s * 0.094;
                var gap = s * 0.066;
                var total = heights.Length * bar + (heights.Length - 1) * gap;
                var x = (s - total) / 2;
                foreach (var h in heights)
                {
                    var bh = s * h;
                    dc.DrawRoundedRectangle(Brushes.White, null, new Rect(x, (s - bh) / 2, bar, bh), bar / 2, bar / 2);
                    x += bar + gap;
                }
            }
            var bitmap = new RenderTargetBitmap(size, size, 96, 96, PixelFormats.Pbgra32);
            bitmap.Render(visual);
            bitmap.Freeze();
            return bitmap;
        }

        // ICO with PNG-compressed frames. WPF rendering needs an STA thread.
        public static void WriteIco(string path)
        {
            Exception failure = null;
            var thread = new Thread(() =>
            {
                try
                {
                    var sizes = new[] { 256, 64, 48, 32, 24, 16 };
                    var frames = new List<byte[]>();
                    foreach (var size in sizes)
                    {
                        var encoder = new PngBitmapEncoder();
                        encoder.Frames.Add(BitmapFrame.Create(Render(size)));
                        using (var memory = new MemoryStream()) { encoder.Save(memory); frames.Add(memory.ToArray()); }
                    }
                    using (var stream = File.Create(path))
                    using (var writer = new BinaryWriter(stream))
                    {
                        writer.Write((short)0);
                        writer.Write((short)1);
                        writer.Write((short)sizes.Length);
                        var offset = 6 + 16 * sizes.Length;
                        for (var i = 0; i < sizes.Length; i++)
                        {
                            writer.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                            writer.Write((byte)(sizes[i] >= 256 ? 0 : sizes[i]));
                            writer.Write((byte)0);
                            writer.Write((byte)0);
                            writer.Write((short)1);
                            writer.Write((short)32);
                            writer.Write(frames[i].Length);
                            writer.Write(offset);
                            offset += frames[i].Length;
                        }
                        foreach (var frame in frames) writer.Write(frame);
                    }
                }
                catch (Exception error) { failure = error; }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            thread.Join();
            if (failure != null) throw failure;
        }
    }

    // ---- theme ----------------------------------------------------------------
    public static class Theme
    {
        public static bool IsDark(Prefs prefs)
        {
            if (prefs.Theme == "dark") return true;
            if (prefs.Theme == "light") return false;
            return SystemDark();
        }

        public static bool SystemDark()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    var value = key == null ? null : key.GetValue("AppsUseLightTheme");
                    return value is int && (int)value == 0;
                }
            }
            catch { return false; }
        }

        private static SolidColorBrush B(string hex)
        {
            var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
            brush.Freeze();
            return brush;
        }

        private static Brush Gradient(string from, string to, double x1, double y1, double x2, double y2)
        {
            var brush = new LinearGradientBrush((Color)ColorConverter.ConvertFromString(from), (Color)ColorConverter.ConvertFromString(to), new Point(x1, y1), new Point(x2, y2));
            brush.Freeze();
            return brush;
        }

        private static Brush Orb(string color)
        {
            var c = (Color)ColorConverter.ConvertFromString(color);
            var brush = new RadialGradientBrush(c, Color.FromArgb(0, c.R, c.G, c.B));
            brush.Freeze();
            return brush;
        }

        public static void Apply(ResourceDictionary r, bool dark)
        {
            var palette = dark ? new Dictionary<string, string>
            {
                { "B.Bg", "#0E1014" }, { "B.Sidebar", "#121419" }, { "B.Surface", "#171A20" }, { "B.Surface2", "#1D2027" },
                { "B.Border", "#252932" }, { "B.BorderStrong", "#363B47" }, { "B.Divider", "#1E2229" },
                { "B.Text", "#ECEEF2" }, { "B.Text2", "#A3AAB6" }, { "B.Text3", "#6F7684" },
                { "B.Accent", "#6470F3" }, { "B.AccentText", "#FFFFFF" }, { "B.AccentSoft", "#2A6470F3" },
                { "B.NavActive", "#1C1F27" }, { "B.NavActiveBorder", "#272B35" }, { "B.HoverOverlay", "#0EFFFFFF" },
                { "B.Success", "#3DCB80" }, { "B.SuccessSoft", "#243DCB80" }, { "B.Warning", "#F1AA3E" }, { "B.WarningSoft", "#24F1AA3E" },
                { "B.Danger", "#F25C6E" }, { "B.DangerSoft", "#26F25C6E" },
                { "B.Track", "#262A33" }, { "B.Knob", "#B9BFCB" }, { "B.Backdrop", "#A6060709" }, { "B.Scroll", "#40FFFFFF" },
                { "B.CodeBg", "#111318" }, { "B.ToastBg", "#262A34" }, { "B.ToastText", "#F2F3F6" }, { "B.ChipBg", "#14FFFFFF" },
                { "B.SegActive", "#2A2E38" }, { "B.HeroChip", "#1AFFFFFF" },
            } : new Dictionary<string, string>
            {
                { "B.Bg", "#F5F6F9" }, { "B.Sidebar", "#EDEFF4" }, { "B.Surface", "#FFFFFF" }, { "B.Surface2", "#F4F5F8" },
                { "B.Border", "#E3E6EC" }, { "B.BorderStrong", "#CDD2DB" }, { "B.Divider", "#E4E7ED" },
                { "B.Text", "#15171C" }, { "B.Text2", "#5A616D" }, { "B.Text3", "#8B919C" },
                { "B.Accent", "#4B55E8" }, { "B.AccentText", "#FFFFFF" }, { "B.AccentSoft", "#1A4B55E8" },
                { "B.NavActive", "#FFFFFF" }, { "B.NavActiveBorder", "#E1E4EB" }, { "B.HoverOverlay", "#0A000000" },
                { "B.Success", "#1C9B58" }, { "B.SuccessSoft", "#1C1C9B58" }, { "B.Warning", "#C47A0C" }, { "B.WarningSoft", "#22E3A33A" },
                { "B.Danger", "#D63A4F" }, { "B.DangerSoft", "#1CD63A4F" },
                { "B.Track", "#E1E4EA" }, { "B.Knob", "#FFFFFF" }, { "B.Backdrop", "#70141720" }, { "B.Scroll", "#38000000" },
                { "B.CodeBg", "#F6F7FA" }, { "B.ToastBg", "#1D2028" }, { "B.ToastText", "#FFFFFF" }, { "B.ChipBg", "#0C000000" },
                { "B.SegActive", "#FFFFFF" }, { "B.HeroChip", "#B3FFFFFF" },
            };
            foreach (var pair in palette) r[pair.Key] = B(pair.Value);
            r["B.Hero"] = dark ? Gradient("#22265A", "#171A20", 0, 0, 0.9, 1) : Gradient("#E8EAFF", "#FFFFFF", 0, 0, 0.9, 1);
            r["B.HeroOrb"] = Orb(dark ? "#3A6470F3" : "#2E7C6CF7");
            r["B.HeroOrb2"] = Orb(dark ? "#268A6CF7" : "#224B55E8");
            r["ShadowOpacity"] = dark ? 0.55 : 0.16;
        }
    }

    // ---- animation helpers --------------------------------------------------
    public static class Anim
    {
        public static bool Enabled = true;
        public static readonly IEasingFunction Out = Frozen(new QuinticEase { EasingMode = EasingMode.EaseOut });
        public static readonly IEasingFunction Cubic = Frozen(new CubicEase { EasingMode = EasingMode.EaseOut });
        public static readonly IEasingFunction InOut = Frozen(new CubicEase { EasingMode = EasingMode.EaseInOut });
        public static readonly IEasingFunction Spring = Frozen(new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.32 });
        public static readonly IEasingFunction Pop = Frozen(new BackEase { EasingMode = EasingMode.EaseOut, Amplitude = 0.8 });
        public static readonly IEasingFunction In = Frozen(new CubicEase { EasingMode = EasingMode.EaseIn });

        private static IEasingFunction Frozen(EasingFunctionBase ease) { ease.Freeze(); return ease; }

        public static void Run(IAnimatable target, DependencyProperty property, double to, int ms, IEasingFunction ease = null, int delay = 0, Action done = null, double? from = null)
        {
            if (!Enabled || ms <= 0)
            {
                target.BeginAnimation(property, null);
                ((DependencyObject)target).SetValue(property, to);
                if (done != null) done();
                return;
            }
            var animation = new DoubleAnimation
            {
                To = to,
                Duration = TimeSpan.FromMilliseconds(ms),
                EasingFunction = ease ?? Out,
                BeginTime = TimeSpan.FromMilliseconds(delay),
                FillBehavior = FillBehavior.HoldEnd,
            };
            if (from.HasValue) animation.From = from.Value;
            if (done != null) animation.Completed += (s, e) => done();
            target.BeginAnimation(property, animation, HandoffBehavior.SnapshotAndReplace);
        }

        public static void Set(IAnimatable target, DependencyProperty property, double value)
        {
            target.BeginAnimation(property, null);
            ((DependencyObject)target).SetValue(property, value);
        }

        public static TranslateTransform Shift(UIElement element)
        {
            var transform = element.RenderTransform as TranslateTransform;
            if (transform == null || transform.IsFrozen)
            {
                transform = new TranslateTransform();
                element.RenderTransform = transform;
            }
            return transform;
        }

        public static void Enter(UIElement element, double dx, double dy, int delay, int ms)
        {
            var shift = Shift(element);
            if (!Enabled)
            {
                Set(element, UIElement.OpacityProperty, 1);
                Set(shift, TranslateTransform.XProperty, 0);
                Set(shift, TranslateTransform.YProperty, 0);
                return;
            }
            Set(element, UIElement.OpacityProperty, 0);
            Set(shift, TranslateTransform.XProperty, dx);
            Set(shift, TranslateTransform.YProperty, dy);
            Run(element, UIElement.OpacityProperty, 1, (int)(ms * 0.75), Cubic, delay);
            Run(shift, TranslateTransform.XProperty, 0, ms, Out, delay);
            Run(shift, TranslateTransform.YProperty, 0, ms, Out, delay);
        }
    }

    // Wheel scrolling that glides instead of jumping three lines at a time.
    public sealed class SmoothScroll
    {
        private readonly ScrollViewer viewer;
        private double target;
        private bool running;

        public static void Attach(ScrollViewer viewer) { new SmoothScroll(viewer); }

        private SmoothScroll(ScrollViewer viewer)
        {
            this.viewer = viewer;
            viewer.PreviewMouseWheel += OnWheel;
        }

        private void OnWheel(object sender, MouseWheelEventArgs e)
        {
            if (viewer.ScrollableHeight <= 0) return;
            e.Handled = true;
            if (!Anim.Enabled)
            {
                viewer.ScrollToVerticalOffset(viewer.VerticalOffset - e.Delta);
                return;
            }
            if (!running) target = viewer.VerticalOffset;
            target = Math.Max(0, Math.Min(viewer.ScrollableHeight, target - e.Delta * 0.95));
            if (!running)
            {
                running = true;
                CompositionTarget.Rendering += Tick;
            }
        }

        private void Tick(object sender, EventArgs e)
        {
            var current = viewer.VerticalOffset;
            var next = current + (target - current) * 0.2;
            if (Math.Abs(target - next) < 0.6)
            {
                next = target;
                running = false;
                CompositionTarget.Rendering -= Tick;
            }
            viewer.ScrollToVerticalOffset(next);
        }
    }

    public static class Snapshot
    {
        public static void Save(FrameworkElement root, string dir, string name)
        {
            if (dir == null) return;
            try
            {
                Directory.CreateDirectory(dir);
                var dpi = VisualTreeHelper.GetDpi(root);
                var visual = new DrawingVisual();
                using (var dc = visual.RenderOpen()) dc.DrawRectangle(new VisualBrush(root), null, new Rect(0, 0, root.ActualWidth, root.ActualHeight));
                var bitmap = new RenderTargetBitmap((int)Math.Ceiling(root.ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(root.ActualHeight * dpi.DpiScaleY), dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32);
                bitmap.Render(visual);
                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(bitmap));
                using (var stream = File.Create(IOPath.Combine(dir, name + ".png"))) encoder.Save(stream);
            }
            catch (Exception error) { Log.Warn("snapshot " + name + ": " + error.Message); }
        }
    }

    public static class Native
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        public static void RoundCorners(Window window)
        {
            try
            {
                var hwnd = new WindowInteropHelper(window).Handle;
                var preference = 2; // DWMWCP_ROUND (Windows 11; ignored elsewhere)
                DwmSetWindowAttribute(hwnd, 33, ref preference, sizeof(int));
            }
            catch { }
        }
    }
}
