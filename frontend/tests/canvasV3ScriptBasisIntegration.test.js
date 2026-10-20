import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import {
  DIRECTOR_REFERENCE_IMAGE_LIMIT,
  directorImageSourceMode,
  directorScriptSourceMode,
  isDirectorClarificationComplete,
  isDirectorClarificationReady,
  normalizeDirectorClarificationAnswers,
} from '../src/features/canvas-v3/config/directorClarifications.js'
import { directorClarificationAssetsIntent } from '../src/features/canvas-v3/config/directorConversation.js'
import {
  directorApplyImageSourceIntent,
  directorReferenceImages,
} from '../src/features/canvas-v3/config/directorImageSources.js'
import { directorApplyScriptSourceIntent } from '../src/features/canvas-v3/config/directorScriptReferences.js'
import { directorPendingClarificationRun } from '../src/features/canvas-v3/config/directorRouting.js'

const shell = await readFile(
  new URL('../src/features/canvas-v3/components/CanvasV3Shell.vue', import.meta.url),
  'utf8',
)
const extract = (name) => {
  const source = shell.match(
    new RegExp(`^(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\}`, 'm'),
  )?.[0]
  assert.ok(source, `missing actual Shell function ${name}`)
  return source
}
const original = {
  id: 'product-1',
  layerId: 'product-1',
  name: '商品实拍.jpg',
  kind: 'image',
  source: 'library',
  url: 'https://assets.test/real-product.jpg',
  referenceRole: 'product',
}
const paid = { model: 'frozen-model', ratio: '16:9', resolution: '2K', count: 1 }

function harness() {
  const run = {
    id: 'run-1',
    phase: 'awaiting_input',
    dryRun: true,
    questions: [{ id: 'basis', kind: 'script_source', question: '这次脚本采用哪份商品资料？' }],
    referenceCandidates: [original],
    generationIntent: {
      ...paid,
      attachments: [],
      referenceAssets: [],
      referenceLayerIds: [],
      selectedLayerIds: [],
    },
  }
  const submissions = []
  const context = {
    directorAgentRuns: { value: [run] },
    directorRun: (id) => (id === run.id ? run : null),
    updateDirectorRun: (_id, patch) => Object.assign(run, patch),
    directorPlanningRequests: new Map(),
    directorPendingClarificationRun,
    normalizeDirectorClarificationAnswers,
    isDirectorClarificationComplete,
    isDirectorClarificationReady,
    directorClarificationAssetsIntent,
    directorImageSourceMode,
    directorScriptSourceMode,
    directorReferenceImages,
    directorApplyImageSourceIntent,
    directorApplyScriptSourceIntent,
    DIRECTOR_REFERENCE_IMAGE_LIMIT,
    createDirectorGenerationIntent: (message) => ({ attachments: message.parts || [] }),
    handleDirectorSubmit(message, intent) {
      submissions.push({ message, intent })
      return 'next-run'
    },
  }
  runInNewContext(extract('handleDirectorClarification'), context)
  return {
    run,
    submissions,
    answer(option, ids = [], parts = []) {
      let result
      context.handleDirectorClarification(
        run.id,
        {
          id: 'reply',
          dryRunIntent: false,
          parts,
          context: {
            clarification: {
              sourceRunId: run.id,
              answers: [{ questionId: 'basis', answer: option }],
              referenceImageIds: ids,
              referenceRoles: {},
            },
          },
        },
        (value) => {
          result = value
        },
      )
      return result
    },
  }
}

test('historical reuse binds only explicitly selected saved snapshots, not supplied replacement URLs', () => {
  const h = harness()
  assert.equal(
    h.answer(
      '沿用历史商品图',
      ['product-1'],
      [{ ...original, url: 'https://evil.test/replaced.jpg' }],
    ).ok,
    true,
  )
  const { intent, message } = h.submissions[0]
  assert.deepEqual(
    intent.referenceAssets.map((image) => image.url),
    [original.url],
  )
  assert.equal(intent.scriptSourceMode, 'history')
  for (const [key, value] of Object.entries(paid)) assert.equal(intent[key], value)
  assert.equal(message.dryRunIntent, true, 'a source answer cannot grant paid approval')
  assert.equal(message.context.clarification.scriptSourceMode, 'history')
})

test('missing or forged historical selection cannot silently bind every candidate', () => {
  for (const ids of [[], ['another-product']]) {
    const h = harness()
    assert.equal(h.answer('沿用历史商品图', ids).ok, false)
    assert.equal(h.submissions.length, 0)
  }
})

test('replacement source requires newly submitted images rather than borrowing historical candidates', () => {
  const h = harness()
  assert.equal(h.answer('上传或选择其他商品图', ['product-1']).ok, false)
  const replacement = {
    ...original,
    id: 'new-product',
    layerId: 'new-product',
    url: 'https://assets.test/new.jpg',
  }
  assert.equal(h.answer('上传或选择其他商品图', ['new-product'], [replacement]).ok, true)
  assert.deepEqual(
    h.submissions[0].intent.referenceAssets.map((image) => image.url),
    [replacement.url],
  )
})

test('text-only planning clears stale images and preserves known paid parameters and unrelated documents', () => {
  const h = harness()
  const document = {
    id: 'facts',
    layerId: 'facts',
    kind: 'file',
    url: 'https://assets.test/facts.txt',
  }
  h.run.generationIntent = {
    ...h.run.generationIntent,
    imageSourceMode: 'reference',
    referenceAssets: [original],
    attachments: [original, document],
    referenceLayerIds: ['product-1', 'facts'],
    selectedLayerIds: ['product-1'],
  }
  assert.equal(h.answer('仅根据文字策划', ['product-1'], [original, document]).ok, true)
  const { intent, message } = h.submissions[0]
  assert.equal(intent.scriptSourceMode, 'text')
  assert.equal(intent.referenceAssets.length, 0)
  assert.deepEqual(intent.referenceLayerIds, ['facts'])
  assert.equal(
    intent.attachments.some((asset) => asset.kind === 'image'),
    false,
  )
  assert.equal(
    message.parts.some((asset) => asset.kind === 'image'),
    false,
  )
  for (const [key, value] of Object.entries(paid)) assert.equal(intent[key], value)
})

test('source candidate catalog is persisted with a pending questionnaire and sent as metadata only', () => {
  const context = {}
  runInNewContext(extract('serializedDirectorRun'), context)
  const pending = harness().run
  const restored = JSON.parse(JSON.stringify(context.serializedDirectorRun(pending)))
  assert.deepEqual(restored.referenceCandidates, [original])
  assert.match(
    shell,
    /scriptBrief: directorScriptBrief\(intent, run\.referenceCandidates \|\| \[\]\)/,
  )
})
