#Requires -Version 5.1
<#
.SYNOPSIS
    holaOS 简体中文包 —— 一键安装

.DESCRIPTION
    1) 自动定位本机 holaOS 安装目录
    2) 备份原版 app.asar -> app.asar.orig（只备份一次）
    3) 用本仓库词表把英文界面文案换成中文，产出中文 asar 并校验
    4) 换入并启动

    不需要预装 Node：找不到 node 时用 holaOS.exe 自带的 Electron 运行时
    （ELECTRON_RUN_AS_NODE=1）执行构建脚本。

.PARAMETER AppDir
    holaOS 安装目录。默认自动探测（注册表 -> %LOCALAPPDATA%\Programs\holaOS -> Program Files）。

.PARAMETER AsarPath
    直接使用现成的中文 asar，跳过构建。

.PARAMETER NoStart
    只安装，不启动。

.PARAMETER Clean
    忽略缓存，强制重新构建。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\install.ps1

.EXAMPLE
    .\install.ps1 -Clean -NoStart
#>
[CmdletBinding()]
param(
    [string]$AppDir,
    [string]$AsarPath,
    [switch]$NoStart,
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
try {
    $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch { }

$RepoSlug  = 'SuJan1998/holaos-zh'
$RepoBranch = 'main'
$CacheDir  = Join-Path $env:LOCALAPPDATA 'holaos-zh'
$CacheAsar = Join-Path $CacheDir 'app.zh.asar'
$StatePath = Join-Path $CacheDir 'state.json'
$BuildLog  = Join-Path $CacheDir 'build.log'
$VerifyLog = Join-Path $CacheDir 'verify.log'
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

# 脚本来源解析：直接跑（有脚本路径）或 irm | iex 管道（无路径 -> 自取源码包）
$RepoRoot = $null
if ($MyInvocation.MyCommand.Path) {
    $cand = Split-Path -Parent $MyInvocation.MyCommand.Path
    if (Test-Path (Join-Path $cand 'tools\zh-build.mjs')) { $RepoRoot = $cand }
}
if (-not $RepoRoot) {
    Write-Host '  下载源码包 …' -ForegroundColor DarkGray
    $zip = Join-Path $CacheDir 'src.zip'
    $dst = Join-Path $CacheDir 'src'
    if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri "https://codeload.github.com/$RepoSlug/zip/refs/heads/$RepoBranch" -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $dst -Force
    Remove-Item $zip -Force
    $inner = Get-ChildItem $dst -Directory | Select-Object -First 1
    if (-not $inner -or -not (Test-Path (Join-Path $inner.FullName 'tools\zh-build.mjs'))) {
        Write-Host '[x] 源码包内容异常' -ForegroundColor Red; exit 1
    }
    $RepoRoot = $inner.FullName
}

function Say($msg, $color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Die($msg) { Say ''; Say "[x] $msg" 'Red'; exit 1 }

Say ''
Say '  holaOS 简体中文包 · installer' 'Cyan'
Say '  -------------------------------------------' 'DarkGray'

# ------------------------------------------------------------------ 1. 定位安装
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
            if ($p.UninstallString -match '"([^"]+)\\Uninstall') {
                $guess = $Matches[1]
                if (Test-Path (Join-Path $guess 'holaOS.exe')) { return $guess }
            }
        }
    }

    $cands = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\holaOS'),
        (Join-Path $env:ProgramFiles 'holaOS')
    )
    if (${env:ProgramFiles(x86)}) { $cands += (Join-Path ${env:ProgramFiles(x86)} 'holaOS') }
    foreach ($c in $cands) {
        if ($c -and (Test-Path (Join-Path $c 'holaOS.exe'))) { return $c }
    }
    Die '没找到 holaOS 安装目录。请用 -AppDir "D:\path\to\holaOS" 指定'
}

$AppDir = Resolve-AppDir -Explicit $AppDir
$ResDir = Join-Path $AppDir 'resources'
$Asar   = Join-Path $ResDir 'app.asar'
$Orig   = Join-Path $ResDir 'app.asar.orig'
$Exe    = Join-Path $AppDir 'holaOS.exe'

if (-not (Test-Path $Asar)) { Die "找不到 app.asar：$Asar" }
Say ("  app dir   " + $AppDir) 'DarkGray'

# ------------------------------------------------------------------ 2. Node 运行时
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $RunnerPath = $nodeCmd.Source
    $RunnerEnv  = $false
} else {
    $RunnerPath = $Exe
    $RunnerEnv  = $true
}
Say ("  node      " + $RunnerPath + $(if ($RunnerEnv) { '  (via ELECTRON_RUN_AS_NODE)' } else { '' })) 'DarkGray'

