import test from 'node:test'
import assert from 'node:assert/strict'
import {
  directorApplyScriptSourceIntent,
  directorScriptBrief,
  directorScriptReferenceCandidates,
} from '../src/features/canvas-v3/config/directorScriptReferences.js'

const image = (id, overrides = {}) => ({
  id,
  layerId: id,
  name: `${id}.jpg`,
  kind: 'image',
  url: `https://assets.example.com/${id}.jpg`,
  source: 'upload',
  status: 'ready',
  referenceRole: 'product',
  ...overrides,
})
const run = (id, images, overrides = {}) => ({
  id,
  generationIntent: { referenceAssets: images, attachments: images },
  ...overrides,
})

test('only the newest eligible product reference group is offered, not unrelated prior SKUs', () => {
  const original = [
    run('old-mattress', [image('mattress')]),
    run('new-curtains', [image('curtain-front'), image('curtain-detail')]),
    { id: 'plain-followup', reply: '已完成方案', generationIntent: {} },
  ]
  const result = directorScriptReferenceCandidates(original)
  assert.deepEqual(
    result.map(({ id }) => id),
    ['curtain-front', 'curtain-detail'],
  )
  assert.ok(result.every(({ originRunId }) => originRunId === 'new-curtains'))
  assert.ok(result.every(({ source }) => source === 'library'))
  assert.equal(original[1].generationIntent.referenceAssets[0].source, 'upload')
  assert.ok(Object.isFrozen(result) && result.every(Object.isFrozen))
})

test('excluding the active run does not offer its image as a historical reference', () => {
  const result = directorScriptReferenceCandidates(
    [run('previous', [image('previous')]), run('active', [image('active')])],
    'active',
  )
  assert.deepEqual(
    result.map(({ id }) => id),
    ['previous'],
  )
})

test('generated result fields and selected canvas images are not historical product originals', () => {
  const result = directorScriptReferenceCandidates([
    run('uploaded', [image('original')]),
    run('generated', [image('canvas-output', { source: 'canvas' })], {
      nodeId: 'generated-node',
      outputUrls: ['https://assets.example.com/result.jpg'],
      result: { url: 'https://assets.example.com/another-result.jpg' },
    }),
  ])
  assert.deepEqual(
    result.map(({ id }) => id),
    ['original'],
  )
})

test('style, other, unknown sources, failed uploads and nonimages cannot become product candidates', () => {
  const result = directorScriptReferenceCandidates([
    run('sources', [
      image('style', { referenceRole: 'style' }),
      image('other', { referenceRole: 'other' }),
      image('unknown-role', { referenceRole: 'generated' }),
      image('unknown-source', { source: 'output' }),
      image('failed', { status: 'error' }),
      image('pending', { status: 'uploading' }),
      image('video', { kind: 'video' }),
      image('unnamed-role', { referenceRole: '' }),
      image('product', { source: 'library' }),
    ]),
  ])
  assert.deepEqual(
    result.map(({ id }) => id),
    ['unnamed-role', 'product'],
  )
})

test('candidate groups deduplicate both IDs and image URLs and cap at eight', () => {
  const values = [
    image('first'),
    image('first', { url: 'https://assets.example.com/changed-url.jpg' }),
    image('second', { url: 'https://assets.example.com/first.jpg' }),
    ...Array.from({ length: 12 }, (_, index) => image(`item-${index}`)),
  ]
  const result = directorScriptReferenceCandidates([run('many', values)])
  assert.equal(result.length, 8)
  assert.equal(new Set(result.map(({ id }) => id)).size, 8)
  assert.equal(new Set(result.map(({ url }) => url)).size, 8)
})

