// Anchor the menu to the actual trigger, never to the whole prompt panel.
export function modelMenuPlacement(anchor, viewport, itemCount) {
  const gap = 4
  const margin = 8
  const width = Math.min(370, viewport.width - margin * 2)
  const desiredHeight = Math.min(410, itemCount * 56 + 6)
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const above = Math.max(0, anchor.top - gap - margin)
  const direction = below >= desiredHeight || below >= above ? 'below' : 'above'
  const height = Math.min(desiredHeight, direction === 'below' ? below : above)
  return {
    direction,
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: direction === 'below' ? anchor.bottom + gap : anchor.top - gap - height,
    width,
    height,
  }
}

// All composer popovers share the screen-level overlay layer. Prefer opening
// above their own trigger; constrain tall content to the available scrolling area.
export function nodePopupPlacement(anchor, viewport, size) {
  const margin = 8
  const gap = 4
  const width = Math.max(0, Math.min(size.width, viewport.width - margin * 2))
  const desiredHeight = Math.max(0, Math.min(size.height, viewport.height - margin * 2))
  const above = Math.max(0, anchor.top - gap - margin)
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const direction = above >= desiredHeight || above >= below ? 'above' : 'below'
  const height = Math.min(desiredHeight, direction === 'above' ? above : below)
  const top = direction === 'above' ? anchor.top - gap - height : anchor.bottom + gap
  return {
    direction,
    left: Math.max(margin, Math.min(anchor.left, viewport.width - width - margin)),
    top: Math.max(margin, Math.min(top, viewport.height - height - margin)),
    width,
    height,
  }
}

// The toolbar's hover menu is centered on its own button and opens below it.
// Teleport it to the overlay layer, outside the toolbar's horizontal scroller.
export function imageGridMenuPlacement(anchor, viewport, size = {}) {
  const margin = 8
  const gap = 4
  const width = Math.max(0, Math.min(size.width || 280, viewport.width - margin * 2))
  const desiredHeight = size.height || 360
  const above = Math.max(0, anchor.top - gap - margin)
  const below = Math.max(0, viewport.height - anchor.bottom - gap - margin)
  const direction = below >= desiredHeight || below >= above ? 'below' : 'above'
  const maxHeight = Math.min(desiredHeight, direction === 'below' ? below : above)
  return {
    direction,
    left: Math.max(
      margin,
      Math.min((anchor.left + anchor.right - width) / 2, viewport.width - width - margin),
    ),
    ...(direction === 'below'
      ? { top: anchor.bottom + gap }
      : { bottom: viewport.height - anchor.top + gap }),
    width,
    maxHeight,
  }
}