function Invoke-Js {
    param([string[]]$JsArgs, [string]$LogPath)
    $prev = $env:ELECTRON_RUN_AS_NODE
    if ($RunnerEnv) { $env:ELECTRON_RUN_AS_NODE = '1' }
    try {
        $out  = & $RunnerPath @JsArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        if ($RunnerEnv) {
            if ($null -eq $prev) { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
            else { $env:ELECTRON_RUN_AS_NODE = $prev }
        }
    }
    $lines = @($out | ForEach-Object { "$_" })
    if ($LogPath) { $lines | Set-Content $LogPath -Encoding utf8 }
    foreach ($l in $lines) { Write-Host ("    " + $l) -ForegroundColor DarkGray }
    return $code
}

# ------------------------------------------------------------------ 3. 备份原版
New-Item -ItemType Directory -Force -Path $CacheDir | Out-Null

$state = $null
if (Test-Path $StatePath) {
    try { $state = Get-Content $StatePath -Raw | ConvertFrom-Json } catch { $state = $null }
}

if (-not (Test-Path $Orig)) {
    $curSize = (Get-Item $Asar).Length
    if ($state -and $state.appDir -eq $AppDir -and $state.zhAsarSize -eq $curSize) {
        Die '当前 app.asar 已经是中文版，且没有原版备份 app.asar.orig。请先用 holaOS 安装包修复/重装，再装本汉化包。'
    }
    Copy-Item $Asar $Orig
    Say ("  backup    app.asar -> app.asar.orig  (" + ('{0:N0}' -f $curSize) + ' B)') 'DarkGray'
} else {
    Say ("  backup    " + $Orig + '  (' + ('{0:N0}' -f (Get-Item $Orig).Length) + ' B)') 'DarkGray'
}

# ------------------------------------------------------------------ 4. 取得中文 asar
if ($AsarPath) {
    if (-not (Test-Path $AsarPath)) { Die "找不到指定的 asar：$AsarPath" }
    Say ("  asar      " + $AsarPath + '  (given)') 'DarkGray'
    $SourceAsar = (Resolve-Path $AsarPath).Path
} else {
    $needBuild = $Clean.IsPresent -or -not (Test-Path $CacheAsar)
    if (-not $needBuild -and $state) {
        $o = Get-Item $Orig
        if ($state.srcSize -ne $o.Length -or $state.srcMtime -ne $o.LastWriteTimeUtc.ToString('o')) {
            Say '  note      holaOS 原版 asar 有变动，重新构建' 'Yellow'
            $needBuild = $true
        }
    }

    if ($needBuild) {
        Say ''
        Say '  [1/3] build' 'Cyan'
        $tmpOut = "$CacheAsar.tmp"
        if (Test-Path $tmpOut) { Remove-Item $tmpOut -Force }
        $code = Invoke-Js -LogPath $BuildLog -JsArgs @(
            (Join-Path $RepoRoot 'tools\zh-build.mjs'),
            '--src', $Orig,
            '--out', $tmpOut,
            '--dict', (Join-Path $RepoRoot 'dict'),
            '--with-main',
            '--stats'
        )
        if ($code -ne 0 -or -not (Test-Path $tmpOut)) {
            Die ("构建失败，完整日志：" + $BuildLog)
        }
        Move-Item $tmpOut $CacheAsar -Force
        $o = Get-Item $Orig
        $rev = ''
        try { $rev = (git -C $RepoRoot rev-parse --short HEAD 2>$null) } catch { }
        @{
            appDir     = $AppDir
            srcSize    = $o.Length
            srcMtime   = $o.LastWriteTimeUtc.ToString('o')
            zhAsarSize = (Get-Item $CacheAsar).Length
            builtAt    = (Get-Date).ToString('o')
            repoRev    = "$rev"
        } | ConvertTo-Json | Set-Content $StatePath -Encoding utf8
        Say ("  built     " + $CacheAsar + '  (' + ('{0:N0}' -f (Get-Item $CacheAsar).Length) + ' B)') 'DarkGray'
    } else {
        Say ("  asar      " + $CacheAsar + '  (cached)') 'DarkGray'
    }
    $SourceAsar = $CacheAsar
}

# ------------------------------------------------------------------ 5. 校验
Say ''
Say '  [2/3] verify' 'Cyan'
$vcode = Invoke-Js -LogPath $VerifyLog -JsArgs @((Join-Path $RepoRoot 'tools\zh-verify.mjs'), $SourceAsar)
if ($vcode -ne 0) { Die ("asar 校验未通过，完整日志：" + $VerifyLog) }

# ------------------------------------------------------------------ 6. 装机
Say ''
Say '  [3/3] install' 'Cyan'
$procs = @(Get-Process -Name holaOS -ErrorAction SilentlyContinue)
if ($procs.Count) {
    Say ("  stop      " + $procs.Count + ' process(es)') 'DarkGray'
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
}
Copy-Item $SourceAsar $Asar -Force
Say ("  write     " + $Asar + '  (' + ('{0:N0}' -f (Get-Item $Asar).Length) + ' B)') 'DarkGray'

$newState = @{
    appDir     = $AppDir
    zhAsarSize = (Get-Item $Asar).Length
    srcSize    = if ($state) { $state.srcSize } else { $null }
    srcMtime   = if ($state) { $state.srcMtime } else { $null }
    builtAt    = if ($state) { $state.builtAt } else { (Get-Date).ToString('o') }
}
$newState | ConvertTo-Json | Set-Content $StatePath -Encoding utf8

if ($NoStart) {
    Say ''
    Say '  done (not started).' 'Green'
    exit 0
}

# ------------------------------------------------------------------ 7. 启动
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process $Exe
for ($i = 0; $i -lt 120; $i++) {
    Start-Sleep -Milliseconds 500
    $p = @(Get-Process -Name holaOS -ErrorAction SilentlyContinue)
    if ($p.Count -ge 3) {
        Say ''
        Say ("  done.  t=" + [math]::Round($i * 0.5, 1) + 's  procs=' + $p.Count) 'Green'
        Say '  侧栏 / 设置 / 新建对话 / 项目页 已是中文。' 'DarkGray'
        Say '  回滚：.\uninstall.ps1' 'DarkGray'
        exit 0
    }
}
Say ''
Say '  [!] 启动超时。若父进程带着 ELECTRON_RUN_AS_NODE=1，Electron 会以纯 Node 模式秒退。' 'Yellow'
Say '      手动启动：Remove-Item Env:\ELECTRON_RUN_AS_NODE; Start-Process "' -NoNewline 'Yellow'
Say ($Exe + '"') 'Yellow'
Say '      回滚：.\uninstall.ps1' 'Yellow'
exit 1
