import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  assertProductMoverStorageReady,
  productMoverStorageLabel,
  productMoverErrorMessage,
} from '../src/utils/productMoverStorage.js'

test('old extension fails before creating tasks; loaded expanded configuration passes', () => {
  for (const info of [
    null,
    { version: '0.9.12.114' },
    { version: '0.9.12.115', storage: { unlimited: false } },
  ]) {
    assert.throws(() => assertProductMoverStorageReady(info), /重新加载/)
  }
  assert.doesNotThrow(() => assertProductMoverStorageReady({ storage: { unlimited: true } }))
})
test('status distinguishes unknown usage from zero and displays real loaded version', () => {
  assert.equal(
    productMoverStorageLabel({
      version: '0.9.12.115',
      storage: { unlimited: true, bytesInUse: 12582912 },
    }),
    '插件 0.9.12.115 · 存储扩容已启用，已用 12.0 MB',
  )
  assert.doesNotMatch(productMoverStorageLabel({ storage: { bytesInUse: null } }), /已用/)
  assert.match(productMoverStorageLabel({ storage: { bytesInUse: 0 } }), /0.0 MB/)
})
test('quota failure has actionable retry guidance, other errors remain unchanged', () => {
  assert.match(
    productMoverErrorMessage(new Error('Resource::kQuotaBytes quota exceeded')),
    /不要重复新建/,
  )
  assert.equal(productMoverErrorMessage(new Error('登录已过期')), '登录已过期')
})
test('capacity preflight runs before cloud create and claim', () => {
  const source = fs.readFileSync(
    new URL('../src/pages/SelectionPoolPage.vue', import.meta.url),
    'utf8',
  )
  for (const [functionName, call] of [
    ['createAndStartMigration', 'await createMigrationTask'],
    ['claimExistingTask', 'await claimMigrationTask'],
  ]) {
    const body = source.slice(source.indexOf(`async function ${functionName}(`))
    assert.ok(body.indexOf('assertProductMoverStorageReady') < body.indexOf(call))
  }
})
