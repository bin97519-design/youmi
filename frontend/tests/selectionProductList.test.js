import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const page = fs.readFileSync(new URL('../src/pages/SelectionPoolPage.vue', import.meta.url), 'utf8')
const apiSource = fs.readFileSync(
  new URL('../src/utils/selectionPoolApi.js', import.meta.url),
  'utf8',
)
const handler = (start, end) => page.slice(page.indexOf(start), page.indexOf(end))
function deferred() {
  let resolve, reject
  const promise = new Promise((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}
function listFixture() {
  const products = [],
    tags = [],
    tasks = []
  const queue = (target) => () => {
    const d = deferred()
    target.push(d)
    return d.promise
  }
  const context = {
    listLoadSequence: 0,
    userStore: {},
    filters: {},
    pageSize: 10,
    page: { value: 1 },
    selectedIds: { value: new Set() },
    products: { value: [] },
    total: { value: 0 },
    tags: { value: [] },
    migrationTasks: { value: [] },
    loading: { value: false },
    refreshing: { value: false },
    errorMessage: { value: '' },
    fetchSelectionProducts: queue(products),
    fetchSelectionTags: queue(tags),
    fetchMigrationTasks: queue(tasks),
  }
  vm.createContext(context)
  vm.runInContext(handler('async function loadData(', 'function applyFilters('), context)
  return { context, products, tags, tasks }
}

test('product table renders without waiting for slow tags or tasks', async () => {
  const app = listFixture()
  const pending = app.context.loadData()
  app.products[0].resolve({ items: [{ id: 1, listMeta: { skuCount: 495 } }], total: 1 })
  let timer
  await Promise.race([
    pending,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('List was blocked by auxiliary requests')), 200)
    }),
  ]).finally(() => clearTimeout(timer))
  assert.equal(app.context.products.value[0].id, 1)
  assert.equal(app.context.loading.value, false)
  app.tags[0].resolve([{ id: 8 }])
  app.tasks[0].resolve([{ taskId: 't1' }])
  await Promise.resolve()
  assert.equal(app.context.tags.value[0].id, 8)
  assert.equal(app.context.migrationTasks.value[0].taskId, 't1')
})

test('older list/tag/task responses never overwrite newer filters', async () => {
  const app = listFixture()
  const first = app.context.loadData()
  const second = app.context.loadData()
  app.products[1].resolve({ items: [{ id: 2 }], total: 1 })
  app.tags[1].resolve([{ id: 2 }])
  app.tasks[1].resolve([{ taskId: 'new' }])
  await second
  app.products[0].resolve({ items: [{ id: 1 }], total: 99 })
  app.tags[0].resolve([{ id: 1 }])
  app.tasks[0].resolve([{ taskId: 'old' }])
  await first
  assert.equal(app.context.products.value[0].id, 2)
  assert.equal(app.context.tags.value[0].id, 2)
  assert.equal(app.context.migrationTasks.value[0].taskId, 'new')
  assert.equal(app.context.total.value, 1)
})

test('list summary keeps counts, category, cover and split label; old responses remain compatible', () => {
  const context = vm.createContext({})
  vm.runInContext(handler('function unwrapProductData(', 'function platformName('), context)
  const summary = {
    id: 1,
    sourceProductId: 'split_test',
    coverImageUrl: 'https://img.test/main',
    listMeta: {
      skuGroupCount: 2,
      skuCount: 495,
      categoryName: '床垫',
      skuSplit: { part: 1, groupName: '尺寸' },
    },
  }
  assert.match(context.productMeta(summary), /床垫.*2 组规格 \/ 495 个 SKU/)
  assert.equal(context.productSplit(summary).groupName, '尺寸')
  assert.equal(context.productImages(summary)[0], summary.coverImageUrl)
  assert.match(
    context.productMeta({ productData: { skus: [{}, {}], skuGroups: [{}] } }),
    /1 组规格 \/ 2 个 SKU/,
  )
})

function detailFixture(fetch) {
  const messages = []
  const context = {
    detailLoadSequence: 0,
    deletingProductIds: { value: [] },
    detailProduct: { value: null },
    detailLoading: { value: false },
    detailSaving: { value: false },
    splitError: { value: '' },
    userStore: {},
    fetchSelectionProduct: fetch,
    showToast: (...args) => messages.push(args),
  }
  vm.createContext(context)
  vm.runInContext(handler('async function openProduct(', 'async function copyProduct('), context)
  return { context, messages }
}

test('editing always fetches full details; failures never expose summary as an editable product', async () => {
  const summary = { id: 1, title: '床垫', listMeta: { skuCount: 495 } }
  let seen
  const app = detailFixture(async (_, id) => {
    seen = id
    return { ...summary, productData: { skus: [{}] } }
  })
  await app.context.openProduct(summary)
  assert.equal(seen, 1)
  assert.equal(app.context.detailProduct.value.productData.skus.length, 1)
  const failed = detailFixture(async () => {
    throw Error('offline')
  })
  await failed.context.openProduct(summary)
  assert.equal(failed.context.detailProduct.value, null)
  const incomplete = detailFixture(async () => summary)
  await incomplete.context.openProduct(summary)
  assert.equal(incomplete.context.detailProduct.value, null)
  assert.match(incomplete.messages[0][0], /完整商品/)
})

test('late detail response cannot reopen a closed editor or replace a different product', async () => {
  const requests = []
  const app = detailFixture(() => {
    const d = deferred()
    requests.push(d)
    return d.promise
  })
  const first = app.context.openProduct({ id: 1 })
  const second = app.context.openProduct({ id: 2 })
  requests[1].resolve({ id: 2, productData: {} })
  await second
  requests[0].resolve({ id: 1, productData: {} })
  await first
  assert.equal(app.context.detailProduct.value.id, 2)
  const third = app.context.openProduct({ id: 3 })
  app.context.detailProduct.value = null
  requests[2].resolve({ id: 3, productData: {} })
  await third
  assert.equal(app.context.detailProduct.value, null)
})

test('web list explicitly requests compact; full detail endpoint and authorization are unchanged', async () => {
  const calls = []
  const context = vm.createContext({
    URLSearchParams,
    apiPath: (value) => value,
    fetch: async (...args) => {
      calls.push(args)
      return { ok: true, json: async () => ({ data: {} }) }
    },
  })
  vm.runInContext(
    apiSource.replace(/^import .*$/m, '').replaceAll('export function ', 'function '),
    context,
  )
  const user = { authHeaders: () => ({ Authorization: 'Bearer synthetic' }) }
  await context.fetchSelectionProducts(user, { page: 2, keyword: '床垫' })
  await context.fetchSelectionProduct(user, 7)
  assert.match(calls[0][0], /compact=true/)
  assert.equal(calls[1][0], '/api/v1/selection-pool/products/7')
  assert.equal(calls[1][1].headers.Authorization, 'Bearer synthetic')
})
