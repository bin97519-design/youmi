$env:MYSQL_URL = [Environment]::GetEnvironmentVariable("MYSQL_URL", "User")
$env:MYSQL_USER = [Environment]::GetEnvironmentVariable("MYSQL_USER", "User")
$env:MYSQL_PASSWORD = [Environment]::GetEnvironmentVariable("MYSQL_PASSWORD", "User")
$env:REDIS_HOST = [Environment]::GetEnvironmentVariable("REDIS_HOST", "User")
$env:REDIS_PASSWORD = [Environment]::GetEnvironmentVariable("REDIS_PASSWORD", "User")
$env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("YOUMI_IMAGE_API_KEY", "User")
if (-not $env:YOUMI_IMAGE_API_KEY) {
  $env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_API_KEY", "User")
}
if (-not $env:YOUMI_IMAGE_API_KEY) {
  $env:YOUMI_IMAGE_API_KEY = [Environment]::GetEnvironmentVariable("APIMART_IMAGE_API_KEY", "User")
}
$env:MINIMAX_API_KEY = [Environment]::GetEnvironmentVariable("MINIMAX_API_KEY", "User")
$env:GETTOKEN_API_KEY = [Environment]::GetEnvironmentVariable("GETTOKEN_API_KEY", "User")
$env:OSS_ENDPOINT = [Environment]::GetEnvironmentVariable("OSS_ENDPOINT", "User")
$env:OSS_ACCESS_KEY_ID = [Environment]::GetEnvironmentVariable("OSS_ACCESS_KEY_ID", "User")
$env:OSS_ACCESS_KEY_SECRET = [Environment]::GetEnvironmentVariable("OSS_ACCESS_KEY_SECRET", "User")
$env:OSS_BUCKET_NAME = [Environment]::GetEnvironmentVariable("OSS_BUCKET_NAME", "User")
$env:OSS_STS_REGION_ID = [Environment]::GetEnvironmentVariable("OSS_STS_REGION_ID", "User")
$env:OSS_STS_ENDPOINT = [Environment]::GetEnvironmentVariable("OSS_STS_ENDPOINT", "User")
$env:OSS_STS_ROLE_ARN = [Environment]::GetEnvironmentVariable("OSS_STS_ROLE_ARN", "User")
$env:OSS_STS_ROLE_SESSION_NAME = [Environment]::GetEnvironmentVariable("OSS_STS_ROLE_SESSION_NAME", "User")
$env:OSS_STS_DURATION_SECONDS = [Environment]::GetEnvironmentVariable("OSS_STS_DURATION_SECONDS", "User")

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pomPath = Join-Path $backendDir 'pom.xml'

mvn -f $pomPath spring-boot:run '-Dspring-boot.run.profiles=dev' '-Dspring-boot.run.arguments=--server.port=8083'
