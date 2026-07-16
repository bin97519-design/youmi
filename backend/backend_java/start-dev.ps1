if (-not $env:MYSQL_PASSWORD) {
  $env:MYSQL_PASSWORD = [Environment]::GetEnvironmentVariable("MYSQL_PASSWORD", "User")
}
if (-not $env:MYSQL_PASSWORD) {
  throw "MYSQL_PASSWORD is not configured. Set it in the current shell or the user environment."
}
$env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("YOUMI_IMAGE_API_KEY", "User")
if (-not $env:YOUMI_IMAGE_API_KEY) {
  $env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_API_KEY", "User")
}
if (-not $env:YOUMI_IMAGE_API_KEY) {
  $env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_IMAGE_API_KEY", "User")
}
$env:GETTOKEN_API_KEY = [Environment]::GetEnvironmentVariable("GETTOKEN_API_KEY", "User")
$env:XFYUN_VISION_API_KEY = [Environment]::GetEnvironmentVariable("XFYUN_VISION_API_KEY", "User")
$env:AGNES_API_KEY = [Environment]::GetEnvironmentVariable("AGNES_API_KEY", "User")
$env:APIMART_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_API_KEY", "User")
$env:IMAGE_PROXY_API_KEY = [Environment]::GetEnvironmentVariable("IMAGE_PROXY_API_KEY", "User")
$env:OSS_ACCESS_KEY_ID = [Environment]::GetEnvironmentVariable("OSS_ACCESS_KEY_ID", "User")
$env:OSS_ACCESS_KEY_SECRET = [Environment]::GetEnvironmentVariable("OSS_ACCESS_KEY_SECRET", "User")

$bundledMaven = Join-Path $PSScriptRoot ".mvn\apache-maven-3.9.6\bin\mvn.cmd"
if (Test-Path $bundledMaven) {
  & $bundledMaven "-Dspring-boot.run.profiles=dev" "spring-boot:run"
} else {
  & (Join-Path $PSScriptRoot "mvnw.cmd") "-Dspring-boot.run.profiles=dev" "spring-boot:run"
}
