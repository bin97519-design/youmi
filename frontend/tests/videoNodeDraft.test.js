import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeVideoNodeDraft,
  syncVideoNodeGenerationSettings,
  syncVideoNodeConnectedReferences,
  videoNodeReferenceError,
} from '../src/utils/videoNodeDraft.js'
import {
  ANMIAO_VIDEO_MODEL,
  ANMIAO25_VIDEO_MODEL,
  MINIMAX_VIDEO_MODEL,
} from '../src/utils/productVideo.js'
import { SEEDANCE_FIRST_LAST_MODE, videoReferencePayload } from '../src/utils/chatVideoSettings.js'

test('new video nodes default to 3:4 without replacing saved or inherited ratios', () => {
  assert.equal(normalizeVideoNodeDraft().config.ratio, '3:4')
  assert.equal(normalizeVideoNodeDraft({ config: { ratio: 'invalid' } }).config.ratio, '3:4')
  for (const ratio of ['16:9', '9:16', '1:1', 'adaptive']) {
    assert.equal(normalizeVideoNodeDraft({ config: { ratio } }).config.ratio, ratio)
    assert.equal(normalizeVideoNodeDraft({}, { ratio }).config.ratio, ratio)
  }
})

test('sidebar settings synchronize without changing node content or graph ownership', () => {
  const draft = normalizeVideoNodeDraft({
    prompt: 'Keep this node script',
    config: { model: ANMIAO_VIDEO_MODEL },
    references: [{ url: '/first.png', layerId: 'first' }, { url: '/last.png', layerId: 'last' }],
    connectedLayerIds: ['first', 'last'],
  })
  const original = structuredClone(draft)
  const synced = syncVideoNodeGenerationSettings(draft, {
    model: ANMIAO25_VIDEO_MODEL,
    ratio: '9:16',
    resolution: '1080p',
    duration: 30,
    generateAudio: false,
    referenceMode: 'shouweizhen',
  })
  assert.deepEqual(synced.config, {
    model: ANMIAO25_VIDEO_MODEL, ratio: '9:16', resolution: '1080p', duration: 30,
    generateAudio: false, referenceMode: SEEDANCE_FIRST_LAST_MODE,
  })
  assert.equal(synced.prompt, original.prompt)
  assert.deepEqual(synced.references, original.references)
  assert.deepEqual(synced.connectedLayerIds, original.connectedLayerIds)
  assert.deepEqual(draft, original)
  assert.deepEqual(syncVideoNodeGenerationSettings(synced, synced.config), synced)
})

test('sidebar sync retains generic reference mode and repairs H3 constraints', () => {
  const draft = normalizeVideoNodeDraft({
    config: { model: ANMIAO25_VIDEO_MODEL, duration: 30, resolution: '720p', generateAudio: false, referenceMode: 'cankaosheng' },
    references: ['/a.png', '/b.png', '/c.png'].map(url => ({ url })),
  })
  const synced = syncVideoNodeGenerationSettings(draft, { model: MINIMAX_VIDEO_MODEL })
  assert.equal(synced.config.referenceMode, 'cankaosheng')
  assert.equal(synced.config.resolution, '768p')
  assert.equal(synced.config.duration, 15)
  assert.equal(synced.config.generateAudio, true)
  assert.deepEqual(synced.references, draft.references)
})

test('configured video models survive node normalization and graph sync', () => {
  const model = 'configured-video-720p'
  const models = [{ value: model, label: 'Configured video' }]
  const draft = normalizeVideoNodeDraft({ config: { model, generateAudio: false } }, {}, models)
  assert.equal(draft.config.model, model)
  assert.equal(draft.config.resolution, '720p')
  const synced = syncVideoNodeConnectedReferences(draft, [{ url: '/a.png', layerId: 'a' }], models)
  assert.equal(synced.config.model, model)
  assert.equal(synced.config.generateAudio, false)
  assert.equal(syncVideoNodeGenerationSettings(synced, { ratio: '9:16' }, models).config.model, model)
})

test('configured Seedance aliases retain explicit frame mode before model list loads', () => {
  const model = 'seedance-2.5-guanfang-anmiao'
  const draft = normalizeVideoNodeDraft({ config: { model, referenceMode: SEEDANCE_FIRST_LAST_MODE } })
  assert.equal(draft.config.model, model)
  assert.equal(draft.config.referenceMode, SEEDANCE_FIRST_LAST_MODE)
  const synced = syncVideoNodeGenerationSettings(draft, { referenceMode: 'shouweizhen' })
  assert.equal(synced.config.referenceMode, SEEDANCE_FIRST_LAST_MODE)
})

