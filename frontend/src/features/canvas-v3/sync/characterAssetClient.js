import { characterStudioPayload } from '../config/characterStudioRuntime.js'

function validAsset(value) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id.trim()) &&
    typeof value.name === 'string' &&
    (!('config' in value) ||
      (value.config && typeof value.config === 'object' && !Array.isArray(value.config)))
  )
}

function headerValues(value) {
  const result = typeof value === 'function' ? value() : value
  return result instanceof Headers ? Object.fromEntries(result.entries()) : result || {}
}

export function createCharacterAssetClient({
  path = (value) => value,
  headers = () => ({}),
  fetcher = fetch,
} = {}) {
  async function request(suffix = '', options = {}) {
    const response = await fetcher(path(`/api/canvas/characters${suffix}`), {
      ...options,
      headers: { 'Content-Type': 'application/json', ...headerValues(headers) },
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok || !payload || payload.code !== 0) {
      const error = new Error(
        typeof payload?.message === 'string' && payload.message
          ? payload.message.replaceAll('角色', '模特')
          : `模特库请求失败（${response.status || '网络异常'}）`,
      )
      error.status = response.status
      error.code = payload?.code
      throw error
    }
    if (!Object.hasOwn(payload, 'data') || payload.data == null) {
      throw new Error('模特库响应缺少数据，请重试')
    }
    return payload.data
  }

  return Object.freeze({
    async list({ signal } = {}) {
      const data = await request('', { method: 'GET', signal })
      if (!Array.isArray(data) || !data.every(validAsset)) throw new Error('模特库列表格式无效')
      return data
    },
    async save(character, { signal } = {}) {
      const data = await request('', {
        method: 'POST',
        body: JSON.stringify(characterStudioPayload(character)),
        signal,
      })
      if (!validAsset(data)) throw new Error('模特保存结果格式无效')
      return data
    },
    async remove(id, { signal } = {}) {
      const value = typeof id === 'string' ? id.trim() : ''
      if (!value) throw new Error('请选择要删除的模特')
      const data = await request(`/${encodeURIComponent(value)}`, { method: 'DELETE', signal })
      if (typeof data !== 'object' || data.id !== value) throw new Error('模特删除结果格式无效')
      return data
    },
  })
}
