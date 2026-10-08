import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  normalizeSelectionProduct,
  buildSelectionSkuMatrix,
  serializeSelectionProduct,
} from '../src/utils/selectionProductFormat.js'
import { previewSelectionSkuSplit, buildSelectionSkuSplit } from '../src/utils/selectionSkuSplit.js'

const batch = '12345678-1234-1234-1234-123456789abc'
function fixture() {
  const groups = [
    {
      propertyId: 'size',
      name: '尺寸',
      values: Array.from({ length: 17 }, (_, i) => ({ valueId: `s${i}`, name: `尺寸${i}` })),
    },
    {
      propertyId: 'color',
      name: '颜色分类',
      values: Array.from({ length: 27 }, (_, i) => ({
        valueId: `c${i}`,
        name: `颜色${i}`,
        imageUrl: `https://img.test/${i}.jpg`,
      })),
    },
  ]
  const skus = buildSelectionSkuMatrix(groups, [], { price: '98.50', defaultStock: 10 }).map(
    (row, i) => ({ ...row, price: `${i + 1}.25`, quantity: i, barcode: `bar${i}` }),
  )
  const product = {
    id: 12,
    sourcePlatform: 'TMALL',
    sourceProductId: '12345',
    sourceUrl: 'https://detail.tmall.com/item.htm?id=12345',
    title: '里米椰棕床垫',
    productData: {
      skuGroups: groups,
      skus,
      category: { id: 'bed', name: '床垫' },
      attributes: { 材质: '棕' },
      images: ['https://img.test/main.jpg'],
      threeToFourImages: ['https://img.test/portrait.jpg'],
      detailImages: ['https://img.test/detail.jpg'],
      videos: [{ url: 'https://img.test/video.mp4' }],
      description: '原商品详情',
      logistics: { freightTemplateId: 'keep' },
      media: { customVideoData: { id: 'v1' } },
    },
  }
  return { product, form: normalizeSelectionProduct(product) }
}

test('17 sizes / 27 colors splits into 216 + 243 or 221 + 238, real rows counted', () => {
  const { form } = fixture()
  assert.deepEqual(
    previewSelectionSkuSplit(form, 0, 8).map((part) => part.skuCount),
    [216, 243],
  )
  assert.deepEqual(
    previewSelectionSkuSplit(form, 1, 13).map((part) => part.skuCount),
    [221, 238],
  )
})

test('children preserve all SKU data and non-SKU contents; source is unchanged', () => {
  const { form, product } = fixture(),
    before = JSON.stringify({ form, product })
  const children = buildSelectionSkuSplit(form, product, 0, 8, batch)
  const base = serializeSelectionProduct(form).productData
  for (const child of children) {
    const data = child.productData
    assert.equal(child.title, product.title)
    assert.equal(child.sourceUrl, product.sourceUrl)
    for (const key of [
      'attributes',
      'category',
      'images',
      'threeToFourImages',
      'detailImages',
      'videos',
      'description',
      'logistics',
      'pricing',
      'inventory',
    ])
      assert.deepEqual(data[key], base[key], key)
    assert.deepEqual(data.media.customVideoData, { id: 'v1' })
    assert.equal(data.skuGroups[1].values.length, 27)
    assert.deepEqual(data.sku, data.skus)
    assert.deepEqual(data.skuList, data.skus)
    assert.deepEqual(data.saleProperties, data.skuGroups)
    assert.deepEqual(data.specList, data.skuGroups)
    assert.equal(child.originProductRowId, product.id)
    assert.equal(child.originProductId, product.sourceProductId)
    assert.notEqual(child.sourceProductId, product.sourceProductId)
    assert.equal(data.source.productId, child.sourceProductId)
  }
  assert.notEqual(children[0].sourceProductId, children[1].sourceProductId)
  assert.deepEqual(
    children.flatMap((child) => child.productData.skus),
    form.skus,
  )
  assert.equal(
    new Set(children.flatMap((child) => child.productData.skus.map((row) => row.skuId))).size,
    459,
  )
  assert.equal(JSON.stringify({ form, product }), before)
})