test('node drafts inherit video settings without sharing references', () => {
  const draft = normalizeVideoNodeDraft(
    { prompt: '脚本', references: [{ url: '/a.png', layerId: 'a' }] },
    { model: MINIMAX_VIDEO_MODEL, ratio: '3:4', duration: 5 },
  )
  assert.equal(draft.config.model, MINIMAX_VIDEO_MODEL)
  assert.equal(draft.config.resolution, '768p')
  assert.equal(draft.config.ratio, '3:4')
  assert.equal(draft.config.duration, 5)
  assert.equal(draft.config.generateAudio, true)
  assert.deepEqual(draft.references, [{ url: '/a.png', layerId: 'a', name: '参考图' }])
})

test('switching from SD2.5 to H3 repairs unsupported duration and resolution', () => {
  const sd25 = normalizeVideoNodeDraft({
    config: { model: ANMIAO25_VIDEO_MODEL, duration: 30, resolution: '720p' },
  })
  const h3 = normalizeVideoNodeDraft({
    ...sd25,
    config: { ...sd25.config, model: MINIMAX_VIDEO_MODEL },
  })
  assert.equal(h3.config.duration, 15)
  assert.equal(h3.config.resolution, '768p')
  assert.equal(
    normalizeVideoNodeDraft({ config: { model: 'minimax-h3-max' } }).config.model,
    'seedance-2.0-fast-0826-720p',
  )
})

test('reference limits block submission instead of silently dropping images', () => {
  const draft = normalizeVideoNodeDraft({
    config: { model: MINIMAX_VIDEO_MODEL },
    references: ['/a.png', '/b.png', '/c.png'].map((url) => ({ url })),
  })
  assert.equal(draft.references.length, 3)
  assert.match(videoNodeReferenceError(draft), /2/)
  draft.config.referenceMode = 'cankaosheng'
  assert.equal(videoNodeReferenceError(draft), '')
})

test('drafts remove transient references and normalize persistent fields', () => {
  const reference = { url: '/a.png', layerId: 'a', uploading: true }
  const draft = normalizeVideoNodeDraft({
    prompt: 'a'.repeat(2600),
    references: [reference, reference, { url: 'blob:temporary' }, null],
    config: { ratio: 'invalid', generateAudio: false },
  })
  assert.equal(draft.prompt.length, 2500)
  assert.equal(draft.config.ratio, '3:4')
  assert.equal(draft.config.generateAudio, false)
  assert.equal(draft.references.length, 1)
  assert.equal(draft.references[0].uploading, undefined)
  draft.references[0].url = '/b.png'
  assert.equal(reference.url, '/a.png')
})

test('new Seedance node drafts default to frame slots while old references stay references', () => {
  for (const model of [ANMIAO_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL]) {
    const config = { model, referenceMode: 'shouweizhen' }
    assert.equal(normalizeVideoNodeDraft({ config }).config.referenceMode, SEEDANCE_FIRST_LAST_MODE)
    const old = normalizeVideoNodeDraft({
      config,
      references: [{ url: '/a.png' }, { url: '/b.png' }],
    })
    assert.equal(old.config.referenceMode, 'cankaosheng')
    assert.equal(videoNodeReferenceError(old), '')
    const frames = normalizeVideoNodeDraft({
      ...old,
      config: { ...old.config, referenceMode: SEEDANCE_FIRST_LAST_MODE },
    })
    assert.equal(frames.config.referenceMode, SEEDANCE_FIRST_LAST_MODE)
    assert.deepEqual(frames.references, old.references)
  }
})

const connectedImages = ['a', 'b', 'c'].map((layerId) => ({
  layerId,
  url: `/${layerId}.png`,
  name: layerId,
}))

test('connected images become first frame, last frame, then generic references', () => {
  for (const model of [MINIMAX_VIDEO_MODEL, ANMIAO_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL]) {
    let draft = normalizeVideoNodeDraft({ prompt: 'script', config: { model } })
    for (let count = 1; count <= 3; count += 1) {
      draft = syncVideoNodeConnectedReferences(draft, connectedImages.slice(0, count))
      assert.deepEqual(draft.references, connectedImages.slice(0, count))
      assert.deepEqual(draft.connectedLayerIds, ['a', 'b', 'c'].slice(0, count))
      assert.equal(
        draft.config.referenceMode,
        count > 2
          ? 'cankaosheng'
          : model === MINIMAX_VIDEO_MODEL
            ? 'shouweizhen'
            : SEEDANCE_FIRST_LAST_MODE,
      )
      assert.equal(draft.prompt, 'script')
      assert.equal(videoNodeReferenceError(draft), '')
      const payload = videoReferencePayload(
        model,
        draft.config.referenceMode,
        draft.references.map((image) => image.url),
      )
      assert.deepEqual(
        payload,
        count > 2
          ? { image_urls: ['/a.png', '/b.png', '/c.png'] }
          : { first_frame_url: '/a.png', last_frame_url: count === 2 ? '/b.png' : undefined },
      )
    }
    draft = syncVideoNodeConnectedReferences(draft, connectedImages.slice(0, 2))
    assert.notEqual(draft.config.referenceMode, 'cankaosheng')
    draft = syncVideoNodeConnectedReferences(draft, connectedImages.slice(1, 2))
    assert.deepEqual(draft.references, connectedImages.slice(1, 2))
    draft = syncVideoNodeConnectedReferences(draft, [])
    assert.deepEqual(draft.references, [])
    assert.deepEqual(draft.connectedLayerIds, [])
  }
})

