[CmdletBinding()]
param(
  [string]$OutputRoot,
  [switch]$NoZip
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputRoot) { $OutputRoot = Join-Path $ProjectRoot 'release' }
$versionInfo = Get-Content -Raw -LiteralPath (Join-Path $ProjectRoot 'ShinawaseLoader\loader-version.json') | ConvertFrom-Json
$version = [string]$versionInfo.version
if ([string]::IsNullOrWhiteSpace($version)) { throw 'loader version is missing.' }

$output = [IO.Path]::GetFullPath($OutputRoot)
$releaseName = "ShinawaseLoader-$version"
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $output $releaseName))
if (-not $releaseRoot.StartsWith($output.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'release path is outside output root.' }

New-Item -ItemType Directory -Force -Path $output | Out-Null
if (Test-Path -LiteralPath $releaseRoot) { Remove-Item -LiteralPath $releaseRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null

$loaderSource = Join-Path $ProjectRoot 'ShinawaseLoader'
$loaderTarget = Join-Path $releaseRoot 'ShinawaseLoader'
New-Item -ItemType Directory -Force -Path $loaderTarget | Out-Null
Get-ChildItem -LiteralPath $loaderSource -Force |
  Where-Object { $_.Name -notin @('node.exe', 'node_modules', 'modded-runtime', 'loader-state.json', 'loader-debug.log', 'Logs', 'backups', 'native-host.json', '.api-token') } |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $loaderTarget $_.Name) -Recurse -Force }
# node-gyp intermediates; the built addon (echo-native-host.node) is kept.
Remove-Item -LiteralPath (Join-Path $loaderTarget 'native\build') -Recurse -Force -ErrorAction SilentlyContinue

# Shinawase Manager (GUI installer/manager), compiled from the copied tree so
# the binary matches the shipped sources.
& (Join-Path $PSScriptRoot 'build-manager.ps1') -Source (Join-Path $loaderTarget 'manager') -LoaderSource $loaderTarget -OutFile (Join-Path $releaseRoot 'ShinawaseManager.exe') -Force | Out-Null
# Bundled packages the installer offers (Streaming, MV) and the extra one.
$packagesTarget = Join-Path $releaseRoot 'examples\packages'
New-Item -ItemType Directory -Force -Path $packagesTarget | Out-Null
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot 'examples\packages') -Filter '*.echomod' -File |
  ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $packagesTarget }

# One-file installer (manager + loader + packages) next to the zip.
& (Join-Path $PSScriptRoot 'build-setup.ps1') -LoaderSource $loaderTarget -PackagesSource $packagesTarget -OutFile (Join-Path $output "ShinawaseSetup-$version.exe") | Out-Null

Copy-Item -LiteralPath (Join-Path $ProjectRoot 'setup-modloader.bat') -Destination $releaseRoot
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'pack-mod.bat') -Destination $releaseRoot
New-Item -ItemType Directory -Force -Path (Join-Path $releaseRoot 'scripts') | Out-Null
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'scripts\setup-modloader.ps1') -Destination (Join-Path $releaseRoot 'scripts\setup-modloader.ps1')
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'scripts\pack-echomod.mjs') -Destination (Join-Path $releaseRoot 'scripts\pack-echomod.mjs')

@(
  '# ShinawaseLoader release',
  '',
  'This folder is the portable end-user release, not the development source tree.',
  '',
  '1. Run ShinawaseManager.exe (or setup-modloader.bat without arguments). ShinawaseSetup-<version>.exe next to this zip installs it with Start menu entry instead.',
  '2. It finds ECHO in your Steam libraries, installs with one click, picks the fastest download source,',
  '   and can write the Steam launch option for you:',
  '   "<game folder>\ECHO.modded.exe" %command%',
  '3. Or double-click ECHO.modded.exe / ShinawaseLoader\start-echo-with-mods.cmd.',
  '4. setup-modloader.bat -Action install -EchoRoot "<ECHO_ROOT>" still runs the console installer.',
  '',
  'ECHO.modded.exe is an independent host. It does not replace Steam ECHO.exe.',
  'Setup asks you to accept the ShinawaseLoader disclaimer. Normal launches do not ask again.',
  'ShinawaseLoader is separate from ECHO. Unlawful, commercial, profit-seeking, infringing, unauthorized or privacy-violating use is prohibited.',
  'The installer uses an external CDP connection and never patches Steam resources\app.asar.',
  'Install builds an isolated ShinawaseLoader\modded-runtime plus ECHO.modded.exe. -PatchApp is accepted for older callers and ignored.',
  'It downloads Node into the current user cache only when required.',
  'Drop Mod packages into Mods and Plugin packages into Plugins for automatic import.',
  'Logs are written to ShinawaseLoader\Logs\loader.log and ShinawaseLoader\Logs\errors.log.',
  'Launchers: ECHO.modded.exe, start-echo-with-mods.cmd, start-echo-debug.cmd, start-echo-safe.cmd, attach-to-echo.cmd.',
  'Use pack-mod.bat <package-directory> <output.echo> --zip to package a Mod or Plugin.',
  'Debug mode is for developing and debugging ShinawaseLoader, Plugins, and Mods.',
  ''
) | Set-Content -LiteralPath (Join-Path $releaseRoot 'README.md') -Encoding ASCII

@(
  "ShinawaseLoader $version",
  '',
  'This is the portable release output, not the development source tree.',
  'Run ShinawaseManager.exe to install, update, launch and manage Mods (setup-modloader.bat opens it too).',
  'Do not replace Steam ECHO.exe. Set Steam launch options to:',
  '"<game folder>\ECHO.modded.exe" %command%',
  'The installer downloads Node into the current user cache only when needed.'
) | Set-Content -LiteralPath (Join-Path $releaseRoot 'RELEASE.txt') -Encoding ASCII

if (-not $NoZip) {
  $zip = Join-Path $output "$releaseName.zip"
  Compress-Archive -LiteralPath $releaseRoot -DestinationPath $zip -Force
  Write-Host "Release ZIP: $zip" -ForegroundColor Green
}
Write-Host "Release folder: $releaseRoot" -ForegroundColor Green
