// Headless entry points for scripted checks of the manager engine. Output is
// one JSON object per line on stdout (attach a console or redirect it):
//   ShinawaseManager.exe --headless detect
//   ShinawaseManager.exe --headless probe
//   ShinawaseManager.exe --headless install --echo "<ECHO_ROOT>" [--packages a,b | --no-packages] [--steam] [--remote] [--no-probe]
//   ShinawaseManager.exe --headless steam-status --echo "<ECHO_ROOT>"
//   ShinawaseManager.exe --headless steam-apply --echo "<ECHO_ROOT>" [--restore]
//   ShinawaseManager.exe --headless uninstall --echo "<ECHO_ROOT>"
//   ShinawaseManager.exe --headless hash [--dir "<manager dir>"]
//   ShinawaseSetup.exe --headless app-install [--dir "<DIR>"] [--desktop] [--no-start-menu] [--no-register]
//   ShinawaseManager.exe --headless app-uninstall [--dir "<DIR>"]
// SHINAWASE_STEAM_ROOT points Steam detection at a fixture folder for tests.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace Shinawase.Manager
{
    public static class Headless
    {
        [DllImport("kernel32.dll")]
        private static extern bool AttachConsole(int processId);

        private static void Emit(JObject value)
        {
            Console.Out.WriteLine(Json.Stringify(value, false));
            Console.Out.Flush();
        }

        private static JObject Obj(params object[] pairs)
        {
            var result = new JObject();
            for (var i = 0; i + 1 < pairs.Length; i += 2) result[(string)pairs[i]] = pairs[i + 1];
            return result;
        }

        private static EchoTarget Target(Options options)
        {
            var hint = options.Echo;
            if (string.IsNullOrEmpty(hint)) throw new ArgumentException("--echo is required");
            if (File.Exists(hint)) return EchoTarget.FromExe(hint);
            var exe = Directory.Exists(hint) ? Directory.GetFiles(hint, "ECHO*.exe").FirstOrDefault(Discovery.IsEchoExe) : null;
            if (exe == null) throw new FileNotFoundException("No ECHO executable under " + hint);
            return EchoTarget.FromExe(exe);
        }

        private static string Source(Options options)
        {
            var exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            foreach (var dir in new[] { options.Source, exeDir, Path.Combine(exeDir, "ShinawaseLoader"), Path.Combine(Path.GetDirectoryName(exeDir) ?? exeDir, "ShinawaseLoader") })
            {
                if (!string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "ShinawaseLoader.mjs"))) return Paths.Full(dir);
            }
            throw new DirectoryNotFoundException("loader source not found; pass --source");
        }

        private static JObject Describe(EchoTarget t)
        {
            return Obj("exe", t.ExePath, "root", t.Root, "echoVersion", t.EchoVersion, "playtest", t.IsPlaytest, "rank", t.Rank, "loader", t.LoaderVersion, "host", t.HasHost, "runtime", t.HasRuntime);
        }

        public static int Run(Options options)
        {
            if (!Console.IsOutputRedirected) AttachConsole(-1);
            L.Locale = options.Get("--locale") ?? "en";
            try
            {
                switch (options.Headless)
                {
                    case "detect":
                        foreach (var target in Discovery.Scan(options.Echo)) Emit(Describe(target));
                        return 0;
                    case "hash":
                        Emit(Obj("hash", ManagerBuild.SourceHash(options.Get("--dir") ?? Path.Combine(Source(options), "manager")), "built", BuildInfo.SourceHash, "version", BuildInfo.Version));
                        return 0;
                    case "probe":
                        {
                            var net = new NetState(Prefs.Load());
                            var info = LoaderVersionInfo.Read(Source(options));
                            net.ProbeAllAsync(info.NodeVersion).GetAwaiter().GetResult();
                            foreach (var source in net.All) Emit(Obj("kind", source.Kind, "id", source.Id, "url", source.BaseUrl, "latency", source.Latency, "version", source.PeekVersion));
                            Emit(Obj("event", "result", "remote", net.RemoteVersion, "via", net.RemoteVia, "node", net.NodeCandidates(info.NodeVersion).Select(c => (object)c.Url).ToList()));
                            return 0;
                        }
                    case "install":
                        return Install(options);
                    case "steam-status":
                        {
                            var target = Target(options);
                            var steam = Steam.Inspect(target.Root);
                            Emit(Obj("steamRoot", steam.Root, "appId", steam.AppId, "running", steam.Found && Steam.IsRunning(steam), "launchOptions", Steam.LaunchOptionsFor(target.Root)));
                            foreach (var account in steam.Accounts) Emit(Obj("account", account.AccountId, "relevant", steam.Relevant.Contains(account), "state", account.State, "value", account.LaunchOptions));
                            return 0;
                        }
                    case "steam-apply":
                        {
                            var target = Target(options);
                            var steam = Steam.Inspect(target.Root);
                            var prefs = Prefs.Load();
                            var count = options.Has("--restore") ? Steam.Restore(steam, steam.Relevant, target.Root, prefs) : Steam.Apply(steam, steam.Relevant, target.Root, prefs);
                            foreach (var account in steam.Accounts) Emit(Obj("account", account.AccountId, "state", account.State, "value", account.LaunchOptions));
                            Emit(Obj("event", "result", "ok", true, "changed", count));
                            return 0;
                        }
                    case "uninstall":
                        {
                            var target = Target(options);
                            var running = Lifecycle.EchoProcesses(target);
                            if (running.Count > 0) throw new InvalidOperationException("ECHO from this folder is running");
                            Lifecycle.Uninstall(target);
                            Emit(Obj("event", "result", "ok", true, "loaderExists", Directory.Exists(target.LoaderRoot), "hostExists", File.Exists(target.ModdedExe)));
                            return 0;
                        }
                    case "app-install":
                        {
                            if (!AppInstall.HasPayload) throw new InvalidOperationException("this binary carries no payload; build it with build-setup.ps1");
                            var choice = new AppInstall.Choice
                            {
                                Dir = options.Get("--dir") ?? AppInstall.DefaultDir,
                                Desktop = options.Has("--desktop"),
                                StartMenu = !options.Has("--no-start-menu"),
                                Register = !options.Has("--no-register"),
                            };
                            AppInstall.Install(choice, (value, text) => Emit(Obj("event", "progress", "value", value, "text", text)));
                            Emit(Obj("event", "result", "ok", true, "dir", Paths.Full(choice.Dir), "version", AppInstall.InstalledVersion(choice.Dir), "payload", AppInstall.PayloadVersion()));
                            return 0;
                        }
                    case "app-uninstall":
                        {
                            var dir = options.Get("--dir") ?? AppInstall.InstalledDir();
                            if (dir == null) throw new DirectoryNotFoundException("Shinawase Manager is not installed");
                            AppInstall.Uninstall(dir, (value, text) => Emit(Obj("event", "progress", "value", value, "text", text)));
                            Emit(Obj("event", "result", "ok", true, "dir", dir));
                            return 0;
                        }
                    default:
                        Emit(Obj("event", "result", "ok", false, "error", "unknown command " + options.Headless));
                        return 2;
                }
            }
            catch (Exception error)
            {
                Emit(Obj("event", "result", "ok", false, "error", error.GetType().Name + ": " + error.Message));
                return 1;
            }
        }

        private static int Install(Options options)
        {
            var target = Target(options);
            var prefs = Prefs.Load();
            var net = new NetState(prefs);
            var source = Source(options);
            var info = LoaderVersionInfo.Read(source);
            if (!options.Has("--no-probe")) net.ProbeAllAsync(info.NodeVersion).GetAwaiter().GetResult();
            var packages = Packages.Bundled();
            var wanted = options.Has("--no-packages") ? new string[0] : (options.Get("--packages") ?? string.Join(",", packages.Select(p => p.Id))).Split(',');
            foreach (var package in packages) package.IsSelected = wanted.Contains(package.Id);
            var root = Path.GetDirectoryName(source);
            var plan = new InstallPlan
            {
                Target = target,
                SourceDir = source,
                UseRemote = options.Has("--remote"),
                RemoteVersion = net.RemoteVersion,
                Packages = packages,
                StartMenu = options.Has("--start-menu"),
                Desktop = options.Has("--desktop"),
                SetSteam = options.Has("--steam"),
                Mode = target.Installed ? "repair" : "install",
                PackageDirs = new List<string> { Path.Combine(root ?? source, "examples", "packages"), Path.Combine(root ?? source, "packages") },
            };
            var installer = new Installer(net, prefs);
            installer.Prepare(plan);
            foreach (var step in installer.Steps)
            {
                var watched = step;
                watched.PropertyChanged += (s, e) =>
                {
                    if (e.PropertyName == "State") Emit(Obj("event", "step", "step", watched.Key, "state", watched.State.ToString(), "detail", watched.Detail));
                };
            }
            installer.LogAppended += line => Emit(Obj("event", "log", "message", line));
            var result = installer.RunAsync(plan, CancellationToken.None).GetAwaiter().GetResult();
            target.Refresh();
            Emit(Obj("event", "result", "ok", result.Ok, "failedStep", result.FailedStep, "error", result.Error, "loader", result.LoaderVersion, "echoVersion", result.EchoVersion,
                "packages", result.PackagesInstalled, "warnings", result.Warnings.Cast<object>().ToList(), "steamApplied", result.SteamApplied, "steamPending", result.SteamPending,
                "accessDenied", result.AccessDenied, "target", Describe(target)));
            return result.Ok ? 0 : 1;
        }
    }
}
