function finiteNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function stableLayerOrder(left, right) {
  const yDelta = finiteNumber(left.y, 0) - finiteNumber(right.y, 0)
  if (yDelta) return yDelta
  const xDelta = finiteNumber(left.x, 0) - finiteNumber(right.x, 0)
  if (xDelta) return xDelta
  return String(left.id).localeCompare(String(right.id))
}

/**
 * Returns new positions for a set of canvas image nodes.
 * Directed connections determine the left-to-right rank. Dense ranks wrap into
 * extra columns so a fan-out graph does not become one very tall strip.
 */
export function buildCanvasAutoLayout(layers, connections = [], options = {}) {
  const nodes = (Array.isArray(layers) ? layers : [])
    .filter((layer) => layer?.id)
    .map((layer) => ({
      ...layer,
      width: Math.max(1, finiteNumber(layer.width, 240)),
      height: Math.max(1, finiteNumber(layer.height, 240)),
      x: finiteNumber(layer.x, 0),
      y: finiteNumber(layer.y, 0),
    }))

  if (nodes.length < 2) return new Map()

  const gapX = Math.max(24, finiteNumber(options.gapX, 96))
  const gapY = Math.max(24, finiteNumber(options.gapY, 64))
  const maxRows = Math.max(
    2,
    Math.floor(finiteNumber(options.maxRows, Math.ceil(Math.sqrt(nodes.length)))),
  )
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const outgoing = new Map(nodes.map((node) => [node.id, []]))
  const indegree = new Map(nodes.map((node) => [node.id, 0]))

  for (const connection of Array.isArray(connections) ? connections : []) {
    const from = connection?.fromLayerId
    const to = connection?.toLayerId
    if (!nodeById.has(from) || !nodeById.has(to) || from === to) continue
    if (outgoing.get(from).includes(to)) continue
    outgoing.get(from).push(to)
    indegree.set(to, indegree.get(to) + 1)
  }

  const rank = new Map(nodes.map((node) => [node.id, 0]))
  const queue = nodes
    .filter((node) => indegree.get(node.id) === 0)
    .sort(stableLayerOrder)
    .map((node) => node.id)
  const visited = new Set()

  while (queue.length) {
    const id = queue.shift()
    if (visited.has(id)) continue
    visited.add(id)
    for (const targetId of outgoing.get(id)) {
      rank.set(targetId, Math.max(rank.get(targetId), rank.get(id) + 1))
      indegree.set(targetId, indegree.get(targetId) - 1)
      if (indegree.get(targetId) === 0) queue.push(targetId)
    }
  }

  // Cycles have no zero-indegree root. Keep them together in a stable column
  // instead of allowing repeated rank growth.
  for (const node of nodes) {
    if (!visited.has(node.id)) rank.set(node.id, 0)
  }

  const logicalColumns = new Map()
  for (const node of nodes) {
    const nodeRank = rank.get(node.id) || 0
    if (!logicalColumns.has(nodeRank)) logicalColumns.set(nodeRank, [])
    logicalColumns.get(nodeRank).push(node)
  }

  const physicalColumns = []
  for (const columnRank of [...logicalColumns.keys()].sort((a, b) => a - b)) {
    const rankedNodes = logicalColumns.get(columnRank).sort(stableLayerOrder)
    for (let index = 0; index < rankedNodes.length; index += maxRows) {
      physicalColumns.push(rankedNodes.slice(index, index + maxRows))
    }
  }

  const originX = Math.min(...nodes.map((node) => node.x))
  const originY = Math.min(...nodes.map((node) => node.y))
  const columnMetrics = physicalColumns.map((column) => ({
    width: Math.max(...column.map((node) => node.width)),
    height:
      column.reduce((total, node) => total + node.height, 0) +
      gapY * Math.max(0, column.length - 1),
  }))
  const layoutHeight = Math.max(...columnMetrics.map((metric) => metric.height))
  const positions = new Map()
  let columnX = originX

  physicalColumns.forEach((column, columnIndex) => {
    const metric = columnMetrics[columnIndex]
    let nodeY = originY + (layoutHeight - metric.height) / 2
    for (const node of column) {
      positions.set(node.id, {
        x: Math.round(columnX + (metric.width - node.width) / 2),
        y: Math.round(nodeY),
      })
      nodeY += node.height + gapY
    }
    columnX += metric.width + gapX
  })

  return positions
}
