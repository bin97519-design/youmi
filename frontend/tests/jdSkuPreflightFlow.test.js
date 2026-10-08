import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  assertJdSkuPreflightAvailable,
  prepareMigrationWithConfirmation,
} from '../src/utils/jdSkuPreflightFlow.js'
const payload = {
  targetPlatform: 'JD',
  taskId: 'task1',
  productRowIds: [1],
  frozenItems: [{ sourceSnapshot: { name: 'original' } }],
}
const warning = (key = 'a'.repeat(64)) => ({
  requiresConfirmation: true,
  execution: { opened: false },
  preflight: {
    version: 'jd-sku-name-preflight-124',
    limit: 50,
    confirmationKey: key,
    products: [{ title: '床垫', issues: [{ skuIndex: 1, name: '棕'.repeat(51), length: 51 }] }],
  },
})
const opened = { execution: { opened: true } }

test('cancel, missing callback and non-boolean consent never send the second start request', async () => {
  for (const confirm of [undefined, async () => false, async () => 'true']) {
    const calls = []
    const result = await prepareMigrationWithConfirmation(
      payload,
      async (value) => {
        calls.push(value)
        return warning()
      },
      confirm,
    )
    assert.equal(result.cancelled, true)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].jdSkuNameConfirmation, undefined)
  }
})

test('explicit confirmation sends the exact challenge only after the customer responds', async () => {
  const calls = []
  let resolveConsent
  const operation = prepareMigrationWithConfirmation(
    payload,
    async (value) => {
      calls.push(value)
      return calls.length === 1 ? warning() : opened
    },
    () =>
      new Promise((resolve) => {
        resolveConsent = resolve
      }),
  )
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, 1)
  resolveConsent(true)
  assert.equal((await operation).execution.opened, true)
  assert.equal(calls[1].jdSkuNameConfirmation, 'a'.repeat(64))
  assert.equal(payload.jdSkuNameConfirmation, undefined)
})

test('request data remains frozen during confirmation; any new challenge requires another customer decision', async () => {
  const original = structuredClone(payload)
  const calls = [],
    questions = []
  const result = await prepareMigrationWithConfirmation(
    original,
    async (value) => {
      calls.push(value)
      return calls.length === 1 ? warning() : calls.length === 2 ? warning('b'.repeat(64)) : opened
    },
    async (report) => {
      questions.push(report.confirmationKey)
      original.frozenItems[0].sourceSnapshot.name = 'changed during modal'
      return true
    },
  )
  assert.equal(result.execution.opened, true)
  assert.deepEqual(questions, ['a'.repeat(64), 'b'.repeat(64)])
  assert.equal(calls[2].jdSkuNameConfirmation, 'b'.repeat(64))
  assert.equal(calls[2].frozenItems[0].sourceSnapshot.name, 'original')
})

test('valid JD and other platforms proceed without a needless confirmation; malformed preflight stops', async () => {
  for (const platform of ['JD', 'TMALL', 'PDD']) {
    assert.equal(
      (
        await prepareMigrationWithConfirmation(
          { ...payload, targetPlatform: platform },
          async () => opened,
          () => {
            throw new Error('must not prompt')
          },
        )
      ).execution.opened,
      true,
    )
  }
  await assert.rejects(
    prepareMigrationWithConfirmation(
      payload,
      async () => warning('wrong'),
      async () => true,
    ),
    /无效/,
  )
  await assert.rejects(
    prepareMigrationWithConfirmation(
      payload,
      async () => ({}),
      async () => true,
    ),
    /未启动/,
  )
})

test('old plugins cannot bypass JD preflight, without blocking other platforms', () => {
  assert.throws(
    () => assertJdSkuPreflightAvailable('JD', { capabilities: ['PREPARE_MIGRATION'] }),
    /重新加载/,
  )
  assert.doesNotThrow(() =>
    assertJdSkuPreflightAvailable('JD', { capabilities: ['JD_SKU_NAME_PREFLIGHT'] }),
  )
  assert.doesNotThrow(() => assertJdSkuPreflightAvailable('PDD', null))
})

test('new-task and resume paths handle cancellation and the review UI lists all issues with explicit buttons', () => {
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8')
  const page = read('../src/pages/SelectionPoolPage.vue')
  assert.equal((page.match(/if \(result\.cancelled\)/g) || []).length, 2)
  assert.match(page, /onBeforeUnmount\(\(\) => finishJdSkuWarning\(false\)\)/)
  const modal = read('../src/components/selection/JdSkuLengthConfirm.vue')
  assert.match(modal, /v-for="\(sku, index\) in product\.issues"/)
  assert.match(modal, /取消，先修改/)
  assert.match(modal, /已知晓，继续上架/)
  assert.match(modal, /cancelButton\.value\?\.focus\(\)/)
  assert.doesNotMatch(modal, /v-html|autofocus.*confirm/)
})
