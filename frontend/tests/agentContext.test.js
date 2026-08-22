import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAgentReferenceImages } from '../src/utils/agentContext.js'

test('uses images explicitly submitted in the current Agent turn', () => {
  const result = resolveAgentReferenceImages({
    currentImages: [{ id: 'new', url: 'https://img.example/new.png', layerId: 'layer-new' }],
    messages: [
      {
        role: 'user',
        agent: true,
        referenceImages: [{ url: 'https://img.example/old.png', layerId: 'layer-old' }],
      },
    ],
  })

  assert.equal(result.inherited, false)
  assert.deepEqual(result.images.map((image) => image.url), ['https://img.example/new.png'])
})

test('does not silently inherit images from an earlier Agent turn', () => {
  const result = resolveAgentReferenceImages({
    currentImages: [],
    messages: [
      {
        role: 'user',
        agent: true,
        referenceImages: [{ url: 'https://img.example/first.png' }],
      },
      { role: 'assistant', agent: true, text: 'analysis' },
      {
        role: 'user',
        agent: true,
        referenceImages: [{ url: 'https://img.example/latest.png', layerId: 'layer-2' }],
      },
      { role: 'assistant', agent: true, text: 'follow-up' },
    ],
  })

  assert.deepEqual(result, { images: [], inherited: false })
})

test('does not inherit non-Agent or unusable temporary images', () => {
  const result = resolveAgentReferenceImages({
    messages: [
      { role: 'user', referenceImages: [{ url: 'https://img.example/plain-chat.png' }] },
      { role: 'user', agent: true, referenceImages: [{ url: 'blob:temporary-image' }] },
    ],
  })

  assert.deepEqual(result, { images: [], inherited: false })
})
