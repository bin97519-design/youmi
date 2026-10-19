const imageId = (image) => String(image?.layerId || image?.id || image?.url || '')

export function directorReferenceImages(intent, attachments = [], excludedIds = [], roles = {}) {
  const excluded = new Set(excludedIds)
  const images = new Map()
  for (const image of [
    ...(intent?.referenceAssets || []),
    ...(intent?.attachments || []),
    ...attachments,
  ]) {
    if (image?.kind !== 'image' || !imageId(image) || excluded.has(imageId(image))) continue
    images.set(imageId(image), {
      ...image,
      referenceRole: roles[imageId(image)] ?? image.referenceRole ?? '',
    })
  }
  return [...images.values()]
}

/** Source choice changes image references only; it cannot change model, size, cost or approval. */
export function directorApplyImageSourceIntent(intent, mode, images = []) {
  if (!['reference', 'text'].includes(mode)) return intent
  const previousImages = [...(intent.referenceAssets || []), ...(intent.attachments || [])].filter(
    (asset) => asset.kind === 'image',
  )
  const previousIds = new Set(previousImages.map(imageId))
  const references =
    mode === 'reference'
      ? [
          ...new Map(
            images
              .filter(
                (image) =>
                  image?.kind === 'image' &&
                  image.url &&
                  (!image.status || image.status === 'ready'),
              )
              .map((image) => [
                imageId(image),
                {
                  ...image,
                  id: image.id || imageId(image),
                  layerId: image.layerId || image.id || imageId(image),
                },
              ]),
          ).values(),
        ]
      : []
  const attachments = (intent.attachments || []).filter((asset) => asset.kind !== 'image')
  const freeze = (items) => Object.freeze(items.map((item) => Object.freeze({ ...item })))
  return Object.freeze({
    ...intent,
    imageSourceMode: mode,
    referenceAssets: freeze(references),
    attachments: freeze([
      ...attachments,
      ...references.filter((image) => image.source !== 'canvas'),
    ]),
    referenceLayerIds: Object.freeze([
      ...new Set([
        ...(intent.referenceLayerIds || []).filter((id) => !previousIds.has(id)),
        ...references.map(imageId),
      ]),
    ]),
    selectedLayerIds: Object.freeze(
      (intent.selectedLayerIds || []).filter(
        (id) => !previousIds.has(id) || references.some((image) => imageId(image) === id),
      ),
    ),
  })
}
