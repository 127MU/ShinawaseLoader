// Steam discovery and launch-option editing. localconfig.vdf is edited in
// place (only the LaunchOptions value changes; everything else keeps its exact
// bytes), a backup is written first, and Steam must be closed while writing
// because it rewrites the file from memory when it exits.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace Shinawase.Manager
{
    public sealed class VdfNode
    {
        public string Key;
        public string Value;               // null for blocks
        public List<VdfNode> Children = new List<VdfNode>();
        public int KeyStart;
        public int ValueStart, ValueEnd;   // value token span (quotes included)
        public int Open = -1, Close = -1;  // brace positions for blocks
        public int Depth;

        public bool IsBlock { get { return Value == null; } }

        public VdfNode Child(string key)
        {
            return Children.FirstOrDefault(c => string.Equals(c.Key, key, StringComparison.OrdinalIgnoreCase));
        }

        public VdfNode Path(params string[] keys)
        {
            var node = this;
            foreach (var key in keys)
            {
                if (node == null) return null;
                node = node.Child(key);
            }
            return node;
        }

        public string Str(string key)
        {
            var child = Child(key);
            return child == null ? null : child.Value;
        }
    }

    public static class Vdf
    {
        private sealed class Token
        {
            public string Text;
            public bool Quoted;
            public char Brace; // '{' or '}' or '\0'
            public int Start, End;
        }

        private static List<Token> Tokenize(string text)
        {
            var tokens = new List<Token>();
            var i = 0;
            while (i < text.Length)
            {
                var ch = text[i];
                if (char.IsWhiteSpace(ch)) { i++; continue; }
                if (ch == '/' && i + 1 < text.Length && text[i + 1] == '/')
                {
                    while (i < text.Length && text[i] != '\n') i++;
                    continue;
                }
                if (ch == '{' || ch == '}') { tokens.Add(new Token { Brace = ch, Start = i, End = i + 1 }); i++; continue; }
                if (ch == '[')
                {
                    // conditional such as [$WIN32]: ignored
                    while (i < text.Length && text[i] != ']') i++;
                    i++;
                    continue;
                }
                if (ch == '"')
                {
                    var start = i;
                    var sb = new StringBuilder();
                    i++;
                    while (i < text.Length && text[i] != '"')
                    {
                        if (text[i] == '\\' && i + 1 < text.Length)
                        {
                            var esc = text[i + 1];
                            if (esc == 'n') sb.Append('\n');
                            else if (esc == 't') sb.Append('\t');
                            else if (esc == 'r') sb.Append('\r');
                            else sb.Append(esc);
                            i += 2;
                            continue;
                        }
                        sb.Append(text[i]);
                        i++;
                    }
                    i++;
                    tokens.Add(new Token { Text = sb.ToString(), Quoted = true, Start = start, End = Math.Min(i, text.Length) });
                    continue;
                }
                var begin = i;
                while (i < text.Length && !char.IsWhiteSpace(text[i]) && text[i] != '{' && text[i] != '}' && text[i] != '"') i++;
                tokens.Add(new Token { Text = text.Substring(begin, i - begin), Start = begin, End = i });
            }
            return tokens;
        }

        public static VdfNode Parse(string text)
        {
            var tokens = Tokenize(text);
            var root = new VdfNode { Key = "", Depth = -1 };
            var index = 0;
            ParseBlock(tokens, ref index, root);
            return root;
        }

        private static void ParseBlock(List<Token> tokens, ref int index, VdfNode parent)
        {
            while (index < tokens.Count)
            {
                var token = tokens[index];
                if (token.Brace == '}')
                {
                    parent.Close = token.Start;
                    index++;
                    return;
                }
                if (token.Brace == '{') { index++; continue; } // stray brace
                var node = new VdfNode { Key = token.Text, KeyStart = token.Start, Depth = parent.Depth + 1 };
                index++;
                if (index >= tokens.Count) break;
                var next = tokens[index];
                if (next.Brace == '{')
                {
                    node.Open = next.Start;
                    index++;
                    ParseBlock(tokens, ref index, node);
                }
                else if (next.Brace == '}')
                {
                    parent.Children.Add(node);
                    continue;
                }
                else
                {
                    node.Value = next.Text;
                    node.ValueStart = next.Start;
                    node.ValueEnd = next.End;
                    index++;
                }
                parent.Children.Add(node);
            }
        }

        public static string Escape(string value)
        {
            return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\n", "\\n").Replace("\t", "\\t");
        }

        private static string NewLine(string text)
        {
            return text.Contains("\r\n") ? "\r\n" : "\n";
        }

        // Sets path[0]/.../path[n-1] = value, creating missing blocks. Only the
        // inserted or replaced span changes.
        public static string SetValue(string text, string[] path, string value)
        {
            var root = Parse(text);
            var node = root;
            var depth = 0;
            for (; depth < path.Length - 1; depth++)
            {
                var child = node.Child(path[depth]);
                if (child == null || !child.IsBlock) break;
                node = child;
            }
            var nl = NewLine(text);
            var quoted = "\"" + Escape(value) + "\"";
            if (depth == path.Length - 1)
            {
                var existing = node.Child(path[path.Length - 1]);
                if (existing != null && !existing.IsBlock)
                {
                    return text.Substring(0, existing.ValueStart) + quoted + text.Substring(existing.ValueEnd);
                }
            }
            if (node == root || node.Open < 0) throw new InvalidDataException("vdf_root_missing");
            var sb = new StringBuilder();
            var indent = node.Depth + 1;
            for (var i = depth; i < path.Length - 1; i++)
            {
                sb.Append(nl).Append('\t', indent).Append('"').Append(Escape(path[i])).Append('"');
                sb.Append(nl).Append('\t', indent).Append('{');
                indent++;
            }
            sb.Append(nl).Append('\t', indent).Append('"').Append(Escape(path[path.Length - 1])).Append("\"\t\t").Append(quoted);
            for (var i = path.Length - 2; i >= depth; i--)
            {
                indent--;
                sb.Append(nl).Append('\t', indent).Append('}');
            }
            var at = node.Open + 1;
            return text.Substring(0, at) + sb + text.Substring(at);
        }

        public static string RemoveValue(string text, string[] path)
        {
            var node = Parse(text).Path(path);
            if (node == null || node.IsBlock) return text;
            var start = node.KeyStart;
            while (start > 0 && (text[start - 1] == ' ' || text[start - 1] == '\t')) start--;
            if (start > 0 && text[start - 1] == '\n') start--;
            if (start > 0 && text[start - 1] == '\r') start--;
            return text.Substring(0, start) + text.Substring(node.ValueEnd);
        }
    }

    public sealed class SteamAccount : Bindable
    {
        public string AccountId;
        public string SteamId64;
        public string PersonaName;
        public string AccountName;
        public bool MostRecent;
        public string ConfigPath;
        public bool HasApp;
        private string launchOptions;
        private string state; // set | unset | other | otherRoot

        public string DisplayName { get { return !string.IsNullOrEmpty(PersonaName) ? PersonaName : (!string.IsNullOrEmpty(AccountName) ? AccountName : AccountId); } }
        public string Initial { get { var name = DisplayName ?? "?"; return name.Length > 0 ? name.Substring(0, 1).ToUpperInvariant() : "?"; } }
        public string SubText { get { return (MostRecent ? L.T("steam.acc.recent") + "  ·  " : "") + "ID " + AccountId; } }
        public string LaunchOptions { get { return launchOptions; } set { Set(ref launchOptions, value, "LaunchOptions"); } }
        public string State { get { return state; } set { if (Set(ref state, value, "State")) Raise("StateText"); } }
        public string StateText
        {
            get
            {
                switch (state)
                {
                    case "set": return L.T("steam.acc.set");
                    case "other": return L.T("steam.acc.other");
                    case "otherRoot": return L.T("steam.acc.otherRoot");
                    default: return L.T("steam.acc.unset");
                }
            }
        }
        public void Relabel() { Raise("StateText"); Raise("SubText"); }
    }

    public sealed class SteamInfo
    {
        public string Root;
        public string Exe;
        public List<string> Libraries = new List<string>();
        public string AppId;
        public string AppName;
        public List<SteamAccount> Accounts = new List<SteamAccount>();
        public bool Found { get { return Root != null; } }
        public List<SteamAccount> Relevant
        {
            get
            {
                var list = Accounts.Where(a => a.HasApp || a.MostRecent).ToList();
                return list.Count > 0 ? list : Accounts.ToList();
            }
        }
    }

    public static class Steam
    {
        private const long SteamId64Base = 76561197960265728L;

        public static string[] LaunchPath(string appId)
        {
            return new[] { "UserLocalConfigStore", "Software", "Valve", "Steam", "apps", appId, "LaunchOptions" };
        }

        public static string FindRoot()
        {
            var overrideRoot = Environment.GetEnvironmentVariable("SHINAWASE_STEAM_ROOT");
            if (!string.IsNullOrEmpty(overrideRoot)) return Directory.Exists(overrideRoot) ? Paths.Full(overrideRoot) : null;
            var candidates = new List<string>();
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                {
                    if (key != null) candidates.Add(Convert.ToString(key.GetValue("SteamPath")));
                }
            }
            catch { }
            foreach (var path in new[] { @"SOFTWARE\WOW6432Node\Valve\Steam", @"SOFTWARE\Valve\Steam" })
            {
                try
                {
                    using (var key = Registry.LocalMachine.OpenSubKey(path))
                    {
                        if (key != null) candidates.Add(Convert.ToString(key.GetValue("InstallPath")));
                    }
                }
                catch { }
            }
            var pf86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)");
            if (!string.IsNullOrEmpty(pf86)) candidates.Add(Path.Combine(pf86, "Steam"));
            foreach (var candidate in candidates)
            {
                if (string.IsNullOrWhiteSpace(candidate)) continue;
                var full = Paths.Full(candidate.Replace('/', '\\'));
                if (File.Exists(Path.Combine(full, "steam.exe")) || Directory.Exists(Path.Combine(full, "steamapps"))) return full;
            }
            return null;
        }

        private static VdfNode ReadVdf(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                return Vdf.Parse(File.ReadAllText(path, Encoding.UTF8));
            }
            catch { return null; }
        }

        public static List<string> Libraries(string root)
        {
            var output = new List<string>();
            if (root == null) return output;
            output.Add(root);
            var doc = ReadVdf(Path.Combine(root, "steamapps", "libraryfolders.vdf"));
            var folders = doc == null ? null : (doc.Child("libraryfolders") ?? doc.Child("LibraryFolders"));
            if (folders != null)
            {
                foreach (var child in folders.Children)
                {
                    var path = child.IsBlock ? child.Str("path") : (child.Key.All(char.IsDigit) ? child.Value : null);
                    if (string.IsNullOrWhiteSpace(path)) continue;
                    var full = Paths.Full(path.Replace('/', '\\'));
                    if (!output.Any(o => Paths.Same(o, full))) output.Add(full);
                }
            }
            return output;
        }

        public sealed class AppMatch
        {
            public string AppId;
            public string Name;
            public string InstallDir;
        }

        public static List<AppMatch> AppManifests(string library)
        {
            var output = new List<AppMatch>();
            var dir = Path.Combine(library, "steamapps");
            if (!Directory.Exists(dir)) return output;
            string[] files;
            try { files = Directory.GetFiles(dir, "appmanifest_*.acf"); } catch { return output; }
            foreach (var file in files)
            {
                var doc = ReadVdf(file);
                var state = doc == null ? null : doc.Child("AppState");
                if (state == null) continue;
                var installDir = state.Str("installdir");
                if (string.IsNullOrEmpty(installDir)) continue;
                output.Add(new AppMatch { AppId = state.Str("appid"), Name = state.Str("name"), InstallDir = Path.Combine(dir, "common", installDir) });
            }
            return output;
        }

        public static SteamInfo Inspect(string echoRoot)
        {
            var info = new SteamInfo { Root = FindRoot() };
            if (info.Root == null) return info;
            info.Exe = Path.Combine(info.Root, "steam.exe");
            info.Libraries = Libraries(info.Root);
            if (!string.IsNullOrEmpty(echoRoot))
            {
                foreach (var library in info.Libraries)
                {
                    var match = AppManifests(library).FirstOrDefault(m => Paths.Same(m.InstallDir, echoRoot));
                    if (match != null) { info.AppId = match.AppId; info.AppName = match.Name; break; }
                }
            }
            info.Accounts = Accounts(info.Root, info.AppId, echoRoot);
            return info;
        }

        public static List<SteamAccount> Accounts(string root, string appId, string echoRoot)
        {
            var output = new List<SteamAccount>();
            var users = ReadVdf(Path.Combine(root, "config", "loginusers.vdf"));
            var block = users == null ? null : users.Child("users");
            if (block != null)
            {
                foreach (var user in block.Children.Where(c => c.IsBlock))
                {
                    long id64;
                    if (!long.TryParse(user.Key, NumberStyles.None, CultureInfo.InvariantCulture, out id64) || id64 <= SteamId64Base) continue;
                    var accountId = (id64 - SteamId64Base).ToString(CultureInfo.InvariantCulture);
                    output.Add(new SteamAccount
                    {
                        AccountId = accountId,
                        SteamId64 = user.Key,
                        PersonaName = user.Str("PersonaName"),
                        AccountName = user.Str("AccountName"),
                        MostRecent = user.Str("MostRecent") == "1",
                        ConfigPath = Path.Combine(root, "userdata", accountId, "config", "localconfig.vdf"),
                    });
                }
            }
            var userdata = Path.Combine(root, "userdata");
            if (output.Count == 0 && Directory.Exists(userdata))
            {
                foreach (var dir in Directory.GetDirectories(userdata))
                {
                    var name = System.IO.Path.GetFileName(dir);
                    if (!name.All(char.IsDigit) || name == "0") continue;
                    output.Add(new SteamAccount { AccountId = name, ConfigPath = Path.Combine(dir, "config", "localconfig.vdf") });
                }
            }
            output = output.Where(a => File.Exists(a.ConfigPath)).ToList();
            foreach (var account in output) Refresh(account, appId, echoRoot);
            return output.OrderByDescending(a => a.MostRecent).ThenByDescending(a => a.HasApp).ThenBy(a => a.DisplayName, StringComparer.OrdinalIgnoreCase).ToList();
        }

        public static void Refresh(SteamAccount account, string appId, string echoRoot)
        {
            if (string.IsNullOrEmpty(appId)) { account.State = "unset"; return; }
            var doc = ReadVdf(account.ConfigPath);
            var apps = doc == null ? null : doc.Path("UserLocalConfigStore", "Software", "Valve", "Steam", "apps");
            var app = apps == null ? null : apps.Child(appId);
            account.HasApp = app != null;
            account.LaunchOptions = app == null ? null : app.Str("LaunchOptions");
            account.State = Classify(account.LaunchOptions, echoRoot);
        }

        public static string LaunchOptionsFor(string echoRoot)
        {
            return "\"" + Path.Combine(echoRoot, "ECHO.modded.exe") + "\" %command%";
        }

        public static string Classify(string value, string echoRoot)
        {
            if (string.IsNullOrWhiteSpace(value)) return "unset";
            var at = value.IndexOf("ECHO.modded.exe", StringComparison.OrdinalIgnoreCase);
            if (at < 0) return "other";
            if (echoRoot == null) return "set";
            var expected = Path.Combine(echoRoot, "ECHO.modded.exe");
            return value.IndexOf(expected, StringComparison.OrdinalIgnoreCase) >= 0 && value.IndexOf("%command%", StringComparison.OrdinalIgnoreCase) >= 0 ? "set" : "otherRoot";
        }

        // What we write: our launcher, then whatever plain arguments the user had
        // (a previous value without %command% only appends arguments).
        public static string Merge(string previous, string echoRoot)
        {
            var ours = LaunchOptionsFor(echoRoot);
            if (string.IsNullOrWhiteSpace(previous)) return ours;
            var state = Classify(previous, echoRoot);
            if (state == "set") return previous;
            if (state == "otherRoot") return ours;
            if (previous.IndexOf("%command%", StringComparison.OrdinalIgnoreCase) >= 0) return ours;
            return ours + " " + previous.Trim();
        }

        public static List<Process> SteamProcesses(SteamInfo info)
        {
            if (info == null || info.Root == null) return new List<Process>();
            return Proc.FindByImage(new[] { Path.Combine(info.Root, "steam.exe") }, "steam");
        }

        public static bool IsRunning(SteamInfo info)
        {
            var list = SteamProcesses(info);
            foreach (var p in list) p.Dispose();
            return list.Count > 0;
        }

        public static async Task<bool> ShutdownAsync(SteamInfo info, int timeoutSec, CancellationToken token)
        {
            if (!IsRunning(info)) return true;
            try
            {
                Process.Start(new ProcessStartInfo(info.Exe, "-shutdown") { UseShellExecute = false, CreateNoWindow = true });
            }
            catch (Exception error) { Log.Warn("steam -shutdown failed: " + error.Message); }
            var deadline = DateTime.UtcNow.AddSeconds(timeoutSec);
            while (DateTime.UtcNow < deadline)
            {
                await Task.Delay(500, token);
                if (!IsRunning(info))
                {
                    await Task.Delay(1200, token); // let it finish flushing config files
                    return true;
                }
            }
            return false;
        }

        public static void Start(SteamInfo info)
        {
            try { Process.Start(new ProcessStartInfo(info.Exe) { UseShellExecute = true, WorkingDirectory = info.Root }); }
            catch (Exception error) { Log.Warn("steam start failed: " + error.Message); }
        }

        private static void Backup(string configPath)
        {
            var backup = configPath + ".shinawase.bak";
            File.Copy(configPath, backup, true);
        }

        private static string ReadText(string path, out Encoding encoding)
        {
            var bytes = File.ReadAllBytes(path);
            var bom = bytes.Length >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF;
            encoding = new UTF8Encoding(bom);
            return new UTF8Encoding(false).GetString(bytes, bom ? 3 : 0, bytes.Length - (bom ? 3 : 0));
        }

        private static void WriteText(string path, string text, Encoding encoding)
        {
            var temp = path + ".shinawase.tmp";
            File.WriteAllText(temp, text, encoding);
            File.Copy(temp, path, true);
            File.Delete(temp);
        }

        // Writes our launch option for each account. Previous values are kept in
        // prefs (once: our own value never overwrites the saved original).
        public static int Apply(SteamInfo info, IEnumerable<SteamAccount> accounts, string echoRoot, Prefs prefs)
        {
            if (string.IsNullOrEmpty(info.AppId)) throw new InvalidOperationException("steam_app_missing");
            if (IsRunning(info)) throw new InvalidOperationException("steam_running");
            var backups = prefs.SteamBackups.Obj(info.AppId) ?? new JObject();
            var written = 0;
            foreach (var account in accounts)
            {
                Encoding encoding;
                var text = ReadText(account.ConfigPath, out encoding);
                var current = Vdf.Parse(text).Path(LaunchPath(info.AppId));
                var previous = current == null ? null : current.Value;
                var next = Merge(previous, echoRoot);
                if (previous != next)
                {
                    if (!backups.ContainsKey(account.AccountId) && Classify(previous, echoRoot) != "set") backups[account.AccountId] = previous;
                    Backup(account.ConfigPath);
                    WriteText(account.ConfigPath, Vdf.SetValue(text, LaunchPath(info.AppId), next), encoding);
                    Log.Info("steam launch option written for account " + account.AccountId);
                }
                Refresh(account, info.AppId, echoRoot);
                if (account.State == "set") written++;
            }
            prefs.SteamBackups[info.AppId] = backups;
            prefs.Save();
            return written;
        }

        public static int Restore(SteamInfo info, IEnumerable<SteamAccount> accounts, string echoRoot, Prefs prefs)
        {
            if (string.IsNullOrEmpty(info.AppId)) return 0;
            if (IsRunning(info)) throw new InvalidOperationException("steam_running");
            var backups = prefs.SteamBackups.Obj(info.AppId) ?? new JObject();
            var changed = 0;
            foreach (var account in accounts)
            {
                Encoding encoding;
                var text = ReadText(account.ConfigPath, out encoding);
                var current = Vdf.Parse(text).Path(LaunchPath(info.AppId));
                var value = current == null ? null : current.Value;
                if (Classify(value, echoRoot) != "set" && !backups.ContainsKey(account.AccountId)) continue;
                var previous = backups.Str(account.AccountId);
                string next;
                if (!string.IsNullOrEmpty(previous)) next = Vdf.SetValue(text, LaunchPath(info.AppId), previous);
                else next = Vdf.RemoveValue(text, LaunchPath(info.AppId));
                if (next != text)
                {
                    Backup(account.ConfigPath);
                    WriteText(account.ConfigPath, next, encoding);
                    changed++;
                }
                backups.Remove(account.AccountId);
                Refresh(account, info.AppId, echoRoot);
            }
            prefs.SteamBackups[info.AppId] = backups;
            prefs.Save();
            return changed;
        }
    }
}
