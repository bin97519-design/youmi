// These browser-only tools act on real media. They never submit a model task,
// reuse a visible player's element, or pretend a cross-origin failure succeeded.
export const VIDEO_FRAME_MAX_PIXELS = 16 * 1024 * 1024
export const VIDEO_DOWNLOAD_MAX_BYTES = 300 * 1024 * 1024
const FRAME_MAX_DIMENSION = 8192
const TIMEOUT_LIMIT_MS = 120000
const PNG_PREFIX = /^data:image\/png;base64,iVBORw0KGgo/

class VideoMediaReadError extends Error {}

function abortError(signal) {
  return signal?.reason || new DOMException('操作已取消', 'AbortError')
}
function ensureActive(signal) {
  if (signal?.aborted) throw abortError(signal)
}
function boundedInteger(value, fallback, maximum, message) {
  const result = value == null ? fallback : Number(value)
  if (!Number.isInteger(result) || result < 1 || result > maximum) throw new Error(message)
  return result
}
function safeSource(source, baseURI) {
  if (typeof source !== 'string' || !source.trim() || source.length > 16384)
    throw new Error('请提供有效的视频地址')
  let url
  try {
    url = baseURI ? new URL(source, baseURI) : new URL(source)
  } catch {
    throw new Error('视频地址格式不正确')
  }
  if (!['http:', 'https:', 'blob:'].includes(url.protocol) || url.username || url.password)
    throw new Error('视频地址仅支持无内嵌账号密码的 HTTP、HTTPS 或本地 Blob 地址')
  return url.href
}
function safeFilename(input, extension) {
  const name = [...String(input || 'video')]
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? '-' : character,
    )
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[. ]+$/g, '')
    .slice(0, 100)
  return `${name || 'video'}.${extension}`
}
function recognizedVideo(bytes, declaredType) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end))
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp') {
    if (/^(avif|avis|heic|heix|mif1|msf1)$/.test(ascii(8, 12))) return null
    return ascii(8, 12) === 'qt  '
      ? { mime: 'video/quicktime', extension: 'mov' }
      : { mime: 'video/mp4', extension: 'mp4' }
  }
  if (bytes.length >= 8 && /^(moov|mdat|wide)$/.test(ascii(4, 8)))
    return { mime: 'video/quicktime', extension: 'mov' }
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
    return { mime: 'video/webm', extension: 'webm' }
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'AVI ')
    return { mime: 'video/x-msvideo', extension: 'avi' }
  if (ascii(0, 4) === 'OggS' && declaredType === 'video/ogg')
    return { mime: 'video/ogg', extension: 'ogv' }
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && [0xba, 0xb3].includes(bytes[3]))
    return { mime: 'video/mpeg', extension: 'mpeg' }
  return null
}

