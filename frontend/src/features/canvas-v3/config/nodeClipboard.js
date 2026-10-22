import { CANVAS_V3_SCHEMA_VERSION } from './nodeSpecs.js'
import {
  isGroupColor,
  normalizedGroupColor,
  isGroupPadding,
  normalizedGroupPadding,
} from './groupAppearance.js'

export const NODE_CLIPBOARD_FORMAT = 'youmi-canvas-v3'
export const NODE_CLIPBOARD_VERSION = 1
export const NODE_CLIPBOARD_LIMITS = Object.freeze({
  nodes: 100,
  edges: 500,
  sourceEdges: 10000,
  text: 8 * 1024 * 1024,
  depth: 12,
  entries: 10000,
})

const KINDS = new Set(['image', 'video', 'audio', 'text', 'script', 'smartEdit', 'reference'])
const ACTIVE_STATES = new Set([
  'preparing',
  'submitting',
  'queued',
  'running',
  'paused',
  'uncertain',
])
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const PRIVATE_KEYS = new Set([
  'generation',
  'taskid',
  'taskids',
  'clienttaskid',
  'clientrequestid',
  'idempotencykey',
  'runid',
  'directorrunid',
  'directorconversationid',
  'directordraftsignature',
  'conversationid',
  'editdraft',
  'runstate',
  'artifactstatus',
  'error',
  'statustext',
  'progress',
  'consumedmi',
  'apikey',
  'authorization',
  'accesstoken',
  'refreshtoken',
  'token',
  'password',
  'secret',
  'credentials',
  'headers',
])
const TEXT_FIELDS = ['title', 'prompt', 'model', 'mode', 'summary', 'mediaOrigin']
const OBJECT_FIELDS = [
  'params',
  'switches',
  'stylePreset',
  'editTemplate',
  'localEdit',
  'pixelSize',
]
const URL_KEY = /(?:url|uri|src|image|images|cover|thumbnail|preview)$/i

function fail(message = '节点剪贴板数据无效') {
  throw new Error(message)
}

function record(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function descriptors(value) {
  if (!record(value)) fail()
  const result = Object.getOwnPropertyDescriptors(value)
  if (Object.keys(result).length > NODE_CLIPBOARD_LIMITS.entries) fail('节点剪贴板内容过大')
  if (Object.getOwnPropertySymbols(value).length) fail()
  for (const [key, descriptor] of Object.entries(result)) {
    if (DANGEROUS_KEYS.has(key) || key.length > 128 || descriptor.get || descriptor.set) fail()
  }
  return result
}

function arrayValues(value, limit) {
  if (!Array.isArray(value) || value.length > limit) fail('节点剪贴板数组无效或过大')
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length) fail()
  for (const [key, descriptor] of Object.entries(fields))
    if ((key !== 'length' && !/^\d+$/.test(key)) || descriptor.get || descriptor.set) fail()
  return Array.from({ length: value.length }, (_unused, index) => fields[index]?.value)
}

function hasControlCharacters(value, includeSpace = false) {
  const maximum = includeSpace ? 32 : 31
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code <= maximum || code === 127) return true
  }
  return false
}

function identifier(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 200 ||
    /\s/.test(value) ||
    hasControlCharacters(value) ||
    DANGEROUS_KEYS.has(value)
  )
    fail('节点标识无效')
  return value
}

function resourceUrl(value, kind = '') {
  if (
    typeof value !== 'string' ||
    value.length > NODE_CLIPBOARD_LIMITS.text ||
    value.includes('\\') ||
    hasControlCharacters(value, true)
  )
    fail('图片或素材地址不安全')
  if (!value) return value
  if (value.startsWith('data:')) {
    const match = value.match(
      /^data:((?:image\/(?:png|jpe?g|webp|gif|avif|bmp|x-icon))|(?:video\/(?:mp4|webm|ogg))|(?:audio\/(?:mpeg|mp3|wav|x-wav|ogg|webm)));base64,([A-Za-z0-9+/]+={0,2})$/i,
    )
    if (!match || match[2].length % 4 !== 0) fail('图片或素材地址不安全')
    if (
      ['image', 'video', 'audio'].includes(kind) &&
      !match[1].toLowerCase().startsWith(kind + '/')
    )
      fail('素材类型与节点不一致')
    return value
  }
  // Bundled styles may use Vite's static asset paths. Never accept arbitrary app/API routes.
  if (
    /^\/(?:assets|src|official|images)\//.test(value) &&
    !value.includes('..') &&
    !/%(?:2e|2f|5c)/i.test(value)
  )
    return value
  let url
  try {
    url = new URL(value)
  } catch {
    fail('图片或素材地址不安全')
  }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password)
    fail('图片或素材地址不安全')
  return value
}

