import { serializeSelectionProduct } from './selectionProductFormat.js'

const copy = (value) => JSON.parse(JSON.stringify(value))
const string = (value) => String(value ?? '').trim()

// Match identities, never substrings (e.g. 800mm must not match 1800mm).
function valueIndex(row, group) {
  const properties = (row.properties || []).filter((property) =>
    string(property.propertyId)
      ? string(property.propertyId) === string(group.propertyId)
      : string(property.propertyName) === string(group.name),
  )
  if (properties.length > 1) throw new Error('SKU 规格属性重复，无法安全拆分')
  let id = '',
    name = ''
  if (properties.length === 1) {
    id = string(properties[0].valueId)
    name = string(properties[0].name)
  } else {
    const paths = string(row.propPath)
      .split(';')
      .filter(Boolean)
      .map((part) => {
        const colon = part.indexOf(':')
        return [part.slice(0, colon), part.slice(colon + 1)]
      })
      .filter(([key]) => key === string(group.propertyId))
    if (paths.length !== 1)
      throw new Error(`SKU「${row.name || row.skuId}」缺少唯一的${group.name}对应关系`)
    id = paths[0][1]
  }
  const matches = group.values
    .map((value, index) => ({ value, index }))
    .filter(({ value }) => (id ? string(value.valueId) === id : string(value.name) === name))
  if (matches.length !== 1)
    throw new Error(`SKU「${row.name || row.skuId}」与${group.name}规格值不一致，请先检查规格`)
  return matches[0].index
}

export function previewSelectionSkuSplit(form, groupIndex, firstCount) {
  const groups = form.skuGroups || [],
    rows = form.skus || []
  const group = groups[groupIndex]
  if (!group || !Number.isInteger(Number(groupIndex))) throw new Error('请选择拆分规格')
  if (!Number.isInteger(Number(firstCount)) || firstCount < 1 || firstCount >= group.values.length)
    throw new Error('两份都必须至少保留一个规格值')
  if (!rows.length) throw new Error('尚无 SKU 数据，不能拆分')
  if (new Set(groups.map((item) => string(item.propertyId))).size !== groups.length)
    throw new Error('规格组 ID 重复，请先检查规格')
  for (const item of groups) {
    if (
      !string(item.propertyId) ||
      !string(item.name) ||
      !item.values?.length ||
      item.values.some((value) => !string(value.valueId) || !string(value.name)) ||
      new Set(item.values.map((value) => string(value.valueId))).size !== item.values.length
    )
      throw new Error('规格值缺失或 ID 重复，请先填写完整规格')
  }
  const indexes = [[], []],
    combinations = new Set()
  rows.forEach((row, index) => {
    const values = groups.map((item) => valueIndex(row, item))
    const key = values.join(':')
    if (combinations.has(key)) throw new Error('存在重复 SKU 组合，请先检查规格')
    combinations.add(key)
    indexes[values[groupIndex] < Number(firstCount) ? 0 : 1].push(index)
  })
  if (indexes.some((part) => !part.length)) throw new Error('拆分后存在没有 SKU 的商品，请调整分界')
  return indexes.map((rowIndexes, index) => ({
    rowIndexes,
    skuCount: rowIndexes.length,
    values:
      index === 0
        ? group.values.slice(0, Number(firstCount))
        : group.values.slice(Number(firstCount)),
    groupName: group.name,
  }))
}

export function buildSelectionSkuSplit(form, product, groupIndex, firstCount, batchId) {
  if (!product?.id || !/^[a-zA-Z0-9-]{16,64}$/.test(batchId || ''))
    throw new Error('拆分批次标识无效')
  if (!string(form.title)) throw new Error('请先填写商品标题')
  const preview = previewSelectionSkuSplit(form, groupIndex, firstCount)
  const base = serializeSelectionProduct(form)
  base.productData.media = { ...copy(form.originalData?.media || {}), ...base.productData.media }
  return preview.map((part, index) => {
    const data = copy(base.productData)
    const groups = copy(data.skuGroups)
    groups[groupIndex].values = copy(part.values)
    const rows = part.rowIndexes.map((rowIndex) => copy(data.skus[rowIndex]))
    for (const key of ['skuGroups', 'saleProperties', 'specList']) data[key] = copy(groups)
    for (const key of ['skus', 'sku', 'skuList']) data[key] = copy(rows)
    const images = [
      ...new Set(
        [
          ...groups.flatMap((group) => group.values.map((value) => value.imageUrl)),
          ...rows.map((row) => row.imageUrl),
        ].filter(Boolean),
      ),
    ]
    data.skuImages = images
    data.media.skuImages = copy(images)
    // Independent source keys prevent bulk-upsert from overwriting the original
    // or the sibling. The original URL/identity remains available for provenance.
    const sourceProductId = `split_${batchId}_${index + 1}`
    data.sourceProductId = sourceProductId
    data.source.productId = sourceProductId
    data.source.originalProductId = product.originProductId || form.sourceProductId
    data.skuSplit = {
      batchId,
      parentRowId: product.id,
      part: index + 1,
      totalParts: 2,
      groupName: part.groupName,
      propertyId: groups[groupIndex].propertyId,
      valueNames: part.values.map((value) => value.name),
      skuCount: rows.length,
    }
    return {
      sourcePlatform: form.sourcePlatform,
      sourceProductId,
      sourceUrl: base.sourceUrl,
      title: base.title,
      coverImageUrl: base.coverImageUrl,
      productData: data,
      rawSnapshot: copy(data),
      collectSource: 'MANUAL',
      collectStatus: 'COLLECTED',
      originProductRowId: product.id,
      originProductId: product.originProductId || form.sourceProductId,
    }
  })
}
