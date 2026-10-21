#!/usr/bin/env node
// Builds the ECHO Workshop edition of ShinawaseLoader: a `plugin-package` whose
// subscriber-approved `system:full` trusted module installs the Loader shipped
// under content/assets/. Two outputs, from the same files:
//   workshop/shinawase-loader/content   the Authoring Studio project content
//                                        (git-ignored; publish it from ECHO)
//   dist/shinawase-workshop.zip         the same content as one zip: ECHO's
//                                        Workshop page imports it, and the
//                                        Shinawase setup installs it with ECHO
//
//   node scripts/build-workshop-item.mjs [--zip <file> | --no-zip] [--ref <git rev>]
//                                        [--without-streaming] [--sdk <echo-workshop-sdk dir>]
//
// The Loader payload is the ShinawaseLoader/ tree git would commit (tracked and
// new files, minus .gitignore), or that tree at --ref, plus
// ShinawaseLoader/node_modules from `npm ci`. ECHO's Workshop validation rejects
// executable and script-host file types, so those are left out rather than
// repackaged: no node.exe, no compiled launcher, no native addon.
// --without-streaming also drops the streaming bridge, its npm dependencies and
// the Streaming package.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, readZip } from '../ShinawaseLoader/echomod-archive.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ITEM_ID = 'shinawase.loader';
export const WORKSHOP_ZIP_NAME = 'shinawase-workshop.zip';
export const NODE_MODULES_ARCHIVE = 'node_modules.zip';
export const MIN_ECHO_VERSION = '26.10.16';
export const SOURCE_URL = 'https://github.com/ChunchunOwO/ShinawaseLoader';
// Mirrors blockedWorkshopFileExtensions in ECHO's Workshop content validator.
export const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.clap', '.dll', '.dylib', '.exe', '.jar', '.msi', '.node', '.ps1', '.scr', '.so', '.sys', '.vbs', '.vst3']);
// The Windows Manager is a separate desktop app built from these sources by a
// PowerShell script; the Workshop install does not use it.
const EXCLUDED_PREFIXES = ['ShinawaseLoader/manager/'];
const STREAMING_ONLY = ['ShinawaseLoader/streaming-bridge.cjs', 'ShinawaseLoader/um_wasm_bg.wasm'];
const reservedName = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const invalidCharacter = /[<>:"|?*\u0000-\u001f]/u;

// Workshop manifest versions are three-part semver; 1.8.1.1 becomes 1.8.1-1.
export const workshopVersion = (loaderVersion) => {
  const parts = String(loaderVersion).split('.');
  if (parts.length === 3) return loaderVersion;
  if (parts.length === 4 && parts.every((part) => /^\d+$/u.test(part))) return `${parts.slice(0, 3).join('.')}-${parts[3]}`;
  throw new Error(`unsupported loader version: ${loaderVersion}`);
};

// Same rules as ECHO's normalizeWorkshopRelativePath.
export const workshopPathProblem = (path) => {
  if (!path || path.length > 240) return 'length';
  if (path.includes('\\') || path.startsWith('/') || /^[a-z]:/iu.test(path)) return 'absolute';
  for (const segment of path.split('/')) {
    if (!segment || segment === '.' || segment === '..') return 'segment';
    if (segment.endsWith('.') || segment.endsWith(' ')) return 'trailing';
    if (invalidCharacter.test(segment)) return 'character';
    if (reservedName.test(segment)) return 'reserved';
  }
  return null;
};

export const payloadIncluded = (repoPath, { streaming = true } = {}) => {
  if (BLOCKED_EXTENSIONS.has(extname(repoPath).toLowerCase())) return false;
  if (EXCLUDED_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) return false;
  if (!streaming && STREAMING_ONLY.includes(repoPath)) return false;
  return true;
};

const git = (args, options = {}) => {
  const result = spawnSync('git', args, { cwd: repoRoot, maxBuffer: 512 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || '')}`);
  return result.stdout;
};

const walk = (dir, base = dir, output = []) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      // npm's command shims are .cmd/.ps1/shell scripts the Loader never runs.
      if (entry.name === '.bin') continue;
      walk(full, base, output);
    } else if (entry.isFile()) {
      output.push(relative(base, full).split(sep).join('/'));
    }
  }
  return output;
};

// The inputs at a git revision, written to a temporary folder: what the mirror
// publishes must match the loader zip it builds from the same commit.
const materializeRef = (ref) => {
  const dir = mkdtempSync(join(tmpdir(), 'shinawase-workshop-ref-'));
  const zip = git(['archive', '--format=zip', ref, 'ShinawaseLoader', 'examples/packages', 'workshop/shinawase-loader']);
  for (const entry of readZip(zip, { maxEntries: 50000, maxBytes: 1024 * 1024 * 1024 })) {
    if (entry.path.endsWith('/')) continue;
    const target = join(dir, ...entry.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.data);
  }
  return dir;
};

const loaderFilesAt = (sourceRoot, fromRef) => {
  if (fromRef) return walk(join(sourceRoot, 'ShinawaseLoader')).map((rel) => `ShinawaseLoader/${rel}`);
  // Tracked plus new, not ignored files: the same set a commit would carry,
  // without runtime output (.gitignore covers state, logs, runtimes, node.exe).
  return String(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'ShinawaseLoader'], { encoding: 'utf8' }))
    .split('\0').filter(Boolean).filter((path) => existsSync(join(repoRoot, path)));
};

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const writeJson = (file, value) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const notice = (version, streaming) => `# ShinawaseLoader ${version} — Workshop edition

This Workshop item installs ShinawaseLoader, a community external Mod loader
for ECHO, into \`<ECHO>/ShinawaseLoader\`. It is not made by or affiliated with
the ECHO developers. Source code, the full installer and issue tracker:
${SOURCE_URL}

- \`assets/loader/\` is the Loader tree. It runs from an isolated copy of ECHO
  (\`ShinawaseLoader/modded-runtime\`); the stock ECHO executable and
  \`resources/app.asar\` are never modified.
- \`assets/packages/\` holds the bundled example Mods.
${streaming ? `- \`assets/loader/streaming-bridge.cjs\` bundles IPC modules from ECHO's
  open-source history under AGPL-3.0-only (provenance in each module header);
  the corresponding source is published in the repository above.
- \`assets/loader/node_modules.zip\` holds the third-party npm packages the
  streaming bridge needs (\`npm ci\` output without executables or scripts),
  under their own licenses, each kept with its package. The installer unpacks
  it into \`ShinawaseLoader/node_modules\`.
` : ''}`;

export const buildWorkshopItem = ({
  contentRoot = join(repoRoot, 'workshop', 'shinawase-loader', 'content'),
  zipPath = join(repoRoot, 'dist', WORKSHOP_ZIP_NAME),
  ref = null,
  streaming = true,
  exportedAt = new Date(),
} = {}) => {
  const sourceRoot = ref ? materializeRef(ref) : repoRoot;
  try {
    const projectRoot = join(sourceRoot, 'workshop', 'shinawase-loader');
    const loaderVersion = JSON.parse(readFileSync(join(sourceRoot, 'ShinawaseLoader', 'loader-version.json'), 'utf8')).version;
    const version = workshopVersion(loaderVersion);
    if (existsSync(contentRoot)) {
      const previous = existsSync(join(contentRoot, 'echo.workshop.json')) ? JSON.parse(readFileSync(join(contentRoot, 'echo.workshop.json'), 'utf8')) : null;
      if (previous && previous.id !== ITEM_ID) throw new Error(`refusing to clear ${contentRoot}: it holds another item`);
      if (!previous && readdirSync(contentRoot).length > 0) throw new Error(`refusing to clear ${contentRoot}: not a Workshop content folder`);
      rmSync(contentRoot, { recursive: true, force: true });
    }
    mkdirSync(contentRoot, { recursive: true });

    const problems = [];
    const copyInto = (source, target) => {
      const rel = relative(contentRoot, target).split(sep).join('/');
      const problem = workshopPathProblem(rel);
      if (problem) { problems.push(`${rel} (${problem})`); return; }
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(source, target);
    };

    const loaderTarget = join(contentRoot, 'assets', 'loader');
    let loaderFiles = 0;
    for (const repoPath of loaderFilesAt(sourceRoot, Boolean(ref))) {
      if (!payloadIncluded(repoPath, { streaming })) continue;
      copyInto(join(sourceRoot, repoPath), join(loaderTarget, repoPath.slice('ShinawaseLoader/'.length)));
      loaderFiles += 1;
    }
    let dependencyFiles = 0;
    if (streaming) {
      // npm ci output matches package-lock.json, which the ref carries too.
      // ECHO re-hashes every listed file on each call into the trusted module,
      // so the ~5000 third-party files travel as one archive; the blocked file
      // types are dropped before packing, exactly as for listed files.
      const modules = join(repoRoot, 'ShinawaseLoader', 'node_modules');
      if (!existsSync(modules)) throw new Error('ShinawaseLoader/node_modules is missing: run `npm --prefix ./ShinawaseLoader ci` first, or build --without-streaming');
      const entries = [];
      for (const rel of walk(modules).sort()) {
        if (BLOCKED_EXTENSIONS.has(extname(rel).toLowerCase())) continue;
        const problem = workshopPathProblem(`assets/loader/node_modules/${rel}`);
        if (problem) { problems.push(`node_modules/${rel} (${problem})`); continue; }
        entries.push({ path: rel, data: readFileSync(join(modules, rel)) });
      }
      mkdirSync(loaderTarget, { recursive: true });
      writeFileSync(join(loaderTarget, NODE_MODULES_ARCHIVE), createZip(entries));
      dependencyFiles = entries.length;
    }
    const packages = [];
    const packagesDir = join(sourceRoot, 'examples', 'packages');
    for (const name of readdirSync(packagesDir).filter((file) => file.endsWith('.echomod')).sort()) {
      if (!streaming && /streaming/iu.test(name)) continue;
      copyInto(join(packagesDir, name), join(contentRoot, 'assets', 'packages', name));
      packages.push(name);
    }
    if (problems.length) throw new Error(`paths ECHO's Workshop would reject:\n  ${problems.join('\n  ')}`);
    writeFileSync(join(contentRoot, 'assets', 'NOTICE.md'), notice(loaderVersion, streaming), 'utf8');

    const srcRoot = join(projectRoot, 'src');
    const sourceFiles = readdirSync(srcRoot).filter((name) => statSync(join(srcRoot, name)).isFile()).sort()
      .map((name) => ({ path: name, content: readFileSync(join(srcRoot, name), 'utf8').replace(/\r\n/gu, '\n') }));
    writeJson(join(contentRoot, 'community.echo'), {
      type: 'echo-plugin-package',
      version: 1,
      exportedAt: exportedAt.toISOString(),
      manifest: {
        id: ITEM_ID,
        name: 'ShinawaseLoader',
        version,
        apiVersion: 2,
        minEchoVersion: MIN_ECHO_VERSION,
        entry: 'plugin.js',
        trustedEntry: 'trusted.mjs',
        permissions: ['system:full'],
        contributes: {
          commands: [
            { id: 'open', title: 'Open ShinawaseLoader', description: 'Show the Loader status page.' },
            { id: 'restart-with-mods', title: 'Restart ECHO with Mods', description: 'Close ECHO and reopen it in the isolated runtime that loads Mods.', confirm: 'ECHO will close and reopen with ShinawaseLoader. Playback stops.' },
          ],
          panels: [
            { id: 'main', title: 'ShinawaseLoader', path: 'panel.html', description: 'Install the Loader and switch to the Mods runtime.', placement: 'page', group: 'plugins', icon: 'blocks' },
          ],
        },
      },
      files: sourceFiles,
    });

    const inventory = walk(contentRoot)
      .filter((rel) => rel.toLowerCase() !== 'echo.workshop.json')
      .map((rel) => ({ path: rel, size: lstatSync(join(contentRoot, rel)).size, sha256: sha256(join(contentRoot, rel)) }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const lowered = new Set();
    for (const file of inventory) {
      const key = file.path.toLowerCase();
      if (lowered.has(key)) throw new Error(`case collision: ${file.path}`);
      lowered.add(key);
    }
    writeJson(join(contentRoot, 'echo.workshop.json'), {
      type: 'echo-workshop-item',
      schemaVersion: 1,
      id: ITEM_ID,
      title: 'ShinawaseLoader',
      version,
      content: { kind: 'plugin-package', entry: 'community.echo' },
      compatibility: { minEchoVersion: MIN_ECHO_VERSION, pluginApiVersion: 2 },
      files: inventory,
      license: { id: 'LicenseRef-ShinawaseLoader', holder: 'ShinawaseLoader contributors', sourceUrl: SOURCE_URL },
    });

    let zip = null;
    if (zipPath) {
      // Content files at the zip root: ECHO's zip import expects echo.workshop.json there.
      const entries = walk(contentRoot).sort().map((rel) => ({ path: rel, data: readFileSync(join(contentRoot, rel)) }));
      const bytes = createZip(entries);
      mkdirSync(dirname(resolve(zipPath)), { recursive: true });
      writeFileSync(zipPath, bytes);
      zip = { path: resolve(zipPath), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    const totalBytes = inventory.reduce((sum, file) => sum + file.size, 0);
    return { id: ITEM_ID, loaderVersion, workshopVersion: version, streaming, ref, loaderFiles, dependencyFiles, packages, files: inventory.length, totalBytes, content: contentRoot, zip };
  } finally {
    if (ref) rmSync(sourceRoot, { recursive: true, force: true });
  }
};

const isMain = process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
  const argv = process.argv.slice(2);
  const option = (name) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  try {
    const result = buildWorkshopItem({
      zipPath: argv.includes('--no-zip') ? null : (option('--zip') ? resolve(option('--zip')) : undefined),
      ref: option('--ref') || null,
      streaming: !argv.includes('--without-streaming'),
    });
    console.log(JSON.stringify({ ...result, content: relative(repoRoot, result.content) }, null, 2));
    const sdkRoot = option('--sdk') || process.env.ECHO_WORKSHOP_SDK || null;
    if (sdkRoot) {
      const cli = join(resolve(sdkRoot), 'bin', 'echo-workshop-sdk.mjs');
      if (!existsSync(cli)) throw new Error(`no echo-workshop-sdk CLI at ${cli}`);
      const projectRoot = join(repoRoot, 'workshop', 'shinawase-loader');
      const check = spawnSync(process.execPath, [cli, 'validate', projectRoot], { cwd: projectRoot, encoding: 'utf8' });
      process.stdout.write(check.stdout || '');
      process.stderr.write(check.stderr || '');
      if (check.status !== 0) process.exitCode = check.status || 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
