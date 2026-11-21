#Requires -Version 5.1
<#
.SYNOPSIS
    只构建中文 asar，不安装。

.EXAMPLE
    .\build.ps1
    .\build.ps1 -AppDir "E:\Local\Programs\holaOS" -Out "D:\tmp\app.zh.asar"
#>
[CmdletBinding()]
param(
    [string]$AppDir,
    [string]$Out,
    [switch]$Stats
)

$ErrorActionPreference = 'Stop'
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Die($m) { Write-Host "[x] $m" -ForegroundColor Red; exit 1 }

if (-not $AppDir) {
    foreach ($root in @(
            'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
            'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
        )) {
        if (-not (Test-Path $root)) { continue }
        foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
            $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
            if (-not $p -or $p.DisplayName -notlike 'holaOS*') { continue }
            if ($p.InstallLocation -and (Test-Path (Join-Path $p.InstallLocation 'holaOS.exe'))) {
                $AppDir = (Resolve-Path $p.InstallLocation).Path; break
            }
        }
        if ($AppDir) { break }
    }
}
if (-not $AppDir) { $AppDir = Join-Path $env:LOCALAPPDATA 'Programs\holaOS' }
if (-not (Test-Path (Join-Path $AppDir 'holaOS.exe'))) { Die "找不到 holaOS：$AppDir（用 -AppDir 指定）" }

$ResDir = Join-Path $AppDir 'resources'
$Orig   = Join-Path $ResDir 'app.asar.orig'
$Asar   = Join-Path $ResDir 'app.asar'
# 优先用 pristine 备份；没有就用当前 asar
$Src = if (Test-Path $Orig) { $Orig } else { $Asar }
if (-not $Out) { $Out = Join-Path (Get-Location) 'app.zh.asar' }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $runner = $nodeCmd.Source; $useEnv = $false
} else {
    $runner = Join-Path $AppDir 'holaOS.exe'; $useEnv = $true
}

$jsArgs = @(
    (Join-Path $RepoRoot 'tools\zh-build.mjs'),
    '--src', $Src, '--out', $Out,
    '--dict', (Join-Path $RepoRoot 'dict'),
    '--with-main'
)
if ($Stats) { $jsArgs += '--stats' }

$prev = $env:ELECTRON_RUN_AS_NODE
if ($useEnv) { $env:ELECTRON_RUN_AS_NODE = '1' }
try { & $runner @jsArgs } finally {
    if ($useEnv) {
        if ($null -eq $prev) { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
        else { $env:ELECTRON_RUN_AS_NODE = $prev }
    }
}
if ($LASTEXITCODE -ne 0) { Die '构建失败' }

Write-Host ''
Write-Host "  built -> $Out" -ForegroundColor Green
Write-Host "  verify: powershell -File .\tools\zh-verify.mjs `"$Out`"  (或 node)" -ForegroundColor DarkGray