test('legacy serialized user attachments are candidates only when intent lacks image snapshots', () => {
  const fallback = { type: 'attachment', ...image('legacy', { status: undefined }) }
  const legacy = { id: 'legacy-run', message: { parts: [fallback] }, generationIntent: {} }
  assert.deepEqual(
    directorScriptReferenceCandidates([legacy]).map(({ id }) => id),
    ['legacy'],
  )
  const explicit = {
    ...legacy,
    generationIntent: { referenceAssets: [image('style', { referenceRole: 'style' })] },
  }
  assert.deepEqual(directorScriptReferenceCandidates([explicit]), [])
})

test('text-only source runs never resurrect stale snapshots or legacy attachment parts', () => {
  for (const source of [{ imageSourceMode: 'text' }, { scriptSourceMode: 'text' }]) {
    assert.deepEqual(
      directorScriptReferenceCandidates([
        {
          ...run('text', [image('stale')]),
          generationIntent: { ...source, referenceAssets: [image('stale')] },
          message: { parts: [{ type: 'attachment', ...image('legacy') }] },
        },
      ]),
      [],
    )
  }
})

test('script candidates are scoped to exactly the supplied conversation runs', () => {
  const firstConversation = [run('first', [image('mattress')])]
  const secondConversation = [run('second', [image('curtains')])]
  assert.deepEqual(
    directorScriptReferenceCandidates(firstConversation).map(({ id }) => id),
    ['mattress'],
  )
  assert.deepEqual(
    directorScriptReferenceCandidates(secondConversation).map(({ id }) => id),
    ['curtains'],
  )
  assert.deepEqual(directorScriptReferenceCandidates(null), [])
})

test('unsafe or unusable URLs are excluded, while real browser image resources remain available', () => {
  const result = directorScriptReferenceCandidates([
    run('url-cases', [
      image('javascript', { url: 'javascript:alert(1)' }),
      image('html', { url: 'data:text/html;base64,SGVsbG8=' }),
      image('svg', { url: 'data:image/svg+xml;base64,PHN2Zz4=' }),
      image('local-path', { url: 'C:\\images\\original.jpg' }),
      image('protocol-relative', { url: '//untrusted.example.com/image.jpg' }),
      image('backslash', { url: '/\\untrusted.example.com/image.jpg' }),
      image('missing', { url: '' }),
      image('http', { url: 'http://127.0.0.1:8083/uploads/product.jpg' }),
      image('https'),
      image('blob', { url: 'blob:http://127.0.0.1:5175/abc-123' }),
      image('data', { url: 'data:image/png;base64,aGVsbG8=' }),
      image('relative', { url: '/uploads/product.jpg' }),
    ]),
  ])
  assert.deepEqual(
    result.map(({ id }) => id),
    ['http', 'https', 'data', 'relative'],
  )
})

test('a missing asset ID receives a non-URL ID, without exposing URLs in candidate metadata', () => {
  const candidates = directorScriptReferenceCandidates([
    run('no-id', [image('', { layerId: '', url: 'https://assets.example.com/no-id.jpg' })]),
  ])
  assert.match(candidates[0].id, /^script-reference-[a-z0-9]+$/)
  const brief = directorScriptBrief({}, candidates)
  assert.deepEqual(Object.keys(brief.referenceCandidates[0]), ['id', 'name', 'referenceRole'])
  assert.ok(!JSON.stringify(brief).includes('https://assets.example.com'))
})

test('script brief defaults to current only for actual ready image references', () => {
  assert.equal(directorScriptBrief({}).sourceMode, 'unconfirmed')
  assert.equal(directorScriptBrief({ referenceAssets: [image('present')] }).sourceMode, 'current')
  assert.equal(
    directorScriptBrief({ attachments: [image('pending', { status: 'uploading' })] }).sourceMode,
    'unconfirmed',
  )
  assert.equal(
    directorScriptBrief({ referenceAssets: [image('invalid', { url: 'javascript:bad' })] })
      .sourceMode,
    'unconfirmed',
  )
})

