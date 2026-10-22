const finite = (value) => typeof value === 'number' && Number.isFinite(value)

/** Groups and pointer use the same canvas-wrapper-local screen coordinates.
 * The short bridge joins the frame to its floating + without covering a whole
 * right-hand strip or placing a hit-test overlay over child media controls.
 */
export function groupAtPointer(groups, point) {
  if (!Array.isArray(groups) || !finite(point?.x) || !finite(point?.y)) return ''
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index]
    const bounds = group?.bounds
    if (
      typeof group?.id !== 'string' ||
      !group.id ||
      !bounds ||
      ![bounds.left, bounds.top, bounds.right, bounds.bottom].every(finite) ||
      bounds.right <= bounds.left ||
      bounds.bottom <= bounds.top
    )
      continue
    const insideFrame =
      point.x >= bounds.left &&
      point.x <= bounds.right &&
      point.y >= bounds.top &&
      point.y <= bounds.bottom
    const centerY = (bounds.top + bounds.bottom) / 2
    const insideAddBridge =
      point.x >= bounds.right &&
      point.x <= bounds.right + 34 &&
      point.y >= centerY - 14 &&
      point.y <= centerY + 14
    if (insideFrame || insideAddBridge) return group.id
  }
  return ''
}
