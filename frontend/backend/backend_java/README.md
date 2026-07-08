# 有米后端

Spring Boot + MySQL + Redis 后端服务，当前已实现登录、当前用户、退出登录接口。

## 默认接口

- `GET /api/health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/ai/status`
- `POST /api/detail-page/prompts`

## 默认账号

```text
账号：admin
密码：123456
```

```text
手机号：13800138000
密码：123456
```

## 数据库

先创建数据库：

```sql
CREATE DATABASE IF NOT EXISTS youmi_ai DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

应用启动时会自动执行：

- `src/main/resources/schema.sql`
- `src/main/resources/data.sql`

## 启动

默认配置：

```text
MySQL: 127.0.0.1:3306 / youmi_ai / root / 123456
Redis: 127.0.0.1:6379
```

启动命令：

```bash
npm run api
```

或：

```bash
mvn -f backend/pom.xml spring-boot:run
```

当前开发脚本 `start-dev.ps1` 会使用可用的 MySQL / Redis 开发环境变量启动服务。

如果要切回本机 MySQL：

```bash
set MYSQL_PASSWORD=你的密码
npm run api
```

## 大模型配置

当前后端通过 OpenAI-compatible 的 `/chat/completions` 协议调用大模型。前端只调用本系统接口，API Key 只保存在后台配置。

配置位置：`src/main/resources/application.yml`

```yaml
youmi:
  ai:
    base-url: https://api.deepseek.com
    chat-path: /chat/completions
    api-key: your-api-key
    model: deepseek-v4-flash
    temperature: 0.35
    timeout-seconds: 45
```

如果后续使用中转站，只需要把 `base-url`、`chat-path`、`api-key`、`model` 换成中转站给出的配置。
