export const GENERATION_DOT_STEP = 12
export const GENERATION_DOT_RADIUS = 0.7
export const GENERATION_DOT_OFFSET = 10.5
export const GENERATION_DOT_FPS = 15

export function generationDotSeed(value = '') {
  let result = 2166136261
  for (const character of String(value)) {
    result = Math.imul(result ^ character.codePointAt(0), 16777619)
  }
  return result >>> 0
}

function sample(seed, x, y) {
  let value = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

const smooth = (value) => value * value * (3 - 2 * value)
const mix = (from, to, amount) => from + (to - from) * amount

function variation(seed, x, y) {
  const left = Math.floor(x)
  const top = Math.floor(y)
  const horizontal = smooth(x - left)
  const vertical = smooth(y - top)
  return mix(
    mix(sample(seed, left, top), sample(seed, left + 1, top), horizontal),
    mix(sample(seed, left, top + 1), sample(seed, left + 1, top + 1), horizontal),
    vertical,
  )
}

function ellipse(x, y, centreX, centreY, radiusX, radiusY) {
  const distance = ((x - centreX) / radiusX) ** 2 + ((y - centreY) / radiusY) ** 2
  return distance >= 1 ? 0 : smooth(Math.min(1, (1 - distance) / 0.85))
}

/** Fixed grid positions; only the opacity of a small, softly bounded cluster changes. */
export function generationDotOpacity(seed, x, y, elapsedMs = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return 0
  const upper = ellipse(x, y, 0.7, 0.19, 0.3, 0.3)
  const lower = ellipse(x, y, 0.5, 0.67, 0.23, 0.25)
  if (!upper && !lower) return 0
  const time = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0) / 1800
  const phase = (((seed >>> 0) % 10007) / 10007) * Math.PI * 2
  // A quiet handoff between the two local clusters makes several seconds of
  // motion readable without moving dot positions or pulsing the entire card.
  const handoff = Math.sin(time * 1.2 + phase) * 0.22
  const envelope = Math.max(upper * 0.82 * (1 + handoff), lower * (1 - handoff))
  const band = (Math.sin(time + x * 3.2 - y * 4.6 + phase) + 1) / 2
  const detail = variation(seed, x * 7, y * 7)
  return Math.min(0.612, envelope * (0.36 + 0.252 * (band * 0.72 + detail * 0.28)))
}
