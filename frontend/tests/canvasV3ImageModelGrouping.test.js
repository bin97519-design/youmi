import test from 'node:test'
import assert from 'node:assert/strict'
import {
  imageModelLabel,
  imageModelMenuOptions,
  imageModelVersion,
} from '../src/features/canvas-v3/config/imageModelVersions.js'
import { imageTaskRequest } from '../src/features/canvas-v3/sync/imageTaskClient.js'

const standard = Object.freeze({
  value: 'model-api-key:44',
  model: 'tt-image-2.5',
  label: 'image-2.5快速',
  provider: 'youmi888',
  defaultVersion: 'flare',
})
const enhanced = Object.freeze({
  value: 'model-api-key:45',
  model: 'tt-image-2.5',
  label: 'image-2.5高质',
  provider: 'youmi888',
  defaultVersion: 'sunburst',
})
const other = Object.freeze({ value: 'banana-pro-api', model: 'banana-pro', label: '香蕉 Pro' })

test('TT image entries collapse at their first position without changing the raw routes', () => {
  const options = Object.freeze([other, standard, enhanced])
  const menu = imageModelMenuOptions(options)
  assert.deepEqual(
    menu.map((option) => option.value),
    [other.value, standard.value],
  )
  assert.deepEqual(menu[0], { ...other, label: 'banana-pro' })
  assert.notEqual(menu[0], other)
  assert.deepEqual(menu[1], { ...standard, label: 'image-2.5' })
  assert.notEqual(menu[1], standard)
  assert.equal(options.length, 3)
  assert.equal(standard.label, 'image-2.5快速')
  assert.equal(enhanced.label, 'image-2.5高质')
})

test('an existing enhanced selection stays selected with its exact route and default version', () => {
  const options = [standard, other, enhanced]
  const menu = imageModelMenuOptions(options, enhanced.value)
  assert.deepEqual(
    menu.map((option) => option.value),
    [enhanced.value, other.value],
  )
  assert.equal(menu[0].defaultVersion, 'sunburst')
  assert.equal(imageModelVersion(menu[0]), 'sunburst')
  assert.equal(imageModelMenuOptions(options, standard.value)[0].value, standard.value)
  assert.equal(imageModelMenuOptions(options, other.value)[0].value, standard.value)
  assert.equal(imageModelMenuOptions(options, 'no-longer-configured')[0].value, standard.value)
})

test('authoritative model identity controls grouping, never an editable model label', () => {
  const renamedOther = { value: 'model-api-key:50', model: 'banana-pro', label: 'image-2.5高质' }
  const unknownRoute = { value: 'model-api-key:51', label: 'tt-image-2.5快速' }
  const misleadingValue = { value: 'tt-image-2.5', model: 'banana-pro', label: 'image-2.5' }
  const renamedTt = { ...enhanced, label: '任意的线路名称' }
  const menu = imageModelMenuOptions([renamedOther, unknownRoute, misleadingValue, renamedTt])
  assert.equal(menu.length, 4)
  assert.deepEqual(menu[0], { ...renamedOther, label: 'banana-pro' })
  assert.equal(menu[1], unknownRoute)
  assert.deepEqual(menu[2], { ...misleadingValue, label: 'banana-pro' })
  assert.equal(menu[3].label, 'image-2.5')
  assert.equal(imageModelLabel(renamedOther), 'banana-pro')
})

test('legacy fast and high aliases share a label while retaining both API identities', () => {
  const fast = { value: 'GPT-image2.5', label: '快速' }
  const high = { value: 'gpt-image2.5-sunburst-api', label: '高质' }
  assert.equal(imageModelMenuOptions([fast, high], high.value)[0].value, high.value)
  assert.equal(imageModelMenuOptions([fast, high], fast.value)[0].value, fast.value)
  assert.equal(imageModelLabel(fast), 'image-2.5')
  assert.equal(imageModelLabel(high), 'image-2.5')
  assert.equal(imageModelVersion(high), 'sunburst')
  assert.equal(imageModelVersion(fast), 'flare')
})

test('group presentation never rewrites the submitted route or explicit version', () => {
  for (const selected of [standard, enhanced]) {
    const [option] = imageModelMenuOptions([standard, enhanced], selected.value)
    for (const version of ['flare', 'sunburst']) {
      const node = {
        data: { kind: 'image', model: selected.value, prompt: '白色花朵', params: { version } },
      }
      const request = imageTaskRequest(node, [], 'stable-client-task', option)
      assert.equal(request.model, selected.value)
      assert.equal(request.version, version)
      assert.equal(node.data.model, selected.value)
    }
  }
})

test('unrelated options and missing catalogues retain existing presentation behavior', () => {
  const options = [
    { value: 'banana2', label: '香蕉 2' },
    { value: 'model-api-key:99', label: '香蕉pro' },
  ]
  assert.deepEqual(imageModelMenuOptions(options), options)
  imageModelMenuOptions(options).forEach((option, index) => assert.equal(option, options[index]))
  assert.deepEqual(imageModelMenuOptions(), [])
  assert.deepEqual(imageModelMenuOptions(null), [])
  assert.equal(imageModelLabel(other), 'banana-pro')
  assert.equal(imageModelLabel(undefined, 'unknown-model'), 'unknown-model')
  assert.equal(imageModelLabel({ value: 'unlabeled-model' }), 'unlabeled-model')
  assert.equal(imageModelLabel('GPT-image2.5'), 'image-2.5')
})

test('Banana Pro aliases receive one consistent display name without adding or rewriting routes', () => {
  for (const model of ['banana-pro', 'banana-pro-api', 'bananapro', 'gemini-3-pro-image-preview']) {
    assert.equal(imageModelLabel(model), 'banana-pro')
    const configured = Object.freeze({
      value: 'model-api-key:86',
      model,
      label: '香蕉pro',
      provider: 'youmi888',
    })
    const menu = imageModelMenuOptions([configured])
    assert.equal(menu.length, 1)
    assert.deepEqual(menu[0], { ...configured, label: 'banana-pro' })
    assert.equal(configured.label, '香蕉pro')
    const request = imageTaskRequest(
      {
        data: { kind: 'image', model: configured.value, prompt: '商品白底图', params: {} },
      },
      [],
      'opaque-pro-route',
      menu[0],
    )
    assert.equal(request.model, configured.value)
    assert.equal(request.parameter_profile, 'canvas-v3-image')
  }
  const alreadyCanonical = { value: 'model-api-key:87', model: 'banana-pro', label: 'banana-pro' }
  assert.equal(imageModelMenuOptions([alreadyCanonical])[0], alreadyCanonical)
  const nonPro = { value: 'banana-pro-api', model: 'banana-2.1', label: '我的21模型' }
  assert.equal(imageModelMenuOptions([nonPro])[0], nonPro)
  assert.equal(imageModelLabel(nonPro), '我的21模型')
})
