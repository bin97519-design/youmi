foreach ($name in @(
  "MYSQL_URL",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "WAVESPEED_API_KEY",
  "WAVESPEED_BASE_URL",
  "WAVESPEED_MULTI_ANGLE_MODEL"
)) {
  if (-not [Environment]::GetEnvironmentVariable($name, "Process")) {
    $value = [Environment]::GetEnvironmentVariable($name, "User")
    if ($value) {
      [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
  }
}

# THQ video settings are kept outside the repository and refreshed on every start.
foreach ($name in @(
  "THQ_VIDEO_API_KEY",
  "THQ_VIDEO_BASE_URL",
  "THQ_VIDEO_TIMEOUT_SECONDS",
  "THQ_VIDEO_DOWNLOAD_TIMEOUT_SECONDS",
  "THQ_VIDEO_PERSIST_GENERATED"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if ($value) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

# Agent settings are managed in the user environment. Always refresh them so a
# long-running launcher cannot pass stale values into a restarted backend.
foreach ($name in @(
  "YOUMI_AGENT_API_KEY",
  "YOUMI_AGENT_BASE_URL",
  "YOUMI_AGENT_MODEL",
  "YOUMI_AGENT_CHAT_PATH",
  "YOUMI_AGENT_MAX_TOKENS",
  "YOUMI_AGENT_TEMPERATURE",
  "YOUMI_AGENT_TIMEOUT_SECONDS"
)) {
  $value = [Environment]::GetEnvironmentVariable($name, "User")
  if ($value) {
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}
if (-not $env:MYSQL_PASSWORD) {
  throw "MYSQL_PASSWORD is not configured. Set it in the current shell or the user environment."
}
if (-not $env:SERVER_PORT) {
  $env:SERVER_PORT = "8083"
}
$env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("YOUMI_IMAGE_API_KEY", "User")
if (-not $env:YOUMI_IMAGE_API_KEY) {
  $env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_API_KEY", "User")
}
if (-not $env:YOUMI_IMAGE_API_KEY) {
  $env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_IMAGE_API_KEY", "User")
}
$env:YOUMI_IMAGE_APIMART_DIRECT_API_KEY = [Environment]::GetEnvironmentVariable("YOUMI_IMAGE_APIMART_DIRECT_API_KEY", "User")
if (-not $env:YOUMI_IMAGE_APIMART_DIRECT_API_KEY) {
  $env:YOUMI_IMAGE_APIMART_DIRECT_API_KEY = $env:YOUMI_IMAGE_API_KEY
}
$env:GETTOKEN_API_KEY = [Environment]::GetEnvironmentVariable("GETTOKEN_API_KEY", "User")
$env:LK888_API_KEY = [Environment]::GetEnvironmentVariable("LK888_API_KEY", "User")
$env:XFYUN_VISION_API_KEY = [Environment]::GetEnvironmentVariable("XFYUN_VISION_API_KEY", "User")
$env:AGNES_API_KEY = [Environment]::GetEnvironmentVariable("AGNES_API_KEY", "User")
$env:APIMART_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_API_KEY", "User")
$env:IMAGE_PROXY_API_KEY = [Environment]::GetEnvironmentVariable("IMAGE_PROXY_API_KEY", "User")
$env:OSS_ACCESS_KEY_ID = [Environment]::GetEnvironmentVariable("OSS_ACCESS_KEY_ID", "User")
$env:OSS_ACCESS_KEY_SECRET = [Environment]::GetEnvironmentVariable("OSS_ACCESS_KEY_SECRET", "User")

$bundledMaven = Join-Path $PSScriptRoot ".mvn\apache-maven-3.9.6\bin\mvn.cmd"
if (Test-Path $bundledMaven) {
  & $bundledMaven "-Dspring-boot.run.profiles=dev" "spring-boot:run"
} elseif (Get-Command "mvn.cmd" -ErrorAction SilentlyContinue) {
  & "mvn.cmd" "-Dspring-boot.run.profiles=dev" "spring-boot:run"
} else {
  & (Join-Path $PSScriptRoot "mvnw.cmd") "-Dspring-boot.run.profiles=dev" "spring-boot:run"
}
