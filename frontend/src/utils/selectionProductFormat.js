const FORMAT_VERSION = 'YOUMI_PRODUCT_V1'

function clone(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    return fallback
  }
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function arrayValue(value) {
  return Array.isArray(value) ? value : []
}

function firstText(...values) {
  return values.map((value) => String(value ?? '').trim()).find(Boolean) || ''
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value) && value.length) || []
}

function firstObject(...values) {
  return (
    values.find(
      (value) =>
        value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length,
    ) || {}
  )
}

export function uniqueUrls(values) {
  return [
    ...new Set(
      arrayValue(values)
        .map((value) => (typeof value === 'string' ? value : value?.url))
        .map((value) => String(value || '').trim())
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  ]
}

export function videoUrls(values) {
  return uniqueUrls(values)
}

function normalizeSkuGroups(values) {
  return arrayValue(values)
    .map((group, groupIndex) => {
      const source = objectValue(group)
      const propertyId = firstText(source.propertyId, source.propId, `custom_${groupIndex + 1}`)
      const name = firstText(source.name, source.text, source.propertyName)
      const normalizedValues = arrayValue(source.values || source.items)
        .map((value, valueIndex) => {
          const item = objectValue(value)
          const itemName = firstText(item.name, item.text, item.valueName)
          if (!itemName) return null
          return {
            ...clone(item, {}),
            valueId: firstText(
              item.valueId,
              item.vid,
              item.value,
              `${propertyId}_${valueIndex + 1}`,
            ),
            name: itemName,
            imageUrl: firstText(item.imageUrl, item.img, item.image),
          }
        })
        .filter(Boolean)
      if (!name || !normalizedValues.length) return null
      return { ...clone(source, {}), propertyId, name, values: normalizedValues }
    })
    .filter(Boolean)
}

function skuProperties(row) {
  return arrayValue(row?.properties)
    .map((property) => {
      const item = objectValue(property)
      const name = firstText(item.name, item.text, item.valueName)
      if (!name) return null
      return {
        ...clone(item, {}),
        propertyId: firstText(item.propertyId, item.propId),
        propertyName: firstText(item.propertyName, item.groupName),
        valueId: firstText(item.valueId, item.vid, item.value),
        name,
        imageUrl: firstText(item.imageUrl, item.img, item.image),
      }
    })
    .filter(Boolean)
}

function propertyPath(properties) {
  return properties
    .map((item) => `${item.propertyId || item.propertyName}:${item.valueId || item.name}`)
    .join(';')
}

function normalizeSkus(values) {
  return arrayValue(values).map((row, index) => {
    const source = objectValue(row)
    const properties = skuProperties(source)
    const imageUrl = firstText(
      source.imageUrl,
      arrayValue(source.skuPicture)[0]?.url,
      properties.find((item) => item.imageUrl)?.imageUrl,
    )
    const quantityText = String(source.quantity ?? source.stock ?? '').trim()
    const quantity =
      quantityText !== '' && Number.isFinite(Number(quantityText))
        ? Math.max(0, Math.trunc(Number(quantityText)))
        : null
    return {
      ...clone(source, {}),
      skuId: firstText(source.skuId, source.id, `custom_sku_${index + 1}`),
      name: firstText(
        source.name,
        properties.map((item) => item.name).join(' / '),
        `规格 ${index + 1}`,
      ),
      propPath: firstText(source.propPath, propertyPath(properties)),
      properties,
      price: firstText(source.price, source.salePrice),
      originalPrice: firstText(source.originalPrice, source.marketPrice),
      quantity,
      imageUrl,
      skuPicture: imageUrl ? [{ url: imageUrl, pix: '' }] : [],
    }
  })
}

export function normalizeSelectionProduct(product) {
  const data = objectValue(product?.productData)
  const source = objectValue(data.source)
  const category = objectValue(data.category)
  const pricing = objectValue(data.pricing)
  const inventory = objectValue(data.inventory)
  const media = objectValue(data.media)
  const mainImagesGroup = objectValue(data.mainImagesGroup)
  const sourcePlatform = firstText(
    product?.sourcePlatform,
    source.platform,
    data.sourcePlatform,
    'LOCAL',
  )
  const sourceProductId = firstText(
    product?.sourceProductId,
    source.productId,
    data.sourceProductId,
  )
  const sourceUrl = firstText(product?.sourceUrl, source.url, data.sourceUrl)
  const title = firstText(product?.title, data.title)
  const coverImageUrl = firstText(product?.coverImageUrl, data.coverImageUrl)
  const mainImages = uniqueUrls(
    firstArray(
      media.mainImages,
      mainImagesGroup.images,
      data.images,
      coverImageUrl ? [coverImageUrl] : [],
    ),
  )
  const attributes = firstObject(data.attributes, data.parameters)
  return {
    originalData: clone(data, {}),
    sourcePlatform,
    sourceProductId,
    sourceUrl,
    title,
    coverImageUrl: coverImageUrl || mainImages[0] || '',
    category: {
      id: firstText(category.id, data.categoryId),
      name: firstText(category.name, data.categoryName),
      path: firstText(category.path, data.categoryPath),
    },
    price: firstText(pricing.salePrice, pricing.price, data.price),
    originalPrice: firstText(pricing.originalPrice, data.originalPrice),
    defaultStock: Math.max(0, Number(inventory.defaultStock ?? data.defaultStock ?? 0) || 0),
    attributes: Object.entries(attributes).map(([name, value]) => ({
      name,
      value: String(value ?? ''),
    })),
    mainImages,
    portraitImages: uniqueUrls(firstArray(media.portraitImages, data.threeToFourImages)),
    detailImages: uniqueUrls(firstArray(media.detailImages, data.detailImages)),
    mainVideoUrls: videoUrls(firstArray(media.mainVideos, data.mainVideos, data.videos)).join('\n'),
    detailVideoUrls: videoUrls(firstArray(media.detailVideos, data.detailVideos)).join('\n'),
    skuGroups: normalizeSkuGroups(firstArray(data.skuGroups, data.saleProperties, data.specList)),
    skus: normalizeSkus(firstArray(data.skus, data.sku, data.skuList)),
    description: firstText(data.description),
  }
}

export function buildSelectionSkuMatrix(groupsValue, existingValue, defaults = {}) {
  const groups = normalizeSkuGroups(groupsValue)
  if (!groups.length) return []
  const total = groups.reduce((count, group) => count * group.values.length, 1)
  if (!Number.isSafeInteger(total) || total > 5000) {
    throw new Error(`当前规格会生成 ${total} 个 SKU，单个商品最多支持 5000 个组合`)
  }
  const existing = normalizeSkus(existingValue)
  const existingByPath = new Map(existing.map((row) => [row.propPath, row]))
  let combinations = [[]]
  groups.forEach((group) => {
    combinations = combinations.flatMap((properties) =>
      group.values.map((value) => [
        ...properties,
        {
          propertyId: group.propertyId,
          propertyName: group.name,
          valueId: value.valueId,
          name: value.name,
          imageUrl: value.imageUrl || '',
        },
      ]),
    )
  })
  return combinations.map((properties, index) => {
    const propPath = propertyPath(properties)
    const current = existingByPath.get(propPath) || {}
    const imageUrl = firstText(current.imageUrl, properties.find((item) => item.imageUrl)?.imageUrl)
    return {
      ...current,
      skuId: firstText(current.skuId, `custom_sku_${index + 1}`),
      name: properties.map((item) => item.name).join(' / '),
      propPath,
      properties,
      price: firstText(current.price, defaults.price),
      originalPrice: firstText(current.originalPrice, defaults.originalPrice),
      quantity:
        current.quantity === null || current.quantity === undefined
          ? Math.max(0, Math.trunc(Number(defaults.defaultStock) || 0))
          : Math.max(0, Math.trunc(Number(current.quantity) || 0)),
      imageUrl,
      skuPicture: imageUrl ? [{ url: imageUrl, pix: '' }] : [],
    }
  })
}

export function serializeSelectionProduct(form) {
  const current = objectValue(form.originalData)
  const attributes = Object.fromEntries(
    form.attributes
      .map((item) => [String(item.name || '').trim(), String(item.value || '').trim()])
      .filter(([name]) => name),
  )
  const mainImages = uniqueUrls(form.mainImages)
  const portraitImages = uniqueUrls(form.portraitImages)
  const detailImages = uniqueUrls(form.detailImages)
  const mainVideos = videoUrls(String(form.mainVideoUrls || '').split(/\r?\n/)).map((url) => ({
    url,
  }))
  const detailVideos = videoUrls(String(form.detailVideoUrls || '').split(/\r?\n/)).map((url) => ({
    url,
  }))
  const skuGroups = clone(form.skuGroups, [])
  const skus = clone(form.skus, [])
  const skuImages = uniqueUrls(
    skuGroups.flatMap((group) => group.values?.map((value) => value.imageUrl) || []),
  )
  const category = {
    ...objectValue(current.category),
    id: String(form.category.id || '').trim(),
    name: String(form.category.name || '').trim(),
    path: String(form.category.path || '').trim(),
  }
  const productData = {
    ...clone(current, {}),
    formatVersion: FORMAT_VERSION,
    title: String(form.title || '').trim(),
    source: {
      ...objectValue(current.source),
      platform: form.sourcePlatform,
      productId: form.sourceProductId,
      url: String(form.sourceUrl || '').trim(),
    },
    category,
    pricing: {
      ...objectValue(current.pricing),
      salePrice: String(form.price || '').trim(),
      originalPrice: String(form.originalPrice || '').trim(),
      currency: 'CNY',
    },
    inventory: {
      ...objectValue(current.inventory),
      defaultStock: Math.max(0, Math.trunc(Number(form.defaultStock) || 0)),
    },
    media: {
      mainImages,
      portraitImages,
      skuImages,
      detailImages,
      mainVideos,
      detailVideos,
    },
    attributes,
    skuGroups,
    skus,
    description: String(form.description || '').trim(),
    sourcePlatform: form.sourcePlatform,
    sourceProductId: form.sourceProductId,
    sourceUrl: String(form.sourceUrl || '').trim(),
    coverImageUrl: mainImages[0] || form.coverImageUrl || '',
    price: String(form.price || '').trim(),
    originalPrice: String(form.originalPrice || '').trim(),
    defaultStock: Math.max(0, Math.trunc(Number(form.defaultStock) || 0)),
    categoryId: category.id,
    categoryName: category.name,
    categoryPath: category.path,
    images: mainImages,
    mainImagesGroup: { ...objectValue(current.mainImagesGroup), images: mainImages },
    threeToFourImages: portraitImages,
    skuImages,
    detailImages,
    mainVideos,
    videos: mainVideos,
    detailVideos,
    parameters: attributes,
    saleProperties: skuGroups,
    specList: skuGroups,
    sku: skus,
    skuList: skus,
  }
  return {
    title: productData.title,
    sourceUrl: productData.sourceUrl || null,
    coverImageUrl: productData.coverImageUrl || null,
    productData,
    hasAiEdit: true,
  }
}
