import { createNodeClipboard, parseNodeClipboard, serializeNodeClipboard } from './nodeClipboard.js'

export const GROUP_TOOLBOX_LIMIT = 20
export const GROUP_TOOLBOX_MAX_BYTES = 4 * 1024 * 1024
const text = (value, max) =>
  typeof value === 'string' &&
  ![...value].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127)
    ? value.trim().slice(0, max)
    : ''

export function groupToolboxKey(userId) {
  const account = text(String(userId ?? ''), 100)
  return account ? `youmi:canvas-v3:group-toolbox:${encodeURIComponent(account)}` : ''
}
function safeRecord(value) {
  if (!value || typeof value !== 'object') return null
  const id = text(value.id, 100)
  const name = text(value.name, 100)
  const snapshot = parseNodeClipboard(typeof value.snapshot === 'string' ? value.snapshot : '')
  if (!id || !name || !snapshot || snapshot.nodes.length < 2) return null
  return {
    id,
    name,
    createdAt: Number.isFinite(value.createdAt) ? value.createdAt : 0,
    nodeCount: snapshot.nodes.length,
    snapshot: serializeNodeClipboard(snapshot),
  }
}

/** Account-owned local browser templates, not cloud assets or shared/public workflows. */
export function loadGroupToolbox(storage, userId) {
  const key = groupToolboxKey(userId)
  if (!key) return []
  let raw
  try {
    raw = storage?.getItem(key)
    if (!raw || raw.length > GROUP_TOOLBOX_MAX_BYTES) return []
    raw = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const seen = new Set()
  return raw.slice(0, GROUP_TOOLBOX_LIMIT).flatMap((item) => {
    const record = safeRecord(item)
    if (!record || seen.has(record.id)) return []
    seen.add(record.id)
    return [record]
  })
}
function write(storage, userId, records) {
  const key = groupToolboxKey(userId)
  if (!key || !storage?.setItem) throw new Error('请先登录后使用本机工具箱')
  const serialized = JSON.stringify(records)
  if (serialized.length > GROUP_TOOLBOX_MAX_BYTES)
    throw new Error('工具箱超过本机存储上限，请减少大图或移除旧模板')
  try {
    storage.setItem(key, serialized)
  } catch {
    throw new Error('本机工具箱保存失败，请检查浏览器存储空间或权限')
  }
}

export function saveGroupToolbox(
  storage,
  userId,
  { nodes, edges = [], name, groupId },
  { now = Date.now, id = () => crypto.randomUUID() } = {},
) {
  if (!groupToolboxKey(userId)) throw new Error('请先登录后使用本机工具箱')
  const members = nodes.filter((node) => node?.data?.groupId === groupId)
  if (!groupId || members.length < 2) throw new Error('请选择完整分组后添加到工具箱')
  const snapshot = serializeNodeClipboard(createNodeClipboard(members, edges))
  const records = loadGroupToolbox(storage, userId)
  if (records.length >= GROUP_TOOLBOX_LIMIT) throw new Error('本机工具箱最多保存20个模板')
  const record = safeRecord({
    id: id(),
    name: text(name || members[0].data.groupName, 100) || '未命名分组',
    createdAt: now(),
    snapshot,
  })
  if (!record || records.some((item) => item.id === record.id))
    throw new Error('工具箱模板标识无效或重复')
  write(storage, userId, [record, ...records])
  return record
}

export function removeGroupToolbox(storage, userId, id) {
  const records = loadGroupToolbox(storage, userId)
  const remaining = records.filter((item) => item.id !== id)
  if (remaining.length === records.length) return false
  write(storage, userId, remaining)
  return true
}

export function groupToolboxSnapshot(record) {
  const safe = safeRecord(record)
  if (!safe) throw new Error('工具箱模板无效，请移除后重新添加')
  return parseNodeClipboard(safe.snapshot)
}
