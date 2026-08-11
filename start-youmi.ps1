param(
  [switch]$Restart
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendDir = Join-Path $ProjectRoot "frontend"
$BackendDir = Join-Path $ProjectRoot "backend\backend_java"
$BackendScript = Join-Path $BackendDir "start-dev.ps1"
$RuntimeDir = Join-Path $ProjectRoot ".codex-run"
$LogDir = Join-Path $ProjectRoot "runtime-logs"
$FrontendPort = 5173
$BackendPort = 8083

New-Item -ItemType Directory -Force -Path $RuntimeDir, $LogDir | Out-Null

function Get-PortProcessId {
  param([int]$Port)

  try {
    $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop |
      Select-Object -First 1
    if ($connection) {
      return [int]$connection.OwningProcess
    }
  } catch {
    $line = netstat -ano -p TCP 2>$null |
      Select-String -Pattern ":$Port\s+.*LISTENING\s+(\d+)$" |
      Select-Object -First 1
    if ($line -and $line.Matches.Count -gt 0) {
      return [int]$line.Matches[0].Groups[1].Value
    }
  }

  return $null
}

function Stop-PortProcess {
  param(
    [int]$Port,
    [string]$Name
  )

  $processId = Get-PortProcessId -Port $Port
  if (-not $processId) {
    return
  }

  if (-not $Restart) {
    Write-Host "[skip] $Name is already running on port $Port (PID $processId)."
    return
  }

  Write-Host "[stop] $Name PID $processId"
  Stop-Process -Id $processId -Force

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline -and (Get-PortProcessId -Port $Port)) {
    Start-Sleep -Milliseconds 300
  }

  if (Get-PortProcessId -Port $Port) {
    throw "$Name did not release port $Port."
  }
}

function Resolve-NodeExecutable {
  $command = Get-Command "node.exe" -ErrorAction SilentlyContinue
  $candidates = @(
    $(if ($command) { $command.Source }),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate -PathType Leaf)) {
      return $candidate
    }
  }

  throw "Node.js was not found. Install Node.js or restore the bundled Codex runtime."
}

function Start-Backend {
  if (Get-PortProcessId -Port $BackendPort) {
    return
  }
  if (-not (Test-Path $BackendScript -PathType Leaf)) {
    throw "Backend startup script was not found: $BackendScript"
  }

  $stdout = Join-Path $LogDir "backend.out.log"
  $stderr = Join-Path $LogDir "backend.err.log"
  Write-Host "[start] Backend http://127.0.0.1:$BackendPort"
  $process = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$BackendScript`"") `
    -WorkingDirectory $BackendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
  Set-Content -Path (Join-Path $RuntimeDir "backend-launcher.pid") -Value $process.Id
}

function Start-Frontend {
  if (Get-PortProcessId -Port $FrontendPort) {
    return
  }

  $node = Resolve-NodeExecutable
  $vite = Join-Path $FrontendDir "node_modules\vite\bin\vite.js"
  if (-not (Test-Path $vite -PathType Leaf)) {
    throw "Frontend dependencies are missing. Run the package installation first."
  }

  $stdout = Join-Path $LogDir "frontend.out.log"
  $stderr = Join-Path $LogDir "frontend.err.log"
  Write-Host "[start] Frontend http://127.0.0.1:$FrontendPort"
  $process = Start-Process -FilePath $node `
    -ArgumentList @("`"$vite`"", "--host", "127.0.0.1", "--port", "$FrontendPort") `
    -WorkingDirectory $FrontendDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -PassThru
  Set-Content -Path (Join-Path $RuntimeDir "frontend.pid") -Value $process.Id
}

function Wait-HttpReady {
  param(
    [string]$Url,
    [string]$Name,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        Write-Host "[ready] $Name $Url"
        return
      }
    } catch {
      Start-Sleep -Milliseconds 700
    }
  }

  throw "$Name did not become ready. Check logs in $LogDir."
}

Stop-PortProcess -Port $FrontendPort -Name "Frontend"
Stop-PortProcess -Port $BackendPort -Name "Backend"

Start-Backend
Start-Frontend

Wait-HttpReady -Url "http://127.0.0.1:$BackendPort/api/health" -Name "Backend" -TimeoutSeconds 90
Wait-HttpReady -Url "http://127.0.0.1:$FrontendPort/" -Name "Frontend" -TimeoutSeconds 30

Write-Host ""
Write-Host "Youmi is ready."
Write-Host "Frontend: http://127.0.0.1:$FrontendPort/"
Write-Host "Backend:  http://127.0.0.1:$BackendPort/api/health"
Write-Host "Logs:     $LogDir"
