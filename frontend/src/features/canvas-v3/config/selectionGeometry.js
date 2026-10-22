import { nodeSize } from './nodeGeometry.js'

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value))

/** Explicit selected nodes in world coordinates -> one padded screen-space frame. */
export function canvasSelectionBounds(nodes = [], viewport = {}, padding = 24) {
  if (!Array.isArray(nodes)) return null
  const zoom = viewport.zoom == null ? 1 : viewport.zoom
  if (!finite(zoom) || zoom <= 0) return null
  const x = finite(viewport.x) ? viewport.x : 0
  const y = finite(viewport.y) ? viewport.y : 0
  const inset = finite(padding) ? Math.max(0, padding) : 24
  const rectangles = nodes
    .filter(
      (node) => !node?.hidden && node?.data && finite(node.position?.x) && finite(node.position?.y),
    )
    .map((node) => {
      const size = nodeSize(node.data.kind, node.data)
      return {
        left: node.position.x * zoom + x,
        top: node.position.y * zoom + y,
        right: (node.position.x + size.width) * zoom + x,
        bottom: (node.position.y + size.height) * zoom + y,
      }
    })
    .filter((rect) => [rect.left, rect.top, rect.right, rect.bottom].every(finite))
  if (rectangles.length < 2) return null
  const left = Math.min(...rectangles.map((rect) => rect.left)) - inset
  const top = Math.min(...rectangles.map((rect) => rect.top)) - inset
  const right = Math.max(...rectangles.map((rect) => rect.right)) + inset
  const bottom = Math.max(...rectangles.map((rect) => rect.bottom)) + inset
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

function validBounds(bounds) {
  return (
    bounds &&
    [bounds.left, bounds.top, bounds.right, bounds.bottom].every(finite) &&
    bounds.right >= bounds.left &&
    bounds.bottom >= bounds.top
  )
}

/** Fixed screen pixels; narrow viewports scroll the toolbar, never shrink its typography. */
export function selectionToolbarPlacement(bounds, size = {}, viewport = {}) {
  if (
    !validBounds(bounds) ||
    !finite(viewport.width) ||
    !finite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null
  const margin = Math.min(8, viewport.width / 2, viewport.height / 2)
  const maxWidth = Math.max(0, viewport.width - margin * 2)
  const width = Math.min(finite(size.width) ? Math.max(1, size.width) : 644, maxWidth)
  const height = finite(size.height) ? Math.max(1, size.height) : 50
  const centerX = (bounds.left + bounds.right) / 2
  const above = bounds.top - height - 10
  const below = bounds.bottom + 10
  const useBelow = above < margin && below + height <= viewport.height - margin
  const side = useBelow ? 'below' : 'above'
  return {
    left: clamp(centerX - width / 2, margin, Math.max(margin, viewport.width - width - margin)),
    top: clamp(
      useBelow ? below : above,
      margin,
      Math.max(margin, viewport.height - height - margin),
    ),
    width,
    height,
    maxWidth,
    side,
  }
}

/** Trigger and viewport use the same local screen coordinate system as the toolbar. */
export function selectionMenuPlacement(anchor, size = {}, viewport, preferred = 'below') {
  if (
    !validBounds(anchor) ||
    !finite(viewport?.width) ||
    !finite(viewport?.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null
  const margin = Math.min(8, viewport.width / 2, viewport.height / 2)
  const width = Math.min(
    finite(size.width) ? Math.max(1, size.width) : 150,
    Math.max(0, viewport.width - 2 * margin),
  )
  const maxHeight = Math.max(0, viewport.height - 2 * margin)
  const height = Math.min(finite(size.height) ? Math.max(1, size.height) : 80, maxHeight)
  const above = anchor.top - height - 6
  const below = anchor.bottom + 6
  let side = preferred === 'above' ? 'above' : 'below'
  if (side === 'above' && above < margin && below + height <= viewport.height - margin)
    side = 'below'
  else if (side === 'below' && below + height > viewport.height - margin && above >= margin)
    side = 'above'
  return {
    left: clamp(anchor.left, margin, Math.max(margin, viewport.width - width - margin)),
    top: clamp(
      side === 'above' ? above : below,
      margin,
      Math.max(margin, viewport.height - height - margin),
    ),
    width,
    height,
    maxHeight,
    side,
  }
}
