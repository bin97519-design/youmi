import { buildCanvasAutoLayout } from './canvasAutoLayout.js'
import { selectionBounds, isRenderedCanvasNode } from './canvasNodeConnections.js'

export const CANVAS_SELECTION_LAYOUTS = [
  { key: 'grid', label: '网格排列', icon: 'ri-layout-grid-line' },
  { key: 'horizontal', label: '横向排列', icon: 'ri-layout-column-line' },
  { key: 'vertical', label: '纵向排列', icon: 'ri-layout-row-line' },
  { key: 'left', label: '左对齐', icon: 'ri-align-left', section: true },
  { key: 'center', label: '水平居中', icon: 'ri-align-center' },
  { key: 'right', label: '右对齐', icon: 'ri-align-right' },
  { key: 'top', label: '顶部对齐', icon: 'ri-align-top' },
  { key: 'middle', label: '垂直居中', icon: 'ri-align-vertically' },
  { key: 'bottom', label: '底部对齐', icon: 'ri-align-bottom' },
  { key: 'distribute-x', label: '水平等间距', icon: 'ri-space', section: true },
  { key: 'distribute-y', label: '垂直等间距', icon: 'ri-space' },
]

export function selectedCanvasLayers(layers = [], ids = [], renderedIds) {
  const selected = new Set(ids)
  return layers
    .filter((layer) => isRenderedCanvasNode(layer, renderedIds) && selected.has(layer.id))
    .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))
}

export function expandCanvasGroupSelection(layers = [], ids = [], renderedIds) {
  const selected = new Set(ids)
  const groupIds = new Set(
    layers.filter((layer) => selected.has(layer.id) && layer.groupId).map((layer) => layer.groupId),
  )
  for (const layer of layers) {
    if (isRenderedCanvasNode(layer, renderedIds) && groupIds.has(layer.groupId))
      selected.add(layer.id)
  }
  return [...selected]
}

export function selectedCanvasGroup(layers = [], ids = [], renderedIds) {
  const selected = selectedCanvasLayers(layers, ids, renderedIds)
  const groupId = selected[0]?.groupId
  if (selected.length < 2 || !groupId || selected.some((layer) => layer.groupId !== groupId))
    return null
  const members = layers.filter(
    (layer) => layer.groupId === groupId && isRenderedCanvasNode(layer, renderedIds),
  )
  if (members.length !== selected.length) return null
  return { id: groupId, name: selected[0].groupName || '分组' }
}

export function setCanvasSelectionGroup(layers, ids, groupId = '', name = '') {
  const selected = new Set(ids)
  const affected = new Set(groupId ? [groupId] : [])
  for (const layer of layers) {
    if (!selected.has(layer.id)) continue
    if (layer.groupId) affected.add(layer.groupId)
    if (groupId) {
      layer.groupId = groupId
      layer.groupName = name
    } else {
      delete layer.groupId
      delete layer.groupName
    }
  }
  const counts = new Map()
  for (const layer of layers) {
    if (layer.groupId) counts.set(layer.groupId, (counts.get(layer.groupId) || 0) + 1)
  }
  for (const layer of layers) {
    if (affected.has(layer.groupId) && counts.get(layer.groupId) < 2) {
      delete layer.groupId
      delete layer.groupName
    }
  }
}

export function canvasSelectionLayout(layers, mode) {
  if (layers.length < 2 || !CANVAS_SELECTION_LAYOUTS.some((item) => item.key === mode))
    return new Map()
  const nodes = layers.map((layer) => ({
    ...layer,
    x: Number(layer.x) || 0,
    y: Number(layer.y) || 0,
    width: Math.max(1, Number(layer.width) || 240),
    height: Math.max(1, Number(layer.height) || 240),
  }))
  if (['grid', 'horizontal', 'vertical'].includes(mode)) {
    const columns =
      mode === 'vertical'
        ? 1
        : mode === 'horizontal'
          ? nodes.length
          : Math.ceil(Math.sqrt(nodes.length))
    return buildCanvasAutoLayout(nodes, [], { columns, gapX: 48, gapY: 48 })
  }
  const bounds = selectionBounds(nodes)
  const positions = new Map()
  if (mode.startsWith('distribute-')) {
    if (nodes.length < 3) return positions
    const axis = mode === 'distribute-x' ? 'x' : 'y'
    const size = axis === 'x' ? 'width' : 'height'
    const ordered = [...nodes].sort((a, b) => a[axis] - b[axis])
    const first = ordered[0][axis]
    const last = ordered.at(-1)[axis] + ordered.at(-1)[size]
    const gap =
      (last - first - ordered.reduce((sum, node) => sum + node[size], 0)) / (nodes.length - 1)
    let cursor = first
    for (const node of ordered) {
      positions.set(node.id, { x: node.x, y: node.y, [axis]: Math.round(cursor) })
      cursor += node[size] + gap
    }
    return positions
  }
  for (const node of nodes) {
    let { x, y } = node
    if (mode === 'left') x = bounds.left
    if (mode === 'center') x = bounds.left + (bounds.width - node.width) / 2
    if (mode === 'right') x = bounds.right - node.width
    if (mode === 'top') y = bounds.top
    if (mode === 'middle') y = bounds.top + (bounds.height - node.height) / 2
    if (mode === 'bottom') y = bounds.bottom - node.height
    positions.set(node.id, { x: Math.round(x), y: Math.round(y) })
  }
  return positions
}

export function canvasSelectionContent(layers = []) {
  const ready = layers.filter((layer) => !layer.generating && layer.status !== 'failed')
  return {
    images: ready.filter((layer) => layer.url && (!layer.type || layer.type === 'image')),
    videos: ready.filter((layer) => layer.url && layer.type === 'video'),
    texts: ready.filter((layer) => layer.type === 'text' && String(layer.text || '').trim()),
  }
}

export function canvasSelectionExportEntry(layer, index, data, contentType = '') {
  const text = layer.type === 'text'
  const video = layer.type === 'video'
  const type = contentType.toLowerCase()
  const urlExtension = String(layer.url || '')
    .split('?')[0]
    .match(/\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov|m4v)$/i)?.[1]
  const extension = text
    ? 'txt'
    : video
      ? type.includes('webm')
        ? 'webm'
        : type.includes('quicktime')
          ? 'mov'
          : urlExtension || 'mp4'
      : type.includes('jpeg')
        ? 'jpg'
        : ['png', 'webp', 'gif', 'avif', 'bmp'].find((value) => type.includes(value)) ||
          urlExtension ||
          'png'
  const rawName = [
    ...String(layer.name || `${text ? '文本' : video ? '视频' : '图片'}-${index + 1}`),
  ]
    .map((character) => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
  const baseName =
    rawName.replace(/\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov|m4v|txt)$/i, '') ||
    `素材-${index + 1}`
  return {
    baseName,
    extension: `.${extension.toLowerCase().replace('jpeg', 'jpg')}`,
    data: text ? new TextEncoder().encode(String(layer.text || '')) : data,
  }
}
