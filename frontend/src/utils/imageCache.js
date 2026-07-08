/**
 * 图片缓存工具 —— 防签名 URL 过期导致对话窗口图片裂图。
 *
 * 原理：用浏览器 Cache API 缓存图片的 Response（按 URL 索引）。
 * - getCachedImageUrl(url)：返回可用的 URL（缓存命中则返回 blob URL，未命中则返回原始 URL 并后台缓存）
 * - refreshUrl(url)：当原始 URL 加载失败时，调后端重新签名
 *
 * 生命周期：Cache API 数据跟随浏览器存储，关闭标签页后仍可用（直到存储压力回收）。
 * 缓存 key 用 URL 的 path 部分（去掉签名参数），这样同张图片的不同签名 URL 共享一条缓存。
 */

const CACHE_NAME = 'youmi-image-cache-v1'
const MAX_CACHE_ENTRIES = 500

/** 从 URL 中提取缓存 key（去掉签名参数，只用 path） */
function cacheKey(url) {
  try {
    const u = new URL(url)
    // 保留 origin + pathname 作为 key（去掉 ?OSSAccessKeyId=...&Expires=...&Signature=...）
    return u.origin + u.pathname
  } catch {
    return url // 非 URL 格式（如 data: 或 blob:），原样返回
  }
}

/** 判断 URL 是否可能是签名 URL（需要缓存） */
function isSignableUrl(url) {
  if (!url || !url.startsWith('http')) return false
  try {
    const u = new URL(url)
    // OSS 签名 URL 通常含 Expires/Signature/OSSAccessKeyId 参数
    const params = u.searchParams
    return params.has('Expires') || params.has('Signature') || params.has('OSSAccessKeyId')
      || params.has('X-Amz-Expires') || params.has('X-Amz-Signature')
      // Agnes 临时链接
      || u.hostname.includes('agnes-ai.space')
      // apimart 等中转站临时链接
      || u.hostname.includes('apimart') || u.hostname.includes('aiuxu')
  } catch {
    return false
  }
}

/** 判断 URL 是否是自有 OSS 的永久 URL（无需缓存） */
function isPermanentUrl(url) {
  if (!url || !url.startsWith('http')) return false
  try {
    const u = new URL(url)
    // 自有 OSS 域名且无签名参数 → 永久 URL
    if (u.hostname.includes('huami-canvas') && u.search === '') return true
    // data: blob: 开头 → 本地数据，无需缓存
    if (url.startsWith('data:') || url.startsWith('blob:')) return true
    return false
  } catch {
    return false
  }
}

/**
 * 获取缓存的图片 URL。
 * - 如果是永久 URL / 非签名 URL → 直接返回
 * - 如果缓存命中 → 返回原始 URL（Cache API 会让浏览器的 fetch 命中缓存）
 * - 如果缓存未命中 → 后台尝试缓存，返回原始 URL
 */
export async function getCachedImageUrl(url) {
  if (!url || isPermanentUrl(url) || !isSignableUrl(url)) return url

  try {
    const cache = await caches.open(CACHE_NAME)
    const key = cacheKey(url)
    const cached = await cache.match(key)
    if (cached) {
      // 缓存命中，返回原始 URL（浏览器发请求时会命中 Cache API）
      return url
    }
    // 缓存未命中，后台缓存（不阻塞渲染）
    cacheImageInBackground(url)
    return url
  } catch {
    return url
  }
}

/** 后台缓存图片 */
function cacheImageInBackground(url) {
  // 用 setTimeout 避免阻塞渲染
  setTimeout(async () => {
    try {
      const cache = await caches.open(CACHE_NAME)
      const key = cacheKey(url)
      // 用 no-cors 模式 fetch（OSS 可能不允许 CORS）
      const response = await fetch(url, { mode: 'no-cors' })
      if (response.ok || response.type === 'opaque') {
        await cache.put(key, response)
        // 清理过多条目
        trimCache(cache)
      }
    } catch {
      // 缓存失败不影响功能
    }
  }, 100)
}

/** 清理缓存，保持条目数不超过上限 */
async function trimCache(cache) {
  try {
    const keys = await cache.keys()
    if (keys.length <= MAX_CACHE_ENTRIES) return
    // 删除最旧的条目
    const toDelete = keys.slice(0, keys.length - MAX_CACHE_ENTRIES)
    await Promise.all(toDelete.map((key) => cache.delete(key)))
  } catch {
    // ignore
  }
}

/**
 * 当图片加载失败时（onerror），尝试刷新 URL。
 * 返回新的签名 URL，或 null（无法刷新）。
 */
export async function refreshExpiredUrl(url) {
  if (!url || !url.startsWith('http')) return null
  try {
    const resp = await fetch('/api/v1/file/refresh-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    const data = await resp.json()
    if (data.code === 0 && data.data?.url) {
      // 刷新成功，更新缓存
      try {
        const cache = await caches.open(CACHE_NAME)
        const key = cacheKey(url)
        const newResp = await fetch(data.data.url, { mode: 'no-cors' })
        if (newResp.ok || newResp.type === 'opaque') {
          await cache.put(key, newResp)
        }
      } catch {
        // 缓存更新失败不影响
      }
      return data.data.url
    }
    return null
  } catch {
    return null
  }
}

/**
 * 创建一个带自动刷新的 img 标签 HTML。
 * 当图片加载失败时，尝试调后端重新签名。
 */
export function cachedImgHtml(url, attrs = '') {
  if (!url) return ''
  const escapedUrl = url.replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return `<img src="${escapedUrl}"${attrs ? ' ' + attrs : ''} onerror="this._refreshAttempted || (this._refreshAttempted=true, fetch('/api/v1/file/refresh-url',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:'${escapedUrl}'})}).then(r=>r.json()).then(d=>{if(d.code===0&&d.data?.url)this.src=d.data.url;else this.style.display='none'}).catch(()=>this.style.display='none'))" />`
}