test('graph synchronization preserves manual uploads and explicit frame swaps', () => {
  const upload = { url: '/upload.png', name: 'upload', layerId: '' }
  let draft = syncVideoNodeConnectedReferences(
    normalizeVideoNodeDraft({ config: { model: MINIMAX_VIDEO_MODEL } }),
    connectedImages.slice(0, 2),
  )
  draft.references.reverse()
  draft.references.push(upload)
  const updated = { ...connectedImages[0], url: '/a-updated.png', name: 'updated' }
  draft = syncVideoNodeConnectedReferences(draft, [updated, connectedImages[1]])
  assert.deepEqual(draft.references, [connectedImages[1], updated, upload])
  assert.equal(draft.config.referenceMode, 'cankaosheng')
  draft = syncVideoNodeConnectedReferences(draft, [updated])
  assert.deepEqual(draft.references, [updated, upload])
  assert.equal(draft.config.referenceMode, 'shouweizhen')
  draft = syncVideoNodeConnectedReferences(draft, [])
  assert.deepEqual(draft.references, [upload])
})

test('duplicate graph references are deduplicated and refresh ownership on reconnect', () => {
  let draft = syncVideoNodeConnectedReferences(
    normalizeVideoNodeDraft({ config: { model: MINIMAX_VIDEO_MODEL } }),
    [connectedImages[0], connectedImages[0], { ...connectedImages[0], layerId: 'duplicate' }],
  )
  assert.equal(draft.references.length, 1)
  assert.deepEqual(draft.connectedLayerIds, ['a'])
  draft = syncVideoNodeConnectedReferences(draft, [{ ...connectedImages[0], layerId: 'duplicate' }])
  assert.equal(draft.references.length, 1)
  assert.deepEqual(draft.connectedLayerIds, ['duplicate'])
  draft = syncVideoNodeConnectedReferences(draft, [{ url: 'blob:temporary', layerId: 'pending' }])
  assert.deepEqual(draft.references, [])
})

test('source replacement deduplicates before deciding whether to use frame slots', () => {
  const upload = { url: '/upload.png' }
  let draft = syncVideoNodeConnectedReferences(
    normalizeVideoNodeDraft({ config: { model: MINIMAX_VIDEO_MODEL } }),
    connectedImages.slice(0, 2),
  )
  draft.references.push(upload)
  draft = syncVideoNodeConnectedReferences(draft, [
    { ...connectedImages[0], url: connectedImages[1].url },
    connectedImages[1],
  ])
  assert.equal(draft.references.length, 2)
  assert.equal(draft.config.referenceMode, 'shouweizhen')
})

test('models without frame slots use generic references and retain all connected images', () => {
  const model = 'seedance-2.0-fast-0826-720p'
  const draft = syncVideoNodeConnectedReferences(
    normalizeVideoNodeDraft({ config: { model } }),
    connectedImages,
  )
  assert.equal(draft.config.referenceMode, 'cankaosheng')
  assert.equal(draft.references.length, 3)
  assert.deepEqual(videoReferencePayload(model, draft.config.referenceMode, ['/a.png']), {
    image_urls: ['/a.png'],
  })
})

test('Seedance node drafts retain the audio switch while H3 keeps native audio', () => {
  for (const model of [ANMIAO_VIDEO_MODEL, ANMIAO25_VIDEO_MODEL]) {
    const draft = normalizeVideoNodeDraft({ config: { model, generateAudio: false } })
    assert.equal(draft.config.generateAudio, false)
    const connected = syncVideoNodeConnectedReferences(draft, connectedImages)
    assert.equal(connected.config.generateAudio, false)
    assert.equal(
      normalizeVideoNodeDraft(JSON.parse(JSON.stringify(connected))).config.generateAudio,
      false,
    )
    assert.equal(
      normalizeVideoNodeDraft({ ...draft, config: { ...draft.config, generateAudio: true } }).config
        .generateAudio,
      true,
    )
  }
  assert.equal(
    normalizeVideoNodeDraft({ config: { model: MINIMAX_VIDEO_MODEL, generateAudio: false } }).config
      .generateAudio,
    true,
  )
})
