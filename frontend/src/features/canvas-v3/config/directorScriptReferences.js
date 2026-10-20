import { directorApplyImageSourceIntent } from './directorImageSources.js'

const REFERENCE_LIMIT = 8
const SOURCE_MODES = new Set(['unconfirmed', 'current', 'history', 'upload', 'text'])
const assetId = (asset) => String(asset?.layerId || asset?.id || '').trim()

// Persisted upload URLs must be usable image resources, never executable URL schemes.
function safeImageUrl(value) {
  const url = String(value || '').trim()
  if (
    !url ||
    [...url].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
  )
    return ''
  if (/^https?:\/\/[^\s]+$/i.test(url)) return url
  // Object URLs are local previews, not durable files the server/model can read.
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$/i.test(url)) return url
  // Support same-origin uploads while rejecting protocol-relative and backslash URLs.
  if (/^\/(?!\/)[^\s\\]+$/.test(url)) return url
  return ''
}

function readyImage(asset) {
  return (
    asset?.kind === 'image' &&
    (!asset.status || asset.status === 'ready') &&
    Boolean(safeImageUrl(asset.url))
  )
}

function fallbackId(url) {
  let hash = 2166136261
  for (let index = 0; index < url.length; index += 1)
    hash = Math.imul(hash ^ url.charCodeAt(index), 16777619)
  return `script-reference-${(hash >>> 0).toString(36)}`
}

/**
 * Runs are chronological. Only the newest eligible user-provided reference group is offered;
 * it remains a candidate catalog, not permission to use any historical image.
 */
export function directorScriptReferenceCandidates(runs, excludedRunId = '') {
  const history = Array.isArray(runs) ? runs : []
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const run = history[index]
    if (!run || (excludedRunId && String(run.id) === String(excludedRunId))) continue
    const intent = run.generationIntent || {}
    if (intent.imageSourceMode === 'text' || intent.scriptSourceMode === 'text') continue
    const snapshots = [...(intent.referenceAssets || []), ...(intent.attachments || [])]
    const hasImageSnapshots = snapshots.some((asset) => asset?.kind === 'image')
    const assets = hasImageSnapshots
      ? snapshots
      : (run.message?.parts || []).filter((part) => part?.type === 'attachment')
    const ids = new Set()
    const urls = new Set()
    const candidates = []
    for (const asset of assets) {
      if (
        !readyImage(asset) ||
        !['upload', 'library'].includes(asset.source) ||
        (asset.referenceRole && asset.referenceRole !== 'product')
      )
        continue
      const url = safeImageUrl(asset.url)
      const id = assetId(asset) || fallbackId(url)
      if (ids.has(id) || urls.has(url)) continue
      ids.add(id)
      urls.add(url)
      candidates.push(
        Object.freeze({
          id,
          layerId: String(asset.layerId || id),
          name: String(asset.name || '商品参考图'),
          kind: 'image',
          url,
          source: 'library',
          referenceRole: asset.referenceRole || '',
          originRunId: String(run.id || ''),
        }),
      )
      if (candidates.length >= REFERENCE_LIMIT) break
    }
    if (candidates.length) return Object.freeze(candidates)
  }
  return Object.freeze([])
}

/** The model receives candidate names and IDs, never their unconfirmed image URLs. */
export function directorScriptBrief(intent = {}, candidates = []) {
  const actualImages = [...(intent.referenceAssets || []), ...(intent.attachments || [])]
  const sourceMode = SOURCE_MODES.has(intent.scriptSourceMode)
    ? intent.scriptSourceMode
    : actualImages.some(readyImage)
      ? 'current'
      : 'unconfirmed'
  const referenceCandidates =
    sourceMode === 'text'
      ? []
      : candidates.slice(0, REFERENCE_LIMIT).map((candidate) => ({
          id: String(candidate.id || ''),
          name: String(candidate.name || '商品参考图'),
          referenceRole: candidate.referenceRole === 'product' ? 'product' : '',
        }))
  return { sourceMode, referenceCandidates }
}

/** A source choice only replaces image snapshots; paid parameters and approval stay frozen. */
export function directorApplyScriptSourceIntent(intent, mode, images = []) {
  if (!['history', 'upload', 'text'].includes(mode)) return intent
  const next = directorApplyImageSourceIntent(
    intent,
    mode === 'text' ? 'text' : 'reference',
    images.filter(readyImage).map((image) => ({ ...image, url: safeImageUrl(image.url) })),
  )
  return Object.freeze({ ...next, scriptSourceMode: mode })
}
