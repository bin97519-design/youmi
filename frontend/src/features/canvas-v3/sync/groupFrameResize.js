import { normalizedGroupPadding } from '../config/groupAppearance.js'
import { resizeGroupPadding } from '../config/groupGeometry.js'

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const point = (event) =>
  finite(event?.clientX) && finite(event?.clientY) ? { x: event.clientX, y: event.clientY } : null
const equalPadding = (a, b) =>
  ['top', 'right', 'bottom', 'left'].every((key) => a?.[key] === b?.[key])

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

/** Caller captures the pointer; no image/video resizing, paid execution or external writes. */
export function createGroupFrameResize({
  graph,
  getScope = () => graph.projectId,
  getZoom = () => 1,
}) {
  let resize = null
  function sameScope(current) {
    try {
      return scopeKey(getScope) === current.scope
    } catch {
      return false
    }
  }
  function originalNodesPresent(current) {
    return current.entries.every((entry) => graph.nodes?.some((node) => node === entry.node))
  }
  function sameSelection(current) {
    return (
      graph.selectionMutable &&
      graph.selectedGroup?.id === current.groupId &&
      graph.selectedGroup?.type === current.groupType &&
      Array.isArray(graph.selectedNodes) &&
      graph.selectedNodes.length === current.entries.length &&
      graph.nodes.filter((node) => node.data?.groupId === current.groupId).length ===
        current.entries.length &&
      current.entries.every(
        (entry) =>
          graph.selectedNodes.some((node) => node === entry.node) &&
          entry.node.data?.groupId === current.groupId &&
          entry.node.position?.x === entry.x &&
          entry.node.position?.y === entry.y,
      )
    )
  }
  function matchesPointer(event) {
    return (
      resize.pointerId == null || event?.pointerId == null || event.pointerId === resize.pointerId
    )
  }
  function finish() {
    if (!resize) return false
    const current = resize
    resize = null
    // Cancellation keeps already-applied padding as one undoable edit, but a new
    // account/project or newly hydrated graph never receives a stale revision.
    if (!current.moved || !sameScope(current) || !originalNodesPresent(current)) return false
    graph.markChanged()
    return true
  }
  function start(event, corner) {
    if (resize || event?.button !== 0 || !['nw', 'ne', 'sw', 'se'].includes(corner)) return false
    const origin = point(event)
    const group = graph.selectedGroup
    const members = graph.selectedNodes
    if (
      !origin ||
      !group ||
      !graph.selectionMutable ||
      !Array.isArray(members) ||
      members.length < 2
    )
      return false
    const entries = members.map((node) => ({
      id: node?.id,
      node,
      x: node?.position?.x,
      y: node?.position?.y,
    }))
    if (
      new Set(entries.map((entry) => entry.id)).size !== entries.length ||
      !entries.every(
        (entry) =>
          entry.id &&
          finite(entry.x) &&
          finite(entry.y) &&
          entry.node.data?.groupId === group.id &&
          graph.nodes?.some((node) => node === entry.node),
      ) ||
      graph.nodes.filter((node) => node.data?.groupId === group.id).length !== entries.length
    )
      return false
    let zoom, scope
    try {
      zoom = getZoom()
      scope = scopeKey(getScope)
    } catch {
      return false
    }
    if (!finite(zoom) || zoom <= 0) return false
    resize = {
      origin,
      corner,
      entries,
      groupId: group.id,
      groupType: group.type,
      padding: normalizedGroupPadding(entries[0].node.data.groupPadding),
      zoom,
      scope,
      pointerId: event.pointerId,
      moved: false,
    }
    return true
  }
  function move(event) {
    if (!resize || !matchesPointer(event)) return false
    const current = resize
    if (!sameScope(current) || !originalNodesPresent(current) || !sameSelection(current)) {
      finish()
      return false
    }
    const destination = point(event)
    if (!destination) return false
    const dx = destination.x - current.origin.x
    const dy = destination.y - current.origin.y
    if (!current.moved && Math.hypot(dx, dy) <= 3 + 1e-9) return false
    const padding = resizeGroupPadding(
      current.padding,
      current.corner,
      dx / current.zoom,
      dy / current.zoom,
    )
    if (
      !padding ||
      current.entries.every((entry) => equalPadding(entry.node.data.groupPadding, padding))
    )
      return false
    if (!current.moved) {
      graph.remember()
      current.moved = true
    }
    for (const entry of current.entries) entry.node.data.groupPadding = { ...padding }
    return true
  }
  function end(event) {
    if (!resize || !matchesPointer(event)) return false
    if (point(event)) move(event)
    return finish()
  }
  return {
    start,
    move,
    end,
    cancel: finish,
    get active() {
      return Boolean(resize)
    },
  }
}
