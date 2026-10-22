const IMAGE_EXTENSION = /\.(?:png|jpe?g|webp|gif|avif|bmp|ico|heic|heif|svgz?)$/i
const LOCAL_FILE_LIMIT = 1024 * 1024
const LOCAL_CANVAS_LIMIT = 2500000

function imageMimeType(file) {
  if (file.type?.toLowerCase().startsWith('image/')) return file.type.toLowerCase()
  const extension = (file.name || '').split('.').at(-1).toLowerCase()
  return {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
  }[extension]
}

export function canvasImageFiles(transfer) {
  const files = Array.from(transfer?.files || [])
  const candidates = files.length
    ? files
    : Array.from(transfer?.items || [])
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile?.())
        .filter(Boolean)
  return candidates.filter(
    (file) => file.type?.startsWith('image/') || IMAGE_EXTENSION.test(file.name || ''),
  )
}

export function canvasTransferHasFiles(transfer) {
  return (
    Array.from(transfer?.types || []).includes('Files') ||
    Boolean(transfer?.files?.length) ||
    Array.from(transfer?.items || []).some((item) => item.kind === 'file')
  )
}

export function canvasImageTargetIsEditable(target) {
  return Boolean(
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) ||
    target?.isContentEditable ||
    target?.closest?.(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-canvas-shortcuts-ignore]',
    ),
  )
}

export function readCanvasImage(file, { signal } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    let image
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      if (image) image.onload = image.onerror = null
    }
    const fail = (error) => {
      cleanup()
      reject(error)
    }
    const abort = () => {
      reader.abort()
      fail(new DOMException('图片导入已取消', 'AbortError'))
    }
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    reader.onerror = () => fail(new Error('无法读取图片，请重新选择文件'))
    reader.onload = () => {
      const mimeType = imageMimeType(file)
      const dataUrl = mimeType
        ? String(reader.result).replace(/^data:[^;,]*/, `data:${mimeType}`)
        : reader.result
      image = new Image()
      image.onload = () => {
        cleanup()
        if (!image.naturalWidth || !image.naturalHeight)
          return reject(new Error('图片尺寸无效，请使用有效的图片文件'))
        resolve({
          dataUrl,
          width: image.naturalWidth,
          height: image.naturalHeight,
        })
      }
      image.onerror = () => fail(new Error('无法解码图片，请转换为 PNG、JPG 或 WebP 后重试'))
      image.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

/** User-initiated imports only. No generation tasks, ephemeral URLs or cross-canvas writes. */
export function createCanvasImageImporter({
  graph,
  upload,
  maxBytes,
  canUpload = () => true,
  getScope = () => graph.projectId,
  readImage = readCanvasImage,
  onStatus = () => {},
}) {
  let disposed = false
  let revision = 0
  let queue = Promise.resolve()
  const controllers = new Set()

  async function run(files, anchor, scope, version) {
    const current = () => !disposed && version === revision && scope === getScope()
    if (!current()) return []
    const controller = new AbortController()
    controllers.add(controller)
    const assets = []
    const errors = []
    let localBytes = graph.nodes.reduce(
      (sum, node) =>
        sum + (node.data.assetUrl?.startsWith('data:') ? node.data.assetUrl.length : 0),
      0,
    )
    let localCount = 0
    try {
      for (const [index, originalFile] of files.entries()) {
        if (!current()) return []
        const mimeType = imageMimeType(originalFile)
        const file =
          mimeType &&
          originalFile.type !== mimeType &&
          typeof File !== 'undefined' &&
          originalFile instanceof Blob
            ? new File([originalFile], originalFile.name, {
                type: mimeType,
                lastModified: originalFile.lastModified,
              })
            : originalFile
        onStatus({
          busy: true,
          error: false,
          message: `正在导入图片（${index + 1}/${files.length}）`,
        })
        try {
          if (file.type?.toLowerCase() === 'image/svg+xml' || /\.svgz?$/i.test(file.name || ''))
            throw new Error('暂不支持 SVG，请使用 PNG、JPG 或 WebP 图片')
          if (file.size > maxBytes) throw new Error('图片不能超过 20MB，请压缩后重新导入')
          const decoded = await readImage(file, { signal: controller.signal })
          if (!current()) return []
          let url = ''
          let uploadError
          if (canUpload()) {
            try {
              const result = await upload(file, {
                dir: 'youmi-canvas/uploads',
                signal: controller.signal,
              })
              url = typeof result === 'string' ? result : result?.url
              if (!/^https?:\/\//i.test(url || '')) throw new Error('上传未返回有效图片地址')
            } catch (error) {
              if (error.name === 'AbortError') throw error
              uploadError = error
              url = ''
            }
          }
          if (!current()) return []
          if (!url) {
            if (
              file.size > LOCAL_FILE_LIMIT ||
              localBytes + decoded.dataUrl.length > LOCAL_CANVAS_LIMIT
            )
              throw new Error(
                uploadError
                  ? `上传失败：${uploadError.message}；图片过大，无法降级为本地保存`
                  : '本地图片存储空间不足，请登录后导入，或使用 1MB 以内的图片',
              )
            url = decoded.dataUrl
            localBytes += url.length
            localCount++
          }
          assets.push({
            title: file.name || `粘贴图片 ${index + 1}.png`,
            assetUrl: url,
            mediaWidth: decoded.width,
            mediaHeight: decoded.height,
          })
        } catch (error) {
          if (error.name === 'AbortError' || !current()) return []
          errors.push(`${file.name || '图片'}：${error.message || '导入失败'}`)
        }
      }
      if (!current()) return []
      const nodes = assets.length ? graph.addImageAssets(assets, anchor) : []
      onStatus({
        busy: false,
        error: errors.length > 0,
        message: [
          nodes.length ? `已将 ${nodes.length} 张图片加入画布` : '',
          localCount ? `${localCount} 张已本地保存，生成时会上传参考图` : '',
          errors.length ? `${errors.length} 张导入失败：${errors[0]}` : '',
        ]
          .filter(Boolean)
          .join('；'),
      })
      return nodes
    } finally {
      controllers.delete(controller)
    }
  }

  return {
    importFiles(files, anchor) {
      const snapshot = Array.from(files)
      if (!snapshot.length || disposed) return Promise.resolve([])
      const scope = getScope()
      const version = revision
      const position = { ...anchor }
      const pending = queue.then(() => run(snapshot, position, scope, version))
      queue = pending.catch(() => {})
      return pending
    },
    cancel() {
      revision++
      for (const controller of controllers) controller.abort()
      onStatus(null)
    },
    dispose() {
      disposed = true
      this.cancel()
    },
  }
}
