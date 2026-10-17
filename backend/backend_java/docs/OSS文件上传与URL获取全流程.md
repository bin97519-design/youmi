# 有米 OSS 文件上传与 URL 获取全流程

更新日期：2026年10月16日。适用项目：`E:\youmi`，Vue 前端与 Spring Boot 后端当前实现。

本流程用于将本地文件或远程文件保存到阿里云 OSS，并取得供画布、素材库、生图或视频接口使用的文件地址。常规上传使用“登录鉴权 → 后端签发临时 PUT 地址 → 浏览器直传 OSS → 上传成功后保存访问 URL”。文件内容不经过业务后端，因此不占用后端转发文件的带宽。

## 外部系统实际接入信息

其他电脑、云端工作台或独立应用不需要存在 `E:\youmi` 目录，也不能通过自己的 `127.0.0.1:8083` 访问这台开发机，应连接公网后台。

2026年10月16日核对结果：

| 项目              | 地址或状态                                                                               |
| --------------- | ----------------------------------------------------------------------------------- |
| 公网后台基础地址        | `http://101.133.149.214/youmi-api`                                                  |
| 健康检查            | `GET http://101.133.149.214/youmi-api/api/health`，实测HTTP 200、业务code=0               |
| 登录接口            | `POST http://101.133.149.214/youmi-api/api/auth/login`，字段来自代码，本次未用账号登录验证            |
| 上传签名接口          | `POST http://101.133.149.214/youmi-api/api/file/oss-sign`，实测存在，匿名请求返回业务code=401、未登录 |
| 私有读取链接接口        | `POST http://101.133.149.214/youmi-api/api/file/refresh-url`，需有米令牌                  |
| 后端代传接口          | `POST http://101.133.149.214/youmi-api/api/file/upload`，multipart文件字段为file          |
| 本机开发后台          | `http://127.0.0.1:8083`，本次健康检查正常，仅供本机使用                                             |
| 公网HTTPS         | `https://101.133.149.214/youmi-api/api/health` 本次证书连接失败，未验证可用                       |
| 本地实际Bucket      | `huami-canvas`，本地后端启动日志显示该Bucket的CORS配置成功                                           |
| 本地OSS区域endpoint | `oss-cn-shanghai.aliyuncs.com`，本地配置且进程和用户环境未覆盖                                      |
| 业务访问凭证          | 由有米账号登录获得，本文不包含可用账号、密码或令牌                                                           |

公网健康和匿名鉴权检查不等于已验证公网的登录、实际上传和文件读取全链路；公网Bucket和密钥也不能仅凭本地配置认定相同。现有可达公网入口是HTTP，正式跨公网传输密码、令牌前应配置有效HTTPS域名或使用可信加密通道，不要通过关闭证书校验把HTTPS失败当作已解决。

### 接入方需要配置的资料

通过本项目后台上传时，接入方需要后台地址和有米业务身份，不需要OSS长期AccessKey：

```text
YOUMI_API_BASE=<可验证的HTTPS后台基础地址，末尾包含/youmi-api>
YOUMI_ACCOUNT=<管理员分配的账号>
YOUMI_PASSWORD=<在接入系统私密凭证配置中填写>
YOUMI_AUTH_TOKEN=<登录后取得的data.token，或安全配置已有有效令牌>
UPLOAD_DIR=youmi/uploads
```

账号由有米管理员分配，当前开放注册接口已关闭。密码和令牌通过私密配置渠道交付，不写入聊天正文或Git。登录方法：

```http
POST {YOUMI_API_BASE}/api/auth/login
Content-Type: application/json
```

```json
{ "account": "实际账号", "password": "实际密码" }
```

成功后读取 `data.token`，后续请求带 `Authorization: Bearer <data.token>`。用 `GET {YOUMI_API_BASE}/api/auth/me` 可检查登录态。业务code非0按错误处理，不能只检查HTTP状态。令牌失效后重新登录，不视为永久密钥。

### 从文件到下游平台可读取链接

