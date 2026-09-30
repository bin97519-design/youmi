import assert from 'node:assert/strict'
import test from 'node:test'
import {
  estimatedVideoMiCost,
  validVideoDuration,
  validVideoResolution,
  videoDurationOptions,
  videoRatioForRequest,
  videoResolutionForModel,
  videoResolutionOptions,
  videoReferencePayload,
  videoReferenceLimit,
} from './chatVideoSettings.js'
import {
  ANMIAO_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
  VIDEO_MODELS,
} from './productVideo.js'

test('retired H3 Max cannot be selected, priced or submitted', () => {
  const model = 'minimax-h3-max'
  assert.equal(
    VIDEO_MODELS.some((option) => option.value === model),
    false,
  )
  assert.deepEqual(videoResolutionOptions(model), [])
  assert.deepEqual(videoDurationOptions(model), [])
  assert.equal(validVideoDuration(model, 5), false)
  assert.equal(validVideoResolution(model, '480p'), false)
  assert.equal(estimatedVideoMiCost(model, '480p', 5, {}), null)
  assert.throws(() => videoReferencePayload(model, 'shouweizhen', []), /已移除/)
})

test('H3 has independent resolution tiers, duration and pricing', () => {
  const model = MINIMAX_VIDEO_MODEL
  assert.equal(videoResolutionForModel(model), '768p')
  assert.deepEqual(videoResolutionOptions(model), ['768p', '1080p', '2k', '4k'])
  assert.deepEqual(videoDurationOptions(model), [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  assert.equal(validVideoDuration(model, 30), false)
  assert.equal(validVideoResolution(model, '720p'), false)
  const capabilities = {
    minimaxVideo: true,
    minimaxMiPerSecondByResolution: { '768p': 5, '1080p': 10, '2k': 15, '4k': 30 },
  }
  assert.equal(estimatedVideoMiCost(model, '768p', 5, capabilities), 25)
  assert.equal(estimatedVideoMiCost(model, '2k', 15, capabilities), 225)
  assert.equal(estimatedVideoMiCost(model, '4k', 30, capabilities), null)
  assert.equal(estimatedVideoMiCost(model, '768p', 5, null), null)
  assert.equal(
    estimatedVideoMiCost(model, '768p', 5, { ...capabilities, minimaxVideo: false }),
    null,
  )
  assert.equal(videoRatioForRequest(model, 1, '3:4'), '3:4')
})

test('H3 frame mode preserves order and reference mode accepts a single reference', () => {
  const urls = ['https://assets/first.png', 'https://assets/last.png']
  assert.deepEqual(videoReferencePayload(MINIMAX_VIDEO_MODEL, 'shouweizhen', urls), {
    first_frame_url: urls[0],
    last_frame_url: urls[1],
  })
  assert.deepEqual(videoReferencePayload(MINIMAX_VIDEO_MODEL, 'cankaosheng', [urls[0]]), {
    image_urls: [urls[0]],
  })
  assert.deepEqual(
    JSON.parse(JSON.stringify(videoReferencePayload(MINIMAX_VIDEO_MODEL, 'shouweizhen', []))),
    {},
  )
  assert.equal(videoReferenceLimit(MINIMAX_VIDEO_MODEL, 'shouweizhen'), 2)
  assert.equal(videoReferenceLimit(MINIMAX_VIDEO_MODEL, 'cankaosheng'), 9)
  assert.throws(() => videoReferencePayload(MINIMAX_VIDEO_MODEL, 'shouweizhen', [...urls, 'third']))
  assert.throws(() =>
    videoReferencePayload(MINIMAX_VIDEO_MODEL, 'cankaosheng', Array(10).fill('image')),
  )
  assert.deepEqual(videoReferencePayload(ANMIAO_VIDEO_MODEL, 'shouweizhen', urls), {
    image_urls: urls,
  })
})

test('legacy chat video keeps fixed duration, resolution and price', () => {
  const model = 'seedance-2.0-fast-0826-480p'
  assert.deepEqual(videoResolutionOptions(model), ['480p'])
  assert.deepEqual(videoDurationOptions(model), [15])
  assert.equal(estimatedVideoMiCost(model, '480p', 15, null), 50)
  assert.equal(validVideoDuration(model, 6), false)
})

test('per-second chat video exposes standard resolutions and 4-15 seconds', () => {
  assert.equal(videoResolutionForModel(ANMIAO_VIDEO_MODEL), '720p')
  assert.deepEqual(videoResolutionOptions(ANMIAO_VIDEO_MODEL), ['480p', '720p', '1080p', '4k'])
  assert.deepEqual(
    videoDurationOptions(ANMIAO_VIDEO_MODEL),
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  )
  assert.equal(validVideoResolution(ANMIAO_VIDEO_MODEL, '4k'), true)
  assert.equal(validVideoDuration(ANMIAO_VIDEO_MODEL, 6), true)
  assert.equal(validVideoDuration(ANMIAO_VIDEO_MODEL, 16), false)
})

test('estimate uses selected backend tier and blocks unavailable pricing', () => {
  const capabilities = {
    anmiaoVideo: true,
    anmiaoMiPerSecondByResolution: { '480p': 3, '720p': 5, '1080p': 10, '4k': 20 },
  }
  assert.equal(estimatedVideoMiCost(ANMIAO_VIDEO_MODEL, '480p', 6, capabilities), 18)
  assert.equal(estimatedVideoMiCost(ANMIAO_VIDEO_MODEL, '4k', 6, capabilities), 120)
  assert.equal(
    estimatedVideoMiCost(ANMIAO_VIDEO_MODEL, '4k', 6, {
      ...capabilities,
      anmiaoMiPerSecondByResolution: { '720p': 5 },
    }),
    null,
  )
  assert.equal(
    estimatedVideoMiCost(ANMIAO_VIDEO_MODEL, '720p', 6, {
      ...capabilities,
      anmiaoVideo: false,
    }),
    null,
  )
})

test('Seedance 2.5 chat video offers 30 seconds but no 4K and separate pricing', () => {
  assert.deepEqual(videoResolutionOptions(ANMIAO25_VIDEO_MODEL), ['480p', '720p', '1080p'])
  assert.equal(videoDurationOptions(ANMIAO25_VIDEO_MODEL).at(-1), 30)
  assert.equal(validVideoDuration(ANMIAO25_VIDEO_MODEL, 30), true)
  assert.equal(validVideoDuration(ANMIAO25_VIDEO_MODEL, 31), false)
  assert.equal(validVideoResolution(ANMIAO25_VIDEO_MODEL, '4k'), false)
  assert.equal(videoRatioForRequest(ANMIAO25_VIDEO_MODEL, 1, '9:16'), 'adaptive')
  assert.equal(videoRatioForRequest(ANMIAO25_VIDEO_MODEL, 2, '9:16'), '9:16')
  assert.equal(videoRatioForRequest(ANMIAO25_VIDEO_MODEL, 0, '9:16'), '9:16')
  assert.equal(videoRatioForRequest(ANMIAO_VIDEO_MODEL, 1, '9:16'), '9:16')
  const capabilities = {
    anmiao25Video: true,
    anmiao25MiPerSecondByResolution: { '480p': 4, '720p': 7, '1080p': 14 },
    anmiaoMiPerSecondByResolution: { '720p': 5 },
  }
  assert.equal(estimatedVideoMiCost(ANMIAO25_VIDEO_MODEL, '720p', 30, capabilities), 210)
  assert.equal(estimatedVideoMiCost(ANMIAO25_VIDEO_MODEL, '4k', 30, capabilities), null)
  assert.equal(
    estimatedVideoMiCost(ANMIAO25_VIDEO_MODEL, '720p', 30, {
      ...capabilities,
      anmiao25MiPerSecondByResolution: {},
    }),
    null,
  )
})
