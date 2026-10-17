param(
  [Parameter(Mandatory = $true)][string]$ApiBase,
  [Parameter(Mandatory = $true)][string]$Account,
  [string]$ReportPath = (Join-Path $PSScriptRoot 'OSS接入验收结果.json')
)

$ErrorActionPreference = 'Stop'
$baseUri = [Uri]$ApiBase
if ($baseUri.Scheme -ne 'https' -or $baseUri.AbsolutePath.TrimEnd('/') -notmatch '/youmi-api$') {
  throw 'ApiBase必须是证书有效的HTTPS地址，且包含/youmi-api。'
}
$ApiBase = $ApiBase.TrimEnd('/')
$report = [ordered]@{
  apiBase = $ApiBase
  startedAt = [DateTimeOffset]::Now.ToString('o')
  steps = @()
  success = $false
}
$auth = $null
$plainPassword = $null
$token = $null
function Invoke-BusinessPost([string]$Path, $Body, $Headers) {
  $result = Invoke-RestMethod -Uri "$ApiBase$Path" -Method Post `
    -ContentType 'application/json' -Headers $Headers `
    -Body ([Text.Encoding]::UTF8.GetBytes(($Body | ConvertTo-Json -Depth 8 -Compress))) -TimeoutSec 60
  if ($result.code -ne 0) { throw "业务接口失败，code=$($result.code)" }
  return $result.data
}
try {
  $securePassword = Read-Host '请输入上传业务账号密码（隐藏输入）' -AsSecureString
  $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
  try { $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
  $login = Invoke-BusinessPost '/api/auth/login' @{ account = $Account; password = $plainPassword } @{}
  $plainPassword = $null
  $token = $login.token
  if (-not $token) { throw '登录未返回令牌' }
  $auth = @{ Authorization = "Bearer $token" }
  $report.steps += @{ step = '1 登录'; passed = $true }

  $fileBytes = [Text.Encoding]::UTF8.GetBytes("youmi-oss-upload-check $([Guid]::NewGuid())")
  $sign = Invoke-BusinessPost '/api/file/oss-sign' @{
    fileName = 'upload-check.txt'; contentType = 'text/plain'; size = $fileBytes.Length
    dir = 'integration-check'; expireSeconds = 300
  } $auth
  if (-not $sign.uploadUrl -or -not $sign.url -or -not $sign.objectName) { throw '签名字段不完整' }
  if (([Uri]$sign.uploadUrl).Scheme -ne 'https') { throw 'OSS上传地址不是HTTPS' }
  $report.steps += @{ step = '2 申请上传签名'; passed = $true; objectName = $sign.objectName }

  $ossHeaders = @{}
  $sign.headers.PSObject.Properties | ForEach-Object { $ossHeaders[$_.Name] = [string]$_.Value }
  $put = Invoke-WebRequest -UseBasicParsing -Method Put -Uri $sign.uploadUrl `
    -Headers $ossHeaders -Body $fileBytes -TimeoutSec 90
  if ($put.StatusCode -lt 200 -or $put.StatusCode -ge 300) { throw 'PUT上传未成功' }
  $report.steps += @{ step = '3 PUT上传'; passed = $true; httpStatus = [int]$put.StatusCode }

  $readLink = Invoke-BusinessPost '/api/file/refresh-url' @{ url = $sign.url } $auth
  if (-not $readLink.url -or ([Uri]$readLink.url).Scheme -ne 'https') { throw '未取得HTTPS读取地址' }
  # 进一步实际下载核对内容，私有读取签名不写入报告。
  $download = Invoke-WebRequest -UseBasicParsing -Uri $readLink.url -TimeoutSec 60
  $actual = if ($download.Content -is [byte[]]) {
    [Text.Encoding]::UTF8.GetString($download.Content)
  } else { [string]$download.Content }
  if ($actual -cne [Text.Encoding]::UTF8.GetString($fileBytes)) { throw '下载内容与上传内容不一致' }
  $report.steps += @{ step = '4 私有读取链接及下载内容核验'; passed = $true; httpStatus = [int]$download.StatusCode }
  $report.success = $true
  $report.testObject = $sign.objectName
  Write-Output '四步验收通过，读取内容一致。报告不含密码、令牌或签名URL。'
} catch {
  # 不保存异常原文，避免部分HTTP异常包含带签名URL。
  $report.failureStage = $report.steps.Count + 1
  $report.errorType = $_.Exception.GetType().FullName
  Write-Warning "验收未通过，失败阶段：$($report.failureStage)。报告未包含敏感请求信息。"
} finally {
  $report.finishedAt = [DateTimeOffset]::Now.ToString('o')
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8
  $auth = $null
  $token = $null
  $plainPassword = $null
}
if (-not $report.success) { exit 1 }
