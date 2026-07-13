$env:MYSQL_URL = "jdbc:mysql://rm-uf65sj38p60279hc04o.mysql.rds.aliyuncs.com:3306/office_dashboard?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false"
$env:MYSQL_USER = "hm_rds"
$env:MYSQL_PASSWORD = "hm321@2023"
$env:REDIS_HOST = "139.224.246.245"
$env:REDIS_PASSWORD = "common@2024"
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

mvn -f backend/pom.xml spring-boot:run