function cloneValue(value, state, depth = 0, key = '') {
  if (depth > NODE_CLIPBOARD_LIMITS.depth || ++state.entries > NODE_CLIPBOARD_LIMITS.entries)
    fail('节点剪贴板内容过大或层级过深')
  if (value === undefined) return undefined
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail()
    return value
  }
  if (typeof value === 'string') {
    if (value.length > NODE_CLIPBOARD_LIMITS.text) fail('节点剪贴板内容过大')
    return URL_KEY.test(key) ? resourceUrl(value) : value
  }
  if (typeof value !== 'object' || state.seen.has(value)) fail()
  state.seen.add(value)
  try {
    if (Array.isArray(value)) {
      return arrayValues(value, 1000).map(
        (entry) => cloneValue(entry, state, depth + 1, key) ?? null,
      )
    }
    const result = {}
    for (const [name, descriptor] of Object.entries(descriptors(value))) {
      if (!descriptor.enumerable || PRIVATE_KEYS.has(name.replace(/[-_]/g, '').toLowerCase()))
        continue
      const next = cloneValue(descriptor.value, state, depth + 1, name)
      if (next !== undefined) result[name] = next
    }
    return result
  } finally {
    state.seen.delete(value)
  }
}

/** True for the same image/video task states guarded by graph deletion and duplication. */
export function isNodeClipboardCopyBlocked(node) {
  const data = descriptors(node?.data)
  if (!['image', 'video'].includes(data.kind?.value)) return false
  if (ACTIVE_STATES.has(data.runState?.value)) return true
  const generation = data.generation?.value
  if (generation == null) return false
  const fields = descriptors(generation)
  const unresolved = fields.unresolvedTaskIds?.value
  if (unresolved != null && !Array.isArray(unresolved)) fail('任务状态无效，不能复制节点')
  return Boolean(fields.persistPending?.value || fields.queryPending?.value || unresolved?.length)
}

/** Copies visible draft/media fields, never task ownership, authorization or execution metadata. */
export function sanitizeCopiedNodeData(data) {
  const fields = descriptors(data)
  if (!KINDS.has(fields.kind?.value)) fail('节点类型无效')
  if (isNodeClipboardCopyBlocked({ data })) fail('任务尚未结束或仍待确认，不能复制节点')
  const result = { schemaVersion: CANVAS_V3_SCHEMA_VERSION, kind: data.kind }
  const state = { seen: new WeakSet(), entries: 0 }
  for (const key of TEXT_FIELDS) {
    const value = fields[key]?.value
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length > 100000) fail('节点文本无效或过长')
    result[key] = value
  }
  for (const key of OBJECT_FIELDS) {
    const value = fields[key]?.value
    if (value == null) continue
    if (!record(value)) fail('节点参数无效')
    result[key] = cloneValue(value, state)
  }
  for (const key of ['mediaWidth', 'mediaHeight', 'mediaDuration', 'rotation']) {
    const value = fields[key]?.value
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9)
      fail('素材尺寸无效')
    if (key !== 'rotation' && value < 0) fail('素材尺寸无效')
    result[key] = value
  }
  if (fields.rating) {
    const rating = fields.rating.value
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) fail('节点评级无效')
    result.rating = rating
  }
  if (fields.locked) {
    if (typeof fields.locked.value !== 'boolean') fail()
    result.locked = fields.locked.value
  }
  if (fields.sourceImageNodeId?.value != null)
    result.sourceImageNodeId = identifier(fields.sourceImageNodeId.value)
  if (fields.groupId?.value != null) {
    result.groupId = identifier(fields.groupId.value)
    const name = fields.groupName?.value
    if (name != null && (typeof name !== 'string' || name.length > 100)) fail('分组名称无效')
    result.groupName = name || '分组'
    const type = fields.groupType?.value || 'normal'
    if (!['normal', 'storyboard'].includes(type)) fail('分组类型无效')
    result.groupType = type
    const color = fields.groupColor?.value
    if (color != null) {
      if (!isGroupColor(color)) fail('分组颜色无效')
      result.groupColor = normalizedGroupColor(color)
    }
    const padding = fields.groupPadding?.value
    if (padding != null) {
      if (!isGroupPadding(padding)) fail('分组边距无效')
      result.groupPadding = normalizedGroupPadding(padding)
    }
  }
  if (fields.assetUrl?.value != null)
    result.assetUrl = resourceUrl(fields.assetUrl.value, result.kind)
  result.runState = 'idle'
  result.artifactStatus = result.assetUrl ? 'ready' : 'empty'
  return result
}

