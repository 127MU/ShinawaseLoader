// Shared helpers for the Shinawase Manager: a small order-preserving JSON
// reader/writer, file-system helpers that never follow junctions, a process
// runner with timeouts, logging and persisted preferences.
// Compiled by the .NET Framework C# compiler (C# 5): no string interpolation,
// no null-conditional operators, no expression-bodied members.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Shinawase.Manager
{
    public sealed class JObject : Dictionary<string, object>
    {
        public JObject() : base(StringComparer.Ordinal) { }

        public string Str(string key)
        {
            object value;
            if (!TryGetValue(key, out value) || value == null) return null;
            return value as string ?? Convert.ToString(value, CultureInfo.InvariantCulture);
        }

        public bool? Bool(string key)
        {
            object value;
            if (!TryGetValue(key, out value) || !(value is bool)) return null;
            return (bool)value;
        }

        public double? Num(string key)
        {
            object value;
            if (!TryGetValue(key, out value) || value == null) return null;
            if (value is long) return (long)value;
            if (value is double) return (double)value;
            if (value is int) return (int)value;
            return null;
        }

        public JObject Obj(string key)
        {
            object value;
            if (!TryGetValue(key, out value)) return null;
            return value as JObject;
        }

        public List<object> Arr(string key)
        {
            object value;
            if (!TryGetValue(key, out value)) return null;
            return value as List<object>;
        }
    }

    public static class Json
    {
        public static object Parse(string text)
        {
            if (text == null) throw new FormatException("json_empty");
            var reader = new Reader(text.TrimStart('﻿'));
            reader.SkipWs();
            var value = reader.Value();
            reader.SkipWs();
            if (!reader.End) throw new FormatException("json_trailing");
            return value;
        }

        public static JObject ParseObject(string text)
        {
            var value = Parse(text) as JObject;
            if (value == null) throw new FormatException("json_not_object");
            return value;
        }

        public static JObject TryReadObject(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                return ParseObject(File.ReadAllText(path, Encoding.UTF8));
            }
            catch { return null; }
        }

        public static void WriteObject(string path, object value)
        {
            Fs.EnsureParent(path);
            Fs.WriteTextAtomic(path, Stringify(value, true) + "\n");
        }

        public static string Stringify(object value, bool pretty)
        {
            var sb = new StringBuilder();
            Write(sb, value, pretty, 0);
            return sb.ToString();
        }

        private static void Write(StringBuilder sb, object value, bool pretty, int depth)
        {
            if (value == null) { sb.Append("null"); return; }
            if (value is string) { WriteString(sb, (string)value); return; }
            if (value is bool) { sb.Append((bool)value ? "true" : "false"); return; }
            if (value is int || value is long) { sb.Append(Convert.ToInt64(value, CultureInfo.InvariantCulture).ToString(CultureInfo.InvariantCulture)); return; }
            if (value is double || value is float)
            {
                var d = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(d) || double.IsInfinity(d)) { sb.Append("null"); return; }
                if (d == Math.Floor(d) && Math.Abs(d) < 9e15) sb.Append(((long)d).ToString(CultureInfo.InvariantCulture));
                else sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
                return;
            }
            var dict = value as IDictionary<string, object>;
            if (dict != null)
            {
                if (dict.Count == 0) { sb.Append("{}"); return; }
                sb.Append('{');
                var first = true;
                foreach (var pair in dict)
                {
                    if (!first) sb.Append(',');
                    first = false;
                    if (pretty) { sb.Append('\n'); sb.Append(' ', (depth + 1) * 2); }
                    WriteString(sb, pair.Key);
                    sb.Append(pretty ? ": " : ":");
                    Write(sb, pair.Value, pretty, depth + 1);
                }
                if (pretty) { sb.Append('\n'); sb.Append(' ', depth * 2); }
                sb.Append('}');
                return;
            }
            var list = value as System.Collections.IEnumerable;
            if (list != null)
            {
                var items = list.Cast<object>().ToList();
                if (items.Count == 0) { sb.Append("[]"); return; }
                sb.Append('[');
                for (var i = 0; i < items.Count; i++)
                {
                    if (i > 0) sb.Append(',');
                    if (pretty) { sb.Append('\n'); sb.Append(' ', (depth + 1) * 2); }
                    Write(sb, items[i], pretty, depth + 1);
                }
                if (pretty) { sb.Append('\n'); sb.Append(' ', depth * 2); }
                sb.Append(']');
                return;
            }
            WriteString(sb, Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        private static void WriteString(StringBuilder sb, string text)
        {
            sb.Append('"');
            foreach (var ch in text)
            {
                switch (ch)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
                        else sb.Append(ch);
                        break;
                }
            }
            sb.Append('"');
        }

        private sealed class Reader
        {
            private readonly string text;
            private int pos;
            public Reader(string text) { this.text = text; }
            public bool End { get { return pos >= text.Length; } }

            public void SkipWs()
            {
                while (pos < text.Length && char.IsWhiteSpace(text[pos])) pos++;
            }

            private char Peek()
            {
                if (pos >= text.Length) throw new FormatException("json_eof");
                return text[pos];
            }

            public object Value()
            {
                SkipWs();
                var ch = Peek();
                if (ch == '{') return Obj();
                if (ch == '[') return Arr();
                if (ch == '"') return Str();
                if (ch == 't') { Expect("true"); return true; }
                if (ch == 'f') { Expect("false"); return false; }
                if (ch == 'n') { Expect("null"); return null; }
                return Number();
            }

            private void Expect(string word)
            {
                if (string.CompareOrdinal(text, pos, word, 0, word.Length) != 0) throw new FormatException("json_token");
                pos += word.Length;
            }

            private JObject Obj()
            {
                var result = new JObject();
                pos++;
                SkipWs();
                if (Peek() == '}') { pos++; return result; }
                while (true)
                {
                    SkipWs();
                    if (Peek() != '"') throw new FormatException("json_key");
                    var key = Str();
                    SkipWs();
                    if (Peek() != ':') throw new FormatException("json_colon");
                    pos++;
                    result[key] = Value();
                    SkipWs();
                    var ch = Peek();
                    pos++;
                    if (ch == '}') return result;
                    if (ch != ',') throw new FormatException("json_comma");
                }
            }

            private List<object> Arr()
            {
                var result = new List<object>();
                pos++;
                SkipWs();
                if (Peek() == ']') { pos++; return result; }
                while (true)
                {
                    result.Add(Value());
                    SkipWs();
                    var ch = Peek();
                    pos++;
                    if (ch == ']') return result;
                    if (ch != ',') throw new FormatException("json_comma");
                }
            }

            private string Str()
            {
                var sb = new StringBuilder();
                pos++;
                while (true)
                {
                    var ch = Peek();
                    pos++;
                    if (ch == '"') return sb.ToString();
                    if (ch != '\\') { sb.Append(ch); continue; }
                    var esc = Peek();
                    pos++;
                    switch (esc)
                    {
                        case 'n': sb.Append('\n'); break;
                        case 'r': sb.Append('\r'); break;
                        case 't': sb.Append('\t'); break;
                        case 'b': sb.Append('\b'); break;
                        case 'f': sb.Append('\f'); break;
                        case 'u':
                            if (pos + 4 > text.Length) throw new FormatException("json_escape");
                            sb.Append((char)int.Parse(text.Substring(pos, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                            pos += 4;
                            break;
                        default: sb.Append(esc); break;
                    }
                }
            }

            private object Number()
            {
                var start = pos;
                while (pos < text.Length && "+-0123456789.eE".IndexOf(text[pos]) >= 0) pos++;
                var token = text.Substring(start, pos - start);
                if (token.Length == 0) throw new FormatException("json_value");
                long whole;
                if (token.IndexOfAny(new[] { '.', 'e', 'E' }) < 0 && long.TryParse(token, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out whole)) return whole;
                return double.Parse(token, NumberStyles.Float, CultureInfo.InvariantCulture);
            }
        }
    }

    public static class Paths
    {
        public static string UserDataRoot
        {
            get
            {
                var baseDir = Environment.GetEnvironmentVariable("LOCALAPPDATA");
                if (string.IsNullOrEmpty(baseDir)) baseDir = Path.GetTempPath();
                return Path.Combine(baseDir, "ShinawaseLoader");
            }
        }

        public static string SelectionFile { get { return Path.Combine(UserDataRoot, "selection.json"); } }
        public static string RuntimeCache { get { return Path.Combine(UserDataRoot, "runtimes"); } }
        public static string PrefsFile { get { return Path.Combine(UserDataRoot, "manager.json"); } }
        public static string LogDir { get { return Path.Combine(UserDataRoot, "manager-logs"); } }
        public static string DownloadCache { get { return Path.Combine(UserDataRoot, "downloads"); } }

        public static string Full(string path)
        {
            try { return Path.GetFullPath(path).TrimEnd('\\', '/'); }
            catch { return path; }
        }

        public static bool Same(string left, string right)
        {
            if (string.IsNullOrEmpty(left) || string.IsNullOrEmpty(right)) return false;
            return string.Equals(Full(left), Full(right), StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsUnder(string child, string parent)
        {
            var c = Full(child) + "\\";
            var p = Full(parent) + "\\";
            return c.StartsWith(p, StringComparison.OrdinalIgnoreCase);
        }
    }

    public static class Log
    {
        private static readonly object Gate = new object();
        public static event Action<string> Line;
        public static string FilePath { get { return Path.Combine(Paths.LogDir, "manager.log"); } }

        public static void Info(string message) { Write("INFO", message); }
        public static void Warn(string message) { Write("WARN", message); }
        public static void Error(string message) { Write("ERROR", message); }

        public static void Write(string level, string message)
        {
            var line = "[" + DateTime.Now.ToString("HH:mm:ss", CultureInfo.InvariantCulture) + "] " + (level == "INFO" ? "" : level + " ") + message;
            lock (Gate)
            {
                try
                {
                    Directory.CreateDirectory(Paths.LogDir);
                    var info = new FileInfo(FilePath);
                    if (info.Exists && info.Length > 2 * 1024 * 1024)
                    {
                        var old = FilePath + ".1";
                        if (File.Exists(old)) File.Delete(old);
                        File.Move(FilePath, old);
                    }
                    File.AppendAllText(FilePath, "[" + DateTime.Now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) + " " + line.Substring(1), Encoding.UTF8);
                    File.AppendAllText(FilePath, Environment.NewLine, Encoding.UTF8);
                }
                catch { }
            }
            var handler = Line;
            if (handler != null)
            {
                try { handler(line); } catch { }
            }
        }
    }

    public static class Versions
    {
        // Same ordering as compareVersions() in ShinawaseLoader.mjs.
        public static int Compare(string left, string right)
        {
            var a = Parts(left);
            var b = Parts(right);
            var len = Math.Max(a.Length, b.Length);
            for (var i = 0; i < len; i++)
            {
                var x = i < a.Length ? a[i] : 0;
                var y = i < b.Length ? b[i] : 0;
                if (x > y) return 1;
                if (x < y) return -1;
            }
            return 0;
        }

        private static long[] Parts(string value)
        {
            var text = string.IsNullOrEmpty(value) ? "0" : value;
            return System.Text.RegularExpressions.Regex.Split(text, "[^0-9]+")
                .Where(p => p.Length > 0)
                .Select(p => { long n; return long.TryParse(p, out n) ? n : 0; })
                .ToArray();
        }
    }

    public static class Fs
    {
        public static void EnsureParent(string path)
        {
            var dir = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        }

        public static void WriteTextAtomic(string path, string text)
        {
            EnsureParent(path);
            var temp = path + ".tmp-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            File.WriteAllText(temp, text, new UTF8Encoding(false));
            if (File.Exists(path))
            {
                try { File.Replace(temp, path, null); return; }
                catch { }
                File.Copy(temp, path, true);
                File.Delete(temp);
                return;
            }
            File.Move(temp, path);
        }

        public static bool IsReparsePoint(string path)
        {
            try { return (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0; }
            catch { return false; }
        }

        // Copies a directory tree. Junctions and symbolic links are never entered
        // or reproduced: a loader tree must not drag a runtime copy along with it.
        // `skip` holds paths relative to `source` ("Logs", @"native\build").
        public static void CopyTree(string source, string target, ICollection<string> skip, Action<string> onFile)
        {
            CopyTree(source, target, skip, onFile, "");
        }

        private static void CopyTree(string source, string target, ICollection<string> skip, Action<string> onFile, string prefix)
        {
            Directory.CreateDirectory(target);
            foreach (var entry in new DirectoryInfo(source).GetFileSystemInfos())
            {
                var relative = prefix.Length == 0 ? entry.Name : prefix + "\\" + entry.Name;
                if (skip != null && skip.Contains(relative, StringComparer.OrdinalIgnoreCase)) continue;
                if ((entry.Attributes & FileAttributes.ReparsePoint) != 0) continue;
                var dest = Path.Combine(target, entry.Name);
                if ((entry.Attributes & FileAttributes.Directory) != 0)
                {
                    CopyTree(entry.FullName, dest, skip, onFile, relative);
                }
                else
                {
                    CopyFile(entry.FullName, dest);
                    if (onFile != null) onFile(dest);
                }
            }
        }

        public static void CopyFile(string source, string dest)
        {
            EnsureParent(dest);
            if (File.Exists(dest))
            {
                var attrs = File.GetAttributes(dest);
                if ((attrs & FileAttributes.ReadOnly) != 0) File.SetAttributes(dest, attrs & ~FileAttributes.ReadOnly);
            }
            File.Copy(source, dest, true);
        }

        // Deletes a directory tree without ever following a junction or symbolic
        // link: the isolated runtime links into the Steam ECHO folder, so
        // recursing through a link would delete the user's game files.
        public static void DeleteTree(string path)
        {
            if (!Directory.Exists(path)) return;
            if (IsReparsePoint(path))
            {
                Directory.Delete(path, false);
                return;
            }
            foreach (var file in Directory.GetFiles(path))
            {
                try { File.SetAttributes(file, FileAttributes.Normal); } catch { }
                File.Delete(file);
            }
            foreach (var dir in Directory.GetDirectories(path))
            {
                if (IsReparsePoint(dir)) Directory.Delete(dir, false);
                else DeleteTree(dir);
            }
            Directory.Delete(path, false);
        }

        public static string Sha256File(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
            {
                return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
            }
        }

        public static string Sha256Text(string text)
        {
            using (var sha = SHA256.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "").ToLowerInvariant();
            }
        }

        public static void TryDelete(string path)
        {
            try
            {
                if (File.Exists(path)) { File.SetAttributes(path, FileAttributes.Normal); File.Delete(path); }
                else if (Directory.Exists(path)) DeleteTree(path);
            }
            catch { }
        }

        public static string FormatBytes(double bytes)
        {
            if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024.0 * 1024 * 1024)).ToString("0.0", CultureInfo.InvariantCulture) + " GB";
            if (bytes >= 1024 * 1024) return (bytes / (1024.0 * 1024)).ToString("0.0", CultureInfo.InvariantCulture) + " MB";
            if (bytes >= 1024) return (bytes / 1024.0).ToString("0", CultureInfo.InvariantCulture) + " KB";
            return ((long)bytes).ToString(CultureInfo.InvariantCulture) + " B";
        }
    }

    public sealed class ProcResult
    {
        public int ExitCode;
        public bool TimedOut;
        public string StdOut;
        public string StdErr;
        public string Tail(int lines)
        {
            var all = ((StdErr ?? "") + "\n" + (StdOut ?? "")).Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
            return string.Join(" ", all.Skip(Math.Max(0, all.Length - lines)).Select(l => l.Trim())).Trim();
        }
    }

    public static class Proc
    {
        public static string Quote(string value)
        {
            if (value == null) return "\"\"";
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) return value;
            var sb = new StringBuilder("\"");
            var backslashes = 0;
            foreach (var ch in value)
            {
                if (ch == '\\') { backslashes++; continue; }
                if (ch == '"') { sb.Append('\\', backslashes * 2 + 1); sb.Append('"'); backslashes = 0; continue; }
                sb.Append('\\', backslashes);
                backslashes = 0;
                sb.Append(ch);
            }
            sb.Append('\\', backslashes * 2);
            sb.Append('"');
            return sb.ToString();
        }

        public static Task<ProcResult> RunAsync(string file, IEnumerable<string> args, string cwd, IDictionary<string, string> env, int timeoutMs, Action<string> onLine, CancellationToken token)
        {
            var info = new ProcessStartInfo
            {
                FileName = file,
                Arguments = string.Join(" ", args.Select(Quote)),
                WorkingDirectory = string.IsNullOrEmpty(cwd) ? Environment.CurrentDirectory : cwd,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                RedirectStandardInput = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            if (env != null)
            {
                foreach (var pair in env)
                {
                    if (pair.Value == null) info.EnvironmentVariables.Remove(pair.Key);
                    else info.EnvironmentVariables[pair.Key] = pair.Value;
                }
            }
            var tcs = new TaskCompletionSource<ProcResult>();
            var stdout = new StringBuilder();
            var stderr = new StringBuilder();
            var process = new Process { StartInfo = info, EnableRaisingEvents = true };
            var outDone = new ManualResetEventSlim(false);
            var errDone = new ManualResetEventSlim(false);
            process.OutputDataReceived += (s, e) =>
            {
                if (e.Data == null) { outDone.Set(); return; }
                lock (stdout) stdout.AppendLine(e.Data);
                if (onLine != null) onLine(e.Data);
            };
            process.ErrorDataReceived += (s, e) =>
            {
                if (e.Data == null) { errDone.Set(); return; }
                lock (stderr) stderr.AppendLine(e.Data);
                if (onLine != null) onLine(e.Data);
            };
            var finished = 0;
            Action<bool> finish = timedOut =>
            {
                if (Interlocked.Exchange(ref finished, 1) == 1) return;
                if (timedOut) KillTree(process);
                outDone.Wait(3000);
                errDone.Wait(3000);
                int code;
                try { code = timedOut ? 124 : process.ExitCode; } catch { code = -1; }
                tcs.TrySetResult(new ProcResult { ExitCode = code, TimedOut = timedOut, StdOut = stdout.ToString(), StdErr = stderr.ToString() });
                try { process.Dispose(); } catch { }
            };
            process.Exited += (s, e) => Task.Run(() => finish(false));
            try
            {
                process.Start();
            }
            catch (Exception error)
            {
                tcs.TrySetException(error);
                return tcs.Task;
            }
            try { process.StandardInput.Close(); } catch { }
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            if (timeoutMs > 0)
            {
                Task.Delay(timeoutMs).ContinueWith(_ => finish(true));
            }
            if (token.CanBeCanceled)
            {
                token.Register(() => finish(true));
            }
            return tcs.Task;
        }

        public static void KillTree(Process process)
        {
            try
            {
                if (process.HasExited) return;
                var kill = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + process.Id + " /T /F") { CreateNoWindow = true, UseShellExecute = false });
                if (kill != null) kill.WaitForExit(5000);
            }
            catch { }
            try { if (!process.HasExited) process.Kill(); } catch { }
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(int access, bool inherit, int pid);
        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        private static extern bool QueryFullProcessImageName(IntPtr handle, int flags, StringBuilder name, ref int size);
        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        public static string ImagePath(Process process)
        {
            IntPtr handle = IntPtr.Zero;
            try
            {
                handle = OpenProcess(0x1000, false, process.Id); // PROCESS_QUERY_LIMITED_INFORMATION
                if (handle == IntPtr.Zero) return null;
                var sb = new StringBuilder(1024);
                var size = sb.Capacity;
                return QueryFullProcessImageName(handle, 0, sb, ref size) ? sb.ToString() : null;
            }
            catch { return null; }
            finally { if (handle != IntPtr.Zero) CloseHandle(handle); }
        }

        // Processes whose image is one of `images` (full paths, case-insensitive).
        public static List<Process> FindByImage(IEnumerable<string> images, params string[] names)
        {
            var wanted = new HashSet<string>(images.Select(Paths.Full), StringComparer.OrdinalIgnoreCase);
            var found = new List<Process>();
            foreach (var name in names)
            {
                foreach (var process in Process.GetProcessesByName(name))
                {
                    var image = ImagePath(process);
                    if (image != null && wanted.Contains(Paths.Full(image))) found.Add(process);
                    else process.Dispose();
                }
            }
            return found;
        }
    }

    public abstract class Bindable : INotifyPropertyChanged
    {
        public event PropertyChangedEventHandler PropertyChanged;
        protected void Raise(string name)
        {
            var handler = PropertyChanged;
            if (handler != null) handler(this, new PropertyChangedEventArgs(name));
        }
        protected bool Set<T>(ref T field, T value, string name)
        {
            if (EqualityComparer<T>.Default.Equals(field, value)) return false;
            field = value;
            Raise(name);
            return true;
        }
    }

    // Manager-only preferences live in manager.json. Values shared with the
    // PowerShell installer and the loader (target, locale, download source) stay
    // in selection.json so every entry point agrees on them.
    public sealed class Prefs
    {
        public string Theme = "system";
        public bool Motion = true;
        public bool AutoCheck = true;
        public bool AutoMirror = true;
        public bool UseShinawaseMirror = true;
        public JObject SteamBackups = new JObject();

        public static Prefs Load()
        {
            var prefs = new Prefs();
            var data = Json.TryReadObject(Paths.PrefsFile);
            if (data == null) return prefs;
            var theme = data.Str("theme");
            if (theme == "light" || theme == "dark" || theme == "system") prefs.Theme = theme;
            prefs.Motion = data.Bool("motion") ?? true;
            prefs.AutoCheck = data.Bool("autoCheck") ?? true;
            prefs.AutoMirror = data.Bool("autoMirror") ?? true;
            prefs.UseShinawaseMirror = data.Bool("useShinawaseMirror") ?? true;
            prefs.SteamBackups = data.Obj("steamBackups") ?? new JObject();
            return prefs;
        }

        public void Save()
        {
            try
            {
                var data = Json.TryReadObject(Paths.PrefsFile) ?? new JObject();
                data["theme"] = Theme;
                data["motion"] = Motion;
                data["autoCheck"] = AutoCheck;
                data["autoMirror"] = AutoMirror;
                data["useShinawaseMirror"] = UseShinawaseMirror;
                data["steamBackups"] = SteamBackups;
                Json.WriteObject(Paths.PrefsFile, data);
            }
            catch (Exception error) { Log.Warn("prefs save failed: " + error.Message); }
        }
    }

    public static class Selection
    {
        public static JObject Read()
        {
            return Json.TryReadObject(Paths.SelectionFile) ?? new JObject();
        }

        public static void Update(IDictionary<string, object> values)
        {
            try
            {
                var data = Read();
                foreach (var pair in values) data[pair.Key] = pair.Value;
                Json.WriteObject(Paths.SelectionFile, data);
            }
            catch (Exception error) { Log.Warn("selection save failed: " + error.Message); }
        }
    }
}