test('color split filters only associated SKU images and does not lose zero inventory', () => {
  const { form, product } = fixture()
  const children = buildSelectionSkuSplit(form, product, 1, 13, batch)
  assert.deepEqual(
    children.map((child) => child.productData.media.skuImages.length),
    [13, 14],
  )
  assert.deepEqual(
    children.map((child) => child.productData.skuGroups[0].values.length),
    [17, 17],
  )
  assert.equal(children[0].productData.skus[0].quantity, 0)
  const union = children.flatMap((child) => child.productData.skus)
  assert.equal(union.length, form.skus.length)
  assert.equal(new Set(union.map((row) => row.propPath)).size, form.skus.length)
  for (const row of union)
    assert.deepEqual(
      row,
      form.skus.find((original) => original.propPath === row.propPath),
    )
})

test('sparse matrices partition existing rows without generating nonexistent SKUs', () => {
  const { form } = fixture()
  form.skus = form.skus.filter((_, index) => index % 3 === 0)
  const parts = previewSelectionSkuSplit(form, 0, 8)
  assert.equal(
    parts.reduce((sum, part) => sum + part.skuCount, 0),
    153,
  )
})

test('invalid boundary, empty rows, duplicate values and stale mappings fail closed', () => {
  for (const boundary of [0, 17, 1.5, NaN])
    assert.throws(() => previewSelectionSkuSplit(fixture().form, 0, boundary))
  const { form } = fixture()
  form.skus = []
  assert.throws(() => previewSelectionSkuSplit(form, 0, 8), /尚无 SKU/)
  const duplicated = fixture().form
  duplicated.skuGroups[0].values[1].valueId = 's0'
  assert.throws(() => previewSelectionSkuSplit(duplicated, 0, 8), /ID 重复/)
  const stale = fixture().form
  stale.skus[0].properties[0].valueId = 'missing'
  assert.throws(() => previewSelectionSkuSplit(stale, 0, 8), /不一致/)
  const duplicateRow = fixture().form
  duplicateRow.skus.push(duplicateRow.skus[0])
  assert.throws(() => previewSelectionSkuSplit(duplicateRow, 0, 8), /重复 SKU/)
})

test('propPath-only SKUs are mapped by exact IDs, not name substrings', () => {
  const { form } = fixture()
  form.skus.forEach((row) => {
    row.properties = []
  })
  assert.deepEqual(
    previewSelectionSkuSplit(form, 0, 8).map((part) => part.skuCount),
    [216, 243],
  )
  form.skus[0].propPath = 'size:s000;color:c0'
  assert.throws(() => previewSelectionSkuSplit(form, 0, 8), /不一致/)
})

test('same batch retry keeps keys; resplitting a child retains original provenance', () => {
  const { form, product } = fixture()
  const first = buildSelectionSkuSplit(form, product, 0, 8, batch)
  assert.deepEqual(buildSelectionSkuSplit(form, product, 0, 8, batch), first)
  const child = { ...first[0], id: 33 }
  const second = buildSelectionSkuSplit(
    normalizeSelectionProduct(child),
    child,
    0,
    4,
    batch.replace('abc', 'def'),
  )
  assert.equal(second[0].originProductRowId, 33)
  assert.equal(second[0].originProductId, '12345')
  assert.notEqual(second[0].sourceProductId, first[0].sourceProductId)
})

test('saving and handoff wiring uses transactional bulk endpoint and selects children only', () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
  assert.match(read('../src/utils/selectionPoolApi.js'), /request\('\/products\/bulk'/)
  const page = read('../src/pages/SelectionPoolPage.vue')
  const handler = page.slice(
    page.indexOf('async function splitProductEdits('),
    page.indexOf('function openTags('),
  )
  assert.match(handler, /createSelectionSplitProducts/)
  assert.match(handler, /new Set\(result.items.map\(\(item\) => item.id\)\)/)
  assert.doesNotMatch(handler, /updateSelectionProduct|deleteSelectionProducts|createMigrationTask/)
})
