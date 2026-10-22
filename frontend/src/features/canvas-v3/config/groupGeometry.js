import { canvasSelectionBounds } from './selectionGeometry.js'
import { MIN_GROUP_PADDING, MAX_GROUP_PADDING, normalizedGroupPadding } from './groupAppearance.js'

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const clampPadding = (value) => Math.max(MIN_GROUP_PADDING, Math.min(MAX_GROUP_PADDING, value))

/** Persistent containers use world-space padding; screen-fixed multi-selection uses another frame. */
export function canvasGroupBounds(nodes, viewport = {}, padding) {
  const content = canvasSelectionBounds(nodes, viewport, 0)
  if (!content) return null
  const zoom = viewport.zoom ?? 1
  const inset = normalizedGroupPadding(padding ?? nodes?.[0]?.data?.groupPadding)
  const left = content.left - inset.left * zoom
  const top = content.top - inset.top * zoom
  const right = content.right + inset.right * zoom
  const bottom = content.bottom + inset.bottom * zoom
  if (![left, top, right, bottom].every(finite)) return null
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

/** Resizes only the surrounding padding. Members' positions, media geometry and links stay intact. */
export function resizeGroupPadding(padding, corner, dx, dy) {
  if (!['nw', 'ne', 'sw', 'se'].includes(corner) || !finite(dx) || !finite(dy)) return null
  const next = normalizedGroupPadding(padding)
  if (corner.includes('w')) next.left = clampPadding(next.left - dx)
  else next.right = clampPadding(next.right + dx)
  if (corner.includes('n')) next.top = clampPadding(next.top - dy)
  else next.bottom = clampPadding(next.bottom + dy)
  return next
}
