#Requires -Version 5.1
<#
.SYNOPSIS
    holaOS 简体中文包 —— 回滚到原版

.EXAMPLE
    .\uninstall.ps1
    .\uninstall.ps1 -NoStart
#>
[CmdletBinding()]
param(
    [string]$AppDir,
    [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

function Die($m) { Write-Host "[x] $m" -ForegroundColor Red; exit 1 }

function Resolve-AppDir {
    param([string]$Explicit)
    if ($Explicit) {
        if (Test-Path (Join-Path $Explicit 'holaOS.exe')) { return (Resolve-Path $Explicit).Path }
        Die "指定目录里没有 holaOS.exe：$Explicit"
    }
    foreach ($root in @(
            'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
            'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
            'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
        )) {
        if (-not (Test-Path $root)) { continue }
        foreach ($k in Get-ChildItem $root -ErrorAction SilentlyContinue) {
            $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
            if (-not $p -or $p.DisplayName -notlike 'holaOS*') { continue }
            if ($p.InstallLocation -and (Test-Path (Join-Path $p.InstallLocation 'holaOS.exe'))) {
                return (Resolve-Path $p.InstallLocation).Path
            }
        }
    }
    foreach ($c in @(
            (Join-Path $env:LOCALAPPDATA 'Programs\holaOS'),
            (Join-Path $env:ProgramFiles 'holaOS')
        )) {
        if ($c -and (Test-Path (Join-Path $c 'holaOS.exe'))) { return $c }
    }
    Die '没找到 holaOS 安装目录，请用 -AppDir 指定'
}

$AppDir = Resolve-AppDir -Explicit $AppDir
$ResDir = Join-Path $AppDir 'resources'
$Asar   = Join-Path $ResDir 'app.asar'
$Orig   = Join-Path $ResDir 'app.asar.orig'
$Exe    = Join-Path $AppDir 'holaOS.exe'

if (-not (Test-Path $Orig)) {
    Die "没有原版备份 app.asar.orig，无法回滚。可用 holaOS 安装包修复安装。"
}

$procs = @(Get-Process -Name holaOS -ErrorAction SilentlyContinue)
if ($procs.Count) {
    Write-Host ("停止 " + $procs.Count + ' 个 holaOS 进程…') -ForegroundColor DarkGray
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
}

Copy-Item $Orig $Asar -Force
Write-Host ("已还原原版 app.asar (" + ('{0:N0}' -f (Get-Item $Asar).Length) + ' B)') -ForegroundColor Green

if ($NoStart) { exit 0 }

Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process $Exe
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $p = @(Get-Process -Name holaOS -ErrorAction SilentlyContinue)
    if ($p.Count -ge 3) {
        Write-Host ("已启动原版：t=" + [math]::Round($i * 0.5, 1) + 's') -ForegroundColor Green
        exit 0
    }
}
Write-Host '启动超时：检查 ELECTRON_RUN_AS_NODE 残留' -ForegroundColor Yellow
exit 1
