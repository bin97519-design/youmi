import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mappedVideoModelOption,
  ANMIAO_VIDEO_MODEL,
  ANMIAO20_FAST_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
  HAILUO_H3_VIDEO_MODEL,
  newProductVideo,
  newShot,
  buildVideoRequest,
} from '../src/utils/productVideo.js'

const options = [
  { value: ANMIAO_VIDEO_MODEL, label: 'seedance-2.0\u6807\u51c6', provider: 'lk888' },
  { value: ANMIAO20_FAST_VIDEO_MODEL, label: 'seedance-2.0\u5feb\u901f', provider: 'lk888' },
  { value: MINIMAX_VIDEO_MODEL, label: 'MiniMax H3', provider: 'lk888' },
]

test('video mappings accept canonical IDs and administrator-facing names', () => {
  assert.equal(mappedVideoModelOption(ANMIAO_VIDEO_MODEL, options), options[0])
  assert.equal(mappedVideoModelOption(options[0].label, options), options[0])
  assert.equal(mappedVideoModelOption('  MINIMAX-H3  ', options), options[2])
  assert.equal(mappedVideoModelOption(' minimax h3 ', options), options[2])
})

test('exact model IDs take precedence over an overlapping display label', () => {
  const overlapping = [{ value: 'other-model', label: ANMIAO_VIDEO_MODEL }, ...options]
  assert.equal(mappedVideoModelOption(ANMIAO_VIDEO_MODEL, overlapping), options[0])
})

test('missing and excluded models do not silently select the first available option', () => {
  for (const value of [
    null,
    undefined,
    '',
    ' ',
    'unknown-model',
    'seedance-2.0-fast-0826-720p',
    'minimax-h3-max',
  ])
    assert.equal(mappedVideoModelOption(value, options), undefined)
  assert.equal(mappedVideoModelOption(ANMIAO_VIDEO_MODEL), undefined)
})

test('the legacy H3 alias requires an advertised and mapped Hailuo model', () => {
  const hailuo = { value: HAILUO_H3_VIDEO_MODEL, label: 'Mini H3 first and last frame' }
  assert.equal(mappedVideoModelOption(MINIMAX_VIDEO_MODEL, [hailuo], true), hailuo)
  assert.equal(mappedVideoModelOption(MINIMAX_VIDEO_MODEL, [hailuo], false), undefined)
  assert.equal(mappedVideoModelOption(MINIMAX_VIDEO_MODEL, options, true), options[2])
  assert.equal(mappedVideoModelOption(MINIMAX_VIDEO_MODEL, [], true), undefined)
})

test('resolving a display name uses the same model and duration in generation without mutating the saved task', () => {
  const workflow = newProductVideo()
  workflow.videoModel = options[0].label
  const shot = newShot({
    title: 'Product',
    imagePrompt: 'Frame',
    motion: '0-4 seconds: move',
    duration: 4,
  })
  shot.images = [{ id: 'frame', status: 'completed', url: 'https://assets.example/frame.png' }]
  shot.imageId = 'frame'
  shot.approvedImageId = 'frame'
  const option = mappedVideoModelOption(workflow.videoModel, options)
  const request = buildVideoRequest({ ...workflow, videoModel: option.value }, shot, 'mapping-test')
  assert.equal(request.model, ANMIAO_VIDEO_MODEL)
  assert.equal(request.durationSeconds, 4)
  assert.equal(workflow.videoModel, options[0].label)
})
