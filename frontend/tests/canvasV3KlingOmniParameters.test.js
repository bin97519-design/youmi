import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KLING_OMNI_API_MODELS,
  klingOmniControls,
  klingOmniParams,
  klingOmniSummary,
} from '../src/features/canvas-v3/config/klingOmniParameters.js'

function choices(profile, key) {
  return profile.fields.find((field) => field.key === key)?.options.map((option) => option.value)
}

test('each Omni UI mode identifies exactly its documented API contract without changing the selected model', () => {
  assert.deepEqual(KLING_OMNI_API_MODELS, {
    视频参考: 'kling-v3-omni-videoref',
    参考生: 'kling-v3-omni-cankao',
    首尾帧: 'kling-v3-omni-shouweizhen',
  })
  for (const mode of Object.keys(KLING_OMNI_API_MODELS))
    assert.equal(klingOmniControls(mode).apiModel, KLING_OMNI_API_MODELS[mode])
  for (const mode of [undefined, '', '历史模式', '文生视频']) {
    assert.equal(klingOmniControls(mode).label, '视频参考')
    assert.equal(klingOmniControls(mode).apiModel, KLING_OMNI_API_MODELS.视频参考)
  }
})

test('reference generation exposes only standard/pro quality, 5/10/15 seconds and the three ratios', () => {
  const profile = klingOmniControls('参考生')
  assert.deepEqual(
    profile.fields.map((field) => field.key),
    ['mode', 'duration', 'aspect_ratio'],
  )
  assert.deepEqual(choices(profile, 'mode'), ['std', 'pro'])
  assert.deepEqual(choices(profile, 'duration'), ['5', '10', '15'])
  assert.deepEqual(choices(profile, 'aspect_ratio'), ['16:9', '9:16', '1:1'])
  assert.deepEqual(
    profile.fields.filter((field) => field.required).map((field) => field.key),
    ['mode', 'duration'],
  )
  assert.deepEqual(profile.assetLimits, {
    images: { min: 0, max: 7, required: false, label: '参考图片' },
  })
  assert.deepEqual(klingOmniParams('参考生'), { mode: 'std', duration: '5', aspect_ratio: '16:9' })
  assert.match(profile.notes.join(' '), /纯文生视频.*最多7张/)
})

test('video reference feature mode exposes only documented options and video constraints', () => {
  const profile = klingOmniControls('视频参考')
  assert.deepEqual(
    profile.fields.map((field) => field.key),
    ['refer_type', 'mode', 'duration', 'aspect_ratio', 'keep_original_sound'],
  )
  assert.deepEqual(choices(profile, 'refer_type'), ['feature', 'base'])
  assert.deepEqual(choices(profile, 'duration'), ['5', '10'])
  assert.deepEqual(choices(profile, 'mode'), ['std', 'pro'])
  assert.deepEqual(choices(profile, 'aspect_ratio'), ['16:9', '9:16', '1:1'])
  assert.deepEqual(choices(profile, 'keep_original_sound'), ['yes', 'no'])
  assert.deepEqual(
    profile.fields.filter((field) => field.required).map((field) => field.key),
    ['refer_type', 'mode'],
  )
  assert.deepEqual(profile.assetLimits, {
    images: { min: 0, max: 4, required: false, label: '参考图片' },
    video: {
      min: 1,
      max: 1,
      required: true,
      formats: ['mp4', 'mov'],
      maxSizeMB: 100,
      minWidth: 700,
      minDuration: 3,
      maxDuration: 10,
    },
  })
  assert.deepEqual(klingOmniParams('视频参考'), {
    refer_type: 'feature',
    mode: 'std',
    duration: '5',
    aspect_ratio: '16:9',
    keep_original_sound: 'yes',
  })
})

test('instruction transformation hides and excludes time, ratio and sound override instead of merely disabling them', () => {
  const raw = {
    refer_type: 'base',
    mode: 'pro',
    duration: '10',
    aspect_ratio: '9:16',
    keep_original_sound: 'no',
  }
  const before = structuredClone(raw)
  const profile = klingOmniControls('视频参考', raw)
  assert.deepEqual(
    profile.fields.map((field) => field.key),
    ['refer_type', 'mode'],
  )
  assert.deepEqual(profile.defaults, { refer_type: 'base', mode: 'std' })
  assert.deepEqual(klingOmniParams('视频参考', raw), { refer_type: 'base', mode: 'pro' })
  assert.match(profile.notes.join(' '), /时长.*比例.*跟随输入视频.*始终保留原声/)
  assert.deepEqual(raw, before)
  const feature = klingOmniParams('视频参考', { ...raw, refer_type: 'feature' })
  assert.deepEqual(feature, { ...raw, refer_type: 'feature' })
})

test('first/last frames require one or two images and never expose or retain an aspect ratio', () => {
  const profile = klingOmniControls('首尾帧')
  assert.deepEqual(
    profile.fields.map((field) => field.key),
    ['mode', 'duration'],
  )
  assert.deepEqual(choices(profile, 'duration'), ['5', '10', '15'])
  assert.deepEqual(profile.assetLimits, {
    images: { min: 1, max: 2, required: true, label: '首尾帧' },
  })
  assert.deepEqual(
    klingOmniParams('首尾帧', { mode: 'pro', duration: '15', aspect_ratio: '1:1' }),
    {
      mode: 'pro',
      duration: '15',
    },
  )
  assert.match(profile.notes.join(' '), /1张.*首帧.*2张.*首帧.*尾帧/)
  assert.match(profile.notes.join(' '), /比例跟随首帧/)
})

