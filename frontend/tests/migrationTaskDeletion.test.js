import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
test('queue offers select, bulk delete, clear all and explicit confirmation', () => {
  const source = read('../src/pages/SelectionPoolPage.vue')
  assert.match(source, /全选当前列表/)
  assert.match(source, /批量删除/)
  assert.match(source, /清空任务/)
  assert.match(source, /window\.confirm\(\s*`确定删除/)
  assert.match(source, /未显示的任务/)
  assert.match(source, /重试清理插件缓存/)
  assert.match(source, /sessionStorage.setItem/)
})
test('deletion targets task endpoint, not products, and cleans cache after backend success', () => {
  const api = read('../src/utils/selectionPoolApi.js')
  const page = read('../src/pages/SelectionPoolPage.vue')
  assert.match(api, /request\('\/migration-tasks\/delete'/)
  const body = page.slice(
    page.indexOf('async function removeQueuedTasks('),
    page.indexOf('\nfunction ', page.indexOf('async function removeQueuedTasks(')),
  )
  assert.ok(
    body.indexOf('await deleteMigrationTasks') < body.indexOf('await cleanDeletedTaskCache'),
  )
  assert.doesNotMatch(body, /deleteSelectionProducts|updateSelectionProduct/)
  assert.match(body, /clearAll: true/)
})
