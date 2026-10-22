// Group color is a presentation token, never an arbitrary CSS declaration.
export const DEFAULT_GROUP_COLOR = '#b8b8b8'
export const DEFAULT_GROUP_PADDING = Object.freeze({ top: 80, right: 80, bottom: 80, left: 80 })
export const MIN_GROUP_PADDING = 16
export const MAX_GROUP_PADDING = 100000

export function isGroupPadding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  const fields = Object.getOwnPropertyDescriptors(value)
  if (Object.getOwnPropertySymbols(value).length || Object.keys(fields).length !== 4) return false
  return Object.keys(DEFAULT_GROUP_PADDING).every((key) => {
    const descriptor = fields[key]
    const number = descriptor?.value
    return (
      descriptor &&
      !descriptor.get &&
      !descriptor.set &&
      typeof number === 'number' &&
      Number.isFinite(number) &&
      number >= MIN_GROUP_PADDING &&
      number <= MAX_GROUP_PADDING
    )
  })
}

export function normalizedGroupPadding(value) {
  const source = isGroupPadding(value) ? value : DEFAULT_GROUP_PADDING
  return Object.fromEntries(Object.keys(DEFAULT_GROUP_PADDING).map((key) => [key, source[key]]))
}

export function isGroupColor(value) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
}

export function normalizedGroupColor(value) {
  return isGroupColor(value) ? value.toLowerCase() : DEFAULT_GROUP_COLOR
}
