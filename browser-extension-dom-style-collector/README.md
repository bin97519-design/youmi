# Youmi DOM Style Collector

独立的页面 DOM + 样式收集器，用于复刻 `youqianai.com` 时采集运行态布局。

## 安装

1. 打开 Chrome / Edge。
2. 进入 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择本目录：

```text
D:\codex_workspace\youmi\browser-extension-dom-style-collector
```

## 使用

1. 打开目标页面，比如 `https://youqianai.com/`。
2. 把页面切到你要复刻的状态：
   - 侧边栏展开
   - 某个菜单展开
   - 首页输入框 hover
   - 登录弹窗打开
3. 点击浏览器右上角扩展图标。
4. 点击“采集并导出 JSON”。
5. 把导出的 `dom-style-*.json` 发给 Codex 分析。

## 会采集什么

- 页面 URL、标题、视口尺寸、滚动位置
- DOM 树：标签、class、id、文本、子节点
- 元素 `getBoundingClientRect()`
- 关键 `computedStyle`
- 关键 selector 匹配结果
- 图片、字体、SVG、样式表信息

## 建议采集状态

- 首页侧边栏收起
- 首页侧边栏展开
- AI 设计师菜单展开
- AI 产品图菜单展开
- 首页输入框区域
- 快捷功能卡片 hover
- 登录弹窗
- 生成图片工作区
- 详情页生成弹窗
