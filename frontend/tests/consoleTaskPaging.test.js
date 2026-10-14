import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { parse as parseVue } from '@vue/compiler-sfc'
import {
  consoleTaskStatsUrl,
  mergeConsoleTaskStats,
  normalizeConsoleTaskStats,
} from '../src/utils/consoleTaskStats.js'

const require = createRequire(createRequire(import.meta.url).resolve('@vue/compiler-sfc'))
const { parse } = require('@babel/parser')
const source = parseVue(
  fs.readFileSync(new URL('../src/pages/ConsolePage.vue', import.meta.url), 'utf8'),
).descriptor.scriptSetup.content
const ast = parse(source, { sourceType: 'module' })
const ref = (value) => ({ value })

function context(kind = 'all', api = async () => ({ tasks: [], total: 0 })) {
  const state = vm.createContext({
    URLSearchParams,
    api,
    consoleTaskStatsUrl,
    mergeConsoleTaskStats,
    normalizeConsoleTaskStats,
    statsRequestSequence: 0,
    taskReloadSequence: 0,
    statsKind: ref(kind),
    stats: ref(null),
    taskRows: ref([]),
    taskRowsTotal: ref(0),
    taskDateFrom: ref('2026-10-01'),
    taskDateTo: ref('2026-10-13'),
    taskStatusFilter: ref('FAILED'),
    taskModelFilter: ref('shared model'),
    taskUserFilter: ref('7'),
    taskCurrentPage: ref(1),
    taskPageSize: ref(10),
    taskReloading: ref(false),
    errorText: ref(''),
  })
  state.taskTotalPages = {
    get value() {
      return Math.max(1, Math.ceil(state.taskRowsTotal.value / state.taskPageSize.value))
    },
  }
  for (const name of [
    'buildTaskQuery',
    'fetchTaskPage',
    'fetchTaskStats',
    'reloadTaskPage',
    'refreshTaskStatsSilently',
  ]) {
    const node = ast.program.body.find(
      (item) => item.type === 'FunctionDeclaration' && item.id?.name === name,
    )
    assert.ok(node, `Missing ${name}`)
    vm.runInContext(source.slice(node.start, node.end), state)
  }
  return state
}

test('all four categories send every filter and page to the server', async () => {
  for (const kind of ['all', 'image', 'video', 'enhance']) {
    const requests = []
    const state = context(kind, async (url) => {
      requests.push(url)
      return { tasks: [{ taskId: 'filtered', taskType: 'VIDEO' }], total: 650 }
    })
    await state.fetchTaskPage(56)
    const query = new URL(requests[0], 'http://localhost')
    assert.equal(query.pathname, '/api/admin/tasks')
    assert.equal(query.searchParams.get('kind'), kind)
    assert.equal(query.searchParams.get('status'), 'FAILED')
    assert.equal(query.searchParams.get('model'), 'shared model')
    assert.equal(query.searchParams.get('userId'), '7')
    assert.equal(query.searchParams.get('dateFrom'), '2026-10-01')
    assert.equal(query.searchParams.get('dateTo'), '2026-10-13')
    assert.equal(query.searchParams.get('page'), '56')
    assert.equal(state.taskRowsTotal.value, 650)
    assert.equal(state.taskRows.value[0].taskId, 'filtered')
  }
})

test('overall summary stays separate from the complete server-paged task list', async () => {
  const requests = []
  const state = context('all', async (url) => {
    requests.push(url)
    if (url.startsWith('/api/admin/tasks'))
      return {
        tasks: [
          { taskId: 'i', taskType: 'IMAGE', status: 'failed' },
          { taskId: 'v', taskType: 'VIDEO', status: 'completed', videoUrls: ['/v.mp4'] },
          { taskId: 'e', taskType: 'VIDEO_ENHANCE', status: 'completed', videoUrls: ['/e.mp4'] },
        ],
        total: 800,
      }
    return { summary: { totalTasks: 100 }, tasks: [{ taskId: 'summary-only' }] }
  })
  await state.fetchTaskStats(1)
  assert.equal(requests.length, 4)
  assert.equal(requests.filter((url) => url.startsWith('/api/admin/image-tasks')).length, 0)
  assert.equal(state.stats.value.summary.totalTasks, 300)
  assert.equal(state.taskRowsTotal.value, 800)
  assert.deepEqual(
    state.taskRows.value.map((row) => row.taskId),
    ['i', 'v', 'e'],
  )
  assert.deepEqual(state.taskRows.value[1].videoPreviewUrls, ['/v.mp4'])
})

