function normalizeReferenceImages(images, limit) {
  const result = []
  const seenUrls = new Set()

  for (const image of Array.isArray(images) ? images : []) {
    if (!image || image.uploading || image.error) continue
    const url = String(typeof image === 'string' ? image : image.url || '').trim()
    if (!url || url.startsWith('blob:') || seenUrls.has(url)) continue
    seenUrls.add(url)
    result.push({
      id: typeof image === 'string' ? '' : String(image.id || ''),
      layerId: typeof image === 'string' ? '' : String(image.layerId || ''),
      name: typeof image === 'string' ? '' : String(image.name || ''),
      url,
    })
    if (result.length >= limit) break
  }

  return result
}

export function resolveAgentReferenceImages({ currentImages, messages, instruction = '', limit = 8 } = {}) {
  const safeLimit = Math.max(1, Math.min(12, Number(limit) || 8))
  const current = normalizeReferenceImages(currentImages, safeLimit)
  if (current.length) return { images: current, inherited: false }
  const retryRequested = /再(?:重)?(?:生成|生|写|做|出|来)(?:一|1)?(?:次|遍|版|个|条)|重新(?:生成|写|策划|制作)|重做|重写|再试一次/.test(instruction)
  const sceneChangeRequested = /(?:换|改|调整|更换|切换|变更).{0,20}(?:场景|卧室|房间|客厅|背景|环境|布景)|(?:场景|卧室|房间|客厅|背景|环境|布景).{0,12}(?:换|改|调整|变成)/.test(instruction)
  const withoutImages = /不(?:要|用|再)(?:使用|带|沿用)?(?:上次|之前|原来|参考)?(?:的)?(?:图|图片)|纯文字/.test(instruction)
  if ((!retryRequested && !sceneChangeRequested) || withoutImages) return { images: [], inherited: false }
  for (const message of [...(Array.isArray(messages) ? messages : [])].reverse()) {
    if (!message?.agent || message.generating || message.failed) continue
    const draft = message.agentDraft
    const activeItem = draft?.items?.[draft.activeIndex || 0]
    const images = normalizeReferenceImages(
      activeItem?.referenceImages?.length ? activeItem.referenceImages
        : draft?.referenceImages?.length ? draft.referenceImages : message.referenceImages,
      safeLimit,
    )
    if (images.length) return { images, inherited: true }
  }
  return { images: [], inherited: false }
}