1. 确认后台地址可达，登录取得令牌；已有有效令牌时可复用。
2. 调用 `{YOUMI_API_BASE}/api/file/oss-sign`，取得 `uploadUrl`、`headers`、`url` 和 `objectName`。
3. 向返回的 `uploadUrl` PUT文件二进制，使用返回的OSS请求头，不携带有米令牌，确认2xx成功。
4. 需要公开访问时验证 `url` 能否直接下载；需要私有读取链接时，带有米令牌调用 `{YOUMI_API_BASE}/api/file/refresh-url`，请求 `{ "url": "步骤2返回的url" }`，取 `data.url`。当前实现读取签名有效7天。
5. 将最终可读取URL提交给下游平台的图片或视频输入字段；上传后台与下游生成平台是两套接口，不混用基础地址或令牌。
6. 保存 `objectName`，在读取签名到期前使用，过期重新获取。

缺少有米账号或有效令牌时，仍无法完成登录上传，需要管理员私密交付业务凭证。若决定绕过后台直连阿里云OSS，需要另行配置签名服务或STS临时凭证，属于不同接入方案。

### 当前交付前必须完成的事项

2026年10月16日，对 `101.133.149.214:443` 的证书信息检查显示：IP直连所呈现的证书主体为 `openclaw.chenb.tech`，SAN包含 `openclaw.chenb.tech` 和 `www.openclaw.chenb.tech`，有效期结束于2026年6月10日。该证书既不覆盖IP地址，也已过期。此检查仅用于读取公开证书信息，没有携带业务凭证，也不代表上述域名就是有米服务的正确入口；使用不同SNI的虚拟主机可能呈现其他证书。

交付方仍需完成两项：

1. 提供确实路由到有米后台的HTTPS域名，配置匹配且未过期的证书，并验证 `{基础地址}/api/health`；不能直接把上述证书域名替换进地址就视为可用。
2. 为接入方分配有米业务账号，或通过安全渠道交付有效业务令牌。接入方在自己的私密配置页面填写，不写入本文。

在这两项完成前，HTTP可达与接口说明只能用于确认部署和联调，不能声称外部安全上传链路已交付完成。

## 1 地址与对象名称

| 名称           | 用途                                          | 是否应长期保存                   |
| ------------ | ------------------------------------------- | ------------------------- |
| `uploadUrl`  | 带签名的临时上传地址，只用于 HTTP PUT 文件                  | 否，过期后重新申请                 |
| `url`        | 后端生成的文件访问地址                                 | 可存入业务数据，但读取依赖权限、对象存在及域名可用 |
| `objectName` | OSS 对象键，例如 `users/1/youmi/uploads/随机编号.png` | 建议与 URL 一起保存，用于定位和管理文件    |
| `uploadId`   | 分片上传会话编号                                    | 仅分片上传期间保存                 |
| 签名 GET URL   | 私有文件的临时读取地址                                 | 不作为永久地址，需要到期刷新            |

`url` 在申请签名时就能算出，但此时 OSS 中还不一定存在文件。必须等 PUT 返回 2xx 后再当作上传结果使用。不要保存 `uploadUrl` 作为图片或视频来源。

无签名 URL 没有签名到期时间，但并不意味着“任何人始终可访问”。删除对象、修改读取权限、生命周期清理、域名变化都会影响访问。把地址提供给第三方 AI 服务前，应确认该服务无需有米登录态也能下载。

## 2 上传方式选择

| 场景                 | 入口                                        | 说明                                   |
| ------------------ | ----------------------------------------- | ------------------------------------ |
| 浏览器已有 File 对象      | `uploadFileDirect(file, options)`         | 当前常规方式，后端签名后浏览器直传                    |
| Base64 图片          | `uploadBase64ImageDirect(value, options)` | 转成 File 后走同一流程                       |
| 需要后端接收文件           | `POST /api/file/upload`                   | multipart 表单，后端再上传 OSS               |
| 已有远程图片或文件 URL      | `POST /api/file/upload-from-url`          | 后端下载后转存，返回结果地址                       |
| 大文件需要分片或恢复         | `/api/file/oss-multipart/*`               | 后端已有接口，常规 `uploadFileDirect` 未自动使用分片 |
| 客户端需要 OSS SDK 临时凭证 | `POST /api/file/oss-sts`                  | 需要额外配置 STS 角色，普通签名直传无需此项             |

