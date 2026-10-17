import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveAgentReferenceImages } from '../src/utils/agentContext.js'

test('scene edits keep the preceding product references', () => {
  const messages = [{ agent: true, role: 'user', referenceImages: [
    { url: 'https://img.example/product.png', layerId: 'product' },
    { url: 'https://img.example/detail.png', layerId: 'detail' },
  ] }]
  for (const instruction of ['或者换个卧室场景', '换个场景', '背景改成日式卧室', '把卧室换成客厅', '调整一下场景光线']) {
    const result = resolveAgentReferenceImages({ instruction, messages })
    assert.equal(result.inherited, true, instruction)
    assert.deepEqual(result.images.map((image) => image.layerId), ['product', 'detail'])
  }
  assert.deepEqual(resolveAgentReferenceImages({ instruction: '换个卧室场景，不用参考图', messages }),
    { images: [], inherited: false })
})

test('explicit regeneration carries the latest draft images in their original order', () => {
  const images = [
    { url: 'https://img.example/2.png', layerId: 'two' },
    { url: 'https://img.example/1.png', layerId: 'one' },
  ]
  for (const instruction of ['再生一次', '重新生成提示词', '再生成一版', '重新写一下']) {
    const result = resolveAgentReferenceImages({ instruction, messages: [
      { agent: true, role: 'user', referenceImages: [{ url: 'https://img.example/old.png' }] },
      { agent: true, role: 'assistant', agentDraft: { referenceImages: images } },
      { agent: true, role: 'assistant', text: '可以继续修改' },
    ] })
    assert.equal(result.inherited, true)
    assert.deepEqual(result.images.map((image) => image.url), images.map((image) => image.url))
  }
})

test('new attachments and explicit no-image requests override regeneration inheritance', () => {
  const messages = [{ agent: true, referenceImages: [{ url: 'https://img.example/old.png' }] }]
  const fresh = resolveAgentReferenceImages({ instruction: '再生一次', messages,
    currentImages: [{ url: 'https://img.example/new.png' }] })
  assert.equal(fresh.inherited, false)
  assert.equal(fresh.images[0].url, 'https://img.example/new.png')
  assert.deepEqual(resolveAgentReferenceImages({ instruction: '重新生成提示词，不要带上次的图片', messages }),
    { images: [], inherited: false })
})

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
