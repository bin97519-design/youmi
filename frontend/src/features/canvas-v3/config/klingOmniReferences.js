import { klingOmniControls } from './klingOmniParameters.js'

const MEDIA_KINDS = new Set(['image', 'video', 'audio'])
const IMAGE_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-zA-Z0-9+/]+={0,2}$/i
const VIDEO_MIME_FORMATS = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-quicktime': 'mov',
}
const KNOWN_VIDEO_EXTENSIONS = new Set([
  'mp4',
  'mov',
  'webm',
  'avi',
  'mkv',
  'm4v',
  'flv',
  'mpeg',
  'mpg',
  'ts',
])

export function collectKlingOmniReferences(references) {
  const result = []
  const ids = new Set()
  const objects = new WeakSet()
  for (const reference of Array.isArray(references) ? references : []) {
    if (!reference || typeof reference !== 'object') continue
    const data = reference.data || reference
    if (!MEDIA_KINDS.has(data.kind)) continue
    const id = reference.id ?? reference.nodeId ?? data.nodeId
    if (id != null && String(id)) {
      if (ids.has(String(id))) continue
      ids.add(String(id))
    } else {
      if (objects.has(reference)) continue
      objects.add(reference)
    }
    result.push(data)
  }
  return result
}

function knownPositive(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function extension(value) {
  if (typeof value !== 'string') return ''
  return value.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || ''
}

function videoFormat(data, parsedUrl) {
  const mime = String(data.mimeType || data.fileType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (VIDEO_MIME_FORMATS[mime]) return VIDEO_MIME_FORMATS[mime]
  if (mime.startsWith('video/')) return mime.slice(6)
  const filename = data.fileName || data.filename || data.originalName
  if (filename) return extension(filename)
  const urlExtension = extension(parsedUrl?.pathname)
  // An opaque download endpoint is not proof of an unsupported video container.
  return KNOWN_VIDEO_EXTENSIONS.has(urlExtension) ? urlExtension : ''
}

function referenceUrl(data, errors, warnings) {
  const url = data.assetUrl ?? data.url ?? ''
  const label = data.kind === 'image' ? '参考图片' : data.kind === 'video' ? '参考视频' : '参考音频'
  if (typeof url !== 'string' || !url.trim()) {
    errors.push(`连接的${label}尚未就绪，请先生成或上传素材`)
    return null
  }
  if (data.kind === 'image' && (IMAGE_DATA_URL.test(url) || url.startsWith('blob:'))) {
    warnings.push('本地参考图片尚待上传，生成前需转换为可访问的图片地址')
    return null
  }
  try {
    const parsed = new URL(url)
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password)
      return parsed
  } catch {
    // The same visible error covers malformed, credential-bearing and local URLs.
  }
  errors.push(`${label}需要可访问的 HTTP(S) 地址`)
  return null
}

function inspectVideo(data, limits, parsedUrl, errors, warnings) {
  const duration = knownPositive(data.mediaDuration ?? data.durationSeconds)
  if (duration == null)
    warnings.push(`尚未读取参考视频时长，需核验为 ${limits.minDuration}～${limits.maxDuration} 秒`)
  else if (duration < limits.minDuration || duration > limits.maxDuration)
    errors.push(`参考视频时长须为 ${limits.minDuration}～${limits.maxDuration} 秒`)

  const width = knownPositive(data.mediaWidth ?? data.width)
  if (width == null) warnings.push(`尚未读取参考视频宽度，需核验不小于 ${limits.minWidth}px`)
  else if (width < limits.minWidth) errors.push(`参考视频宽度不能小于 ${limits.minWidth}px`)

  const size = knownPositive(data.fileSize ?? data.sizeBytes)
  if (size == null) warnings.push(`尚未读取参考视频文件大小，需核验不超过 ${limits.maxSizeMB}MB`)
  else if (size > limits.maxSizeMB * 1024 * 1024)
    errors.push(`参考视频文件大小不能超过 ${limits.maxSizeMB}MB`)

  const format = videoFormat(data, parsedUrl)
  if (!format) warnings.push(`尚未确认参考视频格式，需使用 ${limits.formats.join(' / ')} 文件`)
  else if (!limits.formats.includes(format))
    errors.push(`参考视频仅支持 ${limits.formats.join(' / ')} 格式`)
}

// This is a local, non-network preflight for the parameter popup, not a claim
// that a remote URL is publicly reachable or that a provider accepted a file.
export function klingOmniReferenceState(mode, references = []) {
  const { assetLimits } = klingOmniControls(mode)
  const media = collectKlingOmniReferences(references)
  const counts = { image: 0, video: 0, audio: 0 }
  const errors = []
  const warnings = []
  for (const data of media) counts[data.kind] += 1

  const image = assetLimits.images
  if (counts.image < image.min)
    errors.push(`首尾帧需连接 ${image.min}～${image.max} 张图片，第1张为首帧，第2张为尾帧`)
  if (counts.image > image.max) errors.push(`${image.label}最多支持 ${image.max} 张图片`)
  if (counts.audio) errors.push('此接口不支持单独音频输入，请移除已连接的音频节点')

  const video = assetLimits.video
  if (!video && counts.video) errors.push('当前模式不支持参考视频，请移除已连接的视频节点')
  else if (video) {
    if (counts.video < video.min) errors.push(`视频参考需连接 ${video.min} 个参考视频`)
    if (counts.video > video.max) errors.push(`视频参考最多支持 ${video.max} 个参考视频`)
  }

  for (const data of media) {
    const parsedUrl = referenceUrl(data, errors, warnings)
    if (data.kind === 'video' && video) inspectVideo(data, video, parsedUrl, errors, warnings)
  }
  return { counts, errors: [...new Set(errors)], warnings: [...new Set(warnings)] }
}
