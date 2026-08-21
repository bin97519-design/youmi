import { apiPath } from './apiBase'

const API_PREFIX = '/api/v1/selection-pool'

function queryString(params = {}) {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) search.set(key, String(value))
  })
  const value = search.toString()
  return value ? `?${value}` : ''
}

async function request(path, userStore, options = {}) {
  let response
  try {
    response = await fetch(apiPath(`${API_PREFIX}${path}`), {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...userStore.authHeaders(),
        ...(options.headers || {}),
      },
    })
  } catch {
    throw new Error('暂时无法连接选品库服务，请检查后端服务是否已启动')
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok || payload.code) {
    if (
      response.status === 404 ||
      /No static resource|selection-pool/i.test(String(payload.message || ''))
    ) {
      throw new Error('当前后端尚未启用选品库接口')
    }
    throw new Error(payload.message || `选品库请求失败（${response.status}）`)
  }
  return payload.data
}

export function fetchSelectionProducts(userStore, filters) {
  return request(`/products${queryString(filters)}`, userStore)
}

export function fetchSelectionProduct(userStore, id) {
  return request(`/products/${encodeURIComponent(id)}`, userStore)
}

export function fetchSelectionTags(userStore) {
  return request('/tags', userStore)
}

export function fetchMigrationTasks(userStore) {
  return request('/migration-tasks', userStore)
}

export function createSelectionProduct(userStore, body) {
  return request('/products', userStore, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function updateSelectionProduct(userStore, id, body) {
  return request(`/products/${encodeURIComponent(id)}`, userStore, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export function assignSelectionTags(userStore, productRowIds, tagIds) {
  return request('/products/tags', userStore, {
    method: 'PUT',
    body: JSON.stringify({ productRowIds, tagIds }),
  })
}

export function deleteSelectionProducts(userStore, productRowIds) {
  return request('/products/delete', userStore, {
    method: 'POST',
    body: JSON.stringify({ productRowIds }),
  })
}