控制器同时支持 `/api/file` 和 `/api/v1/file` 两个路径前缀。以下统一使用 `/api/file`。

## 3 后端配置与鉴权

### OSS 配置

| 环境变量                      | 含义                    | 当前配置默认值                        |
| ------------------------- | --------------------- | ------------------------------ |
| `OSS_ENABLED`             | 是否启用 OSS              | `true`                         |
| `OSS_ENDPOINT`            | OSS 区域 endpoint       | `oss-cn-shanghai.aliyuncs.com` |
| `OSS_BUCKET_NAME`         | 存储桶名称                 | `huami-canvas`                 |
| `OSS_ACCESS_KEY_ID`       | 服务端访问密钥 ID            | 无，需配置                          |
| `OSS_ACCESS_KEY_SECRET`   | 服务端访问密钥 Secret        | 无，需配置                          |
| `OSS_CORS_AUTO_CONFIGURE` | 启动时自动配置浏览器跨域规则        | `true`                         |
| `OSS_STS_ROLE_ARN`        | STS AssumeRole 角色 ARN | 无，仅 STS 流程需要                   |
| `OSS_STS_ENDPOINT`        | STS 服务 endpoint       | `sts.cn-shanghai.aliyuncs.com` |

AccessKey 仅保存在后端运行环境，不写到前端代码、公开文档或浏览器存储。普通直传向前端发放临时签名地址，STS 模式发放短期凭证。

自定义访问域名通过 `youmi.oss.custom-domain` 配置；例如在服务端配置文件中设置该属性。当前 `application.yml` 虽有 `public-base-url`，但 `OssStorageProperties` 没有对应属性，现有 URL 拼接逻辑读取的是 `customDomain`。不要只改 `OSS_PUBLIC_BASE_URL` 就认为返回域名会变化。

### 登录鉴权与目录归属

业务接口使用 `Authorization: Bearer <有米登录令牌>`，这是有米账号令牌，不是 OSS AccessKey。前端现有 `useUserStore().authHeaders()` 自动提供请求头。

后端从令牌解析用户 ID，为目录添加 `users/{userId}/`。请求 `dir=youmi/uploads` 时，实际对象键为：

```text
users/{userId}/youmi/uploads/{32位随机编号}.{原文件扩展名}
```

不要由客户端自行传入其他用户目录。获取对象地址、刷新地址、分片操作都会检查对象是否位于当前用户前缀内。目录只接受字母、数字、下划线、点、斜线、连字符，禁止 `..`；不要用中文作为 `dir`。

### 浏览器跨域

后端启动时，`OssCorsInitializer` 在启用自动配置且 OSS 已配置时更新 Bucket CORS。现有规则允许 PUT、POST、GET、HEAD，请求头为 `*`，暴露 `ETag` 和 `x-oss-request-id`，预检缓存 3600 秒。

允许的来源由 `youmi.oss.cors-allowed-origins` 控制，默认含本地 `http://127.0.0.1:5173`、`http://localhost:5173` 和项目现有部署来源。增加新域名或端口时同步更新；协议和端口也属于来源的一部分。自动配置失败会写警告，服务启动成功不代表 CORS 已配置成功。管理员可调用 `POST /api/file/oss-cors` 重配。

## 4 常规直传完整流程

### 第一步 选择文件

浏览器取得 `File`，确认文件名、MIME 类型和字节大小。现有上传工具会对 `image/*` 文件执行 20 MiB 检查。其他类型的业务限制需由相应入口检查，例如参考视频的时长与大小限制不属于 OSS 通用工具的统一限制。

### 第二步 请求上传签名

```http
POST /api/file/oss-sign
Authorization: Bearer <有米登录令牌>
Content-Type: application/json
```

```json
{
  "fileName": "product.png",
  "contentType": "image/png",
  "size": 1048576,
  "dir": "youmi/uploads",
  "expireSeconds": 900
}
```

