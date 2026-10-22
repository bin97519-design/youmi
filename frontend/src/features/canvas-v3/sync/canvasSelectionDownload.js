import { createStoredZip } from '../../../utils/storedZip.js'
import { canvasSelectionExportEntry } from '../../../utils/canvasSelection.js'

export const CANVAS_SELECTION_DOWNLOAD_LIMITS = Object.freeze({
  count: 50,
  imageBytes: 20 * 1024 * 1024,
  videoBytes: 100 * 1024 * 1024,
  totalBytes: 200 * 1024 * 1024,
  timeoutMs: 30000,
})

const failureListName = '_下载失败清单.txt'
const encoder = new TextEncoder()
const abortReason = (signal) => signal?.reason || new DOMException('下载已取消', 'AbortError')
const checkAbort = (signal) => {
  if (signal?.aborted) throw abortReason(signal)
}

function discardBody(response) {
  try {
    void response?.body?.cancel?.().catch?.(() => {})
  } catch {
    // A locked/failed body must not hide the original read or cancellation error.
  }
}

function boundedLimit(value, fallback, maximum, label) {
  const result = value == null ? fallback : Number(value)
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum)
    throw new Error(`${label}超出允许范围`)
  return result
}

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
        if (settled) return releaseLate(value)
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
}

function privateHost(host) {
  const value = host.toLowerCase().replace(/\.$/, '')
  if (
    !value.includes('.') ||
    value.startsWith('[') ||
    /(^|\.)(localhost|local|internal)$/.test(value)
  )
    return true
  const octets = value.split('.').map(Number)
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part))) return false
  const [a, b] = octets
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && [0, 168].includes(b)) ||
    (a === 198 && [18, 19].includes(b))
  )
}

function sourceDescriptor(value, kind) {
  if (typeof value !== 'string' || !value) throw new Error('节点尚无可下载的成品')
  if (value.startsWith('data:')) {
    if (value.length > Math.ceil((CANVAS_SELECTION_DOWNLOAD_LIMITS.imageBytes * 4) / 3) + 128)
      throw new Error('内嵌图片超过大小限制')
    if (
      kind !== 'image' ||
      !/^data:image\/(?:png|jpe?g|webp|gif|avif|bmp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)
    )
      throw new Error('仅支持有效的位图图片数据，不支持 SVG 或内嵌视频')
    return { type: 'inline' }
  }
  if (
    value.length > 16384 ||
    value.includes('\\') ||
    [...value].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  )
    throw new Error('素材地址无效')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('素材地址仅支持完整的 HTTP(S) 地址')
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname ||
    privateHost(url.hostname)
  )
    throw new Error('素材地址仅支持无账号密码的公网 HTTP(S) 地址')
  return { type: 'remote' }
}

function snapshotSelection(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) throw new Error('请先选择需要下载的节点')
  if (nodes.length > CANVAS_SELECTION_DOWNLOAD_LIMITS.count)
    throw new Error('单次最多下载 50 个节点')
  return Object.freeze(
    nodes.map((node, index) => {
      const data = node?.data || {}
      const item = {
        nodeId: typeof node?.id === 'string' ? node.id : `selection-${index + 1}`,
        title:
          typeof data.title === 'string'
            ? [...data.title].slice(0, 200).join('')
            : `素材-${index + 1}`,
        kind: typeof data.kind === 'string' ? data.kind : '',
        url: typeof data.assetUrl === 'string' ? data.assetUrl : '',
      }
      try {
        if (!['image', 'video'].includes(item.kind)) throw new Error('此下载仅支持图片和视频成品')
        item.sourceType = sourceDescriptor(item.url, item.kind).type
      } catch (error) {
        item.error = error.message
      }
      return Object.freeze(item)
    }),
  )
}

function mediaFormat(bytes, kind) {
  const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end))
  if (kind === 'image') {
    if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value))
      return { mimeType: 'image/png', extension: 'png' }
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
      return { mimeType: 'image/jpeg', extension: 'jpg' }
    if (['GIF87a', 'GIF89a'].includes(ascii(0, 6)))
      return { mimeType: 'image/gif', extension: 'gif' }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP')
      return { mimeType: 'image/webp', extension: 'webp' }
    if (ascii(0, 2) === 'BM') return { mimeType: 'image/bmp', extension: 'bmp' }
    if (ascii(4, 8) === 'ftyp' && /avif|avis/.test(ascii(8, 64)))
      return { mimeType: 'image/avif', extension: 'avif' }
  } else {
    if (bytes.length >= 12 && ascii(4, 8) === 'ftyp') {
      if (/^(avif|avis|heic|heix|mif1|msf1)$/.test(ascii(8, 12))) return null
      return ascii(8, 12) === 'qt  '
        ? { mimeType: 'video/quicktime', extension: 'mov' }
        : { mimeType: 'video/mp4', extension: 'mp4' }
    }
    if (bytes.length >= 8 && /^(moov|mdat|wide)$/.test(ascii(4, 8)))
      return { mimeType: 'video/quicktime', extension: 'mov' }
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3)
      return { mimeType: 'video/webm', extension: 'webm' }
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'AVI ')
      return { mimeType: 'video/x-msvideo', extension: 'avi' }
    if (ascii(0, 4) === 'OggS') return { mimeType: 'video/ogg', extension: 'ogv' }
    if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && [0xba, 0xb3].includes(bytes[3]))
      return { mimeType: 'video/mpeg', extension: 'mpeg' }
  }
  return null
}

