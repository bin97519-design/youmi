# Youmi Site Structure Recorder

Chrome / Edge Manifest V3 网页快照扩展，用于保存可供网页复刻分析的完整页面状态。

## 快照内容

- 完整 DOM 与表单运行时状态（密码输入框会自动清空）
- 每个元素的选择器、坐标、可见状态和关键计算样式
- `::before`、`::after`、`::marker` 伪元素样式
- 开放式 Shadow DOM、Canvas 静态画面和页面滚动位置
- CSS 样式表、图片、字体、媒体、脚本及网络资源地址清单
- 当前页面最近 500 条点击、输入、导航和网络摘要
- 全页截图；捕获完成后立即断开页面调试连接
- 可直接打开检查的静态 HTML 预览

每次捕获会下载一个 `youmi-snapshot-*.zip`：

```text
snapshot.json   机器可读的结构化快照
page.html       静态页面预览
screenshot.png  页面截图
README.txt      快照说明
```

## 安装

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。Chrome 会提示扩展具有页面调试权限，该权限只用于完整长页截图。
4. 选择目录：

   `D:\codex_workspace\youmi\browser-extension-site-recorder`

修改代码后，在扩展管理页点击扩展的“重新加载”按钮。

## 使用

1. 打开需要分析且有权访问的网页，等待页面加载完成。
2. 打开扩展弹窗，点击“保存当前网页快照”。
3. 也可以在页面空白处点击右键，选择“保存完整网页快照”。
4. 将导出的 ZIP 提供给 Codex，即可依据 DOM、样式、资源和截图进行复刻。

“记录操作”开启时，扩展会继续采集 SPA 导航、点击、输入、拖拽、资源加载、Fetch/XHR 摘要和运行时错误。原有“反推提示词”右键菜单仍然保留。

## 边界

- 快照用于复刻页面外观、布局和已呈现状态，不会复制服务端业务逻辑。
- 登录态、Cookie、LocalStorage 和密码不会写入快照。
- 跨域 iframe 内部 DOM、关闭式 Shadow DOM、受保护视频和被跨域内容污染的 Canvas 可能无法读取。
- `page.html` 不执行原站脚本；动态交互应结合 `snapshot.json` 中的操作和网络记录重新实现。
- 页面外部资源地址会保留在资源清单中，打开 HTML 预览时部分资源仍可能需要网络。

请只采集你有权检查和复刻的页面。
