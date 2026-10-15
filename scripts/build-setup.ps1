[CmdletBinding()]
param(
  # Output installer. Default: release\ShinawaseSetup-<version>.exe
  [string]$OutFile,
  # Loader tree to bundle (default: <repo>\ShinawaseLoader).
  [string]$LoaderSource,
  # Folder with the bundled .echomod packages (default: <repo>\examples\packages).
  [string]$PackagesSource
)

# Builds ShinawaseSetup.exe: the Shinawase Manager with the loader tree and the
# bundled packages embedded. Double-clicked, it installs the manager per user
# (Start menu, optional desktop shortcut, Apps & features entry) and opens it.
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $LoaderSource) { $LoaderSource = Join-Path $ProjectRoot 'ShinawaseLoader' }
if (-not $PackagesSource) { $PackagesSource = Join-Path $ProjectRoot 'examples\packages' }
$LoaderSource = [IO.Path]::GetFullPath($LoaderSource)
$version = [string](Get-Content -Raw -LiteralPath (Join-Path $LoaderSource 'loader-version.json') | ConvertFrom-Json).version
if (-not $OutFile) { $OutFile = Join-Path $ProjectRoot "release\ShinawaseSetup-$version.exe" }
$OutFile = [IO.Path]::GetFullPath($OutFile)

$work = Join-Path ([IO.Path]::GetTempPath()) ('shinawase-setup-' + [guid]::NewGuid().ToString('N'))
$stage = Join-Path $work 'payload'
try {
  # Same exclusions as build-release.ps1: no dependencies, runtime copies,
  # native build intermediates, local state or credentials.
  $loaderTarget = Join-Path $stage 'ShinawaseLoader'
  New-Item -ItemType Directory -Force -Path $loaderTarget | Out-Null
  Get-ChildItem -LiteralPath $LoaderSource -Force |
    Where-Object { $_.Name -notin @('node.exe', 'node_modules', 'modded-runtime', 'loader-state.json', 'loader-debug.log', 'Logs', 'backups', 'native-host.json', '.api-token', 'ShinawaseManager.exe') } |
    ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $loaderTarget $_.Name) -Recurse -Force }
  Remove-Item -LiteralPath (Join-Path $loaderTarget 'native\build') -Recurse -Force -ErrorAction SilentlyContinue
  $packagesTarget = Join-Path $stage 'examples\packages'
  New-Item -ItemType Directory -Force -Path $packagesTarget | Out-Null
  if (Test-Path -LiteralPath $PackagesSource) {
    Get-ChildItem -LiteralPath $PackagesSource -Filter '*.echomod' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $packagesTarget }
  }

  # Zip with forward-slash entry names regardless of the .NET Framework default.
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zipPath = Join-Path $work 'payload.zip'
  $zip = [IO.Compression.ZipFile]::Open($zipPath, [IO.Compression.ZipArchiveMode]::Create)
  try {
    $prefix = $stage.TrimEnd('\') + '\'
    foreach ($file in Get-ChildItem -LiteralPath $stage -Recurse -File) {
      $name = $file.FullName.Substring($prefix.Length).Replace('\', '/')
      [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $name, [IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $zip.Dispose() }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
  & (Join-Path $PSScriptRoot 'build-manager.ps1') -Source (Join-Path $loaderTarget 'manager') -LoaderSource $loaderTarget -Payload $zipPath -OutFile $OutFile -Force | Out-Null
  $size = (Get-Item -LiteralPath $OutFile).Length / 1MB
  Write-Host ("ShinawaseSetup: {0} ({1:N1} MB, payload {2:N1} MB)" -f $OutFile, $size, ((Get-Item -LiteralPath $zipPath).Length / 1MB)) -ForegroundColor Green
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output $OutFile
