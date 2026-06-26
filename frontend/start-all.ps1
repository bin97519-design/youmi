param(
  [switch]$Restart,
  [ValidateSet("Maven", "Jar")]
  [string]$BackendMode = "Maven"
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$FrontendPort = 5173
$BackendPort = 8080
$LogDir = Join-Path $Root "tmp\logs"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-ListeningProcessId {
  param([int]$Port)

  $line = cmd /c "netstat -ano | findstr LISTENING | findstr :$Port" 2>$null |
    Select-Object -First 1

  if (-not $line) {
    return $null
  }

  $parts = $line -split "\s+" | Where-Object { $_ }
  return [int]$parts[-1]
}

function Stop-PortProcess {
  param(
    [int]$Port,
    [string]$Name
  )

  $processId = Get-ListeningProcessId -Port $Port
  if (-not $processId) {
    return
  }

  Write-Host "$Name port $Port is already in use by PID $processId."
  if ($Restart) {
    Write-Host "Stopping $Name PID $processId..."
    Stop-Process -Id $processId -Force
    Start-Sleep -Seconds 2
  } else {
    Write-Host "Skip starting $Name. Use -Restart to replace it."
  }
}

function Start-ServiceWindow {
  param(
    [string]$Title,
    [string]$Command,
    [string]$LogFile
  )

  $quotedRoot = $Root.Replace("'", "''")
  $quotedLog = $LogFile.Replace("'", "''")
  $script = @"
`$Host.UI.RawUI.WindowTitle = '$Title'
Set-Location '$quotedRoot'
$Command *>&1 | Tee-Object -FilePath '$quotedLog'
"@

  Start-Process powershell.exe -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-NoExit",
    "-Command",
    $script
  ) -WorkingDirectory $Root
}

function Wait-Http {
  param(
    [string]$Url,
    [string]$Name,
    [int]$Seconds = 30
  )

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3 | Out-Null
      Write-Host "$Name is ready: $Url"
      return $true
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  Write-Host "$Name is not ready yet. Check logs under $LogDir"
  return $false
}

Stop-PortProcess -Port $FrontendPort -Name "Frontend"
Stop-PortProcess -Port $BackendPort -Name "Backend"

if (-not (Get-ListeningProcessId -Port $BackendPort)) {
  $backendLog = Join-Path $LogDir "backend.log"

  if ($BackendMode -eq "Jar") {
    $jarPath = Join-Path $Root "..\backend\backend_java\target\youmi-api-0.1.0.jar"
    if (-not (Test-Path $jarPath)) {
      throw "Backend jar not found: $jarPath"
    }
    $backendCommand = @"
function Set-EnvFromScopes {
  param([string]`$Name, [string]`$Default = '')
  `$value = [Environment]::GetEnvironmentVariable(`$Name, 'Process')
  if (-not `$value) { `$value = [Environment]::GetEnvironmentVariable(`$Name, 'User') }
  if (-not `$value) { `$value = [Environment]::GetEnvironmentVariable(`$Name, 'Machine') }
  if (-not `$value) { `$value = `$Default }
  if (`$value) { [Environment]::SetEnvironmentVariable(`$Name, `$value, 'Process') }
}
Set-EnvFromScopes 'MYSQL_URL'
Set-EnvFromScopes 'MYSQL_USER'
Set-EnvFromScopes 'MYSQL_PASSWORD'
Set-EnvFromScopes 'REDIS_HOST'
Set-EnvFromScopes 'REDIS_PASSWORD'
Set-EnvFromScopes 'YOUMI_IMAGE_API_KEY'
if (-not `$env:YOUMI_IMAGE_API_KEY) { Set-EnvFromScopes 'APIMART_API_KEY'; `$env:YOUMI_IMAGE_API_KEY = `$env:APIMART_API_KEY }
if (-not `$env:YOUMI_IMAGE_API_KEY) { Set-EnvFromScopes 'APIMART_IMAGE_API_KEY'; `$env:YOUMI_IMAGE_API_KEY = `$env:APIMART_IMAGE_API_KEY }
Set-EnvFromScopes 'MINIMAX_API_KEY'
Set-EnvFromScopes 'GETTOKEN_API_KEY'
Set-EnvFromScopes 'OSS_ENDPOINT' 'oss-cn-shanghai.aliyuncs.com'
Set-EnvFromScopes 'OSS_ACCESS_KEY_ID'
Set-EnvFromScopes 'OSS_ACCESS_KEY_SECRET'
Set-EnvFromScopes 'OSS_BUCKET_NAME' 'huami-canvas'
Set-EnvFromScopes 'OSS_STS_REGION_ID' 'cn-shanghai'
Set-EnvFromScopes 'OSS_STS_ENDPOINT' 'sts.cn-shanghai.aliyuncs.com'
Set-EnvFromScopes 'OSS_STS_ROLE_ARN'
Set-EnvFromScopes 'OSS_STS_ROLE_SESSION_NAME' 'youmi-upload'
Set-EnvFromScopes 'OSS_STS_DURATION_SECONDS' '3600'
java -jar '..\backend\backend_java\target\youmi-api-0.1.0.jar'
"@
  } else {
    $mavenRepo = Join-Path $Root "..\.m2\repository"
    New-Item -ItemType Directory -Force -Path $mavenRepo | Out-Null
    $backendCommand = @"
function Set-EnvFromScopes {
  param([string]`$Name, [string]`$Default = '')
  `$value = [Environment]::GetEnvironmentVariable(`$Name, 'Process')
  if (-not `$value) { `$value = [Environment]::GetEnvironmentVariable(`$Name, 'User') }
  if (-not `$value) { `$value = [Environment]::GetEnvironmentVariable(`$Name, 'Machine') }
  if (-not `$value) { `$value = `$Default }
  if (`$value) { [Environment]::SetEnvironmentVariable(`$Name, `$value, 'Process') }
}
Set-EnvFromScopes 'MYSQL_URL'
Set-EnvFromScopes 'MYSQL_USER'
Set-EnvFromScopes 'MYSQL_PASSWORD'
Set-EnvFromScopes 'REDIS_HOST'
Set-EnvFromScopes 'REDIS_PASSWORD'
Set-EnvFromScopes 'YOUMI_IMAGE_API_KEY'
if (-not `$env:YOUMI_IMAGE_API_KEY) { Set-EnvFromScopes 'APIMART_API_KEY'; `$env:YOUMI_IMAGE_API_KEY = `$env:APIMART_API_KEY }
if (-not `$env:YOUMI_IMAGE_API_KEY) { Set-EnvFromScopes 'APIMART_IMAGE_API_KEY'; `$env:YOUMI_IMAGE_API_KEY = `$env:APIMART_IMAGE_API_KEY }
Set-EnvFromScopes 'MINIMAX_API_KEY'
Set-EnvFromScopes 'GETTOKEN_API_KEY'
Set-EnvFromScopes 'OSS_ENDPOINT' 'oss-cn-shanghai.aliyuncs.com'
Set-EnvFromScopes 'OSS_ACCESS_KEY_ID'
Set-EnvFromScopes 'OSS_ACCESS_KEY_SECRET'
Set-EnvFromScopes 'OSS_BUCKET_NAME' 'huami-canvas'
Set-EnvFromScopes 'OSS_STS_REGION_ID' 'cn-shanghai'
Set-EnvFromScopes 'OSS_STS_ENDPOINT' 'sts.cn-shanghai.aliyuncs.com'
Set-EnvFromScopes 'OSS_STS_ROLE_ARN'
Set-EnvFromScopes 'OSS_STS_ROLE_SESSION_NAME' 'youmi-upload'
Set-EnvFromScopes 'OSS_STS_DURATION_SECONDS' '3600'
mvn "-Dmaven.repo.local=$($mavenRepo)" -f ../backend/backend_java/pom.xml spring-boot:run
"@
  }

  Write-Host "Starting backend on http://127.0.0.1:$BackendPort ..."
  Start-ServiceWindow -Title "youmi backend" -Command $backendCommand -LogFile $backendLog
}

if (-not (Get-ListeningProcessId -Port $FrontendPort)) {
  $frontendLog = Join-Path $LogDir "frontend.log"
  Write-Host "Starting frontend on http://127.0.0.1:$FrontendPort ..."
  Start-ServiceWindow -Title "youmi frontend" -Command "npm run dev" -LogFile $frontendLog
}

Write-Host ""
Write-Host "Waiting for services..."
Wait-Http -Url "http://127.0.0.1:$BackendPort/api/health" -Name "Backend" -Seconds 60 | Out-Null
Wait-Http -Url "http://127.0.0.1:$FrontendPort/" -Name "Frontend" -Seconds 30 | Out-Null

Write-Host ""
Write-Host "Frontend: http://127.0.0.1:$FrontendPort/"
Write-Host "Backend:  http://127.0.0.1:$BackendPort/"
Write-Host "Logs:     $LogDir"
Write-Host ""
Write-Host "Tip: run .\start-all.ps1 -Restart to replace existing port processes."
