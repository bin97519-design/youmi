import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createCopier, buildCopy } from '../src/utils/selectionProductCopy.js'

const page = fs.readFileSync(new URL('../src/pages/SelectionPoolPage.vue', import.meta.url), 'utf8')
const handler = page.slice(
  page.indexOf('async function copyProduct('),
  page.indexOf('async function saveProductEdits('),
)
const original = {
  id: 8,
  sourcePlatform: 'TMALL',
  sourceProductId: 'origin',
  title: '保持商品标题',
  sourceUrl: 'https://test/item',
  coverImageUrl: 'https://test/main',
  qualityScore: 100,
  productData: {
    skuGroups: [{ name: '颜色', values: ['白色', '黑色'] }],
    skus: [
      { skuId: '1', quantity: 0, price: 15 },
      { skuId: '2', quantity: 10, price: 20 },
    ],
    media: { mainImages: ['https://test/main'], detailImages: ['https://test/detail'] },
    attributes: { 面料: '棉' },
  },
  tags: [{ id: 7 }],
}

test('frontend copy payload keeps all SKU/media/attributes and separates the new identity', () => {
  const before = structuredClone(original)
  const copy = buildCopy(original, 'frontend-copy-test-batch')
  assert.deepEqual(original, before)
  assert.deepEqual(copy.payload.productData.skus, original.productData.skus)
  assert.deepEqual(copy.payload.productData.media, original.productData.media)
  assert.deepEqual(copy.payload.productData.attributes, original.productData.attributes)
  assert.notEqual(copy.payload.sourceProductId, original.sourceProductId)
})

function fixture() {
  const store = new Map(),
    events = [],
    messages = []
  const context = {
    copyingProductId: { value: null },
    deletingProductIds: { value: [] },
    selectedIds: { value: new Set([8]) },
    page: { value: 3 },
    filters: {
      keyword: 'old',
      platform: 'TMALL',
      collectStatus: 'COLLECTED',
      publishStatus: 'PUBLISHED',
      tagId: '7',
    },
    showToast: (...args) => messages.push(args),
    loadData: async () => events.push('refresh'),
    productCopier: createCopier({
      getScope: () => 'frontend-user-1',
      uuid: () => 'frontend-copy-test-batch',
      readPending: (key) => store.get(key),
      writePending: (key, value) => store.set(key, structuredClone(value)),
      removePending: (key) => store.delete(key),
      fetchProduct: async (id) => {
        events.push(['get', id])
        return structuredClone(original)
      },
      createProduct: async (body) => {
        events.push(['create', body])
        return { ...body, id: 20 }
      },
      assignTags: async (id, tags) => events.push(['tags', id, tags]),
    }),
  }
  vm.createContext(context)
  vm.runInContext(handler, context)
  return { context, events, messages, store }
}

test('actual Vue copy handler creates one full child, refreshes in place, selects only the copy', async () => {
  const f = fixture()
  await f.context.copyProduct({ id: 8 })
  assert.deepEqual(
    f.events.map((e) => (Array.isArray(e) ? e[0] : e)),
    ['get', 'create', 'tags', 'refresh'],
  )
  assert.deepEqual([...f.context.selectedIds.value], [20])
  assert.equal(f.context.page.value, 1)
  assert.equal(f.context.filters.publishStatus, '')
  assert.equal(f.context.copyingProductId.value, null)
  assert.match(f.messages[0][0], /已复制商品/)
  assert.equal(f.store.size, 0)
})

test('Vue list copy error does not claim success and always releases the row button', async () => {
  const f = fixture()
  f.context.productCopier = {
    copy: async () => {
      throw Error('quota error')
    },
  }
  await f.context.copyProduct({ id: 8 })
  assert.equal(f.events.length, 0)
  assert.equal(f.context.copyingProductId.value, null)
  assert.equal(f.messages[0][1], 'error')
  assert.match(f.messages[0][0], /重试/)
})

test('Vue list ignores additional copy clicks while a copy is active', async () => {
  const f = fixture()
  f.context.copyingProductId.value = 8
  await f.context.copyProduct({ id: 9 })
  assert.equal(f.events.length, 0)
})

test('Vue copy button sits beside edit, uses full-detail API, and never copies text to the clipboard', () => {
  assert.match(page, /@click\.stop="copyProduct\(product\)"/)
  assert.match(page, /:disabled="copyingProductId !== null \|\| deletingProductIds.length > 0"/)
  assert.match(page, /fetchProduct: \(id\) => fetchSelectionProduct\(userStore, id\)/)
  assert.match(page, /createProduct: \(body\) => createSelectionProduct\(userStore, body\)/)
  const actions = page.slice(page.indexOf('<div class="product-row-actions">'))
  assert.ok(actions.indexOf('copyProduct(product)') < actions.indexOf('openProduct(product)'))
  assert.doesNotMatch(handler, /clipboard|router\.|prepareMigration|openProduct\(/)
})
