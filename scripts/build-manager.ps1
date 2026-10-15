[CmdletBinding()]
param(
  # Folder with the manager sources (*.cs and the *.xaml it embeds).
  [string]$Source,
  # Loader tree the manager installs from; passed as --source on -Launch.
  [string]$LoaderSource,
  # Output exe. Default: a per-source-hash cache under %LOCALAPPDATA%, so an
  # unchanged tree is compiled once.
  [string]$OutFile,
  # Optional zip embedded as Shinawase.Manager.Payload.zip; the result is a
  # self-installing ShinawaseSetup.exe (see build-setup.ps1).
  [string]$Payload,
  [switch]$Launch,
  [switch]$Force
)

# Compiles the Shinawase Manager (ShinawaseLoader/manager) with the C#
# compiler that ships with the .NET Framework, the same way the installer
# builds ECHO.modded.exe. No SDK, NuGet or network access is needed.
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Source) { $Source = Join-Path $ProjectRoot 'ShinawaseLoader\manager' }
$Source = [IO.Path]::GetFullPath($Source)
if (-not $LoaderSource) { $LoaderSource = Split-Path -Parent $Source }
$LoaderSource = [IO.Path]::GetFullPath($LoaderSource)

# Must match ManagerBuild.SourceHash in Engine.cs.
function Get-ManagerSourceHash([string]$Dir) {
  $files = @(Get-ChildItem -LiteralPath $Dir -File | Where-Object { $_.Extension -in @('.cs', '.xaml') })
  $names = [string[]]@($files | ForEach-Object { $_.Name })
  $keys = [string[]]@($names | ForEach-Object { $_.ToLowerInvariant() })
  [Array]::Sort($keys, $names, [StringComparer]::Ordinal)
  $sb = New-Object System.Text.StringBuilder
  foreach ($name in $names) {
    $text = [IO.File]::ReadAllText((Join-Path $Dir $name), [Text.Encoding]::UTF8).Replace("`r", '')
    [void]$sb.Append($name.ToLowerInvariant()).Append("`n").Append($text).Append("`n")
  }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($sb.ToString()))
    return (($bytes | ForEach-Object { $_.ToString('x2') }) -join '')
  } finally { $sha.Dispose() }
}

function Find-Csc {
  foreach ($path in @(
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'),
    (Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe')
  )) { if (Test-Path -LiteralPath $path) { return $path } }
  throw 'The .NET Framework C# compiler (csc.exe) was not found.'
}

function Invoke-ManagerCompile([string]$Csc, [string]$Out, [string]$Icon, [string]$Version, [string]$Hash, [string]$Work, [string]$PayloadZip) {
  $framework = Split-Path -Parent $Csc
  $info = Join-Path $Work 'BuildInfo.g.cs'
  $infoText = 'namespace Shinawase.Manager { public static class BuildInfo { public const string Version = "' + $Version + '"; public const string SourceHash = "' + $Hash + '"; } }' + "`n"
  [IO.File]::WriteAllText($info, $infoText, (New-Object System.Text.UTF8Encoding $false))
  $arguments = @('/nologo', '/target:winexe', '/optimize+', '/codepage:65001', "/out:$Out")
  if ($Icon) { $arguments += "/win32icon:$Icon" }
  foreach ($xaml in @(Get-ChildItem -LiteralPath $Source -Filter '*.xaml' -File | Sort-Object Name)) {
    $arguments += ('/resource:' + $xaml.FullName + ',Shinawase.Manager.' + $xaml.Name)
  }
  if ($PayloadZip) { $arguments += ('/resource:' + $PayloadZip + ',Shinawase.Manager.Payload.zip') }
  # Must match ManagerBuild.ReferenceNames in Engine.cs.
  foreach ($reference in @('System.dll', 'System.Core.dll', 'System.Xml.dll', 'System.Xaml.dll', 'System.Drawing.dll', 'System.Management.dll', 'System.Windows.Forms.dll',
      'System.Net.Http.dll', 'System.IO.Compression.dll', 'System.IO.Compression.FileSystem.dll', 'Microsoft.CSharp.dll',
      'WPF\PresentationFramework.dll', 'WPF\PresentationCore.dll', 'WPF\WindowsBase.dll')) {
    $arguments += ('/r:' + (Join-Path $framework $reference))
  }
  $sources = [string[]]@(Get-ChildItem -LiteralPath $Source -Filter '*.cs' -File | ForEach-Object { $_.FullName })
  [Array]::Sort($sources, [StringComparer]::OrdinalIgnoreCase)
  $arguments += $sources
  $arguments += $info
  $log = & $Csc @arguments 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Out)) {
    $errors = ($log -split "`r?`n" | Where-Object { $_ -match ': error ' }) -join "`n"
    if (-not $errors) { $errors = $log }
    throw "Shinawase Manager compilation failed:`n$errors"
  }
}

$versionFile = Join-Path $LoaderSource 'loader-version.json'
$version = if (Test-Path -LiteralPath $versionFile) { [string](Get-Content -Raw -LiteralPath $versionFile | ConvertFrom-Json).version } else { '0.0.0' }
$hash = Get-ManagerSourceHash $Source
if (-not $OutFile) {
  $base = if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { [IO.Path]::GetTempPath() }
  $OutFile = Join-Path $base ("ShinawaseLoader\manager-build\" + $hash.Substring(0, 16) + '\ShinawaseManager.exe')
}
$OutFile = [IO.Path]::GetFullPath($OutFile)

if ($Payload -and -not (Test-Path -LiteralPath $Payload)) { throw "Payload not found: $Payload" }
if ($Force -or $Payload -or -not (Test-Path -LiteralPath $OutFile)) {
  $csc = Find-Csc
  $work = Join-Path ([IO.Path]::GetTempPath()) ('shinawase-manager-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $work | Out-Null
  try {
    # Pass 1 builds a plain exe that draws the app icon; pass 2 embeds it.
    $plain = Join-Path $work 'ShinawaseManager.plain.exe'
    Invoke-ManagerCompile $csc $plain $null $version $hash $work
    $icon = Join-Path $work 'app.ico'
    $p = Start-Process -FilePath $plain -ArgumentList @('--write-icon', "`"$icon`"") -Wait -PassThru -WindowStyle Hidden
    if ($p.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $icon)) { $icon = $null }
    $built = Join-Path $work 'ShinawaseManager.exe'
    Invoke-ManagerCompile $csc $built $icon $version $hash $work $(if ($Payload) { [IO.Path]::GetFullPath($Payload) } else { $null })
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
    Copy-Item -LiteralPath $built -Destination $OutFile -Force
  } finally {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if ($Launch) {
  Start-Process -FilePath $OutFile -ArgumentList @('--source', "`"$LoaderSource`"") -WorkingDirectory (Split-Path -Parent $OutFile)
}
Write-Output $OutFile
