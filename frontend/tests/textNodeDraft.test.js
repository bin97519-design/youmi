import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeTextNodeDraft,
  syncTextNodeReferences,
  textNodeRequest,
  textNodeRequestError,
  textNodeResultPatch,
} from '../src/utils/textNodeDraft.js'

test('text drafts preserve authored input, selected model and pending results', () => {
  const draft = normalizeTextNodeDraft(
    {
      prompt: 'x'.repeat(4001),
      model: 'saved',
      pendingResult: 'candidate',
      references: [
        { kind: 'image', layerId: 'a', url: 'https://media.test/a.png' },
        { kind: 'image', layerId: 'a', url: 'https://media.test/a.png' },
        { kind: 'image', url: 'blob:temporary' },
        { kind: 'text', layerId: 'b', text: '  original  ' },
      ],
    },
    'default',
  )
  assert.equal(draft.prompt.length, 4001)
  assert.equal(draft.model, 'saved')
  assert.equal(draft.pendingResult, 'candidate')
  assert.equal(draft.references.length, 2)
  assert.equal(normalizeTextNodeDraft({}, 'default').model, 'default')
})

test('linked references update live, disconnect cleanly and preserve manual references', () => {
  const initial = normalizeTextNodeDraft({
    prompt: 'write',
    model: 'model',
    connectedLayerIds: ['a', 'b'],
    references: [
      { kind: 'image', layerId: 'a', url: 'https://media.test/old.png' },
      { kind: 'text', layerId: 'b', text: 'old' },
      { kind: 'text', layerId: 'manual', text: 'manual' },
    ],
  })
  const synced = syncTextNodeReferences(
    initial,
    [{ layerId: 'a', url: 'https://media.test/new.png' }],
    [],
    [{ id: 'manual', text: 'changed' }],
  )
  assert.deepEqual(synced.connectedLayerIds, ['a'])
  assert.equal(synced.references.length, 2)
  assert.equal(synced.references[0].url, 'https://media.test/new.png')
  assert.equal(synced.references[1].text, 'changed')
  assert.equal(synced.prompt, 'write')
})

test('text request keeps user instructions separate from original text and visual evidence', () => {
  const draft = normalizeTextNodeDraft({
    prompt: '  improve  ',
    model: 'agent',
    references: [
      { kind: 'image', url: 'https://media.test/a.png', layerId: 'a' },
      { kind: 'text', name: 'script', text: 'source', layerId: 'b' },
    ],
  })
  const request = textNodeRequest('canvas', { id: 'text', text: 'original' }, draft)
  assert.equal(request.instruction, 'improve')
  assert.equal(request.text, 'original')
  assert.equal(request.agentModel, 'agent')
  assert.deepEqual(request.imageUrls, ['https://media.test/a.png'])
  assert.deepEqual(request.referenceTexts, [{ name: 'script', text: 'source' }])
  assert.equal(request.model, undefined)
})

test('limits reject excessive context rather than silently truncating text', () => {
  assert.ok(textNodeRequestError(normalizeTextNodeDraft({ prompt: ' ' })))
  assert.ok(textNodeRequestError(normalizeTextNodeDraft({ prompt: 'x'.repeat(4001) })))
  assert.ok(textNodeRequestError(normalizeTextNodeDraft({ prompt: 'write' }), 'x'.repeat(20001)))
  assert.ok(
    textNodeRequestError(
      normalizeTextNodeDraft({
        prompt: 'write',
        references: Array.from({ length: 9 }, (_, id) => ({
          kind: 'image',
          url: `https://media.test/${id}.png`,
        })),
      }),
    ),
  )
  assert.ok(
    textNodeRequestError(
      normalizeTextNodeDraft({
        prompt: 'write',
        references: [{ kind: 'text', text: 'x'.repeat(12001) }],
      }),
    ),
  )
  assert.ok(
    textNodeRequestError(
      normalizeTextNodeDraft({
        prompt: 'write',
        references: [{ kind: 'text', text: 'x'.repeat(12000) }],
      }),
      'x'.repeat(13000),
    ),
  )
})

test('successful text generation changes only text and draft, retaining node geometry', () => {
  const layer = {
    id: 'node',
    text: 'original',
    width: 360,
    height: 480,
    x: 200,
    y: 120,
    textNodeDraft: { prompt: 'write', model: 'agent' },
  }
  const patch = textNodeResultPatch(
    layer,
    { text: 'original', instruction: 'write', model: 'agent' },
    { text: 'new\ntext', model: 'agent' },
  )
  assert.equal(patch.text, 'new\ntext')
  assert.equal(patch.textNodeDraft.prompt, '')
  assert.equal(patch.textNodeDraft.pendingResult, '')
  assert.equal(patch.width, undefined)
  assert.equal(layer.text, 'original')
})

test('manual changes, ongoing direct edits and locked nodes preserve new results for confirmation', () => {
  for (const state of [
    { text: 'manual' },
    { text: 'original', editing: true },
    { text: 'original', locked: true },
  ]) {
    const layer = { ...state, textNodeDraft: { prompt: 'write', model: 'agent' } }
    const patch = textNodeResultPatch(
      layer,
      { text: 'original', instruction: 'write', model: 'agent' },
      { text: 'candidate' },
      state.editing,
    )
    assert.equal(patch.text, undefined)
    assert.equal(patch.textNodeDraft.pendingResult, 'candidate')
    assert.equal(patch.textNodeDraft.prompt, 'write')
  }
})

test('empty or oversized results never replace the original', () => {
  const layer = { text: 'original' }
  assert.throws(() => textNodeResultPatch(layer, {}, { text: '' }))
  assert.throws(() => textNodeResultPatch(layer, {}, { text: 'x'.repeat(20001) }))
  assert.equal(layer.text, 'original')
})