test('a delayed old filter or category response cannot replace the latest result', async () => {
  const pending = []
  const state = context('all', (url) => new Promise((resolve) => pending.push({ url, resolve })))
  const first = state.fetchTaskPage(1)
  state.taskUserFilter.value = '8'
  state.statsKind.value = 'enhance'
  const second = state.fetchTaskPage(1)
  pending[1].resolve({ tasks: [{ taskId: 'new', taskType: 'VIDEO_ENHANCE' }], total: 1 })
  await second
  pending[0].resolve({ tasks: [{ taskId: 'old' }], total: 800 })
  await first
  assert.equal(state.taskRows.value[0].taskId, 'new')
  assert.equal(state.taskRowsTotal.value, 1)
})

test('every category renders its received page directly, without another local slice', () => {
  const paged = ast.program.body.find(
    (item) =>
      item.type === 'VariableDeclaration' && item.declarations[0]?.id?.name === 'pagedTasks',
  )
  const total = ast.program.body.find(
    (item) => item.type === 'VariableDeclaration' && item.declarations[0]?.id?.name === 'taskTotal',
  )
  const state = vm.createContext({
    taskRows: ref([{ taskId: 'page-56' }]),
    taskRowsTotal: ref(650),
    computed: (fn) => ({
      get value() {
        return fn()
      },
    }),
  })
  vm.runInContext(
    `${source.slice(paged.start, paged.end)}; ${source.slice(total.start, total.end)}; globalThis.result = { rows: pagedTasks.value, total: taskTotal.value }`,
    state,
  )
  assert.equal(state.result.rows[0].taskId, 'page-56')
  assert.equal(state.result.total, 650)
})

test('older reload errors do not clear a newer loading state or show stale errors', async () => {
  const pending = []
  const state = context(
    'all',
    () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  )
  state.stats.value = {}
  const first = state.reloadTaskPage(1)
  const second = state.reloadTaskPage(1)
  pending[0].reject(new Error('old error'))
  await first
  assert.equal(state.taskReloading.value, true)
  assert.equal(state.errorText.value, '')
  pending[1].resolve({ tasks: [], total: 0 })
  await second
  assert.equal(state.taskReloading.value, false)
})

test('refreshing a now-empty last page moves to the last remaining page', async () => {
  const requests = []
  const state = context('video', async (url) => {
    requests.push(url)
    return { tasks: [{ taskId: 'remaining', taskType: 'VIDEO' }], total: 11 }
  })
  state.taskCurrentPage.value = 3
  await state.fetchTaskPage(3)
  assert.equal(requests.length, 2)
  assert.equal(new URL(requests[1], 'http://localhost').searchParams.get('page'), '2')
  assert.equal(state.taskCurrentPage.value, 2)
})

test('automatic refresh retains combined summary updates and recovers a failed initial load', async () => {
  for (const kind of ['all', 'image', 'video', 'enhance']) {
    const requests = []
    const state = context(kind, async (url) => {
      requests.push(url)
      return url.startsWith('/api/admin/tasks')
        ? { tasks: [], total: 0 }
        : { summary: { totalTasks: 20 } }
    })
    Object.assign(state, {
      document: { hidden: false },
      activeTab: ref('stats'),
      loading: ref(false),
      shouldRefreshTaskStats: ref(true),
    })
    await state.refreshTaskStatsSilently({ force: true })
    assert.equal(requests.length, kind === 'all' ? 4 : 2)
    assert.equal(state.stats.value.summary.totalTasks, kind === 'all' ? 60 : 20)
    requests.length = 0
    await state.refreshTaskStatsSilently({ force: true })
    assert.equal(requests.length, kind === 'all' ? 4 : kind === 'image' ? 1 : 2)
  }
})
