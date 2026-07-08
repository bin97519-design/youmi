# 坐标格式定义提示词 (Coordinate Definition Prompt)

> 本文件定义了 detect-elements 接口使用的坐标系统规范。
> 供 `proxy_log.py` 引用，确保提示词与前端解析保持一致。

---

## 坐标系统

### box_2d 格式

```
[top, left, bottom, right]
```

归一化浮点数，范围 0.0 ~ 1.0，保留 3 位小数。

| 索引 | 字段名   | 含义                       |
|------|----------|----------------------------|
| 0    | top      | 元素顶边距图像顶部的比例    |
| 1    | left     | 元素左边距图像左边的比例    |
| 2    | bottom   | 元素底边距图像顶部的比例    |
| 3    | right    | 元素右边距图像左边的比例    |

**约束条件**：
- 必须满足 `top < bottom` 且 `left < right`
- 值域 [0.0, 1.0]，不允许负数或超过 1.0
- 保留 3 位小数，如 `0.058`

### 输出字段名

- **模型输出字段名**：`box_2d`（有下划线，DashScope qwen 模型的标准输出字段）
- **proxy_log.py 输出字段名**：`box2d`（无下划线，与前端保持一致）
- **前端兼容读取**：`el.box2d || el.box_2d`（双兼容，优先读 box2d）

> ⚠️ proxy_log.py 的 parse 函数在输出时将模型返回的 `box_2d` 转换为 `box2d`。
> 前端 CanvasEditorPage.vue 读取时优先 `box2d`，兜底 `box_2d`。

### 数值范围转换

| 阶段            | 范围       | 说明                          |
|-----------------|-----------|-------------------------------|
| 模型输出 (原始)   | 0 ~ 1     | 归一化浮点数                    |
| proxy parse 输出  | 0 ~ 1000  | 千分数整数，乘以 1000 并取整     |
| 前端 normalizeBox | 0 ~ 1     | 除以 1000 还原为归一化浮点数     |

### 坐标可视化

```
  (0,0)────────────────────────────(1,0)
    │              top               │
    │    ┌─────left─────────┐       │
    │    │                  │       │
    │    │   检测到的元素    │       │
    │    │                  │       │
    │    └────right─────────┘       │
    │            bottom             │
  (0,1)────────────────────────────(1,1)

  box_2d = [top, left, bottom, right]
         = [元素顶/图高, 元素左/图宽, 元素底/图高, 元素右/图宽]
```

---

## 提示词片段 (可嵌入 SYS 或 PROMPT)

### 坐标格式定义段

```
【坐标格式定义】
- box_2d: [top, left, bottom, right]，0.0~1.0 浮点数，保留 3 位小数
  * top    = 元素顶边距图像顶部的比例
  * left   = 元素左边距图像左边的比例
  * bottom = 元素底边距图像顶部的比例
  * right  = 元素右边距图像左边的比例
  * 必须满足 top < bottom 且 left < right
```

### 像素坐标换算公式 (前端使用)

```javascript
// 归一化坐标 → 像素坐标
pxLeft   = Math.round(box[1] * layer.width)   // left * 图宽
pxTop    = Math.round(box[0] * layer.height)  // top * 图高
pxRight  = Math.round(box[3] * layer.width)   // right * 图宽
pxBottom = Math.round(box[2] * layer.height)  // bottom * 图高

// 像素坐标 → 归一化坐标
top    = (pxTop - layer.y) / layer.height
left   = (pxLeft - layer.x) / layer.width
bottom = (pxBottom - layer.y) / layer.height
right  = (pxRight - layer.x) / layer.width
```

---

## 版本记录

| 日期       | 变更内容                                    |
|-----------|---------------------------------------------|
| 2026-06-18 | 初始创建，统一坐标格式定义为独立提示词文件     |
