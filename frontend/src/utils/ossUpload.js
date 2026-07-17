import { apiPath } from './apiBase'
import { useUserStore } from '../stores/user'

export const MAX_IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024
export const IMAGE_UPLOAD_SIZE_MESSAGE = '图片不能超过 20MB，请压缩后重新上传。'

export function validateImageUploadSize(file) {
  if (file?.type?.startsWith('image/') && Number(file.size || 0) > MAX_IMAGE_UPLOAD_BYTES) {
    const error = new Error(IMAGE_UPLOAD_SIZE_MESSAGE)
    error.code = 'IMAGE_TOO_LARGE'
    throw error
  }
}

function authHeaders() {
  return useUserStore().authHeaders()
}

function readUploadSign(payload) {
  const data = payload?.data || payload || {}
  if (!data.uploadUrl || !data.url) {
    throw new Error(payload?.message || 'OSS direct upload signature is incomplete')
  }
  return data
}

function putToOss(uploadUrl, file, headers = {}, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value != null && String(value).trim()) xhr.setRequestHeader(key, String(value))
    })
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress({
          loaded: event.loaded,
          total: event.total,
          percent: Math.round((event.loaded / event.total) * 100),
        })
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
        return
      }
      reject(new Error(`OSS direct upload failed: ${xhr.status}`))
    }
    xhr.onerror = () => reject(new Error('OSS direct upload network error'))
    xhr.send(file)
  })
}

export async function uploadFileDirect(file, options = {}) {
  if (!file) throw new Error('No file selected')
  validateImageUploadSize(file)
  const signResponse = await fetch(apiPath('/api/file/oss-sign'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(options.headers || {}) },
    body: JSON.stringify({
      fileName: file.name || 'upload.png',
      contentType: file.type || 'application/octet-stream',
      size: file.size || 0,
      dir: options.dir || 'youmi/uploads',
      expireSeconds: options.expireSeconds || 900,
    }),
  })
  const signPayload = await signResponse.json().catch(() => ({}))
  if (!signResponse.ok || signPayload.code) {
    throw new Error(
      signPayload.message || `Create OSS upload signature failed: ${signResponse.status}`,
    )
  }
  const sign = readUploadSign(signPayload)
  await putToOss(sign.uploadUrl, file, sign.headers, options.onProgress)
  if (options.onProgress) {
    options.onProgress({ loaded: file.size || 0, total: file.size || 0, percent: 100 })
  }
  return sign.url
}

/**
 * 将远端 URL 的图片转存到自有 OSS，返回永久 URL。
 * 用于生图完成后，将临时签名 URL / CDN 链接转存为永久 OSS URL，
 * 防止签名过期后图片裂图。
 * @param {string} url 远端图片 URL
 * @param {object} [options]
 * @param {string} [options.dir] OSS 目录，默认 'youmi/ai'
 * @param {number} [options.timeout] 超时毫秒，默认 30000
 * @returns {Promise<string>} 永久 OSS URL；转存失败则返回原始 URL（降级不中断）
 */
export async function persistToOss(url, options = {}) {
  if (!url || !url.startsWith('http')) return url
  // 已经是自有 OSS 永久 URL（无签名参数），无需转存
  try {
    const u = new URL(url)
    const isOwnOss = u.hostname.includes('huami-canvas') && u.search === ''
    if (isOwnOss) return url
  } catch {
    /* ignore */
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeout || 30000)
    const resp = await fetch(apiPath('/api/v1/file/upload-from-url'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ url, dir: options.dir || 'youmi/ai' }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const data = await resp.json().catch(() => ({}))
    if (data.code === 0 && data.data?.url) {
      console.log(
        '[persistToOss] 转存成功:',
        url.substring(0, 60) + '... →',
        data.data.url.substring(0, 60) + '...',
      )
      return data.data.url
    }
    console.warn('[persistToOss] 转存返回非成功:', data.message || 'unknown')
    return url // 降级：返回原始 URL
  } catch (e) {
    console.warn('[persistToOss] 转存失败，使用原始 URL:', e.message)
    return url // 降级：返回原始 URL
  }
}
