<#
.SYNOPSIS
    Compares RAM and disk usage of the official Microsoft Teams client and Lean Teams.

.DESCRIPTION
    RAM: sums the whole process tree of each app (the host exe plus every
    msedgewebview2.exe it spawned). Reports the working set (what Task Manager's
    "Details" tab shows) and private bytes (memory that belongs to that app alone).
    Several samples are taken and averaged, because WebView2 memory moves a lot.

    Disk: install folder plus the per-user data folder (cache, IndexedDB, logs).
    The WebView2 runtime itself is shared with Edge and every other WebView2 app,
    so it is not counted for either side. Teams lives under C:\Program Files\WindowsApps,
    which only an elevated shell can fully read: run as administrator for its
    install size, otherwise it shows up too small.

    For a fair comparison: start both apps, sign in to the same account, open the
    same chat, wait two minutes, then run this script. Run it once with both
    windows open and once with both minimized to the tray.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\measure.ps1
.EXAMPLE
    .\measure.ps1 -Samples 10 -IntervalSeconds 3
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 100)][int]$Samples = 5,
    [ValidateRange(1, 60)][int]$IntervalSeconds = 2,
    [string]$LeanInstallDir
)

$ErrorActionPreference = 'Stop'

function Get-TreeIds {
    param([int[]]$RootIds, [object[]]$AllProcesses)
    $ids = [System.Collections.Generic.HashSet[int]]::new()
    foreach ($id in $RootIds) { [void]$ids.Add($id) }
    do {
        $added = $false
        foreach ($p in $AllProcesses) {
            $procId = [int]$p.ProcessId
            if (-not $ids.Contains($procId) -and $ids.Contains([int]$p.ParentProcessId)) {
                [void]$ids.Add($procId)
                $added = $true
            }
        }
    } while ($added)
    return $ids
}

function Measure-Tree {
    param([string]$ExeName)
    $all = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name)
    $roots = @($all | Where-Object { $_.Name -ieq $ExeName } | ForEach-Object { [int]$_.ProcessId })
    if ($roots.Count -eq 0) { return $null }
    $ids = Get-TreeIds -RootIds $roots -AllProcesses $all
    $procs = @(Get-Process -Id @($ids) -ErrorAction SilentlyContinue)
    [pscustomobject]@{
        Processes  = $procs.Count
        WorkingSet = ($procs | Measure-Object -Property WorkingSet64 -Sum).Sum
        Private    = ($procs | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
    }
}

function Get-FolderBytes {
    param([string[]]$Paths)
    $total = 0L
    foreach ($path in $Paths) {
        if ($path -and (Test-Path -LiteralPath $path)) {
            $sum = (Get-ChildItem -LiteralPath $path -Recurse -Force -File -ErrorAction SilentlyContinue |
                Measure-Object -Property Length -Sum).Sum
            if ($sum) { $total += [long]$sum }
        }
    }
    return $total
}

function Format-MB {
    param([double]$Bytes)
    if ($Bytes -le 0) { return '-' }
    return ('{0:N0} MB' -f ($Bytes / 1MB))
}

$apps = @(
    [pscustomobject]@{ Name = 'Microsoft Teams'; Exe = 'ms-teams.exe' },
    [pscustomobject]@{ Name = 'Lean Teams'; Exe = 'lean-teams.exe' }
)

# --- RAM -------------------------------------------------------------------
$ram = @{}
foreach ($app in $apps) { $ram[$app.Name] = [System.Collections.Generic.List[object]]::new() }

Write-Host "Sampling memory ($Samples x every $IntervalSeconds s)..."
for ($i = 0; $i -lt $Samples; $i++) {
    foreach ($app in $apps) {
        $m = Measure-Tree -ExeName $app.Exe
        if ($m) { $ram[$app.Name].Add($m) }
    }
    if ($i -lt $Samples - 1) { Start-Sleep -Seconds $IntervalSeconds }
}

# --- Disk ------------------------------------------------------------------
$teamsPackage = Get-AppxPackage -Name 'MSTeams' -ErrorAction SilentlyContinue | Select-Object -First 1
$teamsInstall = if ($teamsPackage) { $teamsPackage.InstallLocation } else { $null }
$teamsData = Join-Path $env:LOCALAPPDATA 'Packages\MSTeams_8wekyb3d8bbwe'

if (-not $LeanInstallDir) {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Lean Teams'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Lean Teams'),
        (Join-Path $env:ProgramFiles 'Lean Teams')
    )
    $LeanInstallDir = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
$leanData = @(
    (Join-Path $env:LOCALAPPDATA 'dev.leanteams.app'),
    (Join-Path $env:APPDATA 'dev.leanteams.app')
)

$disk = @{
    'Microsoft Teams' = [pscustomobject]@{
        Install = Get-FolderBytes -Paths @($teamsInstall)
        Data    = Get-FolderBytes -Paths @($teamsData)
    }
    'Lean Teams'      = [pscustomobject]@{
        Install = Get-FolderBytes -Paths @($LeanInstallDir)
        Data    = Get-FolderBytes -Paths $leanData
    }
}

# --- Report ----------------------------------------------------------------
$rows = foreach ($app in $apps) {
    $samples = $ram[$app.Name]
    $ws = if ($samples.Count) { ($samples | Measure-Object -Property WorkingSet -Average).Average } else { 0 }
    $pv = if ($samples.Count) { ($samples | Measure-Object -Property Private -Average).Average } else { 0 }
    $procs = if ($samples.Count) { $samples[$samples.Count - 1].Processes } else { 0 }
    $d = $disk[$app.Name]
    [pscustomobject]@{
        App          = $app.Name
        Running      = [bool]$samples.Count
        Processes    = $procs
        'Working set' = Format-MB $ws
        'Private'    = Format-MB $pv
        'Install'    = Format-MB $d.Install
        'User data'  = Format-MB $d.Data
        'Disk total' = Format-MB ($d.Install + $d.Data)
        _ws          = $ws
        _disk        = $d.Install + $d.Data
    }
}

$rows | Select-Object App, Running, Processes, 'Working set', Private, Install, 'User data', 'Disk total' |
    Format-Table -AutoSize

$official = $rows | Where-Object App -eq 'Microsoft Teams'
$lean = $rows | Where-Object App -eq 'Lean Teams'
if ($official._ws -gt 0 -and $lean._ws -gt 0) {
    Write-Host ('RAM (working set): Lean Teams uses {0:P0} of Microsoft Teams' -f ($lean._ws / $official._ws))
}
if ($official._disk -gt 0 -and $lean._disk -gt 0) {
    Write-Host ('Disk: Lean Teams uses {0:P0} of Microsoft Teams' -f ($lean._disk / $official._disk))
}
foreach ($row in $rows | Where-Object { -not $_.Running }) {
    Write-Host "$($row.App) is not running - start it to include its RAM usage." -ForegroundColor Yellow
}
