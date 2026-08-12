export const PROMPT_LIBRARY_VIEWS = [
  { value: 'mine', label: '我的提示词' },
  { value: 'public', label: '公共模板' },
  { value: 'recent', label: '最近使用' },
]

export const PROMPT_LIBRARY_CATEGORIES = [
  { value: 'ALL', label: '全部' },
  { value: 'GENERAL', label: '通用' },
  { value: 'MAIN_IMAGE', label: '主图' },
  { value: 'DETAIL', label: '详情页' },
  { value: 'SCENE', label: '场景图' },
  { value: 'SELLING_POINT', label: '卖点图' },
  { value: 'EDIT', label: '改图' },
  { value: 'OTHER', label: '其他' },
]

export function derivePromptLibraryTitle(content, fallback = '我的提示词') {
  const firstLine = String(content || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!firstLine) return fallback
  return firstLine.length > 24 ? `${firstLine.slice(0, 24)}…` : firstLine
}

export function normalizePromptLibraryTags(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(/[，,\s#]+/)
  return [...new Set(values.map((tag) => String(tag || '').trim()).filter(Boolean))].slice(0, 12)
}

export function mergePromptIntoComposer(currentValue, prompt, mode = 'replace') {
  const current = String(currentValue || '').trim()
  const incoming = String(prompt || '').trim()
  if (!incoming) return current
  if (mode === 'append' && current) return `${current}\n\n${incoming}`
  return incoming
}

export function filterPromptLibraryItems(items, { view = 'mine', query = '', category = 'ALL' } = {}) {
  const keyword = String(query || '').trim().toLocaleLowerCase('zh-CN')
  return (Array.isArray(items) ? items : [])
    .filter((item) => {
      if (view === 'mine' && item?.scope !== 'PERSONAL') return false
      if (view === 'public' && item?.scope !== 'PUBLIC') return false
      if (view === 'recent' && !item?.lastUsedAt) return false
      if (category !== 'ALL' && item?.category !== category) return false
      if (!keyword) return true
      const haystack = [item?.title, item?.content, ...(item?.tags || [])]
        .join(' ')
        .toLocaleLowerCase('zh-CN')
      return haystack.includes(keyword)
    })
    .sort((left, right) => {
      if (view === 'recent') return Number(right?.lastUsedAt || 0) - Number(left?.lastUsedAt || 0)
      return Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
    })
}
