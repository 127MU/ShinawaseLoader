// Download sources, latency probing and downloads for the Shinawase Manager.
// Sources mirror scripts/setup-modloader.ps1 and ShinawaseLoader/update-net.mjs;
// tests/manager-contract.test.mjs keeps the literals in sync.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Shinawase.Manager
{
    public sealed class SourceInfo : Bindable
    {
        public string Id;
        public string Kind;       // shinawase | node | npm | github
        public string BaseUrl;
        public string LabelKey;
        public string PeekVersion;
        private long latency = -2; // -2 untested, -1 unreachable
        private bool selected;
        private bool fastest;
        private bool enabled = true;

        public string Label { get { return LabelKey == null ? BaseUrl : L.T(LabelKey); } }
        public string Host
        {
            get
            {
                try { return new Uri(BaseUrl).Host; } catch { return BaseUrl; }
            }
        }

        public long Latency
        {
            get { return latency; }
            set { if (Set(ref latency, value, "Latency")) { Raise("LatencyText"); Raise("State"); } }
        }

        public string LatencyText
        {
            get
            {
                if (latency == -2) return L.T("src.testing");
                if (latency < 0) return L.T("src.down");
                return latency + " ms";
            }
        }

        // ok | slow | down | testing (drives the colored pill in Settings)
        public string State
        {
            get
            {
                if (latency == -2) return "testing";
                if (latency < 0) return "down";
                return slow ? "slow" : "ok";
            }
        }

        private bool slow;
        public bool Slow { get { return slow; } set { if (Set(ref slow, value, "Slow")) Raise("State"); } }

        public bool IsSelected { get { return selected; } set { Set(ref selected, value, "IsSelected"); } }
        public bool IsFastest { get { return fastest; } set { Set(ref fastest, value, "IsFastest"); } }
        public bool IsEnabled { get { return enabled; } set { Set(ref enabled, value, "IsEnabled"); } }
        public void Relabel() { Raise("Label"); Raise("LatencyText"); }
    }

    public sealed class DownloadProgress
    {
        public long Received;
        public long Total;
        public double BytesPerSecond;
        public string Source;
    }

    public sealed class NetError : Exception
    {
        public readonly string Code;
        public NetError(string code, string detail) : base(string.IsNullOrEmpty(detail) ? code : code + ": " + detail) { Code = code; }
    }

    public static class Net
    {
        public const string Repo = "ChunchunOwO/ShinawaseLoader";
        public static readonly string[] DefaultShinawaseMirrors = { "https://mirror.shiinasuki.com/shinawase", "http://43.248.10.82/shinawase" };
        public const string NpmMirrorRegistry = "https://registry.npmmirror.com";
        public const string NpmOfficialRegistry = "https://registry.npmjs.org";
        public const string GithubRaw = "https://raw.githubusercontent.com/ChunchunOwO/ShinawaseLoader/main";
        public const string GhproxyRaw = "https://ghproxy.net/https://raw.githubusercontent.com/ChunchunOwO/ShinawaseLoader/main";

        private static readonly HttpClient client;

        static Net()
        {
            try { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12 | (SecurityProtocolType)12288; }
            catch
            {
                try { ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12; } catch { }
            }
            ServicePointManager.DefaultConnectionLimit = 16;
            var handler = new HttpClientHandler { AllowAutoRedirect = true, AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate };
            client = new HttpClient(handler) { Timeout = Timeout.InfiniteTimeSpan };
            client.DefaultRequestHeaders.UserAgent.ParseAdd("ShinawaseManager/" + BuildInfo.Version);
        }

        public static List<SourceInfo> NodeMirrors()
        {
            return new List<SourceInfo>
            {
                new SourceInfo { Id = "huawei", Kind = "node", BaseUrl = "https://mirrors.huaweicloud.com/repository/toolkit/nodejs", LabelKey = "src.huawei" },
                new SourceInfo { Id = "aliyun", Kind = "node", BaseUrl = "https://mirrors.aliyun.com/nodejs-release", LabelKey = "src.aliyun" },
                new SourceInfo { Id = "npmmirror", Kind = "node", BaseUrl = "https://npmmirror.com/mirrors/node", LabelKey = "src.npmmirror" },
                new SourceInfo { Id = "official", Kind = "node", BaseUrl = "https://nodejs.org/dist", LabelKey = "src.official" },
            };
        }

        public static string NodeZipUrl(string baseUrl, string version)
        {
            return baseUrl.TrimEnd('/') + "/v" + version + "/node-v" + version + "-win-x64.zip";
        }

        // Shinawase mirror bases: SHINAWASE_MIRRORS (comma separated, "none"
        // disables), then "mirrors" in selection.json, then the defaults.
        public static List<string> ShinawaseBases()
        {
            IEnumerable<string> list;
            var env = Environment.GetEnvironmentVariable("SHINAWASE_MIRRORS");
            if (env != null) list = env.Split(',');
            else
            {
                var saved = Selection.Read().Arr("mirrors");
                list = saved != null ? saved.Select(v => Convert.ToString(v)) : DefaultShinawaseMirrors;
            }
            var output = new List<string>();
            foreach (var item in list)
            {
                var text = (item ?? "").Trim().TrimEnd('/');
                Uri uri;
                if (!Uri.TryCreate(text, UriKind.Absolute, out uri)) continue;
                if (uri.Scheme != "http" && uri.Scheme != "https") continue;
                if (!string.IsNullOrEmpty(uri.UserInfo)) continue;
                if (output.Contains(text, StringComparer.OrdinalIgnoreCase)) continue;
                output.Add(text);
                if (output.Count >= 4) break;
            }
            return output;
        }

        public static async Task<long> ProbeAsync(string url, int timeoutMs, bool requireOk)
        {
            var clock = Stopwatch.StartNew();
            using (var cts = new CancellationTokenSource(timeoutMs))
            {
                foreach (var method in new[] { HttpMethod.Head, HttpMethod.Get })
                {
                    try
                    {
                        var request = new HttpRequestMessage(method, url);
                        if (method == HttpMethod.Get) request.Headers.Range = new RangeHeaderValue(0, 0);
                        using (var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false))
                        {
                            var code = (int)response.StatusCode;
                            if (code == 405 || code == 501) continue; // HEAD not allowed: retry with GET
                            if (code >= 500) return -1;
                            if (requireOk && code >= 400) return -1;
                            return Math.Max(1, clock.ElapsedMilliseconds);
                        }
                    }
                    catch { return -1; }
                }
            }
            return -1;
        }

        public static async Task<string> GetStringAsync(string url, int timeoutMs, int maxBytes)
        {
            using (var cts = new CancellationTokenSource(timeoutMs))
            using (var response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, cts.Token).ConfigureAwait(false))
            {
                if (!response.IsSuccessStatusCode) throw new NetError("http_" + (int)response.StatusCode, url);
                using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var memory = new MemoryStream())
                {
                    var buffer = new byte[16384];
                    while (true)
                    {
                        var read = await stream.ReadAsync(buffer, 0, buffer.Length, cts.Token).ConfigureAwait(false);
                        if (read <= 0) break;
                        memory.Write(buffer, 0, read);
                        if (memory.Length > maxBytes) throw new NetError("too_large", url);
                    }
                    return Encoding.UTF8.GetString(memory.ToArray()).TrimStart('﻿');
                }
            }
        }

        // Streams `url` to `dest`. Fails fast on a dead host (connectMs) and on a
        // stalled body (stallMs without a byte), so the caller can move on to the
        // next source instead of hanging.
        public static async Task DownloadAsync(string url, string dest, int connectMs, int stallMs, long maxBytes, string sourceLabel, IProgress<DownloadProgress> progress, CancellationToken token)
        {
            Fs.EnsureParent(dest);
            var part = dest + ".part";
            HttpResponseMessage response;
            using (var connect = CancellationTokenSource.CreateLinkedTokenSource(token))
            {
                connect.CancelAfter(connectMs);
                try
                {
                    response = await client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, connect.Token).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    token.ThrowIfCancellationRequested();
                    throw new NetError("timeout", url);
                }
                catch (HttpRequestException error)
                {
                    throw new NetError("network", error.InnerException != null ? error.InnerException.Message : error.Message);
                }
            }
            using (response)
            {
                if (!response.IsSuccessStatusCode) throw new NetError("http_" + (int)response.StatusCode, url);
                var total = response.Content.Headers.ContentLength ?? 0;
                if (total > maxBytes) throw new NetError("too_large", url);
                using (var stream = await response.Content.ReadAsStreamAsync().ConfigureAwait(false))
                using (var output = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None, 1 << 16, true))
                {
                    var buffer = new byte[1 << 16];
                    long received = 0;
                    var clock = Stopwatch.StartNew();
                    long lastReport = 0;
                    long windowBytes = 0;
                    long windowStart = 0;
                    double rate = 0;
                    while (true)
                    {
                        var read = stream.ReadAsync(buffer, 0, buffer.Length, token);
                        var stall = Task.Delay(stallMs, token);
                        if (await Task.WhenAny(read, stall).ConfigureAwait(false) != read)
                        {
                            token.ThrowIfCancellationRequested();
                            throw new NetError("stalled", url);
                        }
                        var count = await read.ConfigureAwait(false);
                        if (count <= 0) break;
                        await output.WriteAsync(buffer, 0, count, token).ConfigureAwait(false);
                        received += count;
                        windowBytes += count;
                        if (received > maxBytes) throw new NetError("too_large", url);
                        var now = clock.ElapsedMilliseconds;
                        if (now - windowStart >= 500)
                        {
                            var instant = windowBytes * 1000.0 / Math.Max(1, now - windowStart);
                            rate = rate <= 0 ? instant : rate * 0.6 + instant * 0.4;
                            windowBytes = 0;
                            windowStart = now;
                        }
                        if (progress != null && now - lastReport >= 120)
                        {
                            lastReport = now;
                            progress.Report(new DownloadProgress { Received = received, Total = total, BytesPerSecond = rate, Source = sourceLabel });
                        }
                    }
                    if (total > 0 && received != total) throw new NetError("truncated", url);
                    if (progress != null) progress.Report(new DownloadProgress { Received = received, Total = total, BytesPerSecond = rate, Source = sourceLabel });
                }
            }
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(part, dest);
        }
    }

    // Holds every source with its measured latency and turns the user's choice
    // (auto = fastest first, or a pinned Node mirror) into ordered candidates.
    public sealed class NetState : Bindable
    {
        public readonly List<SourceInfo> Shinawase = new List<SourceInfo>();
        public readonly List<SourceInfo> Node = Net.NodeMirrors();
        public readonly List<SourceInfo> Npm = new List<SourceInfo>
        {
            new SourceInfo { Id = "npmmirror", Kind = "npm", BaseUrl = Net.NpmMirrorRegistry, LabelKey = "src.npmmirror" },
            new SourceInfo { Id = "npmjs", Kind = "npm", BaseUrl = Net.NpmOfficialRegistry, LabelKey = "src.official" },
        };
        public readonly List<SourceInfo> Github = new List<SourceInfo>
        {
            new SourceInfo { Id = "ghproxy", Kind = "github", BaseUrl = Net.GhproxyRaw, LabelKey = "src.ghproxy" },
            new SourceInfo { Id = "github", Kind = "github", BaseUrl = Net.GithubRaw, LabelKey = "src.github" },
        };
        public Prefs Prefs;
        private bool probing;
        private string remoteVersion;
        private string remoteVia;
        private bool remoteChecked;

        public NetState(Prefs prefs)
        {
            Prefs = prefs;
            foreach (var bases in Net.ShinawaseBases()) Shinawase.Add(new SourceInfo { Id = "mirror:" + bases, Kind = "shinawase", BaseUrl = bases, LabelKey = "src.shinawase" });
            ApplySelection();
        }

        public bool Probing { get { return probing; } private set { Set(ref probing, value, "Probing"); } }
        public string RemoteVersion { get { return remoteVersion; } private set { Set(ref remoteVersion, value, "RemoteVersion"); } }
        public string RemoteVia { get { return remoteVia; } private set { Set(ref remoteVia, value, "RemoteVia"); } }
        public bool RemoteChecked { get { return remoteChecked; } private set { Set(ref remoteChecked, value, "RemoteChecked"); } }

        public IEnumerable<SourceInfo> All { get { return Shinawase.Concat(Node).Concat(Npm).Concat(Github); } }

        public string PinnedNodeMirror
        {
            get
            {
                var id = Selection.Read().Str("nodeMirror");
                return Node.Any(n => n.Id == id) ? id : "huawei";
            }
        }

        // "official" mirrors the PowerShell installer: direct sources everywhere,
        // no Shinawase mirror and no ghproxy, for the manager and the loader alike.
        public bool OfficialOnly { get { return !Prefs.AutoMirror && PinnedNodeMirror == "official"; } }

        public void ApplySelection()
        {
            var pinned = PinnedNodeMirror;
            foreach (var node in Node)
            {
                node.IsSelected = !Prefs.AutoMirror && node.Id == pinned;
                node.IsEnabled = !Prefs.AutoMirror;
            }
        }

        public SourceInfo FastestNode
        {
            get
            {
                return Node.Where(n => n.Latency >= 0).OrderBy(n => n.Latency).FirstOrDefault();
            }
        }

        public async Task ProbeAllAsync(string nodeVersion)
        {
            if (Probing) return;
            Probing = true;
            foreach (var source in All) { source.Latency = -2; source.IsFastest = false; }
            try
            {
                // The first request of a process pays for proxy auto-detection
                // (WPAD), which would add the same seconds to every timing.
                await Task.Run(() =>
                {
                    try { WebRequest.DefaultWebProxy.GetProxy(new Uri("https://nodejs.org/")); } catch { }
                });
                var tasks = new List<Task>();
                foreach (var mirror in Shinawase) tasks.Add(ProbeShinawase(mirror));
                foreach (var node in Node)
                {
                    var target = node;
                    tasks.Add(Task.Run(async () => target.Latency = await Net.ProbeAsync(Net.NodeZipUrl(target.BaseUrl, nodeVersion), 6000, true)));
                }
                foreach (var npm in Npm)
                {
                    var target = npm;
                    tasks.Add(Task.Run(async () => target.Latency = await Net.ProbeAsync(target.BaseUrl + "/", 6000, false)));
                }
                foreach (var github in Github) tasks.Add(ProbeGithub(github));
                await Task.WhenAll(tasks);
                var fastest = FastestNode;
                if (fastest != null) fastest.IsFastest = true;
                // A source is "slow" relative to its group, so a proxied network
                // where everything takes a second does not paint every pill amber.
                foreach (var group in new[] { Shinawase, Node, Npm, Github })
                {
                    var best = group.Where(s => s.Latency >= 0).Select(s => s.Latency).DefaultIfEmpty(0).Min();
                    foreach (var source in group) source.Slow = source.Latency > Math.Max(800, best * 2);
                }
                PickRemote();
                // Auto mode deliberately leaves selection.json's nodeMirror alone:
                // writing "official" there would also switch the loader's own
                // updater away from the signed Shinawase mirror.
            }
            finally
            {
                Probing = false;
                RemoteChecked = true;
                Raise("Summary");
            }
        }

        private async Task ProbeShinawase(SourceInfo mirror)
        {
            var clock = Stopwatch.StartNew();
            try
            {
                var text = await Net.GetStringAsync(mirror.BaseUrl + "/mirror-manifest.json", 6000, 256 * 1024).ConfigureAwait(false);
                mirror.Latency = Math.Max(1, clock.ElapsedMilliseconds);
                var loader = Json.ParseObject(text).Obj("loader");
                mirror.PeekVersion = loader == null ? null : loader.Str("version");
            }
            catch { mirror.Latency = -1; }
        }

        private async Task ProbeGithub(SourceInfo source)
        {
            var clock = Stopwatch.StartNew();
            try
            {
                var text = await Net.GetStringAsync(source.BaseUrl + "/ShinawaseLoader/loader-version.json", 8000, 64 * 1024).ConfigureAwait(false);
                source.Latency = Math.Max(1, clock.ElapsedMilliseconds);
                source.PeekVersion = Json.ParseObject(text).Str("version");
            }
            catch { source.Latency = -1; }
        }

        // Display-only peek at the newest version. Downloads are verified
        // separately (signed manifest / pinned hashes), so a wrong peek can at
        // worst offer an update that then fails verification.
        private void PickRemote()
        {
            string version = null;
            string via = null;
            if (!OfficialOnly && Prefs.UseShinawaseMirror)
            {
                var mirror = Shinawase.Where(m => m.Latency >= 0 && !string.IsNullOrEmpty(m.PeekVersion)).OrderBy(m => m.Latency).FirstOrDefault();
                if (mirror != null) { version = mirror.PeekVersion; via = mirror.Host; }
            }
            if (version == null)
            {
                var github = Github.Where(g => g.Latency >= 0 && !string.IsNullOrEmpty(g.PeekVersion) && (!OfficialOnly || g.Id == "github")).OrderBy(g => g.Latency).FirstOrDefault();
                if (github != null) { version = github.PeekVersion; via = github.Label; }
            }
            RemoteVersion = version;
            RemoteVia = via;
        }

        public void Relabel()
        {
            foreach (var source in All) source.Relabel();
            Raise("Summary");
        }

        public IEnumerable<SourceInfo> LiveShinawase()
        {
            if (OfficialOnly || !Prefs.UseShinawaseMirror) return Enumerable.Empty<SourceInfo>();
            return Shinawase.Where(m => m.Latency != -1).OrderBy(m => m.Latency < 0 ? long.MaxValue : m.Latency);
        }

        public sealed class Candidate
        {
            public string Label;
            public string Url;
            public int ConnectMs;
            public int TimeoutSec;
        }

        // Shinawase mirrors first (verified by the pinned SHA-256), then Node
        // mirrors fastest-first, or the pinned mirror when Auto is off. Unreachable
        // sources are kept at the end as a last resort.
        public List<Candidate> NodeCandidates(string version)
        {
            var output = new List<Candidate>();
            foreach (var mirror in LiveShinawase())
                output.Add(new Candidate { Label = L.T("src.shinawase") + " (" + mirror.Host + ")", Url = mirror.BaseUrl + "/node/v" + version + "/node-v" + version + "-win-x64.zip", ConnectMs = 8000 });
            IEnumerable<SourceInfo> order;
            if (Prefs.AutoMirror) order = Node.OrderBy(n => n.Latency < 0 ? (n.Latency == -1 ? long.MaxValue : long.MaxValue - 1) : n.Latency);
            else order = Node.Where(n => n.Id == PinnedNodeMirror).Concat(Node.Where(n => n.Id != PinnedNodeMirror && !OfficialOnly));
            foreach (var node in order)
                output.Add(new Candidate { Label = node.Label, Url = Net.NodeZipUrl(node.BaseUrl, version), ConnectMs = node.Latency == -1 ? 8000 : 20000 });
            return output;
        }

        public List<Candidate> NpmRegistries()
        {
            var output = new List<Candidate>();
            foreach (var mirror in LiveShinawase())
                output.Add(new Candidate { Label = L.T("src.shinawase") + " (" + mirror.Host + ")", Url = mirror.BaseUrl + "/npm/", TimeoutSec = 240 });
            if (OfficialOnly)
            {
                output.Add(new Candidate { Label = "npmjs", Url = Net.NpmOfficialRegistry, TimeoutSec = 900 });
                return output;
            }
            var npm = Npm.OrderBy(n => n.Latency < 0 ? long.MaxValue : n.Latency).ToList();
            if (!Prefs.AutoMirror) npm = Npm.ToList(); // npmmirror first, as the PowerShell installer does
            foreach (var registry in npm)
                output.Add(new Candidate { Label = registry.Id, Url = registry.BaseUrl, TimeoutSec = registry.Id == "npmjs" ? 900 : 300 });
            return output;
        }

        public List<string> HelperMirrorArgs()
        {
            if (OfficialOnly) return new List<string> { "--official" };
            if (!Prefs.UseShinawaseMirror) return new List<string> { "--mirrors", "" };
            return new List<string> { "--mirrors", string.Join(",", Shinawase.Select(m => m.BaseUrl)) };
        }

        public string Summary
        {
            get
            {
                if (Probing) return L.T("tile.net.testing");
                SourceInfo best;
                if (Prefs.AutoMirror) best = FastestNode;
                else best = Node.FirstOrDefault(n => n.Id == PinnedNodeMirror);
                if (best == null) return L.T("tile.net.offline");
                return Prefs.AutoMirror ? L.F("tile.net.auto", best.Label) : best.Label;
            }
        }

        public string SummarySub
        {
            get
            {
                if (Probing) return "";
                var best = Prefs.AutoMirror ? FastestNode : Node.FirstOrDefault(n => n.Id == PinnedNodeMirror);
                if (best == null || best.Latency < 0) return L.T("src.down");
                var mirror = LiveShinawase().FirstOrDefault(m => m.Latency >= 0);
                var text = best.Latency + " ms";
                if (mirror != null) text += "  ·  " + L.T("src.shinawase") + " " + mirror.Latency + " ms";
                return text;
            }
        }
    }
}
