import { personalAssetImageUrl } from './personalAssetLibrary.js'

const hasControl = (text) =>
  [...text].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)

function boundedText(value, max, label, required = false) {
  const text = typeof value === 'string' ? value.trim() : ''
  if ((required && !text) || hasControl(text)) throw new Error(`请填写有效的${label}`)
  if (text.length > max) throw new Error(`${label}不能超过 ${max} 字`)
  return text
}

export function imageSubjectPayload(value = {}) {
  const imageUrl = personalAssetImageUrl(value.imageUrl)
  if (!imageUrl) throw new Error('主体图片尚未上传或地址无效')
  const name = boundedText(value.name, 20, '主体名称', true)
  const description = boundedText(value.description, 100, '主体描述', true)
  const rawViews = Array.isArray(value.viewUrls) ? value.viewUrls : []
  if (!rawViews.length) throw new Error('请至少添加 1 张其他视角图')
  if (rawViews.length > 5) throw new Error('最多添加 5 张其他视角图')
  const viewUrls = [...new Set(rawViews.map(personalAssetImageUrl))]
  if (viewUrls.some((url) => !url)) throw new Error('其他视角图地址无效')
  const tags = [
    ...new Set(
      (Array.isArray(value.tags) ? value.tags : [])
        .map((tag) => boundedText(tag, 30, '标签'))
        .filter(Boolean),
    ),
  ].slice(0, 20)
  // Provider voice IDs may only come from the service supplied by the caller, never label aliases.
  const voiceId = boundedText(value.voiceId, 100, '音色标识')
  return {
    name,
    description,
    imageUrl,
    coverUrl: imageUrl,
    config: {
      libraryKind: 'model',
      canvasSubject: {
        sourceNodeId: boundedText(value.sourceNodeId, 100, '来源标识'),
        viewUrls,
        tags,
        voiceId,
      },
      ...(voiceId ? { voice: { selectedVoice: voiceId } } : {}),
      assets: viewUrls.map((url, index) => ({
        type: 'reference-view',
        url,
        name: `其他视角 ${index + 1}`,
      })),
    },
  }
}

export function imageSubjectUploadFile(file) {
  if (!file || !/^image\/(png|jpe?g|webp|gif|avif)$/i.test(file.type || ''))
    throw new Error('请选择 PNG、JPG、WebP 等图片文件')
  if (
    !Number.isFinite(Number(file.size)) ||
    Number(file.size) <= 0 ||
    Number(file.size) > 20 * 1024 * 1024
  )
    throw new Error('图片不能为空且不能超过 20 MB')
  return file
}

export function normalizeSubjectVoices(value) {
  const items = Array.isArray(value) ? value : []
  const seen = new Set()
  return items.flatMap((voice) => {
    if (
      !voice ||
      typeof voice.id !== 'string' ||
      !voice.id.trim() ||
      voice.id.length > 100 ||
      hasControl(voice.id) ||
      seen.has(voice.id)
    )
      return []
    const name = typeof voice.name === 'string' ? voice.name.trim().slice(0, 50) : ''
    if (!name) return []
    seen.add(voice.id)
    return [
      {
        id: voice.id,
        name,
        official: voice.official === true,
        previewUrl: personalAssetImageUrl(voice.previewUrl),
      },
    ]
  })
}
