import assert from 'node:assert/strict'
import test from 'node:test'
import { agentImageContext, describeAgentImageContext } from '../src/utils/agentImageContext.js'

test('image adjustment keeps the generated image first and uses actual submitted settings', () => {
  const message = {
    id: 'image-result',
    imageUrl: '/result.png',
    model: 'later-model',
    generationRequest: {
      prompt: '明亮客厅，窗帘保持白色。',
      model: 'gpt-image-2',
      ratio: '3:4',
      resolution: '2K',
      generationOptions: { inputFidelity: 'high' },
      referenceImageUrls: ['/reference.png', '/result.png', '/reference.png', 'blob:expired'],
    },
    agentDraft: { prompt: 'Unsubmitted prompt', model: 'different-model' },
  }
  const context = agentImageContext(message)
  assert.equal(context.image.model, 'gpt-image-2')
  assert.equal(context.prompt, message.generationRequest.prompt)
  assert.deepEqual(context.image.generationOptions, { inputFidelity: 'high' })
  assert.deepEqual(
    context.referenceImages.map((image) => image.url),
    ['/result.png', '/reference.png'],
  )
  assert.equal(context.referenceImages[0].name, '本次要调整的成图')
  assert.notEqual(context.image.generationOptions, message.generationRequest.generationOptions)
  const history = describeAgentImageContext(context)
  assert.ok(history.includes(message.generationRequest.prompt))
  assert.ok(history.includes('仍需点击确认生图'))
  assert.ok(!history.includes('later-model'))
  assert.ok(!history.includes('Unsubmitted prompt'))
})

test('only completed image results can be selected, never video posters', () => {
  for (const message of [
    null,
    {},
    { imageUrl: '/i.png', generating: true },
    { imageUrl: '/i.png', failed: true },
    { imageUrl: '/i.png', videoUrl: '/v.mp4' },
  ]) {
    assert.equal(agentImageContext(message), null)
  }
  assert.equal(describeAgentImageContext(null), '')
})

test('legacy image metadata remains usable without inventing the missing prompt', () => {
  const context = agentImageContext({
    id: 'old',
    imageUrl: '/old.png',
    model: 'banana2',
    ratio: '1:1',
  })
  assert.equal(context.image.model, 'banana2')
  assert.equal(context.image.ratio, '1:1')
  assert.equal(context.prompt, '')
  assert.deepEqual(
    context.referenceImages.map((image) => image.url),
    ['/old.png'],
  )
  assert.ok(describeAgentImageContext(context).includes('原始提示词未保存'))
})
