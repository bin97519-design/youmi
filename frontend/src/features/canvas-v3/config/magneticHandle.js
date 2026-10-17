export const MAGNETIC_HANDLE_SIZE = 80
export const MAGNETIC_HANDLE_ICON_SIZE = 20
export const MAGNETIC_HANDLE_TRAVEL = 25

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function magneticHandleHome(side) {
  return { x: side === 'target' ? MAGNETIC_HANDLE_TRAVEL : -MAGNETIC_HANDLE_TRAVEL, y: 0 }
}

export function magneticHandleOffset(pointer, rect, side) {
  if (!rect?.width || !rect?.height) return magneticHandleHome(side)

  const localX = ((pointer.x - rect.left) / rect.width) * MAGNETIC_HANDLE_SIZE
  const localY = ((pointer.y - rect.top) / rect.height) * MAGNETIC_HANDLE_SIZE
  const center = MAGNETIC_HANDLE_SIZE / 2

  return {
    x: clamp(localX - center, -MAGNETIC_HANDLE_TRAVEL, MAGNETIC_HANDLE_TRAVEL),
    y: clamp(localY - center, -MAGNETIC_HANDLE_TRAVEL, MAGNETIC_HANDLE_TRAVEL),
  }
}
