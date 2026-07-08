# Youmi Site Structure Recorder

Chrome MV3 extension for recording `https://youqianai.com/` frontend structure and `https://api.youqianai.com/` API behavior to support reconstruction work.

## What It Records

- DOM snapshots: headings, buttons, inputs, images, viewport, element counts
- Important layout blocks: canvas/editor/panel/toolbar/layer selectors, rects, and key computed styles
- SPA navigation: `pushState`, `replaceState`, `popstate`, `hashchange`
- User actions: clicks, right-clicks, pointer down/up, drag/drop, file input changes, keyboard shortcuts
- Network summaries: `fetch` and `XMLHttpRequest` request/response metadata, FormData file fields, and text/json previews
- Resource loads: scripts, CSS, images, fetch/XHR performance entries
- Runtime errors and unhandled promise rejections
- Exportable JSON logs from the extension popup

## Install

1. Open Chrome or Edge.
2. Go to `chrome://extensions`.
3. Enable `Developer mode`.
4. Click `Load unpacked`.
5. Select this folder:
   `D:\codex_workspace\youmi\browser-extension-site-recorder`

## Use

1. Open the target website.
   Target: `https://youqianai.com/`
   API target: `https://api.youqianai.com/`
2. Interact with pages and features you want to reproduce.
3. Open the extension popup.
4. Click `导出 JSON`.

The exported JSON can be used to analyze routes, API calls, UI labels, component hierarchy, and assets.

## Recommended Capture Flow

Record these steps for a complete clone pass:

1. Open home page and expand/collapse the sidebar.
2. Open `万能画布`.
3. Create a new blank canvas.
4. Open `添加图片`, use `本地上传`, and select an image.
5. Click the uploaded image and interact with its floating toolbar.
6. Drag, resize, crop, and delete the image if available.
7. Switch `对话窗口` and `图层窗口`.
8. Type in the dialogue box and trigger send if allowed.
9. Navigate back to the canvas list.

Export JSON immediately after this run.

## Notes

- The extension stores only summarized response bodies and clips long text to reduce noise.
- For protected or private pages, only record content you are authorized to inspect.
