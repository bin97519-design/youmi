import assert from 'node:assert/strict'
import test from 'node:test'
import { agentVideoContext, describeAgentVideoContext } from '../src/utils/agentVideoContext.js'

test('video context uses the submitted script and settings instead of later draft changes', () => {
  const message = {
    id: 'video-result-1',
    taskId: 'task-1',
    videoUrl: 'https://example.com/result.mp4',
    model: 'old-meta-model',
    duration: 15,
    videoRequest: {
      prompt: '0-5秒：全景。5-15秒：布料特写。',
      model: 'minimax-h3',
      duration: 15,
      resolution: '768p',
      ratio: '3:4',
      referenceMode: 'shouweizhen',
      generateAudio: true,
      referenceImages: [{ url: 'https://example.com/reference.png', layerId: 'image-1' }],
    },
    agentDraft: { video: { model: 'different-model', duration: 30 }, prompt: 'different script' },
  }
  const context = agentVideoContext(message)
  assert.equal(context.video.model, 'minimax-h3')
  assert.equal(context.prompt, message.videoRequest.prompt)
  assert.deepEqual(context.referenceImages, message.videoRequest.referenceImages)
  const history = describeAgentVideoContext(context)
  assert.ok(history.includes('video-result-1'))
  assert.ok(history.includes(message.videoRequest.prompt))
  assert.ok(history.includes('不是对成片的逐帧观察'))
  assert.ok(!history.includes('different-model'))
  assert.ok(!history.includes('https://example.com/result.mp4'))
})

test('only completed videos can become an adjustment target', () => {
  assert.equal(agentVideoContext({}), null)
  assert.equal(agentVideoContext({ videoUrl: '/v.mp4', failed: true }), null)
  assert.equal(agentVideoContext({ videoUrl: '/v.mp4', generating: true }), null)
  assert.equal(describeAgentVideoContext(null), '')
})

test('legacy video metadata is retained without inventing a script or reference images', () => {
  const context = agentVideoContext({
    id: 'old-video',
    videoUrl: '/old.mp4',
    model: 'minimax-h3',
    duration: 12,
    ratio: '9:16',
    resolution: '768p',
  })
  assert.equal(context.video.duration, 12)
  assert.equal(context.video.model, 'minimax-h3')
  assert.equal(context.prompt, '')
  assert.deepEqual(context.referenceImages, [])
  assert.ok(describeAgentVideoContext(context).includes('原始脚本未保存'))
})