test('all profiles discard undeclared API fields, media payloads and webhook from scalar settings without mutating inputs', () => {
  const stale = {
    ratio: '21:9',
    resolution: '4K',
    count: '4个',
    audio: false,
    version: '快速',
    search: true,
    images: ['https://example.com/ref.png'],
    video: 'https://example.com/input.mp4',
    notify_url: 'https://example.com/hook',
    prompt: 'Keep',
    token: 'not-a-secret-test-value',
    mode: 'std',
    duration: 10,
    aspect_ratio: '9:16',
    refer_type: 'feature',
    keep_original_sound: 'no',
  }
  const before = structuredClone(stale)
  for (const mode of Object.keys(KLING_OMNI_API_MODELS)) {
    const result = klingOmniParams(mode, stale)
    const fieldKeys = klingOmniControls(mode, stale).fields.map((field) => field.key)
    assert.deepEqual(Object.keys(result), fieldKeys)
    for (const value of Object.values(result)) assert.equal(typeof value, 'string')
    assert.equal(result.duration, '10')
  }
  assert.deepEqual(stale, before)
})

test('invalid enum values and non-object inputs fall back only to UI example choices', () => {
  for (const raw of [undefined, null, [], 123, 'bad']) {
    assert.deepEqual(klingOmniParams('参考生', raw), {
      mode: 'std',
      duration: '5',
      aspect_ratio: '16:9',
    })
  }
  assert.deepEqual(
    klingOmniParams('参考生', { mode: 'high', duration: '6', aspect_ratio: 'Auto' }),
    {
      mode: 'std',
      duration: '5',
      aspect_ratio: '16:9',
    },
  )
  assert.deepEqual(
    klingOmniParams('视频参考', { refer_type: 'edit', duration: '15', keep_original_sound: false }),
    {
      refer_type: 'feature',
      mode: 'std',
      duration: '5',
      aspect_ratio: '16:9',
      keep_original_sound: 'yes',
    },
  )
  assert.deepEqual(klingOmniParams('首尾帧', { mode: 'pro', duration: 15 }), {
    mode: 'pro',
    duration: '15',
  })
})

test('mode switches cannot retain another contract’s invalid options', () => {
  const frames = klingOmniParams('首尾帧', { mode: 'pro', duration: '15' })
  assert.deepEqual(klingOmniParams('视频参考', frames), {
    refer_type: 'feature',
    mode: 'pro',
    duration: '5',
    aspect_ratio: '16:9',
    keep_original_sound: 'yes',
  })
  const editing = klingOmniParams('视频参考', { mode: 'pro', refer_type: 'base', duration: '10' })
  assert.deepEqual(klingOmniParams('参考生', editing), {
    mode: 'pro',
    duration: '5',
    aspect_ratio: '16:9',
  })
  assert.deepEqual(klingOmniParams('首尾帧', editing), { mode: 'pro', duration: '5' })
})

test('field option labels are human readable while values remain exact API enums', () => {
  const profile = klingOmniControls('视频参考')
  assert.deepEqual(profile.fields[0].options, [
    { value: 'feature', label: '视频参考' },
    { value: 'base', label: '指令变换' },
  ])
  assert.deepEqual(profile.fields[1].options, [
    { value: 'std', label: '标准' },
    { value: 'pro', label: '高品质' },
  ])
  assert.deepEqual(profile.fields[2].options, [
    { value: '5', label: '5秒' },
    { value: '10', label: '10秒' },
  ])
  assert.deepEqual(profile.fields[4].options, [
    { value: 'yes', label: '保留' },
    { value: 'no', label: '不保留' },
  ])
})

test('profiles are fresh values so mutating a returned option cannot pollute later popups', () => {
  const changed = klingOmniControls('视频参考')
  changed.fields[0].options[0].value = 'broken'
  changed.assetLimits.video.formats.push('avi')
  changed.defaults.mode = 'broken'
  assert.deepEqual(choices(klingOmniControls('视频参考'), 'refer_type'), ['feature', 'base'])
  assert.deepEqual(klingOmniControls('视频参考').assetLimits.video.formats, ['mp4', 'mov'])
  assert.equal(klingOmniControls('视频参考').defaults.mode, 'std')
})

test('summary reflects active API options without exposing removed resolution/count or inactive overrides', () => {
  assert.equal(
    klingOmniSummary('参考生', { mode: 'pro', duration: '15', aspect_ratio: '1:1' }),
    '1:1 · 高品质 · 15s',
  )
  assert.equal(klingOmniSummary('首尾帧'), '标准 · 5s · 比例跟随首帧')
  assert.equal(klingOmniSummary('视频参考'), '16:9 · 标准 · 5s · 保留原声')
  assert.equal(
    klingOmniSummary('视频参考', { keep_original_sound: 'no' }),
    '16:9 · 标准 · 5s · 不保留原声',
  )
  const summary = klingOmniSummary('视频参考', {
    refer_type: 'base',
    mode: 'pro',
    duration: '10',
    aspect_ratio: '9:16',
    keep_original_sound: 'no',
    resolution: '4K',
    count: '4个',
  })
  assert.equal(summary, '指令变换 · 高品质 · 时长/比例跟随视频 · 保留原声')
  assert.doesNotMatch(summary, /10s|9:16|不保留|4K|4个/)
})
