const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const point = (event) =>
  finite(event?.clientX) && finite(event?.clientY) ? { x: event.clientX, y: event.clientY } : null
const leftHeld = (event) => Number.isInteger(event?.buttons) && (event.buttons & 1) !== 0

function scopeKey(getScope) {
  return JSON.stringify(getScope(), (_key, value) => {
    if (value && Object.getPrototypeOf(value) === Object.prototype)
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      )
    return value
  })
}

/** Left-button anchor drag. The caller owns capture and menu rendering; this
 * controller only publishes local screen coordinates and never edits a graph. */
export function createGroupConnectionDrag({
  graph,
  getScope = () => graph.projectId,
  getCanvasRect,
  onPreview = () => {},
  onRelease = () => {},
  onCancel = () => {},
}) {
  let drag = null
  function current(session) {
    try {
      return (
        session.scope === scopeKey(getScope) &&
        graph.selectionMutable &&
        graph.selectedGroup?.id === session.groupId &&
        graph.selectedGroup?.type === session.groupType &&
        graph.selectedNodes.length === session.entries.length &&
        graph.nodes.filter((node) => node.data?.groupId === session.groupId).length ===
          session.entries.length &&
        session.entries.every(
          ({ node, x, y }) =>
            graph.nodes.includes(node) &&
            graph.selectedNodes.includes(node) &&
            node.data?.groupId === session.groupId &&
            node.position?.x === x &&
            node.position?.y === y,
        )
      )
    } catch {
      return false
    }
  }
  function cancel() {
    if (!drag) return false
    drag = null
    onPreview(null)
    onCancel()
    return true
  }
  function screenPoint(destination) {
    let rect
    try {
      rect = getCanvasRect()
    } catch {
      return null
    }
    return finite(rect?.left) && finite(rect?.top)
      ? { x: destination.x - rect.left, y: destination.y - rect.top }
      : null
  }
  function start(groupId, event) {
    if (drag || event?.button !== 0 || !leftHeld(event) || !finite(event.pointerId)) return false
    const origin = point(event)
    const group = graph.selectedGroup
    const members = graph.selectedNodes
    if (
      !origin ||
      !groupId ||
      group?.id !== groupId ||
      !graph.selectionMutable ||
      !Array.isArray(members) ||
      members.length < 2 ||
      !Array.isArray(graph.nodes)
    )
      return false
    const entries = members.map((node) => ({ node, x: node?.position?.x, y: node?.position?.y }))
    if (
      new Set(members.map((node) => node.id)).size !== entries.length ||
      !entries.every(
        ({ node, x, y }) =>
          node?.id &&
          finite(x) &&
          finite(y) &&
          node.data?.groupId === groupId &&
          graph.nodes.includes(node),
      ) ||
      graph.nodes.filter((node) => node.data?.groupId === groupId).length !== entries.length ||
      !screenPoint(origin)
    )
      return false
    let scope
    try {
      scope = scopeKey(getScope)
    } catch {
      return false
    }
    drag = {
      groupId,
      groupType: group.type,
      entries,
      origin,
      pointerId: event.pointerId,
      scope,
      moved: false,
      last: null,
    }
    return true
  }
  function matches(event) {
    return drag && event?.pointerId === drag.pointerId
  }
  function update(event) {
    const destination = point(event)
    if (!destination) return false
    const screen = screenPoint(destination)
    if (!screen) {
      cancel()
      return false
    }
    if (
      !drag.moved &&
      Math.hypot(destination.x - drag.origin.x, destination.y - drag.origin.y) <= 3 + 1e-9
    )
      return false
    drag.moved = true
    if (drag.last?.x === screen.x && drag.last?.y === screen.y) return true
    drag.last = screen
    onPreview({ groupId: drag.groupId, screen: { ...screen } })
    return true
  }
  function move(event) {
    if (!matches(event)) return false
    if (!current(drag) || !leftHeld(event)) {
      cancel()
      return false
    }
    return update(event)
  }
  function end(event) {
    if (!matches(event) || event.button !== 0) return false
    if (!current(drag) || !point(event)) {
      cancel()
      return false
    }
    update(event)
    if (!drag) return false
    if (!current(drag)) {
      cancel()
      return false
    }
    const session = drag
    drag = null
    onPreview(null)
    if (!session.moved || !session.last) return false
    onRelease({ groupId: session.groupId, screen: { ...session.last } })
    return true
  }
  return {
    start,
    move,
    end,
    cancel,
    get active() {
      return Boolean(drag)
    },
  }
}