后端先鉴权及校验声明的图片大小，再生成当前用户目录中的对象键，签发 PUT URL。返回结构示意：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "method": "PUT",
    "uploadUrl": "https://bucket.example/object.png?签名参数",
    "objectName": "users/1/youmi/uploads/随机编号.png",
    "url": "https://bucket.example/users/1/youmi/uploads/随机编号.png",
    "expireSeconds": 900,
    "headers": { "Content-Type": "image/png" }
  }
}
```

示例域名与随机编号仅用于说明，实际使用接口原样返回值。前端工具默认申请 900 秒；直接调用后端不传有效期时默认为 300 秒，后端把有效期限制在 60 至 1800 秒。

### 第三步 PUT 文件到 OSS

请求地址使用原始 `uploadUrl`，方法为 PUT，请求头使用返回的 `headers`，请求体是文件二进制本身。不要使用 JSON、Base64 字符串或 FormData 包装文件，也不要把有米的 Bearer 令牌带给 OSS。

签名时的 Content-Type 与实际 PUT 请求必须一致。不要修改 URL 中的签名参数或用业务 API 前缀拼接它。

### 第四步 确认上传成功

现有工具仅在 OSS 返回 2xx 后成功返回；失败会抛错。它使用 XMLHttpRequest 提供上传进度和 AbortSignal 取消能力。100% 是客户端上传完成状态，不代替后续业务存储成功。

接口没有强制要求“上传完成回调”。前端仍须把结果写入对应画布图层、素材或任务数据，才能在刷新后恢复。`uploadFileDirect` 自身不会创建画布节点或保存业务记录。

### 第五步 使用并保存 URL

使用 `sign.url` 进行图片预览或视频播放，再通过业务接口保存。需要可追踪的文件管理时同时保存 `objectName`、原文件名、MIME、大小和归属关系。

默认访问地址为 `https://{bucket}.{endpoint}/{objectName}`；配置自定义域名后为 `{customDomain}/{objectName}`。访问 URL 由服务端统一生成，业务代码不要自行猜地址。

## 5 前端接入示例

在现有 Vue 项目中使用统一工具，不需要自行处理 OSS 密钥或签名：

```javascript
import { uploadFileDirect } from '@/utils/ossUpload'

async function handleFileSelected(file) {
  const controller = new AbortController()
  const url = await uploadFileDirect(file, {
    dir: 'youmi/uploads',
    signal: controller.signal,
    onProgress: ({ percent }) => {
      console.log(`上传进度 ${percent}%`)
    },
  })
  // 到这里 PUT 已成功；接着把 url 保存到对应图层或业务记录。
  return url
}
```

如项目未配置 `@` 别名，按调用文件位置改为相对导入。工具选项还支持 `expireSeconds` 和额外业务接口请求 `headers`。当前函数只返回 URL 字符串，不返回整个签名对象。

Base64 图片调用：

```javascript
import { uploadBase64ImageDirect } from '@/utils/ossUpload'
const url = await uploadBase64ImageDirect(base64Value, {
  dir: 'youmi/uploads',
  fileName: 'product',
})
```

本地浏览器的业务请求通常由 Vite 将 `/dev-api` 代理至后端；工具使用 `apiPath()` 拼接配置的 `VITE_APP_BASE_API`。后端直接调试可用 `http://127.0.0.1:8083/api/file/...`；不要在此地址前再加 `/dev-api`。

## 6 Windows 手工验证示例

下面脚本适用于 PowerShell。先在当前进程设置 `YOUMI_AUTH_TOKEN` 为自己的有效登录令牌，并替换文件路径；脚本不输出令牌或上传签名。

```powershell
$filePath = 'E:\files\product.png'
$apiOrigin = 'http://127.0.0.1:8083'
if (-not $env:YOUMI_AUTH_TOKEN) { throw '请先设置 YOUMI_AUTH_TOKEN' }
$uploadFile = Get-Item -LiteralPath $filePath
$requestBody = @{
  fileName = $uploadFile.Name
  contentType = 'image/png' # 按实际文件修改
  size = $uploadFile.Length
  dir = 'youmi/uploads'
  expireSeconds = 900
} | ConvertTo-Json
$signature = Invoke-RestMethod -Method Post `
  -Uri "$apiOrigin/api/file/oss-sign" `
  -Headers @{ Authorization = "Bearer $env:YOUMI_AUTH_TOKEN" } `
  -ContentType 'application/json' -Body $requestBody
