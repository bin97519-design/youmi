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
`$env:MYSQL_URL = 'jdbc:mysql://rm-uf65sj38p60279hc04o.mysql.rds.aliyuncs.com:3306/office_dashboard?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false'
`$env:MYSQL_USER = 'hm_rds'
`$env:MYSQL_PASSWORD = 'hm321@2023'
`$env:REDIS_HOST = '139.224.246.245'
`$env:REDIS_PASSWORD = 'common@2024'
`$env:GETTOKEN_API_KEY = if ([Environment]::GetEnvironmentVariable('GETTOKEN_API_KEY', 'User')) { [Environment]::GetEnvironmentVariable('GETTOKEN_API_KEY', 'User') } else { 'sk-ZCL-3we7_Zxr4OanH3bXdkRzNyP9zrQUY7h6rjLfw7A' }
java -jar '..\backend\backend_java\target\youmi-api-0.1.0.jar'
"@
  } else {
    $mavenRepo = Join-Path $Root "..\.m2\repository"
    New-Item -ItemType Directory -Force -Path $mavenRepo | Out-Null
    $backendCommand = @"
`$env:MYSQL_URL = 'jdbc:mysql://rm-uf65sj38p60279hc04o.mysql.rds.aliyuncs.com:3306/office_dashboard?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false'
`$env:MYSQL_USER = 'hm_rds'
`$env:MYSQL_PASSWORD = 'hm321@2023'
`$env:REDIS_HOST = '139.224.246.245'
`$env:REDIS_PASSWORD = 'common@2024'
`$env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable('YOUMI_IMAGE_API_KEY', 'User')
if (-not `$env:YOUMI_IMAGE_API_KEY) { `$env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable('APIMART_API_KEY', 'User') }
if (-not `$env:YOUMI_IMAGE_API_KEY) { `$env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable('APIMART_IMAGE_API_KEY', 'User') }
`$env:MINIMAX_API_KEY = [Environment]::GetEnvironmentVariable('MINIMAX_API_KEY', 'User')
`$env:GETTOKEN_API_KEY = [Environment]::GetEnvironmentVariable('GETTOKEN_API_KEY', 'User')
if (-not `$env:GETTOKEN_API_KEY) { `$env:GETTOKEN_API_KEY = 'sk-ZCL-3we7_Zxr4OanH3bXdkRzNyP9zrQUY7h6rjLfw7A' }
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
