# Packs the slipwing command, its skill and the two Windows x64 programs into an installable npm tarball.
# Usage: pwsh scripts/pack.ps1 [-DesktopRepo ..\agent-desktop] [-BrowserRepo ..\agent-browser] [-Out dist]
#                              [-DesktopExe PATH] [-BrowserExe PATH]
# The programs come from the personal branches of narmi924/agent-desktop and narmi924/agent-browser. Without
# -DesktopExe and -BrowserExe both are built here with cargo (Visual Studio C++ build tools required).
param(
    [string]$DesktopRepo = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\agent-desktop'),
    [string]$BrowserRepo = (Join-Path (Split-Path -Parent $PSScriptRoot) '..\agent-browser'),
    [string]$Out = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'),
    [string]$DesktopExe,
    [string]$BrowserExe
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$DesktopRepo = (Resolve-Path $DesktopRepo).Path
$BrowserRepo = (Resolve-Path $BrowserRepo).Path
$bundle = Get-Content (Join-Path $repo 'bundle.json') -Raw | ConvertFrom-Json

function Find-VcVars {
    @('C:\Program Files\Microsoft Visual Studio', 'C:\Program Files (x86)\Microsoft Visual Studio') |
        Where-Object { Test-Path $_ } |
        ForEach-Object { Get-ChildItem $_ -Directory | ForEach-Object { Get-ChildItem $_.FullName -Directory } } |
        ForEach-Object { Join-Path $_.FullName 'VC\Auxiliary\Build\vcvars64.bat' } |
        Where-Object { Test-Path $_ } | Select-Object -First 1
}

function Build-Release([string]$directory, [string]$manifest, [string]$package) {
    $vcvars = Find-VcVars
    if (-not $vcvars) { throw 'Visual Studio C++ build tools were not found; pass -DesktopExe and -BrowserExe instead.' }
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    $what = if ($package) { "-p $package" } else { '' }
    & cmd.exe /c "cd /d `"$directory`" && call `"$vcvars`" >nul 2>&1 && cargo build --release --locked --manifest-path `"$manifest`" $what"
    if ($LASTEXITCODE -ne 0) { throw "cargo build failed for $manifest" }
}

if (-not $DesktopExe) {
    Build-Release $DesktopRepo (Join-Path $DesktopRepo 'Cargo.toml') 'agent-desktop'
    $DesktopExe = Join-Path $DesktopRepo 'target\release\agent-desktop.exe'
}
if (-not $BrowserExe) {
    Build-Release $BrowserRepo (Join-Path $BrowserRepo 'cli\Cargo.toml') ''
    $BrowserExe = Join-Path $BrowserRepo 'cli\target\release\agent-browser.exe'
}
foreach ($exe in $DesktopExe, $BrowserExe) {
    $reported = (& $exe --version | Out-String).Trim()
    if ($reported -notmatch '\+slipwing\.\d+\.\d+\.\d+$') { throw "$exe reports '$reported'; build it from the fork's personal branch, whose version ends in +slipwing.X.Y.Z." }
}

$null = New-Item -ItemType Directory -Force -Path $Out
$Out = (Resolve-Path -LiteralPath $Out).Path
$stage = Join-Path $repo ('tmp\pack-' + [IO.Path]::GetRandomFileName())
$bin = New-Item -ItemType Directory -Path (Join-Path $stage 'bin')
$browserBin = New-Item -ItemType Directory -Path (Join-Path $stage 'browser\bin')
$scripts = New-Item -ItemType Directory -Path (Join-Path $stage 'scripts')

Copy-Item -LiteralPath $DesktopExe -Destination (Join-Path $bin.FullName 'agent-desktop-win32-x64.exe')
Copy-Item -LiteralPath $BrowserExe -Destination (Join-Path $browserBin.FullName 'agent-browser-win32-x64.exe')
Copy-Item -LiteralPath (Join-Path $repo 'bin\workflow.js') -Destination $bin.FullName
Copy-Item -LiteralPath (Join-Path $repo 'scripts\initialize-state.ps1') -Destination $scripts.FullName
foreach ($file in 'lib', 'skills', 'bundle.json', 'LICENSE', 'NOTICE') {
    Copy-Item -LiteralPath (Join-Path $repo $file) -Destination $stage -Recurse
}

$repoUrl = 'https://github.com/narmi924/slipwing'
$raw = 'https://raw.githubusercontent.com/narmi924/slipwing/main/'
$readme = [IO.File]::ReadAllText((Join-Path $repo 'README.md'))
$readme = [regex]::Replace($readme, '(?m)^https://github\.com/user-attachments/assets/\S+\r?$',
    '[![Watch the 25-second demo](' + $raw + 'assets/Videos/slipwing-en.jpg)](' + $repoUrl + '#readme)')
$readme = $readme.Replace('](assets/slipwing-architecture.svg)', '](' + $raw + 'assets/slipwing-architecture.png)')
$readme = $readme.Replace('](assets/', '](' + $raw + 'assets/')
$readme = $readme.Replace('src="assets/', 'src="' + $raw + 'assets/')
$readme = $readme.Replace('](README.zh-CN.md)', '](' + $repoUrl + '/blob/main/README.zh-CN.md)')
$readme = $readme.Replace('](README.md)', '](' + $repoUrl + '#readme)')
[IO.File]::WriteAllText((Join-Path $stage 'README.md'), $readme)

$browser = Split-Path -Parent $browserBin.FullName
foreach ($file in 'skill-data', 'skills', 'LICENSE') {
    Copy-Item -LiteralPath (Join-Path $BrowserRepo $file) -Destination $browser -Recurse
}
Copy-Item -Path (Join-Path $BrowserRepo 'cli\src\native\a11y\LICENSE-axe-core*.txt') -Destination $browser

$manifest = [ordered]@{
    name = 'slipwing'
    version = $bundle.version
    description = 'Let any AI agent work in your Windows apps and browser in the background. A Windows build of agent-desktop and agent-browser.'
    license = 'Apache-2.0'
    repository = 'github:narmi924/slipwing'
    homepage = $repoUrl + '#readme'
    keywords = @('windows', 'ai-agent', 'computer-use', 'desktop-automation', 'browser-automation', 'ui-automation', 'mcp', 'agent-skills')
    bin = @{ slipwing = 'bin/workflow.js' }
    engines = @{ node = '>=22' }
    os = @('win32')
    cpu = @('x64')
    scripts = @{ postinstall = 'node bin/workflow.js skill --install' }
}
[IO.File]::WriteAllText((Join-Path $stage 'package.json'), ($manifest | ConvertTo-Json -Depth 4))
& npm.cmd pack $stage --pack-destination $Out --silent
if ($LASTEXITCODE -ne 0) { throw 'Could not pack Slipwing.' }
Remove-Item -LiteralPath $stage -Recurse -Force
