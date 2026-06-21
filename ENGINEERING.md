# 有米前端工程规范

> 统一代码风格、自动化检查、提交规范

## 快速开始

```bash
npm install            # 安装依赖（自动触发 husky install）
npm run lint           # 全量检查
npm run lint:fix       # 自动修复
npm run format         # Prettier 格式化
npm run format:check   # 格式检查（CI 用）
```

## 风格约定（A1）

| 维度 | 规范 |
|------|------|
| 缩进 | 2 空格 |
| 引号 | 单引号 `'` |
| 分号 | 无尾分号 |
| 尾逗号 | 多行总是 trailing comma |
| 箭头函数参数 | 总是带括号 `(x) => x` |
| 行宽 | 100 字符 |
| 换行 | LF (Unix) |
| 文件末尾 | 1 个空行 |

## Pre-commit 自动检查

每次 `git commit` 时，Husky 会自动执行 `lint-staged`：

1. 暂存区的 `*.{js,vue,ts}` → ESLint 自动修复 + Prettier 格式化
2. 暂存区的 `*.{css,md,json}` → Prettier 格式化
3. 任何一步失败 → 拒绝提交，必须手动修复

## 常见问题

### Q1: 提交被 hook 拒绝？
A: 是的，必须先修好。看 `git diff` 里修改的文件，按报错信息改。

### Q2: 临时跳过检查？
A: **不推荐**。但紧急情况：
```bash
git commit --no-verify -m "hotfix: xxx"
```

### Q3: 单文件全量格式化？
```bash
npx prettier --write src/main.js
npx eslint src/main.js --fix
```

### Q4: CI 上跑检查？
```bash
npm run lint           # 0 error 必须
npm run format:check   # 0 diff 必须
```

## 编辑器集成

### VSCode
安装 `ESLint` + `Prettier - Code formatter` 扩展，会自动读取本仓库的 `.eslintrc` / `.prettierrc` / `.editorconfig` 配置。

建议设置：
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

### WebStorm / IntelliJ
开启 ESLint + Prettier 插件即可，配置自动读取。

## 规则豁免

如确需禁用某条规则：
```js
// eslint-disable-next-line no-unused-vars
const unusedButNeeded = 1
```

但请先在 PR 描述里说明原因。