function normalize(nodes, edges, strictEdges = false) {
  if (!Array.isArray(nodes) || !nodes.length) fail('请先选择要复制的节点')
  if (nodes.length > NODE_CLIPBOARD_LIMITS.nodes) fail('单次最多复制100个节点')
  if (
    !Array.isArray(edges) ||
    edges.length > (strictEdges ? NODE_CLIPBOARD_LIMITS.edges : NODE_CLIPBOARD_LIMITS.sourceEdges)
  )
    fail('节点连线数量无效或过多')
  const ids = new Set()
  const copiedNodes = arrayValues(nodes, NODE_CLIPBOARD_LIMITS.nodes).map((node) => {
    const fields = descriptors(node)
    const id = identifier(fields.id?.value)
    if (ids.has(id)) fail('节点标识重复')
    ids.add(id)
    if (fields.type?.value != null && fields.type.value !== 'generator') fail('节点类型无效')
    const position = descriptors(fields.position?.value)
    const x = position.x?.value,
      y = position.y?.value
    if (
      ![x, y].every(
        (value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e7,
      )
    )
      fail('节点位置无效')
    return {
      id,
      type: 'generator',
      position: { x, y },
      data: sanitizeCopiedNodeData(fields.data?.value),
    }
  })
  const groups = new Map()
  for (const node of copiedNodes)
    if (node.data.groupId) groups.set(node.data.groupId, (groups.get(node.data.groupId) || 0) + 1)
  for (const node of copiedNodes)
    if (node.data.groupId && groups.get(node.data.groupId) < 2) {
      delete node.data.groupId
      delete node.data.groupName
      delete node.data.groupType
      delete node.data.groupColor
      delete node.data.groupPadding
    }
  // Only references contained in this clipboard can be remapped safely on another canvas.
  for (const node of copiedNodes) {
    if (!ids.has(node.data.sourceImageNodeId)) delete node.data.sourceImageNodeId
    for (const key of ['editTemplate', 'localEdit'])
      if (node.data[key] && !ids.has(node.data[key].sourceNodeId))
        delete node.data[key].sourceNodeId
  }
  const edgeIds = new Set()
  const copiedEdges = []
  for (const edge of arrayValues(edges, NODE_CLIPBOARD_LIMITS.sourceEdges)) {
    const fields = descriptors(edge)
    const source = identifier(fields.source?.value),
      target = identifier(fields.target?.value)
    if (!ids.has(source) || !ids.has(target)) {
      if (strictEdges) fail('剪贴板包含外部连线')
      continue
    }
    const id =
      fields.id?.value == null
        ? `clipboard-edge-${copiedEdges.length}`
        : identifier(fields.id.value)
    if (edgeIds.has(id)) fail('连线标识重复')
    edgeIds.add(id)
    if (fields.type?.value != null && !['default', 'smoothstep'].includes(fields.type.value))
      fail('连线类型无效')
    const value = {
      id,
      source,
      target,
      sourceHandle: identifier(fields.sourceHandle?.value || 'output'),
      targetHandle: identifier(fields.targetHandle?.value || 'input'),
      type: fields.type?.value || 'default',
      data: { semantic: 'dependency' },
    }
    if (fields.data?.value != null) {
      const semantic = descriptors(fields.data.value).semantic?.value
      if (semantic != null && (typeof semantic !== 'string' || semantic.length > 200))
        fail('连线数据无效')
      if (semantic) value.data.semantic = semantic
    }
    copiedEdges.push(value)
  }
  if (copiedEdges.length > NODE_CLIPBOARD_LIMITS.edges) fail('单次最多复制500条连线')
  const snapshot = {
    format: NODE_CLIPBOARD_FORMAT,
    version: NODE_CLIPBOARD_VERSION,
    nodes: copiedNodes,
    edges: copiedEdges,
  }
  if (JSON.stringify(snapshot).length > NODE_CLIPBOARD_LIMITS.text) fail('节点剪贴板内容超过8MB')
  return snapshot
}

/** `nodes` is the explicitly selected node list; only its internal edges are copied. */
export function createNodeClipboard(nodes, edges = []) {
  return normalize(nodes, edges)
}

function envelope(snapshot) {
  const fields = descriptors(snapshot)
  if (
    Object.keys(fields).some((key) => !['format', 'version', 'nodes', 'edges'].includes(key)) ||
    fields.format?.value !== NODE_CLIPBOARD_FORMAT ||
    fields.version?.value !== NODE_CLIPBOARD_VERSION
  )
    fail('不是支持的有米画布节点剪贴板')
  return normalize(fields.nodes?.value, fields.edges?.value, true)
}

export function serializeNodeClipboard(snapshot) {
  return JSON.stringify(envelope(snapshot))
}

/** Ordinary text, invalid JSON and foreign/unsupported clipboard formats are not node pastes. */
export function parseNodeClipboard(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > NODE_CLIPBOARD_LIMITS.text)
    return null
  try {
    return envelope(JSON.parse(text))
  } catch {
    return null
  }
}