export function createVideoMediaTools(dependencies = {}) {
  const documentRef = dependencies.document ?? globalThis.document
  const createVideo = dependencies.createVideo || (() => documentRef?.createElement('video'))
  const createCanvas = dependencies.createCanvas || (() => documentRef?.createElement('canvas'))
  const fetchMedia = dependencies.fetch || globalThis.fetch?.bind(globalThis)
  const BlobType = dependencies.Blob || globalThis.Blob
  const FileType = dependencies.File || globalThis.File
  const urls = dependencies.URL || globalThis.URL
  const startTimer = dependencies.setTimeout || globalThis.setTimeout
  const clearTimer = dependencies.clearTimeout || globalThis.clearTimeout

  function scope(options, timeoutMessage) {
    ensureActive(options.signal)
    const timeoutMs = boundedInteger(
      options.timeoutMs,
      30000,
      TIMEOUT_LIMIT_MS,
      '读取超时必须为 1–120000 毫秒',
    )
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(abortError(options.signal))
    options.signal?.addEventListener('abort', forwardAbort, { once: true })
    const timer = startTimer(() => controller.abort(new Error(timeoutMessage)), timeoutMs)
    return {
      signal: controller.signal,
      dispose() {
        clearTimer(timer)
        options.signal?.removeEventListener('abort', forwardAbort)
      },
    }
  }
  function raceAbort(promise, signal) {
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener('abort', abort)
        reject(abortError(signal))
      }
      if (signal.aborted) return abort()
      signal.addEventListener('abort', abort, { once: true })
      Promise.resolve(promise).then(
        (value) => {
          signal.removeEventListener('abort', abort)
          if (signal.aborted) reject(abortError(signal))
          else resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', abort)
          reject(signal.aborted ? abortError(signal) : error)
        },
      )
    })
  }
  function mediaEvent(element, name, signal, message, run, ready) {
    return new Promise((resolve, reject) => {
      const clean = () => {
        element.removeEventListener(name, complete)
        element.removeEventListener('error', fail)
        signal.removeEventListener('abort', abort)
      }
      const complete = () => {
        clean()
        resolve()
      }
      const fail = () => {
        clean()
        reject(new VideoMediaReadError(message, { cause: element.error }))
      }
      const abort = () => {
        clean()
        reject(abortError(signal))
      }
      if (signal.aborted) return abort()
      element.addEventListener(name, complete, { once: true })
      element.addEventListener('error', fail, { once: true })
      signal.addEventListener('abort', abort, { once: true })
      try {
        run?.()
        // Metadata and frame decoding can fail between awaited media events.
        // Do not wait for an error event that has already been dispatched.
        if (element.error) fail()
        else if (ready?.()) complete()
      } catch (cause) {
        clean()
        reject(cause)
      }
    })
  }

  async function captureFrame(source, requestedTime = 0, options = {}) {
    ensureActive(options.signal)
    if (!Number.isFinite(requestedTime) || requestedTime < 0)
      throw new Error('截帧时间必须是非负秒数')
    const maxPixels = boundedInteger(
      options.maxPixels,
      VIDEO_FRAME_MAX_PIXELS,
      VIDEO_FRAME_MAX_PIXELS,
      '截帧像素上限无效',
    )
    const maxDimension = boundedInteger(
      options.maxDimension,
      4096,
      FRAME_MAX_DIMENSION,
      '截帧尺寸上限无效',
    )
    const url = safeSource(source, documentRef?.baseURI)
    const operation = scope(options, '截取视频画面超时，请检查视频网络或跨域权限后重试')
    let video
    let canvas
    let localVideoUrl
    const releaseVideo = () => {
      if (!video) return
      video.pause()
      video.removeAttribute('src')
      video.load()
      video = null
    }
    const loadVideo = async (videoUrl) => {
      video = createVideo()
      if (!video) throw new Error('当前浏览器不支持读取视频')
      // Must precede src. No credentials are sent to a third-party media host.
      video.crossOrigin = 'anonymous'
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      await mediaEvent(
        video,
        'loadedmetadata',
        operation.signal,
        '视频无法读取，请检查视频地址、编码格式或跨域访问权限',
        () => {
          video.src = videoUrl
          video.load()
        },
        () => video.readyState >= 1,
      )
    }
    try {
      try {
        await loadVideo(url)
      } catch (cause) {
        ensureActive(operation.signal)
        if (
          !(cause instanceof VideoMediaReadError) ||
          !/^https?:/i.test(url) ||
          !fetchMedia ||
          !BlobType ||
          !urls?.createObjectURL ||
          !urls?.revokeObjectURL
        )
          throw cause
        releaseVideo()
        // A no-CORS playback response can be reused from the browser's media
        // cache when the host omits Vary: Origin. Fetch a fresh CORS-validated
        // copy without changing signed URLs, then decode an origin-clean Blob.
        // The downloader bounds and validates the bytes; it never saves here.
        const original = await downloadOriginal(url, {
          save: false,
          signal: operation.signal,
          timeoutMs: options.timeoutMs,
        })
        ensureActive(operation.signal)
        localVideoUrl = urls.createObjectURL(original.blob)
        await loadVideo(localVideoUrl)
      }
      const duration = Number(video.duration)
      const sourceWidth = Number(video.videoWidth)
      const sourceHeight = Number(video.videoHeight)
      if (!Number.isFinite(duration) || duration <= 0 || duration > 86400)
        throw new Error('视频时长无效或超过 24 小时，无法定位截图')
      if (requestedTime > duration) throw new Error('截帧时间超出视频实际时长')
      if (
        !Number.isInteger(sourceWidth) ||
        !Number.isInteger(sourceHeight) ||
        sourceWidth <= 0 ||
        sourceHeight <= 0 ||
        sourceWidth > 32768 ||
        sourceHeight > 32768
      )
        throw new Error('视频画面尺寸无效或超过浏览器安全上限')
      if (video.readyState < 2)
        await mediaEvent(
          video,
          'loadeddata',
          operation.signal,
          '视频画面尚未解码，无法截帧',
          null,
          () => video.readyState >= 2,
        )
      // Seeking exactly to duration may produce an empty ended frame.
      const time = Math.min(requestedTime, Math.max(0, duration - 0.04))
      if (Math.abs(Number(video.currentTime) - time) > 0.001)
        await mediaEvent(
          video,
          'seeked',
          operation.signal,
          '视频无法定位到指定画面，请重新选择截帧位置',
          () => {
            video.currentTime = time
          },
        )
      ensureActive(operation.signal)
      if (video.readyState < 2 || video.seeking) throw new Error('视频画面尚未解码，无法截帧')
      const scale = Math.min(
        1,
        maxDimension / Math.max(sourceWidth, sourceHeight),
        Math.sqrt(maxPixels / (sourceWidth * sourceHeight)),
      )
      const width = Math.max(1, Math.floor(sourceWidth * scale))
      const height = Math.max(1, Math.floor(sourceHeight * scale))
      canvas = createCanvas()
      if (!canvas) throw new Error('当前浏览器不支持截取视频画面')
      canvas.width = width
      canvas.height = height
      const context = canvas.getContext('2d', { alpha: false })
      if (!context) throw new Error('当前浏览器不支持读取视频画面')
      try {
        context.drawImage(video, 0, 0, width, height)
      } catch (cause) {
        throw new Error('无法读取视频像素，请确认视频源允许跨域截图', { cause })
      }
      let blob
      let dataUrl
      try {
        blob = await raceAbort(
          new Promise((resolve, reject) => {
            canvas.toBlob(
              (result) =>
                result?.size && result.type === 'image/png'
                  ? resolve(result)
                  : reject(new Error('截图编码失败，未得到有效 PNG 图片')),
              'image/png',
            )
          }),
          operation.signal,
        )
        ensureActive(operation.signal)
        dataUrl = canvas.toDataURL('image/png')
      } catch (cause) {
        ensureActive(operation.signal)
        throw new Error('截图导出失败，请确认视频源允许跨域截图', { cause })
      }
      if (!PNG_PREFIX.test(dataUrl) || blob.size > VIDEO_FRAME_MAX_PIXELS * 4)
        throw new Error('截图不是有效 PNG 图片或超过安全大小限制')
      const filename = safeFilename(
        options.filename || `video-frame-${Math.round(time * 100)}cs`,
        'png',
      )
      const file = FileType ? new FileType([blob], filename, { type: 'image/png' }) : blob
      ensureActive(operation.signal)
      return { file, blob, dataUrl, width, height, time, duration }
    } finally {
      operation.dispose()
      releaseVideo()
      if (localVideoUrl) urls.revokeObjectURL(localVideoUrl)
      if (canvas) {
        canvas.width = 0
        canvas.height = 0
      }
    }
  }

  async function downloadOriginal(source, options = {}) {
    ensureActive(options.signal)
    if (!fetchMedia || !BlobType) throw new Error('当前浏览器不支持下载视频文件')
    const url = safeSource(source, documentRef?.baseURI)
    const maxBytes = boundedInteger(
      options.maxBytes,
      VIDEO_DOWNLOAD_MAX_BYTES,
      VIDEO_DOWNLOAD_MAX_BYTES,
      '视频下载大小上限无效',
    )
    const operation = scope(options, '下载原视频超时，请检查网络后重试')
    let reader
    try {
      const response = await raceAbort(
        fetchMedia(url, {
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          signal: operation.signal,
        }),
        operation.signal,
      )
      if (!response.ok)
        throw new Error(`下载原视频失败（${response.status}），视频可能已失效或无访问权限`)
      if (response.status === 206) throw new Error('源站仅返回视频片段，无法作为完整原视频下载')
      const type = (response.headers?.get('content-type') || '').split(';')[0].trim().toLowerCase()
      if (type && !type.startsWith('video/') && type !== 'application/octet-stream')
        throw new Error('视频地址返回的不是视频文件，已取消下载')
      const declaredSize = Number(response.headers?.get('content-length')) || 0
      if (declaredSize > maxBytes) throw new Error('原视频超过允许下载的文件大小')
      const chunks = []
      let size = 0
      if (response.body?.getReader) {
        reader = response.body.getReader()
        while (true) {
          const result = await raceAbort(reader.read(), operation.signal)
          if (result.done) break
          size += result.value.byteLength
          if (size > maxBytes) throw new Error('原视频超过允许下载的文件大小')
          chunks.push(result.value)
        }
      } else {
        const blob = await raceAbort(response.blob(), operation.signal)
        size = blob.size
        if (size > maxBytes) throw new Error('原视频超过允许下载的文件大小')
        chunks.push(blob)
      }
      if (!size) throw new Error('源视频文件为空，已取消下载')
      if (declaredSize && size !== declaredSize)
        throw new Error('原视频下载不完整，已取消下载，请重试')
      let blob = new BlobType(chunks, { type: type || 'application/octet-stream' })
      const prefix = new Uint8Array(
        await raceAbort(blob.slice(0, 64).arrayBuffer(), operation.signal),
      )
      const format = recognizedVideo(prefix, type)
      if (!format) throw new Error('视频内容校验失败，可能是错误页或不支持的视频格式，已取消下载')
      blob = new BlobType([blob], { type: format.mime })
      const filename = safeFilename(options.filename, format.extension)
      const file = FileType ? new FileType([blob], filename, { type: format.mime }) : blob
      ensureActive(operation.signal)
      let downloadStarted = false
      if (options.save !== false) {
        if (!documentRef?.createElement || !urls?.createObjectURL || !urls?.revokeObjectURL)
          throw new Error('当前浏览器无法发起文件下载')
        const objectUrl = urls.createObjectURL(blob)
        let anchor
        try {
          anchor = documentRef.createElement('a')
          anchor.href = objectUrl
          anchor.download = filename
          anchor.rel = 'noopener'
          anchor.style.display = 'none'
          documentRef.body?.appendChild(anchor)
          ensureActive(operation.signal)
          anchor.click()
          downloadStarted = true
        } finally {
          anchor?.remove()
          // Let the browser consume the download URL before releasing it.
          startTimer(() => urls.revokeObjectURL(objectUrl), 1000)
        }
      }
      return { file, blob, filename, mime: format.mime, size, downloadStarted }
    } catch (cause) {
      ensureActive(operation.signal)
      if (cause instanceof TypeError)
        throw new Error('无法下载原视频，请检查网络或视频源的跨域访问权限', { cause })
      throw cause
    } finally {
      operation.dispose()
      if (reader) {
        try {
          void Promise.resolve(reader.cancel()).catch(() => {})
          reader.releaseLock()
        } catch {
          // Some browsers finish cancelling an in-flight read asynchronously.
        }
      }
    }
  }
  return { captureFrame, downloadOriginal }
}

export function captureVideoFrame(source, time, options) {
  return createVideoMediaTools().captureFrame(source, time, options)
}
export function downloadOriginalVideo(source, options) {
  return createVideoMediaTools().downloadOriginal(source, options)
}
