import { personalAssetImageUrl } from '../config/personalAssetLibrary.js'

export const MAX_CLIPBOARD_IMAGE_BYTES = 20 * 1024 * 1024
const TOO_LARGE = '图片超过 20MB，无法复制到剪贴板，请先压缩图片'
const MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
])
const mimeType = (value) =>
  String(value || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
    .replace(/^image\/jpg$/, 'image/jpeg')
const abortReason = (signal) => signal?.reason || new DOMException('图片复制已取消', 'AbortError')
function checkAbort(signal) {
  if (signal?.aborted) throw abortReason(signal)
}
function checkSize(size) {
  if (size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error(TOO_LARGE)
}

/** Abort promptly; release a decoder result that arrives after cancellation as well. */
function abortable(promise, signal, releaseLate = () => {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(abortReason(signal))
    }
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          releaseLate(value)
          return
        }
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (!settled) {
          settled = true
          cleanup()
          reject(error)
        }
      },
    )
  })
}

function sniffRaster(bytes) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end))
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
    return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  if (ascii(0, 2) === 'BM') return 'image/bmp'
  if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 64))) return 'image/avif'
  return ''
}
async function checkedRaster(blob, signal, pngOnly = false) {
  checkAbort(signal)
  if (!blob || typeof blob.arrayBuffer !== 'function' || !blob.size)
    throw new Error('图片内容为空或格式无效')
  checkSize(blob.size)
  const declared = mimeType(blob.type)
  if (declared && declared !== 'application/octet-stream' && !MIME_TYPES.has(declared))
    throw new Error('仅支持 PNG、JPG、WebP、GIF、AVIF 或 BMP 图片，不支持 SVG')
  const actual = sniffRaster(
    new Uint8Array(await abortable(blob.slice(0, 64).arrayBuffer(), signal)),
  )
  if (!actual || (pngOnly && actual !== 'image/png'))
    throw new Error(
      pngOnly ? '图片转换失败：未得到有效的 PNG 图片' : '图片内容不是受支持的位图，请重新上传图片',
    )
  return blob.type === actual ? blob : new Blob([blob], { type: actual })
}
function decodeDataUrl(source) {
  checkSize(Math.floor((Math.max(0, source.length - 100) * 3) / 4))
  const match = source.match(
    /^data:(image\/(?:png|jpe?g|webp|gif|avif|bmp));base64,([a-zA-Z0-9+/]+={0,2})$/i,
  )
  if (!match) throw new Error('图片数据格式无效，不支持 SVG 或临时图片地址')
  let binary
  try {
    binary = globalThis.atob(match[2])
  } catch {
    throw new Error('图片 Base64 数据无效')
  }
  checkSize(binary.length)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType(match[1]) })
}
function authHeaders(value) {
  const resolved = typeof value === 'function' ? value() : value
  if (typeof Headers !== 'undefined' && resolved instanceof Headers)
    return Object.fromEntries(resolved.entries())
  if (resolved == null) return {}
  if (typeof resolved !== 'object' || Array.isArray(resolved))
    throw new Error('图片代理认证配置无效')
  return { ...resolved }
}
async function responseBlob(response, signal) {
  if (!response?.ok)
    throw new Error(`图片读取失败（${response?.status || '网络异常'}），请检查登录状态后重试`)
  const contentType = mimeType(response.headers?.get?.('content-type'))
  if (contentType && contentType !== 'application/octet-stream' && !MIME_TYPES.has(contentType))
    throw new Error('图片代理返回了非图片内容，无法复制')
  checkSize(Number(response.headers?.get?.('content-length')) || 0)
  const reader = response.body?.getReader?.()
  if (!reader) return checkedRaster(await abortable(response.blob(), signal), signal)
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      checkAbort(signal)
      if (done) break
      size += value.byteLength
      checkSize(size)
      chunks.push(value)
    }
    return await checkedRaster(new Blob(chunks, { type: contentType }), signal)
  } catch (error) {
    try {
      await reader.cancel(error)
    } catch {
      /* The fetch may already be aborted. */
    }
    throw error
  } finally {
    reader.releaseLock?.()
  }
}
async function loadRaster(source, { path, headers, fetcher, signal }) {
  checkAbort(signal)
  if (source.startsWith('data:')) return checkedRaster(decodeDataUrl(source), signal)
  if (typeof fetcher !== 'function') throw new Error('当前浏览器无法读取图片')
  // Only our authenticated proxy receives headers, never the remote CDN / user-supplied URL.
  const response = await abortable(
    fetcher(path(`/api/image-tasks/proxy-download?url=${encodeURIComponent(source)}`), {
      method: 'GET',
      headers: authHeaders(headers),
      signal,
    }),
    signal,
  )
  return responseBlob(response, signal)
}

