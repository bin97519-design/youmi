const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const arrows = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

function selectedSnapshot(graph) {
  if (!graph?.selectionMutable || !Array.isArray(graph.selectedNodes)) return null
  const selected = graph.selectedNodes
  if (selected.length < 2 || new Set(selected.map((node) => node?.id)).size !== selected.length)
    return null
  const entries = selected.map((node) => ({
    id: node?.id,
    node,
    x: node?.position?.x,
    y: node?.position?.y,
  }))
  return entries.every(
    (entry) =>
      entry.id &&
      finite(entry.x) &&
      finite(entry.y) &&
      graph.nodes?.some((node) => node === entry.node),
  )
    ? entries
    : null
}

// Capture values, not an object identity: an account/project scope may be mutated in place.
function scopeKey(getScope) {
  return JSON.stringify({ value: getScope() }, (_key, value) => {
    if (value && Object.getPrototypeOf(value) === Object.prototype)
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      )
    return value
  })
}

const point = (event) =>
  finite(event?.clientX) && finite(event?.clientY) ? { x: event.clientX, y: event.clientY } : null

/** Pointer capture belongs to the caller; this controller only changes the explicit selection. */
export function createSelectionFrameDrag({
  graph,
  getScope = () => graph.projectId,
  getZoom = () => 1,
}) {
  let drag = null
  function sameScope(current) {
    try {
      return scopeKey(getScope) === current.scope
    } catch {
      return false
    }
  }
  function originalNodesPresent(current) {
    return current.entries.every((entry) => graph.nodes.some((node) => node === entry.node))
  }
  function matchesPointer(event) {
    return drag.pointerId == null || event?.pointerId == null || event.pointerId === drag.pointerId
  }
  function sameSelection(current) {
    const selected = graph.selectedNodes
    return (
      graph.selectionMutable &&
      Array.isArray(selected) &&
      selected.length === current.entries.length &&
      current.entries.every((entry) => selected.some((node) => node === entry.node))
    )
  }
  function finish() {
    if (!drag) return false
    const current = drag
    drag = null
    // Cancel keeps already-applied movement as one undoable edit. A replaced graph must
    // never receive the old gesture's revision, even when it reuses the same node IDs.
    if (!current.moved || !sameScope(current) || !originalNodesPresent(current)) return false
    graph.markChanged()
    return true
  }
  function start(event) {
    if (drag || event?.button !== 0) return false
    const origin = point(event)
    const entries = selectedSnapshot(graph)
    const zoom = getZoom()
    if (!origin || !entries || !finite(zoom) || zoom <= 0) return false
    let scope
    try {
      scope = scopeKey(getScope)
    } catch {
      return false
    }
    drag = { origin, entries, zoom, scope, pointerId: event.pointerId, moved: false }
    return true
  }
  function move(event) {
    if (!drag || !matchesPointer(event)) return false
    const current = drag
    if (!sameScope(current) || !originalNodesPresent(current) || !sameSelection(current)) {
      finish()
      return false
    }
    const destination = point(event)
    if (!destination) return false
    const dx = destination.x - current.origin.x
    const dy = destination.y - current.origin.y
    // Subtracting fractional client coordinates may round an exact 3px vector upward.
    if (!current.moved && Math.hypot(dx, dy) <= 3 + 1e-9) return false
    const positions = current.entries.map((entry) => ({
      x: entry.x + dx / current.zoom,
      y: entry.y + dy / current.zoom,
    }))
    if (!positions.every((position) => finite(position.x) && finite(position.y))) return false
    const changed = current.entries.some(
      (entry, index) =>
        entry.node.position.x !== positions[index].x ||
        entry.node.position.y !== positions[index].y,
    )
    if (!changed) return false
    if (!current.moved) {
      graph.remember()
      current.moved = true
    }
    current.entries.forEach((entry, index) => {
      entry.node.position = positions[index]
    })
    return true
  }
  function end(event) {
    if (!drag || !matchesPointer(event)) return false
    // Account for a final coalesced pointer position, but support a coordinate-free finish.
    if (point(event)) move(event)
    return finish()
  }
  return { start, move, end, cancel: finish }
}

/** One keydown is one history transaction; canvas capture must block VueFlow's native handler. */
export function moveSelectedByKey(graph, key, { shiftKey = false } = {}) {
  const direction = Object.hasOwn(arrows, key) ? arrows[key] : null
  const entries = direction && selectedSnapshot(graph)
  if (!entries) return false
  const distance = shiftKey ? 20 : 5
  const positions = entries.map((entry) => ({
    x: entry.x + direction[0] * distance,
    y: entry.y + direction[1] * distance,
  }))
  if (!positions.every((position) => finite(position.x) && finite(position.y))) return false
  if (
    !entries.some(
      (entry, index) => entry.x !== positions[index].x || entry.y !== positions[index].y,
    )
  )
    return false
  graph.remember()
  entries.forEach((entry, index) => {
    entry.node.position = positions[index]
  })
  graph.markChanged()
  return true
}
