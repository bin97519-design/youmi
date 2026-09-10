# 生意参谋登录凭证同步

## 环境变量

生产环境必须配置：

```text
YOUMI_CREDENTIAL_MASTER_KEY=<32 字节随机密钥的 Base64>
YOUMI_CREDENTIAL_MASTER_KEY_VERSION=v1
YOUMI_CREDENTIAL_REQUIRE_HTTPS=true
```

生成主密钥（PowerShell）：

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
```

主密钥不能提交到 Git、写入镜像或与数据库备份放在一起。生产环境应由密钥管理系统注入。轮换时先保留旧版本解密能力，再批量重新包装 DEK；不能直接覆盖旧密钥。

## 数据库

当前项目没有启用 Flyway。`schema.sql` 已包含幂等建表语句，生产环境也可以在发布前单独执行：

```text
src/main/resources/db/migration/V20260903__session_credential_center.sql
src/main/resources/db/migration/V20260903_1__session_credential_leases.sql
```

## 接口流程

1. 已登录用户调用 `POST /api/credential-devices/pairing-codes` 获取十分钟有效的一次性配对码。
2. 插件调用 `POST /api/credential-devices/pair`，得到只显示一次的设备令牌。
3. 插件从 `GET /api/credential-devices/encryption-key` 获取当前 RSA-OAEP-256 公钥。
4. 插件仅采集显式白名单字段，使用随机 AES-256-GCM 密钥加密，并用 RSA 公钥包装 AES 密钥。
5. 插件对时间戳、nonce 和请求体摘要签名后调用 `POST /api/session-credentials/upload`。
6. 服务端校验设备、时间窗口、签名和 nonce，解密并再次校验字段白名单，最后使用每凭证独立 DEK 加密落库。
7. 生意参谋页面打开期间，插件每分钟调用 `POST /api/credential-devices/heartbeat`；五分钟没有心跳后，该设备的凭证停止参与新租用。

## 凭证租用

业务任务只能通过以下接口短期使用凭证：

```text
POST /api/session-credential-leases
POST /api/session-credential-leases/{leaseId}/heartbeat
POST /api/session-credential-leases/{leaseId}/release
POST /api/session-credential-leases/{leaseId}/invalidate
```

租用接口要求有米AI用户 Bearer Token，并按当前用户、平台、店铺和可选账号筛选。服务端在同一事务中锁定候选凭证、检查在线状态和并发上限，再创建最长 15 分钟的租约。只有首次租用响应包含解密后的会话；续租、释放、状态列表和审计日志均不包含敏感载荷。

CLI 仅在 Electron 主进程调用这些接口，`withSessionCredentialLease` 每分钟续租并在 `finally` 中释放。租约不通过 preload/IPC 暴露给渲染进程。任务确认登录态失效时调用 `invalidate`；服务端按租用时的凭证版本更新状态，旧任务不会误伤刚同步的新版本。

生产网关必须转发：

```text
X-Forwarded-Proto https
```

凭证接口在生产配置下拒绝 HTTP。不要通过关闭证书校验或把 `YOUMI_CREDENTIAL_REQUIRE_HTTPS` 设为 `false` 规避证书问题。

## 插件

开发目录：

```text
D:\admin\Documents\youmi_cli\extensions\sycm-credential-collector
```

桌面端安装包会将插件复制到：

```text
resources\browser-extensions\sycm-credential-collector
```

插件设备令牌保存在浏览器扩展私有存储中，只允许上传凭证及查看该设备同步状态。服务器端只保存令牌哈希。
