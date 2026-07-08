function Set-EnvFromScopes {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [string]$Default = ""
  )

  $value = [Environment]::GetEnvironmentVariable($Name, "Process")
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, "User") }
  if (-not $value) { $value = [Environment]::GetEnvironmentVariable($Name, "Machine") }
  if (-not $value) { $value = $Default }
  if ($value) { [Environment]::SetEnvironmentVariable($Name, $value, "Process") }
}

Set-EnvFromScopes "MYSQL_URL"
Set-EnvFromScopes "MYSQL_USER"
Set-EnvFromScopes "MYSQL_PASSWORD"
Set-EnvFromScopes "REDIS_HOST"
Set-EnvFromScopes "REDIS_PASSWORD"
Set-EnvFromScopes "YOUMI_IMAGE_API_KEY"
if (-not $env:YOUMI_IMAGE_API_KEY) {
  Set-EnvFromScopes "APIMART_API_KEY"
  $env:YOUMI_IMAGE_API_KEY = $env:APIMART_API_KEY
}
if (-not $env:YOUMI_IMAGE_API_KEY) {
  Set-EnvFromScopes "APIMART_IMAGE_API_KEY"
  $env:YOUMI_IMAGE_API_KEY = $env:APIMART_IMAGE_API_KEY
}
Set-EnvFromScopes "MINIMAX_API_KEY"
Set-EnvFromScopes "GETTOKEN_API_KEY"
Set-EnvFromScopes "OSS_ENDPOINT" "oss-cn-shanghai.aliyuncs.com"
Set-EnvFromScopes "OSS_ACCESS_KEY_ID"
Set-EnvFromScopes "OSS_ACCESS_KEY_SECRET"
Set-EnvFromScopes "OSS_BUCKET_NAME" "huami-canvas"
Set-EnvFromScopes "OSS_STS_REGION_ID" "cn-shanghai"
Set-EnvFromScopes "OSS_STS_ENDPOINT" "sts.cn-shanghai.aliyuncs.com"
Set-EnvFromScopes "OSS_STS_ROLE_ARN"
Set-EnvFromScopes "OSS_STS_ROLE_SESSION_NAME" "youmi-upload"
Set-EnvFromScopes "OSS_STS_DURATION_SECONDS" "3600"

$backendDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pomPath = Join-Path $backendDir 'pom.xml'

mvn -f $pomPath spring-boot:run '-Dspring-boot.run.profiles=dev' '-Dspring-boot.run.arguments=--server.port=8083'
