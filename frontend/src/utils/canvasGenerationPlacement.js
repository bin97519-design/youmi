function numberOr(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeRect(rect = {}) {
  const x = numberOr(rect.x ?? rect.left)
  const y = numberOr(rect.y ?? rect.top)
  const width = Math.max(1, numberOr(rect.width, numberOr(rect.right) - x))
  const height = Math.max(1, numberOr(rect.height, numberOr(rect.bottom) - y))
  return { x, y, width, height }
}

function overlaps(left, right, gap) {
  return !(
    left.x + left.width + gap <= right.x ||
    left.x >= right.x + right.width + gap ||
    left.y + left.height + gap <= right.y ||
    left.y >= right.y + right.height + gap
  )
}

/**
 * Finds a blank generation-card position near the first reference image while
 * keeping the whole card in the currently visible canvas world rectangle.
 */
export function findVisibleGenerationPlacement({
  viewport,
  anchor,
  occupied = [],
  width,
  height,
  gap = 32,
  margin = 20,
} = {}) {
  const view = normalizeRect(viewport)
  const cardWidth = Math.max(1, numberOr(width, 360))
  const cardHeight = Math.max(1, numberOr(height, 480))
  const safeGap = Math.max(0, numberOr(gap, 32))
  const safeMargin = Math.max(0, numberOr(margin, 20))
  const minX = view.x + safeMargin
  const minY = view.y + safeMargin
  const maxX = Math.max(minX, view.x + view.width - safeMargin - cardWidth)
  const maxY = Math.max(minY, view.y + view.height - safeMargin - cardHeight)
  const normalizedAnchor = anchor ? normalizeRect(anchor) : null
  const normalizedOccupied = occupied
    .map(normalizeRect)
    .filter(
      (rect) =>
        Number.isFinite(rect.x) &&
        Number.isFinite(rect.y) &&
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height),
    )

  const clampCandidate = (candidate) => ({
    x: Math.round(Math.min(maxX, Math.max(minX, numberOr(candidate.x, minX)))),
    y: Math.round(Math.min(maxY, Math.max(minY, numberOr(candidate.y, minY)))),
    width: cardWidth,
    height: cardHeight,
  })
  const isInside = (candidate) =>
    candidate.x >= minX &&
    candidate.y >= minY &&
    candidate.x + cardWidth <= view.x + view.width - safeMargin + 0.5 &&
    candidate.y + cardHeight <= view.y + view.height - safeMargin + 0.5
  const isFree = (candidate) =>
    isInside(candidate) && normalizedOccupied.every((rect) => !overlaps(candidate, rect, safeGap))

  const centerCandidate = {
    x: view.x + (view.width - cardWidth) / 2,
    y: view.y + (view.height - cardHeight) / 2,
  }
  const preferred = normalizedAnchor
    ? [
        {
          x: normalizedAnchor.x + normalizedAnchor.width + safeGap,
          y: normalizedAnchor.y,
        },
        {
          x: normalizedAnchor.x,
          y: normalizedAnchor.y + normalizedAnchor.height + safeGap,
        },
        {
          x: normalizedAnchor.x - cardWidth - safeGap,
          y: normalizedAnchor.y,
        },
        {
          x: normalizedAnchor.x,
          y: normalizedAnchor.y - cardHeight - safeGap,
        },
      ]
    : [centerCandidate]

  const seen = new Set()
  const candidates = []
  const addCandidate = (candidate) => {
    const next = clampCandidate(candidate)
    const key = `${next.x}:${next.y}`
    if (seen.has(key)) return
    seen.add(key)
    candidates.push(next)
  }
  preferred.forEach(addCandidate)

  const stepX = Math.max(24, Math.min(cardWidth + safeGap, 72))
  const stepY = Math.max(24, Math.min(cardHeight + safeGap, 72))
  for (let y = minY; y <= maxY + 0.5; y += stepY) {
    for (let x = minX; x <= maxX + 0.5; x += stepX) addCandidate({ x, y })
  }
  addCandidate({ x: maxX, y: maxY })

  const target = normalizedAnchor
    ? {
        x: normalizedAnchor.x + normalizedAnchor.width / 2,
        y: normalizedAnchor.y + normalizedAnchor.height / 2,
      }
    : {
        x: view.x + view.width / 2,
        y: view.y + view.height / 2,
      }
  const directCount = preferred.length
  const direct = candidates.slice(0, directCount).find(isFree)
  if (direct) return { x: direct.x, y: direct.y }

  const scanned = candidates
    .slice(directCount)
    .filter(isFree)
    .sort((left, right) => {
      const leftDistance =
        (left.x + cardWidth / 2 - target.x) ** 2 + (left.y + cardHeight / 2 - target.y) ** 2
      const rightDistance =
        (right.x + cardWidth / 2 - target.x) ** 2 + (right.y + cardHeight / 2 - target.y) ** 2
      return leftDistance - rightDistance
    })[0]
  if (scanned) return { x: scanned.x, y: scanned.y }

  // When the visible area is completely full, staying visible is more useful
  // than silently placing the result outside the viewport.
  const fallback = clampCandidate(preferred[0] || centerCandidate)
  return { x: fallback.x, y: fallback.y }
}
