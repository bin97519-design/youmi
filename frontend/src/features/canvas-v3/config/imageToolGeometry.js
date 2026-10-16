export function imagePixelSize(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 16384 ||
    height > 16384 ||
    width * height > 64_000_000
  )
    throw new Error('图片尺寸无效或过大，请使用不超过6400万像素的图片')
  return { width, height }
}

export function normalizedImageBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null
  const next = box.map((value) => Math.max(0, Math.min(1, value)))
  return next[2] > next[0] && next[3] > next[1] ? next : null
}

export function imageBoxRect(box, width, height) {
  imagePixelSize(width, height)
  const valid = normalizedImageBox(box)
  if (!valid) throw new Error('框选区域无效，请重新框选')
  const x = Math.floor(valid[0] * width)
  const y = Math.floor(valid[1] * height)
  const right = Math.min(width, Math.ceil(valid[2] * width))
  const bottom = Math.min(height, Math.ceil(valid[3] * height))
  return { x, y, width: right - x, height: bottom - y }
}

export function gridCropRects(width, height, rows, columns, selection = null) {
  imagePixelSize(width, height)
  if (
    !Number.isInteger(rows) ||
    !Number.isInteger(columns) ||
    rows < 1 ||
    columns < 1 ||
    rows * columns > 100 ||
    rows > height ||
    columns > width
  )
    throw new Error('宫格行列无效，每格至少需要一个像素，单次最多切分100格')
  const indexes =
    selection === null ? Array.from({ length: rows * columns }, (_, i) => i) : selection
  if (
    !Array.isArray(indexes) ||
    indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= rows * columns)
  )
    throw new Error('请选择有效的画格')
  return [...new Set(indexes)]
    .sort((a, b) => a - b)
    .map((index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      // Shared integer boundaries partition every original pixel exactly once,
      // including images whose dimensions are not divisible by the grid size.
      const x = Math.floor((column * width) / columns)
      const y = Math.floor((row * height) / rows)
      return {
        index,
        row,
        column,
        x,
        y,
        width: Math.floor(((column + 1) * width) / columns) - x,
        height: Math.floor(((row + 1) * height) / rows) - y,
      }
    })
}