function headerSnapshot(headers) {
  const value = typeof headers === 'function' ? headers() : headers
  return Object.freeze(Object.fromEntries(new Headers(value || {}).entries()))
}

function fileName(item, index, format, used) {
  const entry = canvasSelectionExportEntry(
    { type: item.kind, name: item.title, url: item.url },
    index,
    undefined,
    format.mimeType,
  )
  let base = [...entry.baseName].slice(0, 100).join('')
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`
  let name = `${base}.${format.extension}`
  let suffix = 2
  while (used.has(name.toLocaleLowerCase())) name = `${base} (${suffix++}).${format.extension}`
  used.add(name.toLocaleLowerCase())
  return name
}

export function saveCanvasSelectionArchive(blob, filename) {
  if (!globalThis.document?.createElement || !globalThis.URL?.createObjectURL)
    throw new Error('当前浏览器无法发起 ZIP 下载')
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** Read-only export: no model/task endpoint or cloud write is ever used here. */
export function createCanvasSelectionDownloadClient({
  fetcher = globalThis.fetch?.bind(globalThis),
  path = (value) => value,
  headers = {},
  save = saveCanvasSelectionArchive,
  maxImageBytes,
  maxVideoBytes,
  maxTotalBytes,
  timeoutMs,
} = {}) {
  const limits = CANVAS_SELECTION_DOWNLOAD_LIMITS
  const imageLimit = boundedLimit(
    maxImageBytes,
    limits.imageBytes,
    limits.imageBytes,
    '图片大小限制',
  )
  const videoLimit = boundedLimit(
    maxVideoBytes,
    limits.videoBytes,
    limits.videoBytes,
    '视频大小限制',
  )
  const totalLimit = boundedLimit(maxTotalBytes, limits.totalBytes, limits.totalBytes, '总大小限制')
  const timeout = boundedLimit(timeoutMs, limits.timeoutMs, 120000, '读取超时')

  async function readMedia(item, budget, auth, signal) {
    const maximum = Math.min(item.kind === 'image' ? imageLimit : videoLimit, budget)
    if (maximum < 1) throw new Error('已达到本次下载总大小限制')
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(abortReason(signal))
    signal?.addEventListener('abort', forwardAbort, { once: true })
    const timer = setTimeout(() => controller.abort(new Error('素材读取超时，请重试')), timeout)
    let reader
    let response
    try {
      checkAbort(signal)
      let bytes
      if (item.sourceType === 'inline') {
        const raw = item.url.slice(item.url.indexOf(',') + 1)
        if (Math.floor((raw.length * 3) / 4) - 2 > maximum)
          throw new Error('素材超过单项或剩余总大小限制')
        const binary = globalThis.atob(raw)
        if (binary.length > maximum) throw new Error('素材超过单项或剩余总大小限制')
        bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      } else {
        if (typeof fetcher !== 'function') throw new Error('当前浏览器无法读取素材')
        // The existing controller streams original media bytes, including video.
        // Authentication goes only to our fixed proxy, never to the source host.
        response = await abortable(
          fetcher(path(`/api/image-tasks/proxy-download?url=${encodeURIComponent(item.url)}`), {
            method: 'GET',
            headers: auth,
            credentials: 'same-origin',
            redirect: 'error',
            signal: controller.signal,
          }),
          controller.signal,
          discardBody,
        )
        if (!response?.ok || response.status === 206)
          throw new Error(`素材读取失败或不完整（${response?.status || '网络异常'}）`)
        const type = (response.headers?.get?.('content-type') || '')
          .split(';')[0]
          .toLowerCase()
          .trim()
        if (type && type !== 'application/octet-stream' && !type.startsWith(`${item.kind}/`))
          throw new Error('服务返回了非预期媒体内容')
        if (type === 'image/svg+xml') throw new Error('不支持 SVG 图片')
        const declared = Number(response.headers?.get?.('content-length')) || 0
        if (declared > maximum) throw new Error('素材超过单项或剩余总大小限制')
        if (response.body?.getReader) {
          reader = response.body.getReader()
          const chunks = []
          let size = 0
          while (true) {
            const { done, value } = await abortable(reader.read(), controller.signal)
            if (done) break
            size += value.byteLength
            if (size > maximum) throw new Error('素材超过单项或剩余总大小限制')
            chunks.push(value)
          }
          bytes = new Uint8Array(size)
          let offset = 0
          for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.byteLength
          }
        } else {
          const blob = await abortable(response.blob(), controller.signal)
          if (blob.size > maximum) throw new Error('素材超过单项或剩余总大小限制')
          bytes = new Uint8Array(await abortable(blob.arrayBuffer(), controller.signal))
        }
        if (declared && declared !== bytes.byteLength) throw new Error('素材下载不完整，请重试')
      }
      checkAbort(controller.signal)
      if (!bytes.length) throw new Error('素材内容为空')
      const format = mediaFormat(bytes.subarray(0, 64), item.kind)
      if (!format) throw new Error('素材真实内容不是受支持的图片或视频')
      return { data: bytes, ...format }
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', forwardAbort)
      if (reader) {
        try {
          void reader.cancel().catch(() => {})
          reader.releaseLock?.()
        } catch {
          // Cancellation must settle even if a host-specific reader cleanup fails.
        }
      } else discardBody(response)
    }
  }

  async function prepare(nodes, { signal, onProgress = () => {}, filename } = {}) {
    checkAbort(signal)
    // Only immutable export metadata is copied before the first async read.
    // Active jobs may retain an older valid artifact URL; never copy job keys.
    const snapshot = snapshotSelection(nodes)
    const auth = snapshot.some((item) => item.sourceType === 'remote')
      ? headerSnapshot(headers)
      : {}
    const files = []
    const failures = []
    const entries = []
    const usedNames = new Set([failureListName.toLocaleLowerCase()])
    let byteLength = 0
    for (const [index, item] of snapshot.entries()) {
      checkAbort(signal)
      onProgress({
        phase: 'reading',
        index,
        completed: index,
        total: snapshot.length,
        nodeId: item.nodeId,
      })
      try {
        if (item.error) throw new Error(item.error)
        const media = await readMedia(item, totalLimit - byteLength, auth, signal)
        checkAbort(signal)
        const name = fileName(item, index, media, usedNames)
        byteLength += media.data.byteLength
        entries.push({ name, data: media.data })
        files.push(
          Object.freeze({
            nodeId: item.nodeId,
            title: item.title,
            name,
            size: media.data.byteLength,
            mimeType: media.mimeType,
          }),
        )
      } catch (error) {
        checkAbort(signal)
        const reason = String(error.message || '素材读取失败')
          .replace(/https?:\/\/\S+/gi, '[素材地址]')
          .replace(/[\r\n]/g, ' ')
          .slice(0, 200)
        failures.push(Object.freeze({ nodeId: item.nodeId, title: item.title, reason }))
      }
      onProgress({
        phase: 'progress',
        completed: index + 1,
        total: snapshot.length,
        successCount: files.length,
        failedCount: failures.length,
      })
    }
    checkAbort(signal)
    if (failures.length && entries.length) {
      const report = [
        `部分下载：成功 ${files.length}/${snapshot.length} 项，失败 ${failures.length} 项。`,
        '本 ZIP 仅包含成功读取的真实媒体，下列素材未成功下载；未包含源地址或任务凭证。',
        '',
        ...failures.map(
          (item, index) => `${index + 1}. ${item.title.replace(/[\r\n]/g, ' ')}：${item.reason}`,
        ),
      ].join('\r\n')
      entries.push({ name: failureListName, data: encoder.encode(report) })
    }
    const archiveName = String(
      filename || `画布素材-${files.length}项${failures.length ? '-部分成功' : ''}`,
    ).replace(/\.zip$/i, '')
    const safeName = fileName(
      { kind: 'image', title: archiveName, url: '' },
      0,
      { extension: 'zip', mimeType: 'application/zip' },
      new Set(),
    )
    return {
      blob: entries.length ? createStoredZip(entries) : null,
      filename: safeName,
      files: Object.freeze(files),
      failures: Object.freeze(failures),
      totalCount: snapshot.length,
      successCount: files.length,
      failedCount: failures.length,
      complete: failures.length === 0,
      downloaded: false,
      byteLength,
    }
  }

  async function download(nodes, options = {}) {
    const result = await prepare(nodes, options)
    checkAbort(options.signal)
    if (!result.blob || save === false) return result
    if (typeof save !== 'function') throw new Error('ZIP 保存配置无效')
    await save(result.blob, result.filename, result)
    return { ...result, downloaded: true }
  }

  return Object.freeze({ prepare, download })
}
