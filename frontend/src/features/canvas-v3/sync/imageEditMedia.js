import { imagePixelSize } from '../config/imageToolGeometry.js'

function abortIfNeeded(signal) {
  signal?.throwIfAborted()
}

function decodeImage(url, signal) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      image.src = ''
      reject(signal.reason || new DOMException('已取消', 'AbortError'))
    }
    image.onload = () => {
      cleanup()
      try {
        imagePixelSize(image.naturalWidth, image.naturalHeight)
        resolve(image)
      } catch (error) {
        reject(error)
      }
    }
    image.onerror = () => {
      cleanup()
      reject(new Error('图片加载失败'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    image.src = url
  })
}

export async function loadEditableImage(
  url,
  { signal, path = (value) => value, headers = {} } = {},
) {
  if (!url) throw new Error('请先选择图片')
  try {
    return await decodeImage(url, signal)
  } catch (failure) {
    abortIfNeeded(signal)
    if (!/^https?:\/\//i.test(url)) throw failure
    // Authentication belongs only on our same-origin proxy, never on the image host.
    const response = await fetch(
      path('/api/image-tasks/proxy-download?url=' + encodeURIComponent(url)),
      {
        headers,
        signal,
      },
    )
    if (!response.ok) throw new Error('参考图片读取失败，请重新上传后重试')
    const blob = await response.blob()
    abortIfNeeded(signal)
    const objectUrl = URL.createObjectURL(blob)
    try {
      return await decodeImage(objectUrl, signal)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }
}

function pngDataUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('裁图编码失败，请重试'))
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(new Error('裁图读取失败，请重试'))
      reader.readAsDataURL(blob)
    }, 'image/png')
  })
}

export async function cropImageRegions(image, regions, { signal, onProgress = () => {} } = {}) {
  imagePixelSize(image.naturalWidth, image.naturalHeight)
  if (!Array.isArray(regions) || !regions.length || regions.length > 100)
    throw new Error('请至少选择一个画格，单次最多切分100格')
  for (const r of regions)
    if (
      ![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width < 1 ||
      r.height < 1 ||
      r.x + r.width > image.naturalWidth ||
      r.y + r.height > image.naturalHeight
    )
      throw new Error('裁剪范围超出图片，请重新选择')
  const results = []
  const canvas = document.createElement('canvas')
  try {
    for (const region of regions) {
      abortIfNeeded(signal)
      canvas.width = region.width
      canvas.height = region.height
      const context = canvas.getContext('2d')
      if (!context) throw new Error('浏览器不支持裁图，请更换浏览器后重试')
      context.drawImage(
        image,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        region.width,
        region.height,
      )
      const url = await pngDataUrl(canvas)
      abortIfNeeded(signal)
      results.push({ url, width: region.width, height: region.height, region })
      onProgress(results.length, regions.length)
    }
    return results
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}