if ($signature.code -ne 0) { throw $signature.message }
$uploadHeaders = @{}
$signature.data.headers.PSObject.Properties | ForEach-Object {
  $uploadHeaders[$_.Name] = [string]$_.Value
}
Invoke-WebRequest -Method Put -Uri $signature.data.uploadUrl `
  -Headers $uploadHeaders -InFile $uploadFile.FullName | Out-Null
Write-Output $signature.data.url
Write-Output $signature.data.objectName
```

命令成功返回后，再访问结果 URL 检查。签名申请不会上传文件，必须执行 PUT。验证会实际创建 OSS 对象。

## 7 后端代传与远程转存

### 本地文件由后端代传

`POST /api/file/upload`，带有米登录请求头，使用 multipart/form-data，文件字段名为 `file`。配置 OSS 时，后端接收文件并写到 `users/{userId}/{日期}/`，返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "url": "文件地址",
    "fileUrl": "同一文件地址",
    "fullUrl": "同一文件地址",
    "fileName": "完整对象键",
    "name": "完整对象键",
    "originalName": "原文件名",
    "size": 1048576,
    "contentType": "image/png",
    "storage": "oss"
  }
}
```

未配置 OSS 时，这个接口会降级到本地 `uploads`，返回 `storage=local` 和 `/uploads/...` 相对地址。它不代表上传到了 OSS，也不能直接作为第三方服务可访问的公网地址。签名直传接口没有同样的本地降级逻辑。

### 远程 URL 转存

```http
POST /api/file/upload-from-url
Authorization: Bearer <有米登录令牌>
Content-Type: application/json
```


```json
{ "url": "https://example.com/temporary-image.png", "dir": "youmi/ai" }
```

后端连接远程地址，读取文件并写入用户 OSS 目录，返回格式与代传一致。连接超时为15秒、读取超时为120秒。前端 `persistToOss(url, options)` 调用兼容路径 `/api/v1/file/upload-from-url`，默认客户端等待30秒；失败时返回原 URL，不抛出上传成功信号。

因此，`persistToOss` 返回一个字符串不等于转存成功：应确认结果是否为目标 OSS 地址。原临时 URL 若被降级返回，仍可能过期。当前工具会跳过 hostname 含 `huami-canvas` 且无查询参数的地址，这一前端判断并不等同严格的对象归属校验。

## 8 分片上传与 STS

分片上传顺序如下，所有业务接口均需要登录：

1. `POST /api/file/oss-multipart/init`，提交 `fileName`、`contentType`、`dir`，取得 `uploadId`、`objectName`、`url`、`bucket`。
2. 客户端按 OSS 分片要求切分文件，为每片申请 `POST /api/file/oss-multipart/part-sign`，提交 `objectName`、`uploadId`、`partNumber`、可选 `expireSeconds`。
3. 使用返回的 `uploadUrl` PUT 该片二进制，收集 OSS 响应中的 `ETag`。分片编号为1至10000；签名默认900秒，可设60至3600秒。
4. 所有片成功后调用 `POST /api/file/oss-multipart/complete`，提交对象键、上传编号与 `parts` 数组。数组每项使用 `partNumber` 和 `eTag` 两个字段。后端按编号排序并合并后返回 `url` 和 `objectName`。
5. 放弃上传时调用 `POST /api/file/oss-multipart/abort`，提交 `objectName`、`uploadId`，清理未完成的上传会话。

初始化返回 URL 不代表对象已经合并完成，必须以 complete 成功为准。分片大小、并行数、断点记录和失败重传由客户端实现；现有通用直传工具尚未封装这些步骤。

STS 路径为 `POST /api/file/oss-sts`，请求 `dir` 和可选 `durationSeconds`，取得临时 `accessKeyId`、`accessKeySecret`、`securityToken`、`expiration`、`bucket`、`region`、`endpoint` 和授权目录。接口将申请时长限制在900至43200秒，实际时长还受角色配置约束。客户端 OSS SDK 必须带上 SecurityToken；临时凭证到期后重新申请，不能当成长期密钥。

## 9 获取或刷新访问地址

已有 `objectName` 时，使用带登录态的 `GET /api/file/url?fileName=<URL编码后的完整对象键>` 获取地址。优先使用查询参数版本，避免带斜线的完整对象键与路径参数匹配冲突。返回 `data` 是 URL 字符串，不是 `{url: ...}` 对象；它只是生成地址，并未检查对象是否存在。

`POST /api/file/refresh-url` 接收 `{ "url": "原OSS地址" }`，从 URL 提取对象键、检查用户归属后生成7天有效的签名 GET URL，返回 `data.url` 与 `data.objectName`。该接口是重新签名读取，不是重新上传文件，也不能恢复已删除的对象。

## 10 限制与排查

| 现象                        | 检查方法与处理                                             |
| ------------------------- | --------------------------------------------------- |
| 业务接口401或登录失败              | 检查有米令牌和登录状态，不要改 OSS 密钥来解决账号鉴权                       |
| 签名申请失败                    | 检查 OSS 必填配置、后端密钥权限、目录格式与日志                          |
| PUT报403或签名不匹配             | 重新申请未过期签名，保持 PUT、原 URL 与 Content-Type 一致，检查设备时间     |
| 浏览器报 CORS 或 network error | 检查预检响应、当前来源是否在 Bucket CORS 中；查看后端自动配置警告             |
| 上传成功但结果URL报403            | 上传权限与读取权限不同，检查 Bucket 或域名读取配置；私有文件使用签名读取            |
| URL报404                   | 检查 PUT 是否真的成功、对象键和域名是否正确、对象是否已被删除                   |
| 返回 `/uploads/...`         | 走了本地存储降级，检查 `storage` 字段与 OSS 配置                    |
| 图片超过20 MiB                | 前端与后端图片检查都会拦截，压缩或更换图片                               |
| 代传文件约50MB附近失败             | Spring multipart 文件和整个请求默认都是50MB，请求还包含表单开销；检查反向代理限制 |
| 远程转存失败却拿到了原地址             | `persistToOss` 是降级返回，不应标记为已转存                       |
| 分片上传无法读取ETag              | 检查 CORS 暴露 `ETag`，以及单片PUT是否成功                       |

现有签名接口的20 MiB检查依据客户端上报的 `size` 和 `contentType`，不等同 OSS 对真实文件体积和类型的强制验证。直接 PUT 不经过 Spring multipart 的50MB限制。远程转存的50MB判断依据响应 `Content-Length`；未知长度的流没有同等的累计字节硬限制。

远程转存当前使用 URLConnection 直接访问来源地址，代码未展示针对内网地址、协议和跳转目标的完整过滤。若向不受信任来源开放，应增加来源校验和实际流量上限；这属于后续实现加固，不能把现有接口描述成已经具备这些能力。

## 11 验收清单

- 登录用户可申请签名，返回对象键位于自己的 `users/{userId}/` 下。
- 使用原签名地址与返回请求头 PUT 后得到2xx。
- 浏览器能显示图片或播放视频；提供给第三方的地址能在无有米登录态时按预期访问。
- 业务记录保存 URL，刷新页面后仍能恢复素材；需要文件管理时同时保存对象键。
- 错误和取消不写成上传成功，转存降级不标记为 OSS 已转存。
- 私有读取地址到期可刷新，删除对象后不会把刷新签名误当文件恢复。

## 12 源码位置


| 文件 | 职责 |
| --- | --- |
| `frontend/src/utils/ossUpload.js` | 普通直传、Base64上传、远程转存 |
| `frontend/src/utils/apiBase.js` | 业务API前缀 |
| `frontend/vite.config.js` | 开发代理 |
| `backend/backend_java/src/main/java/com/youmi/api/file/FileUploadController.java` | 上传、签名、分片、STS、URL接口与登录鉴权 |
| `backend/backend_java/src/main/java/com/youmi/api/file/OssStorageService.java` | OSS SDK调用、对象键、签名与访问URL生成 |
| `backend/backend_java/src/main/java/com/youmi/api/file/OssStorageProperties.java` | OSS与STS配置 |
| `backend/backend_java/src/main/java/com/youmi/api/file/OssCorsInitializer.java` | 启动时配置CORS |
| `backend/backend_java/src/main/resources/application.yml` | 默认配置与环境变量映射 |

本文描述代码中的上传流程与接口约定，不包含生产密钥。环境配置或代码变化后，应同步更新字段、大小限制、代理前缀和地址生成规则。
