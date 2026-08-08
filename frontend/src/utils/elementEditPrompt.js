function sanitizeLabel(value, fallback) {
  const label = String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
  return label || fallback
}

function formatBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null
  const values = box.map((value) => Number(value))
  if (values.some((value) => !Number.isFinite(value))) return null
  return values.map((value) => Math.max(0, Math.min(1, value)).toFixed(3))
}

export function normalizeRectToBox(rect, bounds) {
  const boundsWidth = Number(bounds?.width)
  const boundsHeight = Number(bounds?.height)
  if (!(boundsWidth > 0) || !(boundsHeight > 0)) return null

  const rectLeft = Math.min(Number(rect?.left), Number(rect?.right))
  const rectTop = Math.min(Number(rect?.top), Number(rect?.bottom))
  const rectRight = Math.max(Number(rect?.left), Number(rect?.right))
  const rectBottom = Math.max(Number(rect?.top), Number(rect?.bottom))
  const boundsLeft = Number(bounds?.left) || 0
  const boundsTop = Number(bounds?.top) || 0
  if (![rectLeft, rectTop, rectRight, rectBottom].every(Number.isFinite)) return null

  const clamp = (value) => Math.max(0, Math.min(1, value))
  const box = [
    clamp((rectLeft - boundsLeft) / boundsWidth),
    clamp((rectTop - boundsTop) / boundsHeight),
    clamp((rectRight - boundsLeft) / boundsWidth),
    clamp((rectBottom - boundsTop) / boundsHeight),
  ]
  if (box[2] <= box[0] || box[3] <= box[1]) return null
  return box
}

export function buildElementEditPrompt({ instruction, targets = [] }) {
  const userInstruction = String(instruction || '').trim()
  const normalizedTargets = (Array.isArray(targets) ? targets : [])
    .map((target, index) => {
      const box = formatBox(target.box)
      if (!box) return null
      return {
        name: sanitizeLabel(target.name, `元素${index + 1}`),
        referenceImageIndex: Math.max(1, Number.parseInt(target.referenceImageIndex, 10) || 1),
        box,
      }
    })
    .filter(Boolean)

  if (!normalizedTargets.length) return userInstruction

  const targetLines = normalizedTargets.map(
    (target, index) =>
      `- 目标${index + 1}：参考图${target.referenceImageIndex}中的“${target.name}”，box_2d=[${target.box.join(', ')}]`,
  )

  return [
    '【局部元素图生图任务】',
    '坐标定义（必须严格按此解释）：',
    '- box_2d 使用 [left, top, right, bottom] 顺序，表示目标矩形的左边、上边、右边、下边。',
    '- 坐标是相对于对应参考图原始宽高的 0.0~1.0 归一化比例；(0,0) 是左上角，(1,1) 是右下角。',
    '- 矩形左上角为 (left, top)，右下角为 (right, bottom)。这些坐标只用于定位，不得在输出图中绘制框线、数字或坐标文字。',
    '目标元素区域：',
    ...targetLines,
    `用户修改要求：${userInstruction || '根据目标元素类型进行适当修改。'}`,
    '编辑约束：',
    '- 只修改上述 box_2d 矩形内的目标元素；框外画面必须尽可能保持与参考图一致。',
    '- 保留未选中的人物、物体、文字、背景、构图、光线、色彩和画面尺寸，不得整体重绘或替换整张图。',
    '- 修改后的目标元素应与原图透视、遮挡关系、光影和材质自然衔接。',
  ].join('\n')
}

function normalizeReferenceImageUrls(images) {
  const urls = (Array.isArray(images) ? images : [])
    .map((image) => (typeof image === 'string' ? image : image?.url))
    .map((url) => String(url || '').trim())
    .filter((url) => url && !url.startsWith('blob:'))
  return [...new Set(urls)]
}

export function buildGenerationReplay({
  record = {},
  userMessage = {},
  assistantMessage = {},
  fallbackReferenceImageUrls = [],
  defaults = {},
} = {}) {
  const requestSnapshot =
    (assistantMessage.generationRequest && typeof assistantMessage.generationRequest === 'object'
      ? assistantMessage.generationRequest
      : null) ||
    (userMessage.generationRequest && typeof userMessage.generationRequest === 'object'
      ? userMessage.generationRequest
      : {})
  const prompt = String(
    record.prompt || requestSnapshot.prompt || userMessage.fullPrompt || userMessage.text || '',
  ).trim()
  const recordedReferences = normalizeReferenceImageUrls(record.referenceImageUrls)
  const snapshotReferences = normalizeReferenceImageUrls(requestSnapshot.referenceImageUrls)
  const fallbackReferences = normalizeReferenceImageUrls([
    ...(Array.isArray(userMessage.referenceImages) ? userMessage.referenceImages : []),
    ...(Array.isArray(fallbackReferenceImageUrls) ? fallbackReferenceImageUrls : []),
  ])
  const referenceImageUrls = recordedReferences.length
    ? recordedReferences
    : snapshotReferences.length
      ? snapshotReferences
      : fallbackReferences
  const requiresReferenceImage =
    prompt.includes('【局部元素图生图任务】') || /\bbox_2d\s*=\s*\[/i.test(prompt)
  const sourceLayerIds = [
    ...new Set(
      [
        ...(Array.isArray(requestSnapshot.sourceLayerIds) ? requestSnapshot.sourceLayerIds : []),
        ...(Array.isArray(userMessage.sourceLayerIds) ? userMessage.sourceLayerIds : []),
        ...(Array.isArray(userMessage.referenceImages)
          ? userMessage.referenceImages.map((image) => image?.layerId)
          : []),
        ...(Array.isArray(userMessage.elements)
          ? userMessage.elements.map((element) => element?.layerId)
          : []),
      ].filter(Boolean),
    ),
  ]

  return {
    prompt,
    displayText: String(userMessage.text || prompt).trim(),
    messageElements: Array.isArray(userMessage.elements)
      ? userMessage.elements.map((element) => ({ ...element }))
      : [],
    messageReferenceImages: Array.isArray(userMessage.referenceImages)
      ? userMessage.referenceImages.map((image) =>
          typeof image === 'string' ? { url: image } : { ...image },
        )
      : [],
    targetLayerId: requestSnapshot.targetLayerId || userMessage.targetLayerId || '',
    sourceLayerIds,
    referenceImageUrls,
    model: record.model || requestSnapshot.model || assistantMessage.model || defaults.model || '',
    ratio: record.ratio || requestSnapshot.ratio || assistantMessage.ratio || defaults.ratio || '',
    resolution:
      record.resolution ||
      requestSnapshot.resolution ||
      assistantMessage.resolution ||
      defaults.resolution ||
      '',
    requiresReferenceImage,
    missingRequiredReference: requiresReferenceImage && !referenceImageUrls.length,
  }
}
