export const CHARACTER_LIBRARY_FILTERS = Object.freeze([
  Object.freeze({
    key: 'gender',
    label: '性别',
    options: Object.freeze(['男', '女', '中性']),
  }),
  Object.freeze({
    key: 'ageGroup',
    label: '年龄段',
    options: Object.freeze(['儿童', '少年', '青年', '中年', '老年']),
  }),
  Object.freeze({
    key: 'culture',
    label: '文化区域',
    options: Object.freeze(['东亚', '欧美', '中东', '非洲', '其他']),
  }),
])

const text = (value) => (typeof value === 'string' ? value.trim() : '')

export function characterLibraryItems(items = []) {
  const seen = new Set()
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    if (!item || typeof item !== 'object' || !text(String(item.id ?? ''))) return []
    const id = String(item.id)
    if (seen.has(id)) return []
    seen.add(id)
    return [
      {
        ...item,
        id,
        name: text(item.name) || '未命名模特',
        description: text(item.description),
        imageUrl: text(item.imageUrl) || text(item.coverUrl),
      },
    ]
  })
}

export function filterCharacterLibrary(items = [], filters = {}, query = '') {
  const needle = text(query).toLocaleLowerCase()
  return characterLibraryItems(items).filter((item) => {
    if (
      needle &&
      ![item.name, item.description].some((field) => field.toLocaleLowerCase().includes(needle))
    ) {
      return false
    }
    return CHARACTER_LIBRARY_FILTERS.every(({ key }) => {
      const wanted = Array.isArray(filters[key]) ? filters[key] : []
      if (!wanted.length) return true
      const values = Array.isArray(item[key]) ? item[key] : [item[key]]
      return values.some(
        (value) =>
          wanted.includes(value) ||
          (key === 'culture' && value === '奇幻' && wanted.includes('其他')),
      )
    })
  })
}

export function characterLibrarySelection(items = [], selectedIds = []) {
  const wanted = new Set(Array.isArray(selectedIds) ? selectedIds.map(String) : [])
  return characterLibraryItems(items).filter((item) => wanted.has(item.id))
}