async function decodedImage(blob, signal) {
  checkAbort(signal)
  if (typeof globalThis.createImageBitmap === 'function') {
    const bitmap = await abortable(globalThis.createImageBitmap(blob), signal, (late) =>
      late?.close?.(),
    )
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close?.(),
    }
  }
  if (typeof globalThis.Image !== 'function' || typeof URL.createObjectURL !== 'function')
    throw new Error('浏览器不支持图片转换，请使用最新版 Chrome、Edge 或 Firefox')
  const objectUrl = URL.createObjectURL(blob)
  let image
  try {
    image = new globalThis.Image()
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal?.removeEventListener('abort', abort)
    }
    const dispose = () => {
      image.src = ''
      URL.revokeObjectURL(objectUrl)
    }
    const abort = () => {
      cleanup()
      dispose()
      reject(abortReason(signal))
    }
    image.onload = () => {
      cleanup()
      resolve({ image, width: image.naturalWidth, height: image.naturalHeight, dispose })
    }
    image.onerror = () => {
      cleanup()
      dispose()
      reject(new Error('图片解码失败，请重新上传图片'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    try {
      image.src = objectUrl
    } catch (error) {
      cleanup()
      dispose()
      reject(error)
    }
  })
}

/** Converts the first raster frame to actual PNG bytes; no cross-origin canvas or URL fallback. */
export async function convertCanvasImageToPng(blob, { signal } = {}) {
  const raster = await checkedRaster(blob, signal)
  if (raster.type === 'image/png') return raster
  let decoded
  let canvas
  try {
    decoded = await decodedImage(raster, signal)
    checkAbort(signal)
    const { width, height } = decoded
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 32768 ||
      height > 32768 ||
      width * height > 64 * 1024 * 1024
    )
      throw new Error('图片尺寸过大或无效，无法复制到剪贴板')
    canvas =
      globalThis.document?.createElement?.('canvas') ||
      (typeof globalThis.OffscreenCanvas === 'function'
        ? new globalThis.OffscreenCanvas(width, height)
        : null)
    if (!canvas) throw new Error('浏览器不支持 PNG 图片转换')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器无法创建图片画布')
    context.drawImage(decoded.image, 0, 0, width, height)
    const output =
      typeof canvas.convertToBlob === 'function'
        ? canvas.convertToBlob({ type: 'image/png' })
        : new Promise((resolve, reject) =>
            canvas.toBlob(
              (result) => (result ? resolve(result) : reject(new Error('图片 PNG 编码失败'))),
              'image/png',
            ),
          )
    return await checkedRaster(await abortable(output, signal), signal, true)
  } finally {
    decoded?.dispose()
    if (canvas) {
      canvas.width = 1
      canvas.height = 1
    }
  }
}

function clipboardError(error) {
  if (error?.name === 'AbortError') return error
  if (['NotAllowedError', 'SecurityError'].includes(error?.name)) {
    const result = new Error(
      '浏览器未允许复制图片，请使用 HTTPS 或 localhost、允许剪贴板权限后重新点击复制',
      { cause: error },
    )
    result.name = error.name
    return result
  }
  return error
}

/** Must be called directly inside the click handler to preserve browser user activation. */
export async function copyCanvasImage(
  url,
  {
    path = (value) => value,
    headers = {},
    clipboard = globalThis.navigator?.clipboard,
    ClipboardItemCtor = globalThis.ClipboardItem,
    fetcher = globalThis.fetch,
    convertToPng = convertCanvasImageToPng,
    signal,
  } = {},
) {
  checkAbort(signal)
  if (typeof url !== 'string') throw new Error('请选择有效的图片')
  const source = url.trim()
  if (!source.startsWith('data:') && !personalAssetImageUrl(source))
    throw new Error('图片地址无效，不支持临时地址或带凭证的地址')
  if (
    source.startsWith('data:') &&
    !/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[a-zA-Z0-9+/]+={0,2}$/i.test(source)
  )
    throw new Error('图片数据格式无效，不支持 SVG')
  if (!clipboard?.write || typeof ClipboardItemCtor !== 'function')
    throw new Error('当前浏览器不支持复制图片，请使用 HTTPS 或 localhost，并允许剪贴板权限')
  if (typeof ClipboardItemCtor.supports === 'function' && !ClipboardItemCtor.supports('image/png'))
    throw new Error('当前浏览器不支持 PNG 图片剪贴板，请更换浏览器')
  if (typeof path !== 'function' || typeof convertToPng !== 'function')
    throw new Error('图片复制服务配置无效')
  const request = new AbortController()
  const abort = () => request.abort(abortReason(signal))
  signal?.addEventListener('abort', abort, { once: true })
  // Do not await fetching/decoding before calling write: Safari/Firefox may consume activation.
  const imagePromise = Promise.resolve().then(async () => {
    const raster = await loadRaster(source, { path, headers, fetcher, signal: request.signal })
    const result =
      raster.type === 'image/png' ? raster : await convertToPng(raster, { signal: request.signal })
    return checkedRaster(result, request.signal, true)
  })
  imagePromise.catch(() => {}) // write/constructor may reject before consuming its promised Blob.
  try {
    let item
    try {
      item = new ClipboardItemCtor({ 'image/png': imagePromise })
    } catch (error) {
      throw new Error('当前浏览器不支持异步图片剪贴板，请使用最新版 Chrome、Edge 或 Firefox', {
        cause: error,
      })
    }
    const writing = clipboard.write([item])
    const [, blob] = await Promise.all([writing, imagePromise])
    checkAbort(request.signal)
    return { mimeType: 'image/png', size: blob.size }
  } catch (error) {
    request.abort()
    throw clipboardError(error)
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}

export function createImageClipboardClient(options = {}) {
  return { copy: (url, request = {}) => copyCanvasImage(url, { ...options, ...request }) }
}
