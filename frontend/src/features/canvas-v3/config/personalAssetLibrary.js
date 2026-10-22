export const PERSONAL_ASSET_LIBRARIES = Object.freeze({
  product: Object.freeze({
    kind: 'product',
    label: '我的商品库',
    title: '我的商品库',
    singular: '商品',
    uploadLabel: '上传商品图',
    importTitle: '导入商品',
    importHint: '上传清晰的商品图片，填写商品名称，可补充材质、尺寸和卖点。',
    emptyTitle: '还没有商品素材',
    emptyDescription: '导入商品图后，可在不同画布中复用商品参考素材。',
  }),
  scene: Object.freeze({
    kind: 'scene',
    label: '我的场景库',
    title: '我的场景库',
    singular: '场景',
    uploadLabel: '上传场景图',
    importTitle: '导入场景',
    importHint: '上传房间、布景或空间参考图片，填写场景名称，可补充风格和用途。',
    emptyTitle: '还没有场景素材',
    emptyDescription: '导入场景图后，可在不同画布中复用空间与氛围参考。',
  }),
})

export const PRODUCT_ASSET_CATEGORIES = Object.freeze([
  '窗帘',
  '床垫',
  '实木床',
  '儿童床',
  '床品',
  '其他',
])

// Unclassified is a display filter, not a stored or inferred product category.
export const PRODUCT_ASSET_CATEGORY_FILTERS = Object.freeze([...PRODUCT_ASSET_CATEGORIES, '未分类'])

/** Missing or unknown discriminators remain legacy model records, never opt in. */
export function personalAssetKind(record) {
  const config = record?.config
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    !Object.hasOwn(config, 'libraryKind')
  )
    return 'model'
  return config.libraryKind === 'product' ||
    config.libraryKind === 'scene' ||
    config.libraryKind === 'asset'
    ? config.libraryKind
    : 'model'
}

/** Only explicit, recognized metadata categorizes products; legacy values stay untouched. */
export function personalProductCategory(record) {
  if (personalAssetKind(record) !== 'product' || !Object.hasOwn(record.config, 'productCategory'))
    return ''
  const category = record.config.productCategory
  return typeof category === 'string' && PRODUCT_ASSET_CATEGORIES.includes(category) ? category : ''
}

export function personalAssetLibrary(kind) {
  if (typeof kind !== 'string' || !Object.hasOwn(PERSONAL_ASSET_LIBRARIES, kind)) {
    throw new Error('请选择商品库或场景库')
  }
  return PERSONAL_ASSET_LIBRARIES[kind]
}

/** References to already uploaded images only; no ephemeral or credentialed URLs. */
export function personalAssetImageUrl(value) {
  if (typeof value !== 'string') return ''
  const candidate = value.trim()
  if (
    !candidate ||
    candidate.length > 4096 ||
    !/^https?:\/\//i.test(candidate) ||
    /[\s\\]/.test(candidate) ||
    [...candidate].some(
      (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
    )
  )
    return ''
  try {
    const url = new URL(candidate)
    return ['https:', 'http:'].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? candidate
      : ''
  } catch {
    return ''
  }
}