test('explicit source modes remain distinct and text source sends no historical candidate catalog', () => {
  const candidates = directorScriptReferenceCandidates([run('previous', [image('original')])])
  for (const mode of ['unconfirmed', 'current', 'history', 'upload'])
    assert.equal(directorScriptBrief({ scriptSourceMode: mode }, candidates).sourceMode, mode)
  assert.deepEqual(directorScriptBrief({ scriptSourceMode: 'text' }, candidates), {
    sourceMode: 'text',
    referenceCandidates: [],
  })
  assert.equal(directorScriptBrief({ scriptSourceMode: 'forged' }).sourceMode, 'unconfirmed')
})

const frozenIntent = Object.freeze({
  generationType: 'video',
  nodeModel: 'selected-paid-model',
  requestedModels: Object.freeze([{ id: 'selected-paid-model' }]),
  ratio: '16:9',
  resolution: '2K',
  count: 1,
  duration: 15,
  quality: 'standard',
  dryRun: true,
  dryRunIntent: true,
  approved: false,
  referenceAssets: Object.freeze([image('stale')]),
  attachments: Object.freeze([
    image('stale'),
    { id: 'brief', layerId: 'brief', kind: 'file', url: 'https://assets.example.com/brief.pdf' },
  ]),
  selectedLayerIds: Object.freeze(['stale', 'text-node']),
  referenceLayerIds: Object.freeze(['stale', 'brief']),
})

test('history selection binds only explicitly selected snapshots and preserves paid settings', () => {
  const selected = image('chosen', { source: 'library' })
  const result = directorApplyScriptSourceIntent(frozenIntent, 'history', [selected])
  assert.equal(result.scriptSourceMode, 'history')
  assert.equal(result.imageSourceMode, 'reference')
  assert.deepEqual(
    result.referenceAssets.map(({ id }) => id),
    ['chosen'],
  )
  assert.deepEqual(result.referenceLayerIds, ['brief', 'chosen'])
  assert.deepEqual(result.selectedLayerIds, ['text-node'])
  for (const key of [
    'generationType',
    'nodeModel',
    'requestedModels',
    'ratio',
    'resolution',
    'count',
    'duration',
    'quality',
    'dryRun',
    'dryRunIntent',
    'approved',
  ])
    assert.equal(result[key], frozenIntent[key])
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.referenceAssets))
  assert.equal(frozenIntent.referenceAssets[0].id, 'stale')
})

test('upload selection accepts only new ready images and never grants generation authorization', () => {
  const result = directorApplyScriptSourceIntent(frozenIntent, 'upload', [
    image('new'),
    image('pending', { status: 'uploading' }),
    image('invalid', { url: 'javascript:bad' }),
  ])
  assert.equal(result.scriptSourceMode, 'upload')
  assert.deepEqual(
    result.referenceAssets.map(({ id }) => id),
    ['new'],
  )
  assert.equal(result.dryRunIntent, true)
  assert.equal(result.approved, false)
})

test('text-only and empty image selections clear stale image snapshots and IDs', () => {
  for (const mode of ['text', 'history', 'upload']) {
    const result = directorApplyScriptSourceIntent(frozenIntent, mode, [])
    assert.deepEqual(result.referenceAssets, [])
    assert.deepEqual(
      result.attachments.map(({ id }) => id),
      ['brief'],
    )
    assert.deepEqual(result.referenceLayerIds, ['brief'])
    assert.deepEqual(result.selectedLayerIds, ['text-node'])
    assert.equal(result.dryRunIntent, true)
  }
  assert.deepEqual(
    directorApplyScriptSourceIntent(frozenIntent, 'text', [image('ignored')]).referenceAssets,
    [],
  )
})

test('unknown source choices cannot mutate the frozen generation intent', () => {
  assert.equal(
    directorApplyScriptSourceIntent(frozenIntent, 'forged', [image('ignored')]),
    frozenIntent,
  )
  assert.equal(directorApplyScriptSourceIntent(frozenIntent, ''), frozenIntent)
})
