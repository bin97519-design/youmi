import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WANXIANG_MODEL,
  isWanxiangModel,
  wanxiangControls,
  wanxiangParams,
  wanxiangSummary,
} from '../src/features/canvas-v3/config/wanxiangParameters.js'

test('Wanxiang identities are exact and configured model takes precedence over an editable label/value', () => {
  for (const input of [WANXIANG_MODEL, '万相 3.0', { model: WANXIANG_MODEL, value: 'route:5' }])
    assert.equal(isWanxiangModel(input), true)
  for (const input of [
    null,
    '万相 3.0 全能',
    'wan3.0',
    'wan3.0-video-quannengcankao-fake',
    { model: 'different-api', value: '万相 3.0', label: '万相 3.0 全能' },
    { label: '万相 3.0 全能' },
  ])
    assert.equal(isWanxiangModel(input), false)
})

test('Wanxiang controls expose exactly the documented scalar enums and required fields', () => {
  const profile = wanxiangControls()
  assert.equal(profile.apiModel, WANXIANG_MODEL)
  assert.deepEqual(
    profile.fields.map((item) => item.key),
    ['version', 'resolution', 'duration', 'ratio', 'audio', 'prompt_extend'],
  )
  const values = Object.fromEntries(
    profile.fields.map((item) => [item.key, item.options.map((option) => option.value)]),
  )
  assert.deepEqual(values.version, ['standard', 'prime'])
  assert.deepEqual(values.resolution, ['480P', '720P', '1080P'])
  assert.deepEqual(values.duration, [
    'auto',
    ...Array.from({ length: 29 }, (_, i) => String(i + 2)),
  ])
  assert.deepEqual(values.ratio, ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'])
  assert.deepEqual(values.audio, [true, false])
  assert.deepEqual(values.prompt_extend, [true, false])
  assert.deepEqual(
    profile.fields.filter((item) => item.required).map((item) => item.key),
    ['version', 'resolution', 'duration'],
  )
  assert.equal(profile.assetLimits.images.max, 10)
  assert.equal(profile.assetLimits.video.max, 5)
  assert.equal(profile.assetLimits.video.maxDuration, 15)
  assert.equal(profile.assetLimits.audio.max, 5)
  assert.match(profile.notes.join(' '), /预扣/)
  assert.match(profile.notes.join(' '), /不自动设为首尾帧/)
})

test('Wanxiang normalization is a pure white-listed UI view, preserving auto and false', () => {
  const input = {
    version: 'prime',
    resolution: '1080P',
    duration: 'auto',
    ratio: '3:4',
    audio: false,
    prompt_extend: true,
    count: '4个',
    seed: 99,
    quality: '高清',
    notify_url: 'https://example.com/callback',
  }
  const before = structuredClone(input)
  const normalized = wanxiangParams(input)
  assert.deepEqual(normalized, {
    version: 'prime',
    resolution: '1080P',
    duration: 'auto',
    ratio: '3:4',
    audio: false,
    prompt_extend: true,
  })
  assert.deepEqual(input, before)
  assert.equal(wanxiangParams({ duration: 30 }).duration, '30')
  assert.equal(wanxiangParams({ audio: 'false' }).audio, false)
  assert.equal(wanxiangParams({ prompt_extend: 'true' }).prompt_extend, true)
  assert.deepEqual(
    wanxiangParams({ duration: 1.5, version: '快速', ratio: '21:9' }),
    wanxiangControls().defaults,
  )
  assert.deepEqual(wanxiangParams(null), wanxiangControls().defaults)
})

test('Wanxiang summary names adaptive, auto, speed and audio rather than generic output count', () => {
  assert.equal(wanxiangSummary(), '自适应 · 标准版 · 720P · 5s · 有声')
  assert.equal(
    wanxiangSummary({ version: 'prime', ratio: '9:16', duration: 'auto', audio: false }),
    '9:16 · 高速版 · 720P · 智能时长 · 无声',
  )
})

test('control callers never share mutable defaults or option arrays', () => {
  const first = wanxiangControls()
  first.defaults.version = 'bad'
  first.fields[0].options[0].label = 'bad'
  first.assetLimits.video.max = 999
  const next = wanxiangControls()
  assert.equal(next.defaults.version, 'standard')
  assert.equal(next.fields[0].options[0].label, '标准版')
  assert.equal(next.assetLimits.video.max, 5)
})
