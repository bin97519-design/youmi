import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(
  new URL('../src/pages/SelectionPoolPage.vue', import.meta.url),
  'utf8',
)
const slice = (start, end) => source.slice(source.indexOf(start), source.indexOf(end))
const ref = (value) => ({ value })
function fixture() {
  const requests = [],
    refreshes = [],
    messages = [],
    confirmations = []
  const context = {
    products: ref([
      { id: 1, title: '商品一' },
      { id: 2, title: '商品二' },
    ]),
    selectedIds: ref(new Set([1, 2])),
    deletingProductIds: ref([]),
    actionLoading: ref(false),
    copyingProductId: ref(null),
    detailSaving: ref(false),
    detailProduct: ref(null),
    errorMessage: ref(''),
    page: ref(1),
    pageSize: 10,
    pageJump: ref('1'),
    total: ref(21),
    userStore: {},
    window: {
      confirm: (message) => {
        confirmations.push(message)
        return true
      },
      scrollTo() {},
    },
    showToast: (...args) => messages.push(args),
    deleteSelectionProducts: async (_, ids) => {
      requests.push([...ids])
      return ids.length
    },
    loadData: async () => refreshes.push(context.page.value),
  }
  context.pageCount = {
    get value() {
      return Math.max(1, Math.ceil(context.total.value / context.pageSize))
    },
  }
  vm.createContext(context)
  vm.runInContext(slice('async function removeSelected(', 'function openManualDialog('), context)
  vm.runInContext(slice('function changePage(', 'async function openProduct('), context)
  return { context, requests, refreshes, messages, confirmations }
}

test('single delete targets only its row, retains unrelated selection and confirms soft-delete scope', async () => {
  const f = fixture()
  await f.context.removeProduct({ id: 1, title: '商品一' })
  assert.deepEqual(f.requests, [[1]])
  assert.deepEqual([...f.context.selectedIds.value], [2])
  assert.match(f.confirmations[0], /商品一.*回收站/)
  assert.match(f.confirmations[0], /不删除平台商品.*不会取消已创建的搬家任务/)
  assert.equal(f.context.actionLoading.value, false)
  assert.equal(f.context.deletingProductIds.value.length, 0)
  assert.match(f.messages[0][0], /已将 1 个商品/)
})

test('bulk delete freezes selected IDs and ignores repeat clicks while the request is running', async () => {
  const f = fixture()
  let resolve
  f.context.deleteSelectionProducts = (_, ids) => {
    f.requests.push([...ids])
    return new Promise((done) => {
      resolve = done
    })
  }
  const pending = f.context.removeSelected()
  f.context.selectedIds.value.add(3)
  await f.context.removeSelected()
  await f.context.removeProduct({ id: 2 })
  assert.deepEqual(f.requests, [[1, 2]])
  resolve(2)
  await pending
  assert.deepEqual([...f.context.selectedIds.value], [3])
})

test('cancel, invalid IDs, oversized selection, copy-in-flight and stale row never delete', async () => {
  const f = fixture()
  f.context.window.confirm = () => false
  await f.context.removeSelected()
  f.context.window.confirm = () => true
  await f.context.removeProducts([0, -1, '1', null])
  await f.context.removeProducts(Array.from({ length: 201 }, (_, i) => i + 1))
  await f.context.removeProduct({ id: 999 })
  f.context.copyingProductId.value = 1
  await f.context.removeSelected()
  assert.equal(f.requests.length, 0)
  assert.deepEqual([...f.context.selectedIds.value], [1, 2])
})

test('request failure keeps selection and releases buttons; refresh failure cannot report delete failure', async () => {
  const f = fixture()
  f.context.deleteSelectionProducts = async () => {
    throw Error('服务器拒绝删除')
  }
  await f.context.removeSelected()
  assert.deepEqual([...f.context.selectedIds.value], [1, 2])
  assert.equal(f.context.products.value.length, 2)
  assert.equal(f.context.actionLoading.value, false)
  assert.match(f.messages.at(-1)[0], /服务器拒绝删除/)
  const g = fixture()
  g.context.loadData = async () => {
    g.context.errorMessage.value = 'offline'
  }
  await g.context.removeSelected()
  assert.equal(g.requests.length, 1)
  assert.match(g.messages.at(-1)[0], /已将 2 个商品.*列表刷新失败/)
  assert.doesNotMatch(g.messages.at(-1)[0], /删除失败/)
})

test('deleting last page returns to the last available 10-item page; empty list stays on page 1', async () => {
  for (const [total, expected] of [
    [20, 2],
    [0, 1],
  ]) {
    const f = fixture()
    f.context.page.value = 3
    f.context.loadData = async () => {
      f.refreshes.push(f.context.page.value)
      f.context.total.value = total
    }
    await f.context.removeSelected()
    assert.deepEqual(f.refreshes, [3, expected])
    assert.equal(f.context.page.value, expected)
  }
})

test('pagination is 10 per page and accepts input jump only to valid integer pages', () => {
  const f = fixture()
  assert.match(source, /const pageSize = 10\b/)
  assert.equal(f.context.pageCount.value, 3)
  f.context.pageJump.value = ' 3 '
  f.context.jumpToPage()
  assert.equal(f.context.page.value, 3)
  assert.equal(f.context.pageJump.value, '3')
  assert.deepEqual(f.refreshes, [3])
  for (const value of ['', '0', '-1', '4', '1.5', '1e0', 'abc', '9007199254740992']) {
    f.context.pageJump.value = value
    f.context.jumpToPage()
  }
  assert.equal(f.messages.length, 8)
  assert.deepEqual(f.refreshes, [3])
  f.context.deletingProductIds.value = [1]
  f.context.changePage(2)
  f.context.pageJump.value = '1'
  f.context.jumpToPage()
  assert.equal(f.context.page.value, 3)
})

test('pagination boundaries and both top/bottom jump forms are wired', () => {
  const f = fixture()
  for (const [total, expected] of [
    [0, 1],
    [10, 1],
    [11, 2],
    [20, 2],
    [21, 3],
  ]) {
    f.context.total.value = total
    assert.equal(f.context.pageCount.value, expected)
  }
  f.context.changePage(0)
  f.context.changePage(1.5)
  f.context.changePage(4)
  assert.equal(f.refreshes.length, 0)
  assert.equal((source.match(/@submit\.prevent="jumpToPage"/g) || []).length, 2)
  assert.equal((source.match(/v-model="pageJump"/g) || []).length, 2)
  assert.match(source, /商品列表顶部分页/)
  assert.match(source, /商品列表底部分页/)
  assert.match(source, /@click\.stop="removeProduct\(product\)"/)
  assert.match(source, /@click="removeSelected"/)
})
