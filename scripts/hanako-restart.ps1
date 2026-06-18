# hanako-restart.ps1
# 只做两件事: 杀 electron + hanako server,后台派发 npm start
# 由 mavis cron 任务调用,不读 git,不合并代码

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$LogFile = Join-Path $RepoRoot 'logs\daily-sync.log'
$LogDir  = Split-Path -Parent $LogFile
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

function Log {
    param([string]$m)
    $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $line = "[$ts] $m"
    Add-Content -Path $LogFile -Value $line -Encoding UTF8
    Write-Host $line
}

Log '[hanako-restart] begin'

# ---- 杀 electron ----
Log 'killing electron processes ...'
$e = Get-Process -Name electron -ErrorAction SilentlyContinue
if ($e) { $e | Stop-Process -Force; Log "  killed $($e.Count) electron" } else { Log '  (no electron running)' }
Start-Sleep -Seconds 1
$e2 = Get-Process -Name electron -ErrorAction SilentlyContinue
if ($e2) { $e2 | Stop-Process -Force; Log "  force-killed $($e2.Count) remaining electron" }

# ---- 杀 hanako server (node 启动 launch.js 的那个) ----
Log 'killing hanako-related node processes ...'
$killed = 0
try {
    $nodes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
    foreach ($n in $nodes) {
        $cmd = $n.CommandLine
        # 任何命令行里包含 openhanako 路径的 node 进程都干掉
        # (server bootstrap.ts / launch.js / electron 内部 node / 等)
        if ($cmd -and $cmd -like '*openhanako*') {
            Log "  kill node PID=$($n.ProcessId) CMD=$cmd"
            Stop-Process -Id $n.ProcessId -Force -ErrorAction SilentlyContinue
            $killed++
        }
    }
} catch {
    Log "  WARN: query node processes failed: $_"
}
if ($killed -eq 0) { Log '  (no hanako-related node process matched)' }

Start-Sleep -Seconds 2

# ---- 后台派发 npm start ----
Log 'dispatching npm start ...'
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) { $npmCmd = 'npm.cmd' }

# cmd /c start 解耦窗口,任务计划程序或脚本退出不会拖累 GUI
$startArgs = '/c start "" "' + $npmCmd + '" start'
Start-Process -FilePath 'cmd.exe' -ArgumentList $startArgs -WorkingDirectory $RepoRoot -WindowStyle Normal
Log 'npm start dispatched'

Log '[hanako-restart] end'
