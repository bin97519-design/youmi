import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMinimaxH3Model,
  isSeedance25Model,
  MINIMAX_H3_MODEL,
  SEEDANCE25_MODEL,
  videoModelControls,
  videoModelParams,
} from '../src/features/canvas-v3/config/videoModelParameters.js'
import {
  modelPresentation,
  videoModelOptions,
} from '../src/features/canvas-v3/config/modelCatalog.js'

test('video parameter families follow native identity, never an editable display label', () => {
  assert.equal(isSeedance25Model(SEEDANCE25_MODEL), true)
  assert.equal(isSeedance25Model('seedance-2.5-guanfang-anmiao'), true)
  assert.equal(isSeedance25Model({ value: 'model-api-key:8', model: SEEDANCE25_MODEL }), true)
  assert.equal(isSeedance25Model({ value: 'other', label: 'Seedance 2.5' }), false)
  assert.equal(isMinimaxH3Model({ value: 'model-api-key:9', model: 'MiniMax-H3' }), true)
  assert.equal(isMinimaxH3Model({ value: 'minimax', label: 'MiniMax H3' }), false)
})

test('Seedance 2.5 exposes only documented per-second resolutions, ratios and duration without a count field', () => {
  const profile = videoModelControls(SEEDANCE25_MODEL)
  assert.deepEqual(profile.fields.resolution[1], ['480P', '720P', '1080P'])
  assert.deepEqual(profile.fields.ratio[1], ['Auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9'])
  assert.equal(Object.hasOwn(profile.fields, 'count'), false)
  assert.equal(Object.hasOwn(profile.defaults, 'count'), false)
  assert.deepEqual([profile.durationMin, profile.durationMax], [4, 30])
  assert.deepEqual(profile.switches, ['联网搜索'])
  assert.equal(Object.hasOwn(profile.defaults, 'audio'), false)
})

test('only Seedance single-image first frame requires adaptive; first/last and reference retain ratios', () => {
  for (const mode of ['图生视频']) {
    assert.deepEqual(videoModelControls(SEEDANCE25_MODEL, mode).fields.ratio[1], ['Auto'])
    assert.equal(videoModelParams(SEEDANCE25_MODEL, { ratio: '16:9' }, mode).ratio, 'Auto')
  }
  for (const mode of ['首尾帧', '文生视频', '图片参考', '全能参考'])
    assert.equal(videoModelControls(SEEDANCE25_MODEL, mode).fields.ratio[1].length, 7)
})

test('H3 exposes its own resolutions, shorter duration, two modes and no ineffective toggles', () => {
  const profile = videoModelControls(MINIMAX_H3_MODEL)
  assert.deepEqual(profile.fields.resolution[1], ['768P', '1080P', '2K', '4K'])
  assert.equal(Object.hasOwn(profile.fields, 'count'), false)
  assert.equal(Object.hasOwn(profile.defaults, 'count'), false)
  assert.deepEqual([profile.durationMin, profile.durationMax], [4, 15])
  assert.deepEqual(profile.modes, ['首尾帧', '参考生'])
  assert.deepEqual(profile.switches, [])
  assert.equal(profile.fields.ratio[1].length, 7)
  for (const mode of ['文生视频', '图生视频', '首尾帧', '参考生']) {
    assert.deepEqual(videoModelControls(MINIMAX_H3_MODEL, mode).fields.ratio[1], [
      'Auto',
      '16:9',
      '4:3',
      '1:1',
      '3:4',
      '9:16',
      '21:9',
    ])
    assert.equal(videoModelControls(MINIMAX_H3_MODEL, mode).defaults.ratio, 'Auto')
    assert.equal(videoModelParams(MINIMAX_H3_MODEL, { ratio: '9:16' }, mode).ratio, '9:16')
  }
})

test('UI model switches normalize unsupported values without retaining another model schema', () => {
  const raw = {
    ratio: '3:4',
    resolution: '4K',
    duration: 30,
    count: '4个',
    audio: false,
    version: 'flare',
  }
  assert.deepEqual(videoModelParams(SEEDANCE25_MODEL, raw), {
    ratio: '3:4',
    resolution: '720P',
    duration: 30,
  })
  assert.deepEqual(videoModelParams(MINIMAX_H3_MODEL, raw), {
    ratio: '3:4',
    resolution: '4K',
    duration: 5,
  })
  assert.deepEqual(
    videoModelParams(SEEDANCE25_MODEL, { ratio: 'adaptive', resolution: '1080p', duration: 4 }),
    {
      ratio: 'Auto',
      resolution: '1080P',
      duration: 4,
    },
  )
  assert.equal(raw.count, '4个')
  assert.deepEqual(videoModelParams('Kling 3.0', raw), raw)
  assert.deepEqual(videoModelControls('seedance-2.0-mini'), { id: 'generic' })
})

test('configured video choices replace only their own static families and preserve opaque routes', () => {
  const values = ['2.0', SEEDANCE25_MODEL, 'Kling 3.0', MINIMAX_H3_MODEL]
  const configured = [
    { value: 'model-api-key:8', model: SEEDANCE25_MODEL, label: '我的 SD 通道' },
    { value: 'model-api-key:9', model: 'MiniMax-H3', label: 'MiniMax' },
    { value: 'unrelated', model: 'some-other-video-model', label: 'Other' },
  ]
  const options = videoModelOptions(values, configured)
  assert.deepEqual(
    options.map((option) => option.value),
    ['2.0', 'model-api-key:8', 'Kling 3.0', 'model-api-key:9'],
  )
  assert.equal(options[1].model, SEEDANCE25_MODEL)
  assert.equal(options[3].model, 'MiniMax-H3')
  assert.equal(options[3].label, 'MiniMax')
  assert.equal(modelPresentation(options[1], 'video').icon, 'modelSeedanceMini')
  assert.equal(modelPresentation(options[3], 'video').icon, 'modelMinimax')
  assert.notEqual(modelPresentation(options[3], 'video').uiOnly, true)
  assert.deepEqual(values, ['2.0', SEEDANCE25_MODEL, 'Kling 3.0', MINIMAX_H3_MODEL])
})
