export function canvasSelectionToolbarPlacement(anchor, viewport, available, size, obstacles = []) {
  const scale = Math.max(0.01, viewport.scale || 1)
  const width = Math.max(48, available.right - available.left)
  const actualWidth = Math.min(size.width, width)
  const screenLeft = viewport.left + anchor.x * scale - actualWidth / 2
  const above = viewport.top + anchor.y * scale - size.height - 12
  const below = viewport.top + anchor.bottom * scale + 12
  const collides = (top) =>
    obstacles.some(
      (rect) =>
        screenLeft < rect.right &&
        screenLeft + actualWidth > rect.left &&
        top < rect.bottom &&
        top + size.height > rect.top,
    )
  const useBelow =
    (above < available.top || collides(above)) &&
    below + size.height <= available.bottom &&
    !collides(below)
  const screenTop = useBelow ? below : above
  const menuWidth = Math.min(216, width)
  const menuHeight = Math.min(396, Math.max(48, available.bottom - available.top))
  const menuLeft = Math.max(available.left, Math.min(available.right - menuWidth, screenLeft))
  const menuBelow = screenTop + size.height + 6
  const menuTop = Math.max(
    available.top,
    Math.min(
      available.bottom - menuHeight,
      menuBelow + menuHeight <= available.bottom ? menuBelow : screenTop - menuHeight - 6,
    ),
  )
  return {
    style: {
      left: `${anchor.x - actualWidth / (2 * scale)}px`,
      top: `${(screenTop - viewport.top) / scale}px`,
      maxWidth: `${width}px`,
      transform: `scale(${1 / scale})`,
    },
    menuStyle: {
      left: `${menuLeft - screenLeft - 1}px`,
      top: `${menuTop - screenTop - 1}px`,
      width: `${menuWidth}px`,
      maxHeight: `${menuHeight}px`,
    },
  }
}
